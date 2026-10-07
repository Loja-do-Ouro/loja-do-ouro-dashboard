-- Apoio ao Cliente: correções da revisão de código (a migração 20261007120000 já está aplicada).
--
-- - Uma conta de agente Zendesk só pode estar ligada a um colaborador (índice único); ao ligar,
--   tickets e mensagens já guardados passam a apontar para essa pessoa; ao desligar, deixam de apontar.
-- - Não lidas pela ordem de chegada ao dashboard (inserted_at), não pela hora da plataforma.
-- - Envios: uma resposta aceite sem id externo é reconhecida pela sincronização (texto normalizado);
--   o resultado de um envio nunca rebaixa uma mensagem já confirmada; ids repetidos são fundidos.
-- - Zendesk: dados mais antigos não substituem estado/responsável mais recentes; um comentário que o
--   Zendesk gravou como privado passa a nota.
-- - Mensagens apagadas pelo cliente ficam marcadas e sem conteúdo.
-- - Sincronização: lease de 150 s, progresso gravado a meio, continuação imediata quando há mais
--   trabalho, fontes sem ligação não contam como sincronizadas, recusas com motivo.
-- - Filtros "Minhas" e "Sem responsável" e os respetivos contadores usam a mesma regra.

alter table public.ldo_support_messages add column deleted_at timestamptz;
create index ldo_support_messages_inbound_idx on public.ldo_support_messages (conversation_id, inserted_at) where kind = 'inbound';

create unique index ldo_support_zendesk_connections_agent_idx
  on public.ldo_support_zendesk_connections (subdomain, zendesk_user_id);

-- Texto comparável entre o que o dashboard enviou e o que a plataforma devolve (o Zendesk trata o
-- corpo como markdown e normaliza espaços).
create function ldo_private.support_norm(p text) returns text
language sql immutable set search_path = '' as $$
  select lower(regexp_replace(coalesce(p, ''), '[[:space:]*_`#>~()!|\[\]\\-]+', '', 'g'));
$$;
revoke all on function ldo_private.support_norm(text) from public, anon, authenticated;

-- ---------------------------------------------------------------- Zendesk: ligações

create or replace function public.ldo_support_zendesk_save(p_token text, p_user_id uuid, p_data jsonb) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_other text;
begin
  perform ldo_private.bi_check(p_token);
  select coalesce(u.full_name, u.username) into v_other
  from public.ldo_support_zendesk_connections z join public.ldo_app_users u on u.id = z.user_id
  where z.subdomain = p_data->>'subdomain' and z.zendesk_user_id = p_data->>'zendesk_user_id' and z.user_id <> p_user_id;
  if v_other is not null then
    raise exception 'Esta conta Zendesk já está ligada a %. Cada colaborador liga a sua própria conta de agente.', v_other
      using errcode = '23505';
  end if;
  insert into public.ldo_support_zendesk_connections (user_id, subdomain, zendesk_user_id, zendesk_name, zendesk_email, zendesk_role, scope,
    access_ct, refresh_ct, access_expires_at, refresh_expires_at, status, status_detail, connected_at, updated_at)
  values (p_user_id, p_data->>'subdomain', p_data->>'zendesk_user_id', p_data->>'zendesk_name', p_data->>'zendesk_email',
    p_data->>'zendesk_role', p_data->>'scope', p_data->>'access_ct', p_data->>'refresh_ct',
    (p_data->>'access_expires_at')::timestamptz, (p_data->>'refresh_expires_at')::timestamptz, 'active', null, now(), now())
  on conflict (user_id) do update set subdomain = excluded.subdomain, zendesk_user_id = excluded.zendesk_user_id,
    zendesk_name = excluded.zendesk_name, zendesk_email = excluded.zendesk_email, zendesk_role = excluded.zendesk_role,
    scope = excluded.scope, access_ct = excluded.access_ct, refresh_ct = excluded.refresh_ct,
    access_expires_at = excluded.access_expires_at, refresh_expires_at = excluded.refresh_expires_at,
    version = public.ldo_support_zendesk_connections.version + 1, refresh_lease_until = null,
    status = 'active', status_detail = null, connected_at = now(), updated_at = now();
  -- Tickets e mensagens já guardados deste agente passam a ser desta pessoa.
  update public.ldo_support_conversations set assignee_id = p_user_id
  where source_id = 'zendesk' and external_assignee_id = p_data->>'zendesk_user_id' and assignee_id is distinct from p_user_id;
  update public.ldo_support_messages m set author_user_id = p_user_id
  from public.ldo_support_conversations c
  where c.id = m.conversation_id and c.source_id = 'zendesk' and m.author_user_id is null
    and m.author_external_id = p_data->>'zendesk_user_id';
  insert into public.ldo_support_audit (actor, action, details)
  values (p_user_id, 'zendesk.connect', jsonb_build_object('zendesk_user_id', p_data->>'zendesk_user_id', 'role', p_data->>'zendesk_role'));
end;
$$;

create or replace function public.ldo_support_zendesk_disconnect(p_session text, p_user_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me uuid := ldo_private.support_check(p_session);
  v_target uuid := coalesce(p_user_id, v_me);
begin
  if v_target <> v_me and ldo_private.support_super(p_session) is null then
    raise exception 'Só o Super Admin desliga a conta de outra pessoa.' using errcode = '42501';
  end if;
  -- O responsável no Zendesk continua visível pelo nome; deixa de contar como "Minhas" desta pessoa.
  update public.ldo_support_conversations set assignee_id = null where source_id = 'zendesk' and assignee_id = v_target;
  delete from public.ldo_support_zendesk_connections where user_id = v_target;
  insert into public.ldo_support_audit (actor, action, details) values (v_me, 'zendesk.disconnect', jsonb_build_object('user_id', v_target));
end;
$$;

-- ---------------------------------------------------------------- não lidas (ordem de chegada)

create or replace function public.ldo_support_mark_read(p_session text, p_id uuid, p_unread boolean) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me uuid := ldo_private.support_check(p_session);
  v_last timestamptz := (select max(inserted_at) from public.ldo_support_messages
    where conversation_id = p_id and kind = 'inbound' and deleted_at is null);
begin
  if not exists (select 1 from public.ldo_support_conversations where id = p_id) then
    raise exception 'Conversa não encontrada.' using errcode = 'P0002';
  end if;
  insert into public.ldo_support_reads (user_id, conversation_id, read_at)
  values (v_me, p_id, case when coalesce(p_unread, false) then coalesce(v_last, now()) - interval '1 millisecond'
    else greatest(now(), coalesce(v_last, now())) end)
  on conflict (user_id, conversation_id) do update set read_at = excluded.read_at;
end;
$$;

create or replace function public.ldo_support_list(p_session text, p_filter text, p_channel text, p_status text, p_q text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := ldo_private.support_check(p_session);
  v_q text := lower(nullif(btrim(coalesce(p_q, '')), ''));
  v_status text := nullif(p_status, '');
begin
  return jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(x.item order by x.sort_at desc)
      from (
        select jsonb_build_object(
          'id', c.id, 'channel', c.channel, 'subject', c.subject, 'status', c.status, 'platform_status', c.platform_status,
          'contact_name', coalesce(k.name, k.handle, k.email, 'Cliente'), 'contact_handle', k.handle,
          'assignee_id', c.assignee_id, 'assignee_name', coalesce(a.full_name, a.username, c.external_assignee_name),
          'last_message_at', coalesce(c.last_message_at, c.created_at), 'last_preview', c.last_preview, 'last_direction', c.last_direction,
          'unread', u.unread,
          'attention', exists (select 1 from public.ldo_support_messages m where m.conversation_id = c.id and m.delivery in ('failed', 'uncertain', 'sending'))
        ) as item, coalesce(c.last_message_at, c.created_at) as sort_at
        from public.ldo_support_conversations c
        left join public.ldo_support_contacts k on k.id = c.contact_id
        left join public.ldo_app_users a on a.id = c.assignee_id
        left join public.ldo_support_reads r on r.conversation_id = c.id and r.user_id = v_me
        cross join lateral (
          select count(*)::int as unread from public.ldo_support_messages m
          where m.conversation_id = c.id and m.kind = 'inbound' and m.deleted_at is null
            and m.inserted_at > coalesce(r.read_at, '-infinity'::timestamptz)
        ) u
        where (p_channel is null or p_channel = '' or c.channel = p_channel)
          and (v_status is null or c.status = v_status)
          and (coalesce(p_filter, 'all') in ('all', 'unread')
            or (p_filter = 'mine' and c.assignee_id = v_me and (v_status is not null or c.status <> 'resolvido'))
            or (p_filter = 'unassigned' and c.assignee_id is null and c.external_assignee_id is null and (v_status is not null or c.status <> 'resolvido')))
          and (coalesce(p_filter, 'all') <> 'unread' or u.unread > 0)
          and (v_q is null
            or position(v_q in lower(coalesce(k.name, '') || ' ' || coalesce(k.email, '') || ' ' || coalesce(k.handle, '') || ' '
              || coalesce(k.phone, '') || ' ' || coalesce(c.subject, '') || ' ' || coalesce(c.external_id, ''))) > 0
            or exists (select 1 from public.ldo_support_messages m where m.conversation_id = c.id and m.kind <> 'note' and position(v_q in lower(m.body)) > 0))
        order by sort_at desc
        limit 300
      ) x
    ), '[]'::jsonb),
    -- Mesmas regras dos filtros (sem canal, estado nem pesquisa): por resolver, minhas, sem responsável, não lidas.
    'counts', (
      select jsonb_build_object(
        'all', count(*),
        'mine', count(*) filter (where c.assignee_id = v_me and c.status <> 'resolvido'),
        'unassigned', count(*) filter (where c.assignee_id is null and c.external_assignee_id is null and c.status <> 'resolvido'),
        'unread', count(*) filter (where exists (
          select 1 from public.ldo_support_messages m
          left join public.ldo_support_reads r on r.conversation_id = c.id and r.user_id = v_me
          where m.conversation_id = c.id and m.kind = 'inbound' and m.deleted_at is null
            and m.inserted_at > coalesce(r.read_at, '-infinity'::timestamptz))))
      from public.ldo_support_conversations c
    ),
    'sources', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'platform', s.platform, 'channel', s.channel, 'label', s.label, 'status', s.status,
        'status_detail', s.status_detail, 'last_success_at', s.last_success_at, 'last_attempt_at', s.last_attempt_at, 'last_error', s.last_error,
        'next_attempt_at', s.next_attempt_at) order by s.id)
      from public.ldo_support_sources s
    ), '[]'::jsonb),
    'poll_seconds', (select poll_seconds from public.ldo_support_settings where id = 1)
  );
end;
$$;

create or replace function public.ldo_support_conversation(p_session text, p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := ldo_private.support_check(p_session);
  v_c public.ldo_support_conversations;
  v_k public.ldo_support_contacts;
begin
  select * into v_c from public.ldo_support_conversations where id = p_id;
  if v_c.id is null then
    raise exception 'Conversa não encontrada.' using errcode = 'P0002';
  end if;
  select * into v_k from public.ldo_support_contacts where id = v_c.contact_id;
  return jsonb_build_object(
    'conversation', to_jsonb(v_c) || jsonb_build_object(
      'assignee_name', (select coalesce(full_name, username) from public.ldo_app_users where id = v_c.assignee_id),
      'platform', (select platform from public.ldo_support_sources where id = v_c.source_id),
      'source_label', (select label from public.ldo_support_sources where id = v_c.source_id),
      'source_status', (select status from public.ldo_support_sources where id = v_c.source_id),
      'read_at', (select read_at from public.ldo_support_reads where user_id = v_me and conversation_id = p_id),
      'last_inbound_inserted_at', (select max(inserted_at) from public.ldo_support_messages
        where conversation_id = p_id and kind = 'inbound' and deleted_at is null)),
    'contact', case when v_k.id is null then null else to_jsonb(v_k) || jsonb_build_object(
      'linked_by_name', (select coalesce(full_name, username) from public.ldo_app_users where id = v_k.linked_by)) end,
    'related', coalesce((
      select jsonb_agg(jsonb_build_object('contact_id', k.id, 'channel', k.channel, 'name', k.name, 'email', k.email, 'phone', k.phone,
        'conversation_id', (select c2.id from public.ldo_support_conversations c2 where c2.contact_id = k.id order by c2.last_message_at desc nulls last limit 1)))
      from public.ldo_support_contacts k
      where k.id <> v_k.id and (
        (coalesce(v_k.email, v_k.linked_email) is not null and lower(coalesce(v_k.email, v_k.linked_email)) in (lower(k.email), lower(k.linked_email)))
        or (v_k.phone is not null and regexp_replace(v_k.phone, '\D', '', 'g') <> '' and regexp_replace(v_k.phone, '\D', '', 'g') = regexp_replace(coalesce(k.phone, ''), '\D', '', 'g')))
    ), '[]'::jsonb),
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'kind', m.kind, 'author_name', coalesce(au.full_name, au.username, m.author_name),
        'author_user_id', m.author_user_id, 'body', m.body, 'attachments', m.attachments, 'created_at', m.created_at,
        'inserted_at', m.inserted_at, 'deleted', m.deleted_at is not null,
        'delivery', m.delivery, 'delivery_detail', m.delivery_detail, 'external', m.external_id is not null) order by m.created_at, m.inserted_at)
      from (select * from public.ldo_support_messages where conversation_id = p_id order by created_at desc, inserted_at desc limit 500) m
      left join public.ldo_app_users au on au.id = m.author_user_id
    ), '[]'::jsonb),
    'presence', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', p.user_id, 'name', coalesce(u.full_name, u.username), 'composing', p.composing, 'seen_at', p.seen_at))
      from public.ldo_support_presence p join public.ldo_app_users u on u.id = p.user_id
      where p.conversation_id = p_id and p.user_id <> v_me and p.seen_at > now() - interval '60 seconds'
    ), '[]'::jsonb),
    'audit', coalesce((
      select jsonb_agg(jsonb_build_object('action', l.action, 'details', l.details, 'created_at', l.created_at,
        'actor', coalesce((select coalesce(full_name, username) from public.ldo_app_users where id = l.actor), 'Sistema')) order by l.created_at desc)
      from (select * from public.ldo_support_audit where conversation_id = p_id order by created_at desc limit 30) l
    ), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------- envios

-- Um pedido repetido só é aceite com o mesmo texto: uma chave antiga nunca "engole" uma resposta nova.
create or replace function public.ldo_support_begin_send(p_session text, p_id uuid, p_kind text, p_body text, p_client_key uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me uuid := ldo_private.support_check(p_session);
  v_c public.ldo_support_conversations;
  v_k public.ldo_support_contacts;
  v_m public.ldo_support_messages;
  v_platform text;
  v_existing boolean := false;
  v_body text := btrim(coalesce(p_body, ''));
begin
  if p_kind not in ('outbound', 'note') then
    raise exception 'Tipo de mensagem inválido.' using errcode = '22023';
  end if;
  if v_body = '' then
    raise exception 'Escreva a mensagem.' using errcode = '22023';
  end if;
  if length(v_body) > 20000 then
    raise exception 'Mensagem demasiado longa.' using errcode = '22023';
  end if;
  if p_client_key is null then
    raise exception 'Pedido inválido.' using errcode = '22023';
  end if;
  select * into v_c from public.ldo_support_conversations where id = p_id;
  if v_c.id is null then
    raise exception 'Conversa não encontrada.' using errcode = 'P0002';
  end if;
  select platform into v_platform from public.ldo_support_sources where id = v_c.source_id;
  select * into v_k from public.ldo_support_contacts where id = v_c.contact_id;

  select * into v_m from public.ldo_support_messages where client_key = p_client_key;
  if v_m.id is not null then
    if v_m.conversation_id <> p_id or v_m.author_user_id is distinct from v_me or v_m.kind <> p_kind or v_m.body <> v_body then
      raise exception 'Este pedido já foi usado para outra mensagem. Volte a carregar em Enviar.' using errcode = '22023';
    end if;
    v_existing := true;
  else
    insert into public.ldo_support_messages (conversation_id, kind, author_user_id, body, created_at, delivery, client_key)
    values (p_id, p_kind, v_me, v_body, now(),
      case when p_kind = 'outbound' or v_platform = 'zendesk' then 'sending' end, p_client_key)
    returning * into v_m;
    insert into public.ldo_support_audit (actor, conversation_id, action, details)
    values (v_me, p_id, case when p_kind = 'note' then 'note' else 'reply' end, jsonb_build_object('message_id', v_m.id));
    if p_kind = 'outbound' and v_platform <> 'zendesk' then
      update public.ldo_support_conversations set
        assignee_id = coalesce(assignee_id, v_me),
        status = case when status = 'novo' then 'em_atendimento' else status end, updated_at = now()
      where id = p_id;
      perform ldo_private.support_summarize(p_id);
    end if;
  end if;
  return jsonb_build_object('message', to_jsonb(v_m), 'existing', v_existing, 'platform', v_platform,
    'conversation', jsonb_build_object('id', v_c.id, 'source_id', v_c.source_id, 'channel', v_c.channel, 'account', v_c.account,
      'external_id', v_c.external_id, 'via', v_c.via, 'contact_external_id', v_k.external_id,
      'external_assignee_id', v_c.external_assignee_id, 'status', v_c.status));
end;
$$;

-- Resultado de um envio. Só altera mensagens ainda por confirmar ('sending'/'uncertain'): nunca rebaixa
-- uma mensagem que a sincronização já confirmou. Se a sincronização gravou entretanto a mesma mensagem
-- como linha separada, essa cópia é fundida nesta (que tem a autoria e a chave do pedido).
create or replace function public.ldo_support_finish_send(p_token text, p_message uuid, p_delivery text, p_detail text, p_external_id text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_m public.ldo_support_messages;
  v_ext text := nullif(p_external_id, '');
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
  update public.ldo_support_messages set
    delivery = case when kind = 'note' and p_delivery = 'accepted' then null else p_delivery end,
    delivery_detail = left(p_detail, 500),
    external_id = coalesce(external_id, v_ext)
  where id = v_m.id;
  perform ldo_private.support_summarize(v_m.conversation_id);
end;
$$;

-- ---------------------------------------------------------------- ingest

create or replace function public.ldo_support_ingest(p_token text, p_source text, p_conversations jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_src public.ldo_support_sources;
  c jsonb;
  m jsonb;
  v_contact uuid;
  v_conv public.ldo_support_conversations;
  v_is_new boolean;
  v_fresh boolean;
  v_new_inbound integer;
  v_match uuid;
  v_assignee uuid;
  v_author uuid;
  v_status text;
  v_incoming_at timestamptz;
  v_new_conv integer := 0;
  v_new_msgs integer := 0;
  v_reopened integer := 0;
  v_platform_truth boolean;
  v_deleted boolean;
begin
  perform ldo_private.bi_check(p_token);
  select * into v_src from public.ldo_support_sources where id = p_source;
  if v_src.id is null then
    raise exception 'Fonte desconhecida.' using errcode = '22023';
  end if;
  v_platform_truth := v_src.platform = 'zendesk';
  for c in select value from jsonb_array_elements(coalesce(p_conversations, '[]'::jsonb)) loop
    insert into public.ldo_support_contacts (channel, account, external_id, name, email, phone, handle, avatar_url)
    values (v_src.channel, v_src.account, coalesce(nullif(c #>> '{contact,external_id}', ''), 'conversa:' || (c ->> 'external_id')),
      left(nullif(c #>> '{contact,name}', ''), 200), left(lower(nullif(c #>> '{contact,email}', '')), 254),
      left(nullif(c #>> '{contact,phone}', ''), 40), left(nullif(c #>> '{contact,handle}', ''), 120), left(nullif(c #>> '{contact,avatar_url}', ''), 1000))
    on conflict (channel, account, external_id) do update set
      name = coalesce(excluded.name, public.ldo_support_contacts.name), email = coalesce(excluded.email, public.ldo_support_contacts.email),
      phone = coalesce(excluded.phone, public.ldo_support_contacts.phone), handle = coalesce(excluded.handle, public.ldo_support_contacts.handle),
      avatar_url = coalesce(excluded.avatar_url, public.ldo_support_contacts.avatar_url), updated_at = now()
    returning id into v_contact;

    v_assignee := null;
    if v_platform_truth and nullif(c ->> 'external_assignee_id', '') is not null then
      select z.user_id into v_assignee from public.ldo_support_zendesk_connections z
      where z.zendesk_user_id = c ->> 'external_assignee_id' order by (z.status = 'active') desc, z.updated_at desc limit 1;
    end if;
    v_status := case when c ->> 'status' in ('novo', 'em_atendimento', 'aguarda_cliente', 'resolvido') then c ->> 'status' end;
    v_incoming_at := nullif(c ->> 'external_updated_at', '')::timestamptz;

    select * into v_conv from public.ldo_support_conversations
    where channel = v_src.channel and account = v_src.account and external_id = c ->> 'external_id' for update;
    v_is_new := v_conv.id is null;
    if v_is_new then
      insert into public.ldo_support_conversations (source_id, channel, account, external_id, contact_id, subject, status, platform_status,
        assignee_id, external_assignee_id, external_assignee_name, via, external_updated_at)
      values (v_src.id, v_src.channel, v_src.account, c ->> 'external_id', v_contact, left(c ->> 'subject', 300),
        case when v_platform_truth then coalesce(v_status, 'novo') else 'novo' end, c ->> 'platform_status',
        v_assignee, nullif(c ->> 'external_assignee_id', ''), nullif(c ->> 'external_assignee_name', ''), c ->> 'via', v_incoming_at)
      returning * into v_conv;
      v_new_conv := v_new_conv + 1;
    else
      -- Um retrato mais antigo do ticket (sincronização lenta) não desfaz uma alteração mais recente.
      v_fresh := v_incoming_at is null or v_conv.external_updated_at is null or v_incoming_at >= v_conv.external_updated_at;
      update public.ldo_support_conversations set
        contact_id = case when v_fresh then v_contact else contact_id end,
        subject = case when v_fresh then coalesce(left(c ->> 'subject', 300), subject) else subject end,
        platform_status = case when v_fresh then coalesce(c ->> 'platform_status', platform_status) else platform_status end,
        via = coalesce(via, c ->> 'via'),
        external_updated_at = greatest(external_updated_at, v_incoming_at),
        status = case when v_platform_truth and v_fresh and v_status is not null then v_status else status end,
        assignee_id = case when v_platform_truth and v_fresh then v_assignee else assignee_id end,
        external_assignee_id = case when v_platform_truth and v_fresh then nullif(c ->> 'external_assignee_id', '') else external_assignee_id end,
        external_assignee_name = case when v_platform_truth and v_fresh then nullif(c ->> 'external_assignee_name', '') else external_assignee_name end,
        updated_at = now()
      where id = v_conv.id
      returning * into v_conv;
    end if;

    v_new_inbound := 0;
    for m in select value from jsonb_array_elements(coalesce(c -> 'messages', '[]'::jsonb)) loop
      if m ->> 'kind' not in ('inbound', 'outbound', 'note') or nullif(m ->> 'external_id', '') is null then
        continue;
      end if;
      v_deleted := coalesce((m ->> 'deleted')::boolean, false);
      if exists (select 1 from public.ldo_support_messages where conversation_id = v_conv.id and external_id = m ->> 'external_id') then
        update public.ldo_support_messages set
          -- Apagada pelo cliente: fica marcada e sem conteúdo.
          deleted_at = case when v_deleted then coalesce(deleted_at, now()) else deleted_at end,
          body = case when v_deleted then '' else body end,
          attachments = case when v_deleted then '[]'::jsonb else attachments end,
          -- O Zendesk pode gravar como privado um comentário enviado como público.
          kind = case when m ->> 'kind' in ('outbound', 'note') and kind in ('outbound', 'note') then m ->> 'kind' else kind end,
          delivery = case
            when m ->> 'delivery' in ('delivered', 'read') and kind = 'outbound' then m ->> 'delivery'
            when kind = 'outbound' and m ->> 'kind' = 'outbound' and delivery in ('sending', 'uncertain') then 'accepted'
            else delivery end
        where conversation_id = v_conv.id and external_id = m ->> 'external_id';
        continue;
      end if;
      if v_deleted then
        continue;
      end if;
      v_author := null;
      if v_platform_truth and nullif(m ->> 'author_external_id', '') is not null then
        select z.user_id into v_author from public.ldo_support_zendesk_connections z
        where z.zendesk_user_id = m ->> 'author_external_id' order by (z.status = 'active') desc, z.updated_at desc limit 1;
      end if;
      -- Uma resposta ou nota enviada pelo dashboard (ainda sem id externo) é reconhecida pelo texto
      -- normalizado, até 15 minutos de diferença, em vez de aparecer duplicada.
      v_match := null;
      if m ->> 'kind' in ('outbound', 'note') then
        select id into v_match from public.ldo_support_messages
        where conversation_id = v_conv.id and external_id is null and client_key is not null
          and kind in ('outbound', 'note')
          and (delivery is null or delivery in ('sending', 'uncertain', 'accepted'))
          and (v_author is null or author_user_id = v_author)
          and ldo_private.support_norm(body) = ldo_private.support_norm(m ->> 'body')
          and abs(extract(epoch from (created_at - (m ->> 'created_at')::timestamptz))) < 900
        order by created_at limit 1;
      end if;
      if v_match is not null then
        update public.ldo_support_messages set external_id = m ->> 'external_id', kind = m ->> 'kind',
          delivery = case when m ->> 'kind' = 'outbound' then
              case when delivery in ('delivered', 'read') then delivery else coalesce(nullif(m ->> 'delivery', ''), 'accepted') end
            else case when kind = 'outbound' then 'failed' else null end end,
          delivery_detail = case when m ->> 'kind' = 'note' and kind = 'outbound'
            then 'O Zendesk gravou esta resposta como nota interna: o cliente não a recebeu.'
            else coalesce(delivery_detail, 'Confirmado pela sincronização.') end,
          attachments = coalesce(m -> 'attachments', attachments)
        where id = v_match;
        continue;
      end if;
      insert into public.ldo_support_messages (conversation_id, external_id, kind, author_name, author_external_id, author_user_id, body,
        attachments, created_at, delivery)
      values (v_conv.id, m ->> 'external_id', m ->> 'kind', left(m ->> 'author_name', 200), m ->> 'author_external_id', v_author,
        left(coalesce(m ->> 'body', ''), 65000), coalesce(m -> 'attachments', '[]'::jsonb), (m ->> 'created_at')::timestamptz,
        case when m ->> 'kind' = 'outbound' then coalesce(nullif(m ->> 'delivery', ''), 'accepted') end)
      on conflict (conversation_id, external_id) do nothing;
      if found then
        v_new_msgs := v_new_msgs + 1;
        if m ->> 'kind' = 'inbound' and (m ->> 'created_at')::timestamptz > coalesce(v_conv.last_inbound_at, '-infinity'::timestamptz) then
          v_new_inbound := v_new_inbound + 1;
        end if;
      end if;
    end loop;

    if not v_platform_truth and not v_is_new and v_new_inbound > 0 and v_conv.status in ('resolvido', 'aguarda_cliente') then
      update public.ldo_support_conversations set
        status = case when v_conv.status = 'resolvido' and assignee_id is null then 'novo' else 'em_atendimento' end
      where id = v_conv.id;
      insert into public.ldo_support_audit (actor, conversation_id, action, details)
      values (null, v_conv.id, 'reopen', jsonb_build_object('from', v_conv.status, 'reason', 'Nova mensagem do cliente'));
      v_reopened := v_reopened + 1;
    end if;
    perform ldo_private.support_summarize(v_conv.id);
  end loop;
  return jsonb_build_object('conversations', jsonb_array_length(coalesce(p_conversations, '[]'::jsonb)),
    'new_conversations', v_new_conv, 'new_messages', v_new_msgs, 'reopened', v_reopened);
end;
$$;

-- ---------------------------------------------------------------- sincronização

drop function public.ldo_support_sync_claim(text, text, boolean);
drop function public.ldo_support_sync_finish(text, text, boolean, text, text, text, jsonb, integer);

-- Devolve {claimed: true, source} ou {claimed: false, reason}. p_force (botão Atualizar) não espera
-- pela frequência normal; p_override (Super Admin) também ignora a espera depois de erros.
-- Nunca duas passagens ao mesmo tempo (lease de 150 s) nem duas em menos de 15 s.
create function public.ldo_support_sync_claim(p_token text, p_source text, p_force boolean, p_override boolean) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_s public.ldo_support_sources;
begin
  perform ldo_private.bi_check(p_token);
  update public.ldo_support_sources set lease_until = now() + interval '150 seconds', last_attempt_at = now()
  where id = p_source and (lease_until is null or lease_until < now())
    and (last_attempt_at is null or last_attempt_at < now() - interval '15 seconds')
    and (next_attempt_at is null or next_attempt_at <= now() or coalesce(p_override, false)
      or (coalesce(p_force, false) and failures = 0))
  returning * into v_s;
  if v_s.id is not null then
    return jsonb_build_object('claimed', true, 'source', to_jsonb(v_s));
  end if;
  select * into v_s from public.ldo_support_sources where id = p_source;
  return jsonb_build_object('claimed', false, 'next_attempt_at', v_s.next_attempt_at, 'reason', case
    when v_s.id is null then 'unknown'
    when v_s.lease_until > now() then 'running'
    when v_s.last_attempt_at >= now() - interval '15 seconds' then 'recent'
    when v_s.failures > 0 then 'backoff'
    else 'not_due' end);
end;
$$;

-- p_outcome: ok | more (ok, com trabalho por fazer: próxima passagem logo a seguir) | skipped (fonte
-- sem ligação: não conta como sincronizada) | error.
create function public.ldo_support_sync_finish(p_token text, p_source text, p_outcome text, p_status text, p_detail text,
  p_error text, p_cursor jsonb, p_retry_after integer) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_poll integer := (select poll_seconds from public.ldo_support_settings where id = 1);
begin
  perform ldo_private.bi_check(p_token);
  if p_outcome in ('ok', 'more') then
    update public.ldo_support_sources set lease_until = null, failures = 0, last_error = null, last_success_at = now(),
      next_attempt_at = case when p_outcome = 'more' then now() else now() + make_interval(secs => v_poll) end,
      status = coalesce(p_status, 'active'), status_detail = p_detail, cursor = coalesce(p_cursor, cursor)
    where id = p_source;
  elsif p_outcome = 'skipped' then
    update public.ldo_support_sources set lease_until = null, failures = 0, last_error = null,
      next_attempt_at = now() + make_interval(secs => v_poll), status = coalesce(p_status, 'pending'), status_detail = p_detail
    where id = p_source;
  else
    update public.ldo_support_sources set lease_until = null, failures = failures + 1, last_error = left(p_error, 500),
      next_attempt_at = now() + make_interval(secs => greatest(least(v_poll * power(2, least(failures + 1, 6)), 1800), coalesce(p_retry_after, 0))),
      status = coalesce(p_status, 'error'), status_detail = coalesce(p_detail, status_detail), cursor = coalesce(p_cursor, cursor)
    where id = p_source;
  end if;
end;
$$;

-- Progresso a meio de uma passagem (cursor e lease), para que um corte pelo tempo limite não perca o trabalho feito.
create function public.ldo_support_sync_progress(p_token text, p_source text, p_cursor jsonb) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform ldo_private.bi_check(p_token);
  update public.ldo_support_sources set cursor = coalesce(p_cursor, cursor), lease_until = now() + interval '150 seconds'
  where id = p_source;
end;
$$;

revoke all on function public.ldo_support_sync_claim(text, text, boolean, boolean),
  public.ldo_support_sync_finish(text, text, text, text, text, text, jsonb, integer),
  public.ldo_support_sync_progress(text, text, jsonb) from public, authenticated;
grant execute on function public.ldo_support_sync_claim(text, text, boolean, boolean),
  public.ldo_support_sync_finish(text, text, text, text, text, text, jsonb, integer),
  public.ldo_support_sync_progress(text, text, jsonb) to anon;
