-- Apoio ao Cliente: chat do site (botão flutuante no tema Shopify).
--
-- O dashboard é a fonte de verdade deste canal: as mensagens do cliente entram diretamente pelas
-- rotas públicas /api/chat/* e as respostas ficam guardadas aqui até o widget as ir buscar.
-- Cada visitante recebe um token aleatório (só o hash fica guardado) que dá acesso apenas à sua
-- própria conversa. Notas internas nunca são devolvidas ao visitante.
--
-- Identidade: o email escrito no chat não é confirmado (qualquer pessoa pode escrever o email de
-- outra). Fica em claimed_email e não conta para encomendas, sugestões nem para a IA; só quando o
-- cliente tem sessão iniciada na loja (assinatura do tema verificada no servidor) é que vai para email.

alter table public.ldo_support_sources drop constraint ldo_support_sources_platform_check;
alter table public.ldo_support_sources add constraint ldo_support_sources_platform_check
  check (platform in ('zendesk', 'metricool', 'whatsapp', 'site'));
alter table public.ldo_support_sources drop constraint ldo_support_sources_channel_check;
alter table public.ldo_support_sources add constraint ldo_support_sources_channel_check
  check (channel in ('zendesk', 'facebook', 'instagram', 'whatsapp', 'site'));

insert into public.ldo_support_sources (id, platform, channel, account, label, status, status_detail, config)
values ('site-chat', 'site', 'site', 'lojadoouro.pt', 'Chat do site', 'active', 'Mensagens recebidas diretamente pelo dashboard.', '{}');

alter table public.ldo_support_contacts
  add column claimed_email text check (claimed_email is null or length(claimed_email) <= 254);

create table public.ldo_support_site_visitors (
  id uuid primary key,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  contact_id uuid not null references public.ldo_support_contacts (id) on delete cascade,
  conversation_id uuid not null references public.ldo_support_conversations (id) on delete cascade,
  name text not null check (length(name) between 1 and 80),
  email text not null check (length(email) between 3 and 254),
  verified boolean not null default false,
  ip_hash text not null check (ip_hash ~ '^[0-9a-f]{64}$'),
  user_agent text check (user_agent is null or length(user_agent) <= 300),
  page_url text check (page_url is null or length(page_url) <= 500),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  notified_at timestamptz
);
create index ldo_support_site_visitors_ip_idx on public.ldo_support_site_visitors (ip_hash, created_at desc);
create index ldo_support_site_visitors_conv_idx on public.ldo_support_site_visitors (conversation_id);
create index ldo_support_site_visitors_created_idx on public.ldo_support_site_visitors (created_at);
alter table public.ldo_support_site_visitors enable row level security;
revoke all on public.ldo_support_site_visitors from anon, authenticated;

-- ---------------------------------------------------------------- auxiliares

-- Visitante pelo hash do token (sessão do chat). Erro P0401 = recomeçar o chat.
create function ldo_private.site_visitor(p_token_hash text) returns public.ldo_support_site_visitors
language plpgsql stable security definer set search_path = '' as $$
declare v public.ldo_support_site_visitors;
begin
  select * into v from public.ldo_support_site_visitors where token_hash = p_token_hash;
  if v.id is null then
    raise exception 'Esta conversa já não está disponível. Inicie uma nova.' using errcode = 'P0401';
  end if;
  return v;
end;
$$;

-- Texto de uma mensagem do visitante: sem caracteres de controlo (exceto mudanças de linha).
create function ldo_private.site_clean(p_text text, p_max integer) returns text
language sql immutable set search_path = '' as $$
  select left(btrim(regexp_replace(replace(coalesce(p_text, ''), E'\r', ''), '[\x01-\x09\x0B-\x1F\x7F]+', ' ', 'g')), p_max);
$$;

-- ---------------------------------------------------------------- funções do servidor (rotas públicas)

-- Novo visitante com a primeira mensagem. Limites: 5 conversas por IP por hora, 20 por dia e 300 no
-- total por hora (contra inundações). Erro P0429 = demasiados pedidos.
create function public.ldo_support_site_start(p_token text, p_token_hash text, p_name text, p_email text, p_verified boolean,
  p_message text, p_client_key uuid, p_page text, p_ip_hash text, p_user_agent text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_name text := ldo_private.site_clean(p_name, 80);
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_body text := ldo_private.site_clean(p_message, 2000);
  v_id uuid := gen_random_uuid();
  v_contact uuid;
  v_conv uuid;
begin
  perform ldo_private.bi_check(p_token);
  if p_token_hash !~ '^[0-9a-f]{64}$' or p_ip_hash !~ '^[0-9a-f]{64}$' or p_client_key is null then
    raise exception 'Pedido inválido.' using errcode = '22023';
  end if;
  if v_name = '' then
    raise exception 'Indique o seu nome.' using errcode = '22023';
  end if;
  if length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]{2,}$' then
    raise exception 'Indique um email válido.' using errcode = '22023';
  end if;
  if v_body = '' then
    raise exception 'Escreva a sua mensagem.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.ldo_support_sources where id = 'site-chat' and status = 'active') then
    raise exception 'O chat está indisponível de momento.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('ldo_site_ip:' || p_ip_hash, 0));
  if (select count(*) from public.ldo_support_site_visitors where ip_hash = p_ip_hash and created_at > now() - interval '1 hour') >= 5
     or (select count(*) from public.ldo_support_site_visitors where ip_hash = p_ip_hash and created_at > now() - interval '1 day') >= 20
     or (select count(*) from public.ldo_support_site_visitors where created_at > now() - interval '1 hour') >= 300 then
    raise exception 'Demasiadas conversas iniciadas. Tente novamente mais tarde.' using errcode = 'P0429';
  end if;

  insert into public.ldo_support_contacts (channel, account, external_id, name, email, claimed_email)
  values ('site', 'lojadoouro.pt', v_id::text, v_name, case when p_verified then v_email end, v_email)
  returning id into v_contact;
  insert into public.ldo_support_conversations (source_id, channel, account, external_id, contact_id, subject, status, via)
  values ('site-chat', 'site', 'lojadoouro.pt', v_id::text, v_contact, 'Chat do site', 'novo', 'site')
  returning id into v_conv;
  insert into public.ldo_support_site_visitors (id, token_hash, contact_id, conversation_id, name, email, verified, ip_hash, user_agent, page_url)
  values (v_id, p_token_hash, v_contact, v_conv, v_name, v_email, coalesce(p_verified, false), p_ip_hash,
    left(p_user_agent, 300), left(p_page, 500));
  insert into public.ldo_support_messages (conversation_id, external_id, kind, author_name, author_external_id, body, created_at)
  values (v_conv, 'site:' || p_client_key, 'inbound', v_name, v_id::text, v_body, now());
  perform ldo_private.support_summarize(v_conv);
  return jsonb_build_object('visitor', v_id, 'conversation', v_conv);
end;
$$;

-- Mensagem do visitante numa conversa existente. A mesma chave não cria duas mensagens.
-- Limites: 20 mensagens em 5 minutos e 200 por dia. Reabre como as mensagens novas dos outros canais.
create function public.ldo_support_site_send(p_token text, p_token_hash text, p_body text, p_client_key uuid, p_page text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v public.ldo_support_site_visitors;
  v_c public.ldo_support_conversations;
  v_body text := ldo_private.site_clean(p_body, 2000);
  v_m public.ldo_support_messages;
begin
  perform ldo_private.bi_check(p_token);
  v := ldo_private.site_visitor(p_token_hash);
  if p_client_key is null then
    raise exception 'Pedido inválido.' using errcode = '22023';
  end if;
  if v_body = '' then
    raise exception 'Escreva a sua mensagem.' using errcode = '22023';
  end if;
  select * into v_m from public.ldo_support_messages where conversation_id = v.conversation_id and external_id = 'site:' || p_client_key;
  if v_m.id is not null then
    return jsonb_build_object('id', v_m.id, 'created_at', v_m.created_at, 'repeated', true);
  end if;
  perform pg_advisory_xact_lock(hashtextextended('ldo_site_conv:' || v.conversation_id::text, 0));
  if (select count(*) from public.ldo_support_messages where conversation_id = v.conversation_id and kind = 'inbound'
        and inserted_at > now() - interval '5 minutes') >= 20
     or (select count(*) from public.ldo_support_messages where conversation_id = v.conversation_id and kind = 'inbound'
        and inserted_at > now() - interval '1 day') >= 200 then
    raise exception 'Enviou muitas mensagens seguidas. Aguarde um pouco.' using errcode = 'P0429';
  end if;
  insert into public.ldo_support_messages (conversation_id, external_id, kind, author_name, author_external_id, body, created_at)
  values (v.conversation_id, 'site:' || p_client_key, 'inbound', v.name, v.id::text, v_body, now())
  returning * into v_m;
  select * into v_c from public.ldo_support_conversations where id = v.conversation_id for update;
  if v_c.status in ('resolvido', 'aguarda_cliente') then
    update public.ldo_support_conversations set
      status = case when v_c.status = 'resolvido' and assignee_id is null then 'novo' else 'em_atendimento' end, updated_at = now()
    where id = v_c.id;
    insert into public.ldo_support_audit (actor, conversation_id, action, details)
    values (null, v_c.id, 'reopen', jsonb_build_object('from', v_c.status, 'reason', 'Nova mensagem do cliente'));
  end if;
  update public.ldo_support_site_visitors set last_seen_at = now(), page_url = coalesce(left(p_page, 500), page_url) where id = v.id;
  perform ldo_private.support_summarize(v.conversation_id);
  return jsonb_build_object('id', v_m.id, 'created_at', v_m.created_at, 'repeated', false);
end;
$$;

-- Mensagens da conversa do visitante (as do cliente e as respostas aceites; nunca notas internas).
-- Ao serem lidas pelo widget as respostas passam a "Entregue" e, com o chat aberto, a "Lida".
create function public.ldo_support_site_messages(p_token text, p_token_hash text, p_after timestamptz, p_open boolean) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v public.ldo_support_site_visitors;
begin
  perform ldo_private.bi_check(p_token);
  v := ldo_private.site_visitor(p_token_hash);
  update public.ldo_support_site_visitors set last_seen_at = now() where id = v.id;
  update public.ldo_support_messages set delivery = case when coalesce(p_open, false) then 'read' else 'delivered' end
  where conversation_id = v.conversation_id and kind = 'outbound' and deleted_at is null
    and (delivery = 'accepted' or (coalesce(p_open, false) and delivery = 'delivered'));
  return jsonb_build_object(
    'name', v.name,
    'email', v.email,
    'verified', v.verified,
    'typing', exists (select 1 from public.ldo_support_presence p where p.conversation_id = v.conversation_id
      and p.composing and p.seen_at > now() - interval '25 seconds'),
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'from', case when m.kind = 'inbound' then 'visitor' else 'team' end,
        'author', case when m.kind = 'inbound' then null
          else nullif(split_part(btrim(coalesce(u.full_name, u.username, '')), ' ', 1), '') end,
        'body', m.body, 'created_at', m.created_at, 'inserted_at', m.inserted_at) order by m.created_at, m.inserted_at)
      from (select * from public.ldo_support_messages
            where conversation_id = v.conversation_id and deleted_at is null
              and (kind = 'inbound' or (kind = 'outbound' and delivery in ('accepted', 'delivered', 'read')))
              and (p_after is null or inserted_at > p_after)
            order by inserted_at desc limit 200) m
      left join public.ldo_app_users u on u.id = m.author_user_id), '[]'::jsonb)
  );
end;
$$;

-- Notificação por email de uma resposta: só se o visitante não estiver com o site aberto (sem contacto
-- há mais de p_idle_seconds) e no máximo um email a cada p_every_minutes por conversa. Reserva o envio
-- (notified_at) para dois envios seguidos não mandarem dois emails.
create function public.ldo_support_site_claim_notify(p_token text, p_conversation uuid, p_idle_seconds integer, p_every_minutes integer) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v public.ldo_support_site_visitors;
begin
  perform ldo_private.bi_check(p_token);
  update public.ldo_support_site_visitors set notified_at = now()
  where id = (select id from public.ldo_support_site_visitors where conversation_id = p_conversation order by last_seen_at desc limit 1)
    and last_seen_at < now() - make_interval(secs => greatest(p_idle_seconds, 0))
    and (notified_at is null or notified_at < now() - make_interval(mins => greatest(p_every_minutes, 0)))
  returning * into v;
  if v.id is null then
    return null;
  end if;
  return jsonb_build_object('email', v.email, 'name', v.name);
end;
$$;

-- Tokens de visitantes sem atividade há mais de 180 dias deixam de funcionar (a conversa fica).
create function public.ldo_support_site_purge(p_token text) returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare v_n integer;
begin
  perform ldo_private.bi_check(p_token);
  delete from public.ldo_support_site_visitors where last_seen_at < now() - interval '180 days';
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- ---------------------------------------------------------------- acessos

revoke all on function ldo_private.site_visitor(text), ldo_private.site_clean(text, integer) from public, anon, authenticated;
revoke all on function
  public.ldo_support_site_start(text, text, text, text, boolean, text, uuid, text, text, text),
  public.ldo_support_site_send(text, text, text, uuid, text),
  public.ldo_support_site_messages(text, text, timestamptz, boolean),
  public.ldo_support_site_claim_notify(text, uuid, integer, integer),
  public.ldo_support_site_purge(text)
from public, authenticated;
grant execute on function
  public.ldo_support_site_start(text, text, text, text, boolean, text, uuid, text, text, text),
  public.ldo_support_site_send(text, text, text, uuid, text),
  public.ldo_support_site_messages(text, text, timestamptz, boolean),
  public.ldo_support_site_claim_notify(text, uuid, integer, integer),
  public.ldo_support_site_purge(text)
to anon;
