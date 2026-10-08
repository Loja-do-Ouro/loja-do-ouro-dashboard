-- Chat do site: correções da revisão.
--
-- 1. Conversa confirmada (cliente com sessão iniciada na loja) só continua com a mesma sessão: cada pedido
--    traz o email assinado pelo tema e, se não bater certo, o chat tem de recomeçar (computadores partilhados).
-- 2. Limites contra abuso por rede (/24) e por IP, também nas mensagens; o teto global deixa de ser um
--    interruptor fácil de acionar (só protege a base de dados de inundações muito grandes).
-- 3. As respostas passam a contar para o widget a partir do momento em que ficam visíveis (inserted_at
--    atualizado ao serem aceites); só as mensagens devolvidas ficam Entregue/Lida.
-- 4. Avisos por email diferidos e agrupados: quem saiu do site recebe todas as respostas que ainda não viu,
--    com nova tentativa se o envio falhar.
-- 5. Ao cliente só aparece o primeiro nome do colaborador (nunca o utilizador de login).
-- 6. Início de conversa idempotente (a mesma chave repetida não cria outra conversa).
-- 7. A pesquisa da caixa de entrada encontra conversas do site pelo email escrito pelo cliente.

alter table public.ldo_support_site_visitors
  add column ip_prefix_hash text check (ip_prefix_hash is null or ip_prefix_hash ~ '^[0-9a-f]{64}$'),
  add column notified_until timestamptz,
  add column notify_lease_until timestamptz;
create index ldo_support_site_visitors_prefix_idx on public.ldo_support_site_visitors (ip_prefix_hash, created_at desc);
create index ldo_support_messages_site_key_idx on public.ldo_support_messages (external_id) where external_id like 'site:%';

drop function public.ldo_support_site_start(text, text, text, text, boolean, text, uuid, text, text, text);
drop function public.ldo_support_site_send(text, text, text, uuid, text);
drop function public.ldo_support_site_messages(text, text, timestamptz, boolean);
drop function public.ldo_support_site_claim_notify(text, uuid, integer, integer);
drop function ldo_private.site_visitor(text);

-- Visitante pelo hash do token. Conversa confirmada: o pedido tem de trazer o mesmo email assinado.
create function ldo_private.site_visitor(p_token_hash text, p_identity_email text) returns public.ldo_support_site_visitors
language plpgsql stable security definer set search_path = '' as $$
declare v public.ldo_support_site_visitors;
begin
  select * into v from public.ldo_support_site_visitors where token_hash = p_token_hash;
  if v.id is null or (v.verified and lower(coalesce(p_identity_email, '')) <> v.email) then
    raise exception 'Esta conversa já não está disponível. Inicie uma nova.' using errcode = 'P0401';
  end if;
  return v;
end;
$$;

create function public.ldo_support_site_start(p_token text, p_token_hash text, p_name text, p_email text, p_verified boolean,
  p_message text, p_client_key uuid, p_page text, p_ip_hash text, p_ip_prefix_hash text, p_user_agent text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_name text := ldo_private.site_clean(p_name, 80);
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_body text := ldo_private.site_clean(p_message, 2000);
  v_id uuid := gen_random_uuid();
  v_contact uuid;
  v_conv uuid;
  v_prev public.ldo_support_site_visitors;
begin
  perform ldo_private.bi_check(p_token);
  if p_token_hash !~ '^[0-9a-f]{64}$' or p_ip_hash !~ '^[0-9a-f]{64}$' or p_ip_prefix_hash !~ '^[0-9a-f]{64}$' or p_client_key is null then
    raise exception 'Pedido inválido.' using errcode = '22023';
  end if;
  -- Repetição do mesmo início (resposta perdida): a conversa já criada passa a usar o token novo.
  select v.* into v_prev from public.ldo_support_messages m
    join public.ldo_support_site_visitors v on v.conversation_id = m.conversation_id and v.id::text = m.author_external_id
  where m.external_id = 'site:' || p_client_key limit 1;
  if v_prev.id is not null then
    if v_prev.ip_hash <> p_ip_hash or v_prev.created_at < now() - interval '15 minutes' or v_prev.email <> v_email then
      raise exception 'Pedido inválido.' using errcode = '22023';
    end if;
    update public.ldo_support_site_visitors set token_hash = p_token_hash, last_seen_at = now() where id = v_prev.id;
    return jsonb_build_object('visitor', v_prev.id, 'conversation', v_prev.conversation_id, 'repeated', true);
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
  perform pg_advisory_xact_lock(hashtextextended('ldo_site_ip:' || p_ip_prefix_hash, 0));
  if (select count(*) from public.ldo_support_site_visitors where ip_hash = p_ip_hash and created_at > now() - interval '1 hour') >= 5
     or (select count(*) from public.ldo_support_site_visitors where ip_hash = p_ip_hash and created_at > now() - interval '1 day') >= 20
     or (select count(*) from public.ldo_support_site_visitors where ip_prefix_hash = p_ip_prefix_hash and created_at > now() - interval '1 hour') >= 30
     or (select count(*) from public.ldo_support_site_visitors where created_at > now() - interval '1 hour') >= 1000 then
    raise exception 'Demasiadas conversas iniciadas. Tente novamente mais tarde.' using errcode = 'P0429';
  end if;

  insert into public.ldo_support_contacts (channel, account, external_id, name, email, claimed_email)
  values ('site', 'lojadoouro.pt', v_id::text, v_name, case when p_verified then v_email end, v_email)
  returning id into v_contact;
  insert into public.ldo_support_conversations (source_id, channel, account, external_id, contact_id, subject, status, via)
  values ('site-chat', 'site', 'lojadoouro.pt', v_id::text, v_contact, 'Chat do site', 'novo', 'site')
  returning id into v_conv;
  insert into public.ldo_support_site_visitors (id, token_hash, contact_id, conversation_id, name, email, verified, ip_hash, ip_prefix_hash, user_agent, page_url)
  values (v_id, p_token_hash, v_contact, v_conv, v_name, v_email, coalesce(p_verified, false), p_ip_hash, p_ip_prefix_hash,
    left(p_user_agent, 300), left(p_page, 500));
  insert into public.ldo_support_messages (conversation_id, external_id, kind, author_name, author_external_id, body, created_at)
  values (v_conv, 'site:' || p_client_key, 'inbound', v_name, v_id::text, v_body, now());
  perform ldo_private.support_summarize(v_conv);
  return jsonb_build_object('visitor', v_id, 'conversation', v_conv, 'repeated', false);
end;
$$;

-- Mensagem do visitante. Limites: por conversa (20 em 5 min, 200 por dia), por IP (120 por hora) e um
-- teto geral de 5000 por hora só para proteger a base de dados.
create function public.ldo_support_site_send(p_token text, p_token_hash text, p_identity_email text, p_body text, p_client_key uuid,
  p_page text, p_ip_hash text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v public.ldo_support_site_visitors;
  v_c public.ldo_support_conversations;
  v_body text := ldo_private.site_clean(p_body, 2000);
  v_m public.ldo_support_messages;
begin
  perform ldo_private.bi_check(p_token);
  v := ldo_private.site_visitor(p_token_hash, p_identity_email);
  if p_client_key is null or coalesce(p_ip_hash, '') !~ '^[0-9a-f]{64}$' then
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
        and inserted_at > now() - interval '1 day') >= 200
     or (select count(*) from public.ldo_support_messages m join public.ldo_support_site_visitors x on x.conversation_id = m.conversation_id
        where x.ip_hash = p_ip_hash and m.kind = 'inbound' and m.inserted_at > now() - interval '1 hour') >= 120
     or (select count(*) from public.ldo_support_messages m join public.ldo_support_conversations c on c.id = m.conversation_id
        where c.channel = 'site' and m.kind = 'inbound' and m.inserted_at > now() - interval '1 hour') >= 5000 then
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

-- Mensagens da conversa (do cliente e respostas aceites; nunca notas internas). Só as respostas devolvidas
-- passam a Entregue (ou Lida com o chat aberto). Do colaborador só sai o primeiro nome.
create function public.ldo_support_site_messages(p_token text, p_token_hash text, p_identity_email text, p_after timestamptz, p_open boolean) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v public.ldo_support_site_visitors;
  v_list jsonb;
  v_ids uuid[];
begin
  perform ldo_private.bi_check(p_token);
  v := ldo_private.site_visitor(p_token_hash, p_identity_email);
  if v.last_seen_at < now() - interval '2 seconds' then
    update public.ldo_support_site_visitors set last_seen_at = now() where id = v.id;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'from', case when m.kind = 'inbound' then 'visitor' else 'team' end,
      'author', case when m.kind = 'inbound' then null
        else nullif(split_part(btrim(coalesce(u.full_name, '')), ' ', 1), '') end,
      'key', case when m.kind = 'inbound' and m.external_id like 'site:%' then substr(m.external_id, 6) end,
      'body', m.body, 'created_at', m.created_at, 'inserted_at', m.inserted_at) order by m.created_at, m.inserted_at), '[]'::jsonb),
    coalesce(array_agg(m.id) filter (where m.kind = 'outbound'), '{}')
  into v_list, v_ids
  from (select * from public.ldo_support_messages
        where conversation_id = v.conversation_id and deleted_at is null
          and (kind = 'inbound' or (kind = 'outbound' and delivery in ('accepted', 'delivered', 'read')))
          and (p_after is null or inserted_at > p_after)
        order by inserted_at desc limit 200) m
  left join public.ldo_app_users u on u.id = m.author_user_id;
  if cardinality(v_ids) > 0 then
    update public.ldo_support_messages set delivery = case when coalesce(p_open, false) then 'read' else 'delivered' end
    where id = any (v_ids) and (delivery = 'accepted' or (coalesce(p_open, false) and delivery = 'delivered'));
  end if;
  return jsonb_build_object(
    'name', v.name,
    'verified', v.verified,
    'typing', exists (select 1 from public.ldo_support_presence p where p.conversation_id = v.conversation_id
      and p.composing and p.seen_at > now() - interval '25 seconds'),
    'messages', v_list
  );
end;
$$;

-- Envio terminado (todas as plataformas). No chat do site a resposta passa a contar para o widget a partir
-- do momento em que fica visível (inserted_at = agora), para não ficar antes do último pedido do widget.
create or replace function public.ldo_support_finish_send(p_token text, p_message uuid, p_delivery text, p_detail text, p_external_id text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_m public.ldo_support_messages;
  v_ext text := nullif(p_external_id, '');
  v_site boolean;
begin
  perform ldo_private.bi_check(p_token);
  if p_delivery is not null and p_delivery not in ('accepted', 'delivered', 'read', 'failed', 'uncertain') then
    raise exception 'Estado inválido.' using errcode = '22023';
  end if;
  select * into v_m from public.ldo_support_messages where id = p_message for update;
  if v_m.id is null or v_m.delivery is null or v_m.delivery not in ('sending', 'uncertain') then
    return;
  end if;
  if v_ext is not null and v_m.external_id is null then
    delete from public.ldo_support_messages
    where conversation_id = v_m.conversation_id and external_id = v_ext and id <> v_m.id and client_key is null;
    if exists (select 1 from public.ldo_support_messages where conversation_id = v_m.conversation_id and external_id = v_ext and id <> v_m.id) then
      v_ext := null;
    end if;
  end if;
  select c.channel = 'site' into v_site from public.ldo_support_conversations c where c.id = v_m.conversation_id;
  update public.ldo_support_messages set
    delivery = case when kind = 'note' and p_delivery = 'accepted' then null else p_delivery end,
    delivery_detail = left(p_detail, 500),
    external_id = coalesce(external_id, v_ext),
    inserted_at = case when coalesce(v_site, false) and p_delivery = 'accepted' then now() else inserted_at end
  where id = v_m.id;
  if p_delivery = 'failed' then
    update public.ldo_support_uploads set message_id = null, public_token = null, public_until = null
    where message_id = v_m.id and data is not null;
  end if;
  perform ldo_private.support_summarize(v_m.conversation_id);
end;
$$;

-- Detalhe do envio depois de terminado (ex.: aviso por email ao cliente do chat do site).
create function public.ldo_support_set_delivery_detail(p_token text, p_message uuid, p_detail text) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform ldo_private.bi_check(p_token);
  update public.ldo_support_messages set delivery_detail = left(p_detail, 500) where id = p_message and kind = 'outbound';
end;
$$;

-- Avisos por email: reserva (2 minutos) as conversas cujo visitante está fora do site há mais de
-- p_idle_seconds e tem respostas que ainda não viu nem recebeu por email, mais antigas que p_min_age_seconds.
-- Devolve, por conversa, o email, o nome e essas respostas (até 10).
create function public.ldo_support_site_notify_claim(p_token text, p_conversation uuid, p_idle_seconds integer, p_min_age_seconds integer, p_limit integer)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v public.ldo_support_site_visitors;
  v_out jsonb := '[]'::jsonb;
  v_replies jsonb;
  v_until timestamptz;
begin
  perform ldo_private.bi_check(p_token);
  for v in
    select x.* from public.ldo_support_site_visitors x
    where (p_conversation is null or x.conversation_id = p_conversation)
      and x.last_seen_at < now() - make_interval(secs => greatest(p_idle_seconds, 0))
      and (x.notify_lease_until is null or x.notify_lease_until < now())
      and exists (select 1 from public.ldo_support_messages m where m.conversation_id = x.conversation_id and m.kind = 'outbound'
        and m.deleted_at is null and m.delivery = 'accepted' and m.inserted_at > coalesce(x.notified_until, '-infinity'::timestamptz)
        and m.inserted_at < now() - make_interval(secs => greatest(p_min_age_seconds, 0)))
      and x.last_seen_at = (select max(y.last_seen_at) from public.ldo_support_site_visitors y where y.conversation_id = x.conversation_id)
    order by x.last_seen_at
    limit least(greatest(coalesce(p_limit, 10), 1), 50)
    for update of x skip locked
  loop
    select jsonb_agg(r.body order by r.inserted_at), max(r.inserted_at) into v_replies, v_until
    from (select m.body, m.inserted_at from public.ldo_support_messages m
          where m.conversation_id = v.conversation_id and m.kind = 'outbound' and m.deleted_at is null and m.delivery = 'accepted'
            and m.inserted_at > coalesce(v.notified_until, '-infinity'::timestamptz)
          order by m.inserted_at limit 10) r;
    update public.ldo_support_site_visitors set notify_lease_until = now() + interval '2 minutes' where id = v.id;
    v_out := v_out || jsonb_build_array(jsonb_build_object('visitor', v.id, 'conversation', v.conversation_id, 'email', v.email,
      'name', v.name, 'until', v_until, 'replies', v_replies));
  end loop;
  return v_out;
end;
$$;

-- Resultado de um aviso: com sucesso as respostas até p_until ficam avisadas; com falha volta a tentar
-- daqui a 30 minutos.
create function public.ldo_support_site_notify_done(p_token text, p_visitor uuid, p_until timestamptz, p_ok boolean) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform ldo_private.bi_check(p_token);
  if p_ok then
    update public.ldo_support_site_visitors set notified_until = greatest(coalesce(notified_until, '-infinity'::timestamptz), p_until),
      notified_at = now(), notify_lease_until = null where id = p_visitor;
  else
    update public.ldo_support_site_visitors set notify_lease_until = now() + interval '30 minutes' where id = p_visitor;
  end if;
end;
$$;

-- Passagem pelos avisos pendentes no máximo uma vez por minuto (usa next_attempt_at da fonte do chat).
create function public.ldo_support_site_notify_sweep(p_token text) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform ldo_private.bi_check(p_token);
  update public.ldo_support_sources set next_attempt_at = now() + interval '60 seconds'
  where id = 'site-chat' and (next_attempt_at is null or next_attempt_at < now());
  return found;
end;
$$;

-- Pesquisa da caixa de entrada: inclui o email escrito pelo cliente no chat do site.
do $$
declare v_def text := pg_get_functiondef('public.ldo_support_list(text,text,text,text,text)'::regprocedure);
begin
  if position('coalesce(k.claimed_email' in v_def) = 0 then
    v_def := replace(v_def, 'coalesce(k.email, '''') || '' '' || coalesce(k.handle, '''')',
      'coalesce(k.email, '''') || '' '' || coalesce(k.claimed_email, '''') || '' '' || coalesce(k.handle, '''')');
    if position('coalesce(k.claimed_email' in v_def) = 0 then
      raise exception 'ldo_support_list: expressão de pesquisa não encontrada';
    end if;
    execute v_def;
  end if;
end;
$$;

revoke all on function ldo_private.site_visitor(text, text) from public, anon, authenticated;
revoke all on function
  public.ldo_support_site_start(text, text, text, text, boolean, text, uuid, text, text, text, text),
  public.ldo_support_site_send(text, text, text, text, uuid, text, text),
  public.ldo_support_site_messages(text, text, text, timestamptz, boolean),
  public.ldo_support_set_delivery_detail(text, uuid, text),
  public.ldo_support_site_notify_claim(text, uuid, integer, integer, integer),
  public.ldo_support_site_notify_done(text, uuid, timestamptz, boolean),
  public.ldo_support_site_notify_sweep(text)
from public, authenticated;
grant execute on function
  public.ldo_support_site_start(text, text, text, text, boolean, text, uuid, text, text, text, text),
  public.ldo_support_site_send(text, text, text, text, uuid, text, text),
  public.ldo_support_site_messages(text, text, text, timestamptz, boolean),
  public.ldo_support_set_delivery_detail(text, uuid, text),
  public.ldo_support_site_notify_claim(text, uuid, integer, integer, integer),
  public.ldo_support_site_notify_done(text, uuid, timestamptz, boolean),
  public.ldo_support_site_notify_sweep(text)
to anon;
