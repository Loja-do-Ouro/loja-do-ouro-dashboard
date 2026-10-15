-- Chat do site em 5 línguas (pt, en, es, fr, de) e com a marca do domínio.
--
-- A marca segue o domínio, que a Shopify escolhe pelo país do cliente: lojadoouro.pt (mercado Portugal) é a
-- Loja do Ouro ('ldo'), goldstorepremium.com (mercados Internacional e Espanha) é a Gold Store Premium ('gsp').
-- * Cada visitante guarda a língua do chat (locale; null = pt, como os visitantes anteriores), o site e o país da
--   loja (Shopify.country). O servidor decide o site pela origem do pedido.
-- * As conversas da Gold Store Premium ficam com account 'goldstorepremium.com' (no chat do site a conta só
--   identifica a loja). O contacto continua em lojadoouro.pt, para o mesmo cliente ser reconhecido nas duas lojas.
-- * A equipa vê a língua, o site e o país no painel do cliente; os avisos por email e a cópia da conversa seguem
--   na língua e com a marca do visitante.
-- * Os avisos de transferência passam a ter kind 'transfer' e to_first (o widget e os emails traduzem); o texto em
--   português continua em body para os widgets antigos.
-- Os parâmetros novos têm valores por omissão: a versão do dashboard em produção continua a funcionar.

alter table public.ldo_support_site_visitors
  add column locale text check (locale is null or locale in ('pt', 'en', 'es', 'fr', 'de')),
  add column site text not null default 'ldo' check (site in ('ldo', 'gsp')),
  add column country text check (country is null or country ~ '^[A-Z]{2}$');

drop function public.ldo_support_site_start(text, text, text, text, boolean, text, uuid, text, text, text, text);
drop function public.ldo_support_site_context(text, text, text, text, text, jsonb, timestamptz, integer);

-- Novo visitante com a primeira mensagem (como em 20261008150000, mais a língua, o site e o país).
create function public.ldo_support_site_start(p_token text, p_token_hash text, p_name text, p_email text, p_verified boolean,
  p_message text, p_client_key uuid, p_page text, p_ip_hash text, p_ip_prefix_hash text, p_user_agent text,
  p_locale text default null, p_site text default 'ldo', p_country text default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_name text := ldo_private.site_clean(p_name, 80);
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_body text := ldo_private.site_clean(p_message, 2000);
  v_locale text := case when p_locale in ('pt', 'en', 'es', 'fr', 'de') then p_locale end;
  v_site text := case when p_site = 'gsp' then 'gsp' else 'ldo' end;
  v_country text := case when p_country ~ '^[A-Z]{2}$' then p_country end;
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
  values ('site-chat', 'site', case when v_site = 'gsp' then 'goldstorepremium.com' else 'lojadoouro.pt' end, v_id::text, v_contact,
    'Chat do site', 'novo', 'site')
  returning id into v_conv;
  insert into public.ldo_support_site_visitors (id, token_hash, contact_id, conversation_id, name, email, verified, ip_hash, ip_prefix_hash,
    user_agent, page_url, locale, site, country)
  values (v_id, p_token_hash, v_contact, v_conv, v_name, v_email, coalesce(p_verified, false), p_ip_hash, p_ip_prefix_hash,
    left(p_user_agent, 300), left(p_page, 500), v_locale, v_site, v_country);
  insert into public.ldo_support_messages (conversation_id, external_id, kind, author_name, author_external_id, body, created_at)
  values (v_conv, 'site:' || p_client_key, 'inbound', v_name, v_id::text, v_body, now());
  perform ldo_private.support_summarize(v_conv);
  return jsonb_build_object('visitor', v_id, 'conversation', v_conv, 'repeated', false);
end;
$$;

-- Contexto enviado pelo widget (como em 20261008160000). A língua só muda quando vem uma válida (o cliente
-- mudou de língua na loja a meio da visita).
create function public.ldo_support_site_context(p_token text, p_token_hash text, p_identity_email text, p_page text, p_title text,
  p_cart jsonb, p_visit_started_at timestamptz, p_pages integer, p_locale text default null) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v public.ldo_support_site_visitors;
begin
  perform ldo_private.bi_check(p_token);
  v := ldo_private.site_visitor(p_token_hash, p_identity_email);
  if v.context_at is not null and v.context_at > now() - interval '5 seconds' then
    return;
  end if;
  update public.ldo_support_site_visitors set
    page_url = coalesce(left(p_page, 500), page_url),
    page_title = left(ldo_private.site_clean(p_title, 200), 200),
    cart = case when p_cart is not null and jsonb_typeof(p_cart) = 'object' and pg_column_size(p_cart) <= 16000 then p_cart else cart end,
    visit_started_at = case when p_visit_started_at between now() - interval '2 days' and now() + interval '5 minutes'
      then p_visit_started_at else visit_started_at end,
    pages_viewed = case when p_pages between 0 and 100000 then p_pages else pages_viewed end,
    locale = coalesce(case when p_locale in ('pt', 'en', 'es', 'fr', 'de') then p_locale end, locale),
    context_at = now(),
    last_seen_at = now()
  where id = v.id;
end;
$$;

-- Para a equipa (painel do cliente): estado do visitante, mais a língua (null = pt), o site e o país.
create or replace function public.ldo_support_site_visitor_info(p_session text, p_conversation uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_me uuid := ldo_private.support_check(p_session);
begin
  return (select jsonb_build_object('page_url', v.page_url, 'page_title', v.page_title, 'cart', v.cart,
      'visit_started_at', v.visit_started_at, 'pages_viewed', v.pages_viewed, 'context_at', v.context_at,
      'last_seen_at', v.last_seen_at, 'created_at', v.created_at, 'verified', v.verified,
      'locale', v.locale, 'site', v.site, 'country', v.country, 'now', now())
    from public.ldo_support_site_visitors v where v.conversation_id = p_conversation
    order by v.last_seen_at desc limit 1);
end;
$$;

-- Avisos por email ao visitante (como em 20261008170000), mais a língua, o site e o país de cada visitante.
create or replace function public.ldo_support_site_notify_claim(p_token text, p_conversation uuid, p_idle_seconds integer, p_min_age_seconds integer, p_limit integer)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v public.ldo_support_site_visitors;
  v_out jsonb := '[]'::jsonb;
  v_replies jsonb;
  v_items jsonb;
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
    select jsonb_agg(r.body order by r.inserted_at),
      jsonb_agg(jsonb_build_object('body', r.body, 'author', ldo_private.support_first_name(r.author_user_id)) order by r.inserted_at),
      max(r.inserted_at) into v_replies, v_items, v_until
    from (select m.body, m.author_user_id, m.inserted_at from public.ldo_support_messages m
          where m.conversation_id = v.conversation_id and m.kind = 'outbound' and m.deleted_at is null and m.delivery = 'accepted'
            and m.inserted_at > coalesce(v.notified_until, '-infinity'::timestamptz)
          order by m.inserted_at limit 10) r;
    update public.ldo_support_site_visitors set notify_lease_until = now() + interval '2 minutes' where id = v.id;
    v_out := v_out || jsonb_build_array(jsonb_build_object('visitor', v.id, 'conversation', v.conversation_id, 'email', v.email,
      'name', v.name, 'until', v_until, 'replies', v_replies, 'items', v_items,
      'locale', v.locale, 'site', v.site, 'country', v.country));
  end loop;
  return v_out;
end;
$$;

-- Chat do site: mensagens, avisos de transferência e o primeiro nome de quem está a atender (como em
-- 20261008170000). Os avisos levam kind 'transfer' e to_first para o widget os mostrar na língua do cliente.
create or replace function public.ldo_support_site_messages(p_token text, p_token_hash text, p_identity_email text, p_after timestamptz, p_open boolean) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v public.ldo_support_site_visitors;
  v_list jsonb;
  v_notices jsonb;
  v_ids uuid[];
begin
  perform ldo_private.bi_check(p_token);
  v := ldo_private.site_visitor(p_token_hash, p_identity_email);
  if v.last_seen_at < now() - interval '2 seconds' then
    update public.ldo_support_site_visitors set last_seen_at = now() where id = v.id;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'from', case when m.kind = 'inbound' then 'visitor' else 'team' end,
      'author', case when m.kind = 'inbound' then null else ldo_private.support_first_name(m.author_user_id) end,
      'key', case when m.kind = 'inbound' and m.external_id like 'site:%' then substr(m.external_id, 6) end,
      'body', m.body, 'created_at', m.created_at, 'inserted_at', m.inserted_at) order by m.created_at, m.inserted_at), '[]'::jsonb),
    coalesce(array_agg(m.id) filter (where m.kind = 'outbound'), '{}')
  into v_list, v_ids
  from (select * from public.ldo_support_messages
        where conversation_id = v.conversation_id and deleted_at is null
          and (kind = 'inbound' or (kind = 'outbound' and delivery in ('accepted', 'delivered', 'read')))
          and (p_after is null or inserted_at > p_after)
        order by inserted_at desc limit 200) m;
  -- Avisos de transferência (só o primeiro nome de quem passa a atender).
  select coalesce(jsonb_agg(jsonb_build_object('id', 'n' || a.id, 'from', 'notice', 'author', null, 'key', null,
      'kind', 'transfer', 'to_first', a.details ->> 'to_first',
      'body', 'A conversa foi transferida para ' || coalesce(a.details ->> 'to_first', 'outra pessoa da equipa') || '.',
      'created_at', a.created_at, 'inserted_at', a.created_at) order by a.created_at), '[]'::jsonb)
  into v_notices
  from (select * from public.ldo_support_audit
        where conversation_id = v.conversation_id and action = 'assign' and (details ->> 'notice') = 'true'
          and (p_after is null or created_at > p_after)
        order by created_at desc limit 50) a;
  if cardinality(v_ids) > 0 then
    update public.ldo_support_messages set delivery = case when coalesce(p_open, false) then 'read' else 'delivered' end
    where id = any (v_ids) and (delivery = 'accepted' or (coalesce(p_open, false) and delivery = 'delivered'));
  end if;
  return jsonb_build_object(
    'name', v.name,
    'verified', v.verified,
    'agent', (select ldo_private.support_first_name(c.assignee_id) from public.ldo_support_conversations c where c.id = v.conversation_id),
    'typing', exists (select 1 from public.ldo_support_presence p where p.conversation_id = v.conversation_id
      and p.composing and p.seen_at > now() - interval '25 seconds'),
    'messages', v_list || v_notices
  );
end;
$$;

-- Terminar a conversa (como em 20261008185000). A cópia leva os avisos com kind/to_first e a resposta traz a
-- língua, o site e o país, para o email seguir na língua e com a marca do cliente.
create or replace function public.ldo_support_site_end(p_token text, p_token_hash text, p_identity_email text, p_transcript boolean)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v public.ldo_support_site_visitors;
  v_items jsonb := '[]'::jsonb;
  v_copy boolean;
  v_reason text;
begin
  perform ldo_private.bi_check(p_token);
  v := ldo_private.site_visitor(p_token_hash, p_identity_email);
  update public.ldo_support_site_visitors set ended_at = now() where id = v.id and ended_at is null;
  if not found then
    raise exception 'Esta conversa já não está disponível. Inicie uma nova.' using errcode = 'P0401';
  end if;

  v_copy := coalesce(p_transcript, false) and v.email is not null;
  if v_copy and not v.verified and not exists (
      select 1 from public.ldo_support_messages m where m.conversation_id = v.conversation_id and m.kind = 'outbound'
        and m.deleted_at is null and m.delivery in ('accepted', 'delivered', 'read')) then
    v_copy := false;
    v_reason := 'sem resposta da equipa';
  end if;
  if v_copy and (select count(*) from public.ldo_support_audit a
      where a.action = 'visitor_end' and (a.details ->> 'transcript') = 'true' and a.details ->> 'email' = lower(v.email)
        and a.created_at > now() - interval '24 hours') >= 2 then
    v_copy := false;
    v_reason := 'limite diário de cópias';
  end if;

  insert into public.ldo_support_audit (actor, conversation_id, action, details)
  values (null, v.conversation_id, 'visitor_end', jsonb_build_object('transcript', v_copy, 'requested', coalesce(p_transcript, false),
    'email', case when v_copy then lower(v.email) end, 'reason', v_reason));

  if v_copy then
    select coalesce(jsonb_agg(x.item order by x.at), '[]'::jsonb) into v_items
    from (
      select y.at, y.item from (
        select m.created_at as at,
          jsonb_build_object('from', case when m.kind = 'inbound' then 'visitor' else 'team' end,
            'author', case when m.kind = 'inbound' then null else ldo_private.support_first_name(m.author_user_id) end,
            'body', m.body, 'at', m.created_at) as item
        from public.ldo_support_messages m
        where m.conversation_id = v.conversation_id and m.deleted_at is null
          and (m.kind = 'inbound' or (m.kind = 'outbound' and m.delivery in ('accepted', 'delivered', 'read')))
        union all
        select a.created_at,
          jsonb_build_object('from', 'notice', 'author', null, 'kind', 'transfer', 'to_first', a.details ->> 'to_first',
            'body', 'A conversa foi transferida para ' || coalesce(a.details ->> 'to_first', 'outra pessoa da equipa') || '.', 'at', a.created_at)
        from public.ldo_support_audit a
        where a.conversation_id = v.conversation_id and a.action = 'assign' and (a.details ->> 'notice') = 'true'
      ) y
      order by y.at desc
      limit 300
    ) x;
  end if;
  return jsonb_build_object('email', v.email, 'name', v.name, 'transcript', v_copy, 'messages', v_items,
    'locale', v.locale, 'site', v.site, 'country', v.country);
end;
$$;

-- Permissões como antes: só o servidor (anon com o token do servidor; a sessão da equipa em visitor_info).
revoke all on function
  public.ldo_support_site_start(text, text, text, text, boolean, text, uuid, text, text, text, text, text, text, text),
  public.ldo_support_site_context(text, text, text, text, text, jsonb, timestamptz, integer, text),
  public.ldo_support_site_visitor_info(text, uuid),
  public.ldo_support_site_notify_claim(text, uuid, integer, integer, integer),
  public.ldo_support_site_messages(text, text, text, timestamptz, boolean),
  public.ldo_support_site_end(text, text, text, boolean)
from public, authenticated;
grant execute on function
  public.ldo_support_site_start(text, text, text, text, boolean, text, uuid, text, text, text, text, text, text, text),
  public.ldo_support_site_context(text, text, text, text, text, jsonb, timestamptz, integer, text),
  public.ldo_support_site_visitor_info(text, uuid),
  public.ldo_support_site_notify_claim(text, uuid, integer, integer, integer),
  public.ldo_support_site_messages(text, text, text, timestamptz, boolean),
  public.ldo_support_site_end(text, text, text, boolean)
to anon;
