-- Apoio ao Cliente: conversas do Zendesk, Facebook/Instagram (Metricool) e, mais tarde, WhatsApp.
--
-- Modelo comum com adaptadores por plataforma. Fonte de verdade:
--   Zendesk  → mensagens, estado e responsável vêm do Zendesk; o dashboard escreve primeiro no
--              Zendesk e só guarda o que o Zendesk devolve (a sincronização nunca escreve no Zendesk,
--              por isso não há ciclos).
--   Metricool/WhatsApp → mensagens vêm da plataforma; estado interno, responsável e notas são do dashboard.
-- Leituras (não lidas) são por colaborador e só locais: abrir uma conversa não marca nada na plataforma.
--
-- Tabelas sem acesso direto (anon/authenticated sem privilégios). Ações das pessoas passam por
-- funções com p_session; dados sincronizados, estados de envio e tokens só pelo servidor, com o
-- token de servidor já existente (BI_INGEST_TOKEN, hash em ldo_private.bi_token).
-- Os tokens Zendesk chegam aqui já cifrados (AES-256-GCM no servidor); a base de dados nunca vê a chave.

alter table public.ldo_app_users add column support_access boolean not null default false;

-- ---------------------------------------------------------------- tabelas

create table public.ldo_support_settings (
  id integer primary key check (id = 1),
  poll_seconds integer not null default 60 check (poll_seconds between 30 and 3600),
  zendesk_subdomain text not null default 'goldstorepremium' check (zendesk_subdomain ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  updated_by uuid references public.ldo_app_users (id),
  updated_at timestamptz not null default now()
);
insert into public.ldo_support_settings (id) values (1);

-- Uma linha por canal e conta de origem. lease_* evita duas sincronizações em simultâneo;
-- failures/next_attempt_at dão a espera progressiva depois de erros.
create table public.ldo_support_sources (
  id text primary key,
  platform text not null check (platform in ('zendesk', 'metricool', 'whatsapp')),
  channel text not null check (channel in ('zendesk', 'facebook', 'instagram', 'whatsapp')),
  account text not null,
  label text not null,
  status text not null default 'pending' check (status in ('not_configured', 'pending', 'active', 'error', 'blocked')),
  status_detail text,
  config jsonb not null default '{}'::jsonb,
  cursor jsonb not null default '{}'::jsonb,
  lease_until timestamptz,
  failures integer not null default 0,
  next_attempt_at timestamptz,
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  unique (channel, account)
);
insert into public.ldo_support_sources (id, platform, channel, account, label, status, status_detail, config) values
  ('zendesk', 'zendesk', 'zendesk', 'goldstorepremium', 'Zendesk', 'pending', null, '{}'),
  ('metricool-facebook', 'metricool', 'facebook', '2912472', 'Facebook Messenger', 'pending', null, '{"provider": "FACEBOOK"}'),
  ('metricool-instagram', 'metricool', 'instagram', '2912472', 'Instagram Direct', 'pending', null, '{"provider": "INSTAGRAM"}'),
  -- Reservado para a fase seguinte: número e conta empresarial ficam em config quando existirem.
  ('whatsapp', 'whatsapp', 'whatsapp', 'por-configurar', 'WhatsApp', 'not_configured',
   'Por configurar: WhatsApp Cloud API (número e conta empresarial) ainda não ligados.',
   '{"phone_number_id": null, "business_account_id": null}');

-- Identidade do cliente em cada canal. Nunca se juntam contactos pelo nome: a associação ao
-- cliente Shopify é manual (linked_*), com sugestões só por email ou telefone.
create table public.ldo_support_contacts (
  id uuid primary key default gen_random_uuid(),
  channel text not null,
  account text not null,
  external_id text not null,
  name text check (name is null or length(name) <= 200),
  email text check (email is null or length(email) <= 254),
  phone text check (phone is null or length(phone) <= 40),
  handle text check (handle is null or length(handle) <= 120),
  avatar_url text check (avatar_url is null or length(avatar_url) <= 1000),
  linked_email text check (linked_email is null or length(linked_email) <= 254),
  linked_by uuid references public.ldo_app_users (id),
  linked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (channel, account, external_id)
);
create index ldo_support_contacts_email_idx on public.ldo_support_contacts (lower(email)) where email is not null;

-- Cada conversa pertence a um canal: conversas do mesmo cliente em canais diferentes ficam separadas.
create table public.ldo_support_conversations (
  id uuid primary key default gen_random_uuid(),
  source_id text not null references public.ldo_support_sources (id),
  channel text not null,
  account text not null,
  external_id text not null,
  contact_id uuid references public.ldo_support_contacts (id),
  subject text check (subject is null or length(subject) <= 300),
  status text not null default 'novo' check (status in ('novo', 'em_atendimento', 'aguarda_cliente', 'resolvido')),
  platform_status text,
  assignee_id uuid references public.ldo_app_users (id),
  external_assignee_id text,
  external_assignee_name text,
  via text,
  last_message_at timestamptz,
  last_inbound_at timestamptz,
  last_preview text,
  last_direction text,
  external_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (channel, account, external_id)
);
create index ldo_support_conversations_last_idx on public.ldo_support_conversations (last_message_at desc nulls last);
create index ldo_support_conversations_assignee_idx on public.ldo_support_conversations (assignee_id);

-- kind: inbound (cliente), outbound (resposta pública), note (nota interna, nunca enviada ao cliente).
-- delivery (só outbound): sending → accepted | failed | uncertain; delivered/read só com confirmação do canal.
create table public.ldo_support_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.ldo_support_conversations (id) on delete cascade,
  external_id text,
  kind text not null check (kind in ('inbound', 'outbound', 'note')),
  author_name text,
  author_external_id text,
  author_user_id uuid references public.ldo_app_users (id),
  body text not null default '' check (length(body) <= 65000),
  attachments jsonb not null default '[]'::jsonb check (jsonb_typeof(attachments) = 'array'),
  created_at timestamptz not null,
  delivery text check (delivery in ('sending', 'accepted', 'delivered', 'read', 'failed', 'uncertain')),
  delivery_detail text,
  client_key uuid unique,
  inserted_at timestamptz not null default now(),
  unique (conversation_id, external_id)
);
create index ldo_support_messages_conv_idx on public.ldo_support_messages (conversation_id, created_at);

create table public.ldo_support_reads (
  user_id uuid not null references public.ldo_app_users (id) on delete cascade,
  conversation_id uuid not null references public.ldo_support_conversations (id) on delete cascade,
  read_at timestamptz not null,
  primary key (user_id, conversation_id)
);

create table public.ldo_support_presence (
  user_id uuid not null references public.ldo_app_users (id) on delete cascade,
  conversation_id uuid not null references public.ldo_support_conversations (id) on delete cascade,
  seen_at timestamptz not null default now(),
  composing boolean not null default false,
  primary key (user_id, conversation_id)
);

-- Registo das ações dos colaboradores e das reaberturas automáticas (actor null = sistema).
create table public.ldo_support_audit (
  id bigint generated always as identity primary key,
  actor uuid references public.ldo_app_users (id),
  conversation_id uuid references public.ldo_support_conversations (id) on delete cascade,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index ldo_support_audit_conv_idx on public.ldo_support_audit (conversation_id, created_at desc);

-- Uma ligação Zendesk por colaborador: cada resposta sai com a conta Zendesk de quem a escreve.
-- version + refresh_lease_until impedem duas renovações em simultâneo (cada renovação invalida o par anterior).
create table public.ldo_support_zendesk_connections (
  user_id uuid primary key references public.ldo_app_users (id) on delete cascade,
  subdomain text not null,
  zendesk_user_id text not null,
  zendesk_name text,
  zendesk_email text,
  zendesk_role text,
  scope text,
  access_ct text,
  refresh_ct text,
  access_expires_at timestamptz,
  refresh_expires_at timestamptz,
  version integer not null default 1,
  refresh_lease_until timestamptz,
  status text not null default 'active' check (status in ('active', 'reconnect')),
  status_detail text,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ldo_support_oauth_states (
  state_hash text primary key,
  user_id uuid not null references public.ldo_app_users (id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz
);

alter table public.ldo_support_settings enable row level security;
alter table public.ldo_support_sources enable row level security;
alter table public.ldo_support_contacts enable row level security;
alter table public.ldo_support_conversations enable row level security;
alter table public.ldo_support_messages enable row level security;
alter table public.ldo_support_reads enable row level security;
alter table public.ldo_support_presence enable row level security;
alter table public.ldo_support_audit enable row level security;
alter table public.ldo_support_zendesk_connections enable row level security;
alter table public.ldo_support_oauth_states enable row level security;
revoke all on public.ldo_support_settings, public.ldo_support_sources, public.ldo_support_contacts,
  public.ldo_support_conversations, public.ldo_support_messages, public.ldo_support_reads,
  public.ldo_support_presence, public.ldo_support_audit, public.ldo_support_zendesk_connections,
  public.ldo_support_oauth_states from anon, authenticated;

-- ---------------------------------------------------------------- permissões

-- Quem pode usar o Apoio ao Cliente: acesso "Apoio ao Cliente" ou Super Admin.
create function ldo_private.support_user(p_session text) returns uuid
language sql stable security definer set search_path = '' as $$
  select u.id from public.ldo_app_users u
  where u.id = ldo_private.session_user_id(p_session) and u.active and (u.support_access or u.is_super_admin);
$$;

create function ldo_private.support_super(p_session text) returns uuid
language sql stable security definer set search_path = '' as $$
  select u.id from public.ldo_app_users u
  where u.id = ldo_private.session_user_id(p_session) and u.active and u.is_super_admin;
$$;

create function ldo_private.support_check(p_session text) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v_me uuid := ldo_private.support_user(p_session);
begin
  if v_me is null then
    raise exception 'Sem acesso ao Apoio ao Cliente.' using errcode = '42501';
  end if;
  return v_me;
end;
$$;

-- Resumo da conversa a partir das mensagens guardadas (notas internas não entram no excerto).
create function ldo_private.support_summarize(p_conversation uuid) returns void
language sql volatile security definer set search_path = '' as $$
  update public.ldo_support_conversations c set
    last_message_at = s.last_at, last_inbound_at = s.last_in, last_preview = s.preview, last_direction = s.direction, updated_at = now()
  from (
    select
      (select max(m.created_at) from public.ldo_support_messages m where m.conversation_id = p_conversation and m.kind <> 'note') as last_at,
      (select max(m.created_at) from public.ldo_support_messages m where m.conversation_id = p_conversation and m.kind = 'inbound') as last_in,
      l.preview, l.direction
    from (select null) z
    left join lateral (
      select left(regexp_replace(case when m.body = '' and jsonb_array_length(m.attachments) > 0 then '[anexo]' else m.body end, '\s+', ' ', 'g'), 160) as preview,
        m.kind as direction
      from public.ldo_support_messages m
      where m.conversation_id = p_conversation and m.kind <> 'note'
      order by m.created_at desc, m.inserted_at desc limit 1
    ) l on true
  ) s
  where c.id = p_conversation;
$$;

revoke all on function ldo_private.support_user(text), ldo_private.support_super(text), ldo_private.support_check(text),
  ldo_private.support_summarize(uuid) from public, anon, authenticated;

-- O perfil da sessão passa a indicar o acesso ao Apoio ao Cliente.
create or replace function public.ldo_me(p_session text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', u.id,
    'username', u.username,
    'full_name', u.full_name,
    'is_super_admin', u.is_super_admin,
    'online_access', u.online_access or u.is_super_admin,
    'support_access', u.support_access or u.is_super_admin,
    'must_change_password', u.must_change_password,
    'stores', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'code', s.code, 'name', s.name, 'level', l.level,
        'ads_keyword', s.ads_keyword, 'closed_weekdays', s.closed_weekdays) order by s.sort_order, s.name)
      from public.ldo_app_stores s
      cross join lateral (select case when u.is_super_admin then 'manager' else u.store_access ->> s.id::text end as level) l
      where s.active and l.level is not null
    ), '[]'::jsonb)
  )
  from public.ldo_app_users u
  where u.id = ldo_private.session_user_id(p_session);
$$;

-- ---------------------------------------------------------------- consulta (sessão)

-- p_filter: all | mine | unassigned | unread. Não lidas = mensagens do cliente posteriores à última
-- leitura desta pessoa no dashboard.
create function public.ldo_support_list(p_session text, p_filter text, p_channel text, p_status text, p_q text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := ldo_private.support_check(p_session);
  v_q text := lower(nullif(btrim(coalesce(p_q, '')), ''));
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
          where m.conversation_id = c.id and m.kind = 'inbound' and m.created_at > coalesce(r.read_at, '-infinity'::timestamptz)
        ) u
        where (p_channel is null or p_channel = '' or c.channel = p_channel)
          and (p_status is null or p_status = '' or c.status = p_status)
          and (coalesce(p_filter, 'all') in ('all', 'unread')
            or (p_filter = 'mine' and c.assignee_id = v_me)
            or (p_filter = 'unassigned' and c.assignee_id is null and c.external_assignee_id is null))
          and (coalesce(p_filter, 'all') <> 'unread' or u.unread > 0)
          and (v_q is null
            or position(v_q in lower(coalesce(k.name, '') || ' ' || coalesce(k.email, '') || ' ' || coalesce(k.handle, '') || ' '
              || coalesce(k.phone, '') || ' ' || coalesce(c.subject, '') || ' ' || coalesce(c.external_id, ''))) > 0
            or exists (select 1 from public.ldo_support_messages m where m.conversation_id = c.id and m.kind <> 'note' and position(v_q in lower(m.body)) > 0))
        order by sort_at desc
        limit 300
      ) x
    ), '[]'::jsonb),
    'counts', (
      select jsonb_build_object(
        'all', count(*),
        'mine', count(*) filter (where c.assignee_id = v_me and c.status <> 'resolvido'),
        'unassigned', count(*) filter (where c.assignee_id is null and c.external_assignee_id is null and c.status <> 'resolvido'),
        'unread', count(*) filter (where exists (
          select 1 from public.ldo_support_messages m
          left join public.ldo_support_reads r on r.conversation_id = c.id and r.user_id = v_me
          where m.conversation_id = c.id and m.kind = 'inbound' and m.created_at > coalesce(r.read_at, '-infinity'::timestamptz))))
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

create function public.ldo_support_conversation(p_session text, p_id uuid) returns jsonb
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
      'read_at', (select read_at from public.ldo_support_reads where user_id = v_me and conversation_id = p_id)),
    'contact', case when v_k.id is null then null else to_jsonb(v_k) || jsonb_build_object(
      'linked_by_name', (select coalesce(full_name, username) from public.ldo_app_users where id = v_k.linked_by)) end,
    -- Outras identidades com o mesmo email ou telefone (identificadores fiáveis), só como sugestão.
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

-- Colaboradores a quem se pode atribuir, e se têm o Zendesk ligado (preciso para tickets Zendesk).
create function public.ldo_support_users(p_session text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_me uuid := ldo_private.support_check(p_session);
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', u.id, 'name', coalesce(u.full_name, u.username), 'me', u.id = v_me,
      'zendesk', z.status = 'active', 'zendesk_user_id', z.zendesk_user_id, 'zendesk_name', z.zendesk_name, 'zendesk_status', z.status)
      order by coalesce(u.full_name, u.username))
    from public.ldo_app_users u
    left join public.ldo_support_zendesk_connections z on z.user_id = u.id
    where u.active and (u.support_access or u.is_super_admin)
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------- ações locais (sessão)

create function public.ldo_support_mark_read(p_session text, p_id uuid, p_unread boolean) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_me uuid := ldo_private.support_check(p_session);
begin
  if coalesce(p_unread, false) then
    -- "Marcar como não lida": a leitura volta para antes da última mensagem do cliente.
    insert into public.ldo_support_reads (user_id, conversation_id, read_at)
    select v_me, c.id, coalesce(c.last_inbound_at, now()) - interval '1 millisecond' from public.ldo_support_conversations c where c.id = p_id
    on conflict (user_id, conversation_id) do update set read_at = excluded.read_at;
  else
    insert into public.ldo_support_reads (user_id, conversation_id, read_at)
    select v_me, c.id, greatest(now(), coalesce(c.last_inbound_at, now())) from public.ldo_support_conversations c where c.id = p_id
    on conflict (user_id, conversation_id) do update set read_at = excluded.read_at;
  end if;
end;
$$;

-- Presença: quem tem a conversa aberta nos últimos 60 s (e se está a escrever).
create function public.ldo_support_presence_ping(p_session text, p_id uuid, p_composing boolean) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_me uuid := ldo_private.support_check(p_session);
begin
  insert into public.ldo_support_presence (user_id, conversation_id, seen_at, composing)
  values (v_me, p_id, now(), coalesce(p_composing, false))
  on conflict (user_id, conversation_id) do update set seen_at = now(), composing = excluded.composing;
  delete from public.ldo_support_presence where seen_at < now() - interval '1 day';
  return coalesce((
    select jsonb_agg(jsonb_build_object('user_id', p.user_id, 'name', coalesce(u.full_name, u.username), 'composing', p.composing, 'seen_at', p.seen_at))
    from public.ldo_support_presence p join public.ldo_app_users u on u.id = p.user_id
    where p.conversation_id = p_id and p.user_id <> v_me and p.seen_at > now() - interval '60 seconds'
  ), '[]'::jsonb);
end;
$$;

-- Estado interno e responsável das conversas em que o dashboard é a fonte de verdade (não Zendesk).
create function public.ldo_support_set_local(p_session text, p_id uuid, p_set_status boolean, p_status text,
  p_set_assignee boolean, p_assignee uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me uuid := ldo_private.support_check(p_session);
  v_c public.ldo_support_conversations;
begin
  select * into v_c from public.ldo_support_conversations where id = p_id for update;
  if v_c.id is null then
    raise exception 'Conversa não encontrada.' using errcode = 'P0002';
  end if;
  if v_c.source_id = 'zendesk' then
    raise exception 'Estado e responsável dos tickets Zendesk são alterados no Zendesk.' using errcode = '42501';
  end if;
  if p_set_status and p_status not in ('novo', 'em_atendimento', 'aguarda_cliente', 'resolvido') then
    raise exception 'Estado inválido.' using errcode = '22023';
  end if;
  if p_set_assignee and p_assignee is not null and not exists (
    select 1 from public.ldo_app_users where id = p_assignee and active and (support_access or is_super_admin)) then
    raise exception 'Este colaborador não tem acesso ao Apoio ao Cliente.' using errcode = '22023';
  end if;
  update public.ldo_support_conversations set
    status = case when p_set_status then p_status else status end,
    assignee_id = case when p_set_assignee then p_assignee else assignee_id end,
    updated_at = now()
  where id = p_id;
  if p_set_status and p_status is distinct from v_c.status then
    insert into public.ldo_support_audit (actor, conversation_id, action, details)
    values (v_me, p_id, 'status', jsonb_build_object('from', v_c.status, 'to', p_status));
  end if;
  if p_set_assignee and p_assignee is distinct from v_c.assignee_id then
    insert into public.ldo_support_audit (actor, conversation_id, action, details)
    values (v_me, p_id, 'assign', jsonb_build_object('from', v_c.assignee_id, 'to', p_assignee,
      'to_name', (select coalesce(full_name, username) from public.ldo_app_users where id = p_assignee)));
  end if;
end;
$$;

-- Associação manual ao cliente (email usado para procurar as encomendas Shopify).
create function public.ldo_support_link_contact(p_session text, p_contact uuid, p_email text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me uuid := ldo_private.support_check(p_session);
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_old text;
begin
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Email inválido.' using errcode = '22023';
  end if;
  select linked_email into v_old from public.ldo_support_contacts where id = p_contact for update;
  if not found then
    raise exception 'Contacto não encontrado.' using errcode = 'P0002';
  end if;
  update public.ldo_support_contacts set linked_email = v_email,
    linked_by = case when v_email is null then null else v_me end,
    linked_at = case when v_email is null then null else now() end, updated_at = now()
  where id = p_contact;
  insert into public.ldo_support_audit (actor, conversation_id, action, details)
  select v_me, c.id, 'link_customer', jsonb_build_object('from', v_old, 'to', v_email)
  from public.ldo_support_conversations c where c.contact_id = p_contact;
end;
$$;

-- Primeiro passo de um envio: grava a mensagem como "a enviar", com a autoria de quem envia.
-- client_key torna o pedido idempotente: um segundo clique devolve a mesma linha (existing = true)
-- e o servidor não volta a chamar a plataforma.
-- Notas internas das conversas que não são Zendesk ficam logo guardadas (só existem no dashboard).
create function public.ldo_support_begin_send(p_session text, p_id uuid, p_kind text, p_body text, p_client_key uuid) returns jsonb
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
    if v_m.conversation_id <> p_id or v_m.author_user_id is distinct from v_me then
      raise exception 'Pedido inválido.' using errcode = '22023';
    end if;
    v_existing := true;
  else
    insert into public.ldo_support_messages (conversation_id, kind, author_user_id, body, created_at, delivery, client_key)
    values (p_id, p_kind, v_me, v_body, now(),
      case when p_kind = 'outbound' or v_platform = 'zendesk' then 'sending' end, p_client_key)
    returning * into v_m;
    insert into public.ldo_support_audit (actor, conversation_id, action, details)
    values (v_me, p_id, case when p_kind = 'note' then 'note' else 'reply' end, jsonb_build_object('message_id', v_m.id));
    -- Responder a uma conversa sem responsável atribui-a a quem respondeu (só conversas locais).
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
      'external_id', v_c.external_id, 'via', v_c.via, 'contact_external_id', v_k.external_id));
end;
$$;

-- ---------------------------------------------------------------- administração (Super Admin)

create function public.ldo_support_admin_state(p_session text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if ldo_private.support_super(p_session) is null then
    raise exception 'Só o Super Admin configura o Apoio ao Cliente.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'settings', (select to_jsonb(s) from public.ldo_support_settings s where id = 1),
    'sources', coalesce((select jsonb_agg(to_jsonb(s) - 'cursor' order by s.id) from public.ldo_support_sources s), '[]'::jsonb),
    'connections', coalesce((select jsonb_agg(jsonb_build_object('user_id', z.user_id, 'name', coalesce(u.full_name, u.username),
      'zendesk_name', z.zendesk_name, 'zendesk_email', z.zendesk_email, 'zendesk_role', z.zendesk_role, 'scope', z.scope,
      'status', z.status, 'status_detail', z.status_detail, 'access_expires_at', z.access_expires_at,
      'refresh_expires_at', z.refresh_expires_at, 'connected_at', z.connected_at, 'updated_at', z.updated_at))
      from public.ldo_support_zendesk_connections z join public.ldo_app_users u on u.id = z.user_id), '[]'::jsonb),
    'users', coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'name', coalesce(u.full_name, u.username), 'username', u.username,
      'support_access', u.support_access, 'is_super_admin', u.is_super_admin) order by coalesce(u.full_name, u.username))
      from public.ldo_app_users u where u.active and u.username is not null), '[]'::jsonb),
    'counts', (select jsonb_build_object('conversations', count(*), 'open', count(*) filter (where status <> 'resolvido'))
      from public.ldo_support_conversations),
    'audit', coalesce((select jsonb_agg(jsonb_build_object('action', l.action, 'details', l.details, 'created_at', l.created_at,
      'actor', coalesce((select coalesce(full_name, username) from public.ldo_app_users where id = l.actor), 'Sistema')) order by l.created_at desc)
      from (select * from public.ldo_support_audit where conversation_id is null order by created_at desc limit 20) l), '[]'::jsonb)
  );
end;
$$;

create function public.ldo_support_save_settings(p_session text, p_poll_seconds integer) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_me uuid := ldo_private.support_super(p_session);
begin
  if v_me is null then
    raise exception 'Só o Super Admin configura o Apoio ao Cliente.' using errcode = '42501';
  end if;
  if p_poll_seconds is null or p_poll_seconds not between 30 and 3600 then
    raise exception 'Frequência entre 30 segundos e 1 hora.' using errcode = '22023';
  end if;
  update public.ldo_support_settings set poll_seconds = p_poll_seconds, updated_by = v_me, updated_at = now() where id = 1;
  insert into public.ldo_support_audit (actor, action, details) values (v_me, 'settings', jsonb_build_object('poll_seconds', p_poll_seconds));
end;
$$;

create function public.ldo_support_set_user_access(p_session text, p_user_id uuid, p_access boolean) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_me uuid := ldo_private.support_super(p_session);
begin
  if v_me is null then
    raise exception 'Só o Super Admin dá acesso ao Apoio ao Cliente.' using errcode = '42501';
  end if;
  update public.ldo_app_users set support_access = coalesce(p_access, false), updated_by = v_me, updated_at = now()
  where id = p_user_id and support_access is distinct from coalesce(p_access, false);
  if found then
    insert into public.ldo_app_audit (actor, action, target, details)
    values (v_me, 'user.support_access', p_user_id, jsonb_build_object('support_access', coalesce(p_access, false)));
  end if;
end;
$$;

-- ---------------------------------------------------------------- Zendesk OAuth

-- O state do OAuth fica ligado à pessoa que iniciou a ligação; só o hash é guardado, vale 10 minutos e uma vez.
create function public.ldo_support_oauth_begin(p_session text, p_state_hash text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_me uuid := ldo_private.support_check(p_session);
begin
  if p_state_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Pedido inválido.' using errcode = '22023';
  end if;
  delete from public.ldo_support_oauth_states where expires_at < now() - interval '1 day';
  insert into public.ldo_support_oauth_states (state_hash, user_id, expires_at) values (p_state_hash, v_me, now() + interval '10 minutes');
end;
$$;

create function public.ldo_support_oauth_consume(p_session text, p_state_hash text) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare v_me uuid := ldo_private.support_user(p_session);
begin
  if v_me is null then
    return false;
  end if;
  update public.ldo_support_oauth_states set used_at = now()
  where state_hash = p_state_hash and user_id = v_me and used_at is null and expires_at > now();
  return found;
end;
$$;

-- Desligar a própria conta (ou, para o Super Admin, a de outra pessoa). Os tokens são apagados.
create function public.ldo_support_zendesk_disconnect(p_session text, p_user_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me uuid := ldo_private.support_check(p_session);
  v_target uuid := coalesce(p_user_id, v_me);
begin
  if v_target <> v_me and ldo_private.support_super(p_session) is null then
    raise exception 'Só o Super Admin desliga a conta de outra pessoa.' using errcode = '42501';
  end if;
  delete from public.ldo_support_zendesk_connections where user_id = v_target;
  insert into public.ldo_support_audit (actor, action, details) values (v_me, 'zendesk.disconnect', jsonb_build_object('user_id', v_target));
end;
$$;

-- ---------------------------------------------------------------- servidor (token)

create function public.ldo_support_zendesk_save(p_token text, p_user_id uuid, p_data jsonb) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform ldo_private.bi_check(p_token);
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
  insert into public.ldo_support_audit (actor, action, details)
  values (p_user_id, 'zendesk.connect', jsonb_build_object('zendesk_user_id', p_data->>'zendesk_user_id', 'role', p_data->>'zendesk_role'));
end;
$$;

create function public.ldo_support_zendesk_get(p_token text, p_user_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform ldo_private.bi_check(p_token);
  return (select to_jsonb(z) from public.ldo_support_zendesk_connections z where z.user_id = p_user_id);
end;
$$;

-- Ligação usada para a sincronização (leitura): a ativa mais recente, preferindo um Super Admin.
create function public.ldo_support_zendesk_sync_user(p_token text) returns uuid
language plpgsql stable security definer set search_path = '' as $$
begin
  perform ldo_private.bi_check(p_token);
  return (select z.user_id from public.ldo_support_zendesk_connections z join public.ldo_app_users u on u.id = z.user_id
    where z.status = 'active' and u.active and (u.support_access or u.is_super_admin)
    order by u.is_super_admin desc, z.updated_at desc limit 1);
end;
$$;

-- Só um pedido de cada vez renova o token: quem obtém o lease renova; os outros esperam pela versão nova.
create function public.ldo_support_zendesk_claim(p_token text, p_user_id uuid, p_version integer) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform ldo_private.bi_check(p_token);
  update public.ldo_support_zendesk_connections set refresh_lease_until = now() + interval '30 seconds'
  where user_id = p_user_id and version = p_version and status = 'active'
    and (refresh_lease_until is null or refresh_lease_until < now());
  return found;
end;
$$;

create function public.ldo_support_zendesk_rotate(p_token text, p_user_id uuid, p_version integer, p_data jsonb) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform ldo_private.bi_check(p_token);
  update public.ldo_support_zendesk_connections set access_ct = p_data->>'access_ct', refresh_ct = p_data->>'refresh_ct',
    access_expires_at = (p_data->>'access_expires_at')::timestamptz, refresh_expires_at = (p_data->>'refresh_expires_at')::timestamptz,
    scope = coalesce(p_data->>'scope', scope), version = version + 1, refresh_lease_until = null, updated_at = now()
  where user_id = p_user_id and version = p_version;
  return found;
end;
$$;

create function public.ldo_support_zendesk_fail(p_token text, p_user_id uuid, p_version integer, p_detail text) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform ldo_private.bi_check(p_token);
  update public.ldo_support_zendesk_connections set status = 'reconnect', status_detail = left(p_detail, 300),
    access_ct = null, refresh_ct = null, refresh_lease_until = null, updated_at = now()
  where user_id = p_user_id and version = p_version;
end;
$$;

-- Sincronização: uma de cada vez por fonte. p_force (botão Atualizar) ignora a espera normal,
-- mas não a espera progressiva depois de erros, e nunca repete em menos de 15 s.
create function public.ldo_support_sync_claim(p_token text, p_source text, p_force boolean) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_s public.ldo_support_sources;
begin
  perform ldo_private.bi_check(p_token);
  update public.ldo_support_sources set lease_until = now() + interval '90 seconds', last_attempt_at = now()
  where id = p_source and (lease_until is null or lease_until < now())
    and (last_attempt_at is null or last_attempt_at < now() - interval '15 seconds')
    and (next_attempt_at is null or next_attempt_at <= now() or (coalesce(p_force, false) and failures = 0))
  returning * into v_s;
  return case when v_s.id is null then null else to_jsonb(v_s) end;
end;
$$;

create function public.ldo_support_sync_finish(p_token text, p_source text, p_ok boolean, p_status text, p_detail text,
  p_error text, p_cursor jsonb, p_retry_after integer) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_poll integer := (select poll_seconds from public.ldo_support_settings where id = 1);
begin
  perform ldo_private.bi_check(p_token);
  if p_ok then
    update public.ldo_support_sources set lease_until = null, failures = 0, last_error = null, last_success_at = now(),
      next_attempt_at = now() + make_interval(secs => v_poll), status = coalesce(p_status, 'active'), status_detail = p_detail,
      cursor = coalesce(p_cursor, cursor)
    where id = p_source;
  else
    update public.ldo_support_sources set lease_until = null, failures = failures + 1, last_error = left(p_error, 500),
      next_attempt_at = now() + make_interval(secs => greatest(least(v_poll * power(2, least(failures + 1, 6)), 1800), coalesce(p_retry_after, 0))),
      status = coalesce(p_status, 'error'), status_detail = coalesce(p_detail, status_detail), cursor = coalesce(p_cursor, cursor)
    where id = p_source;
  end if;
end;
$$;

-- Estado de uma fonte sem sincronizar (ex.: Zendesk sem ligação, WhatsApp por configurar).
create function public.ldo_support_source_status(p_token text, p_source text, p_status text, p_detail text) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform ldo_private.bi_check(p_token);
  update public.ldo_support_sources set status = p_status, status_detail = left(p_detail, 500) where id = p_source;
end;
$$;

-- Grava conversas e mensagens vindas de uma plataforma. Idempotente: as chaves únicas
-- (canal, conta, id externo) e (conversa, id externo da mensagem) impedem duplicados.
-- Regra de reabertura (conversas cujo estado é do dashboard): uma mensagem nova do cliente
-- numa conversa "Resolvido" volta a "Novo" (sem responsável) ou "Em atendimento" (com responsável);
-- em "A aguardar cliente" passa a "Em atendimento". No Zendesk é o próprio Zendesk que reabre.
create function public.ldo_support_ingest(p_token text, p_source text, p_conversations jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_src public.ldo_support_sources;
  c jsonb;
  m jsonb;
  v_contact uuid;
  v_conv public.ldo_support_conversations;
  v_is_new boolean;
  v_new_inbound integer;
  v_match uuid;
  v_assignee uuid;
  v_status text;
  v_new_conv integer := 0;
  v_new_msgs integer := 0;
  v_reopened integer := 0;
  v_platform_truth boolean;
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
      select z.user_id into v_assignee from public.ldo_support_zendesk_connections z where z.zendesk_user_id = c ->> 'external_assignee_id';
    end if;
    v_status := case when c ->> 'status' in ('novo', 'em_atendimento', 'aguarda_cliente', 'resolvido') then c ->> 'status' end;

    select * into v_conv from public.ldo_support_conversations
    where channel = v_src.channel and account = v_src.account and external_id = c ->> 'external_id' for update;
    v_is_new := v_conv.id is null;
    if v_is_new then
      insert into public.ldo_support_conversations (source_id, channel, account, external_id, contact_id, subject, status, platform_status,
        assignee_id, external_assignee_id, external_assignee_name, via, external_updated_at)
      values (v_src.id, v_src.channel, v_src.account, c ->> 'external_id', v_contact, left(c ->> 'subject', 300),
        case when v_platform_truth then coalesce(v_status, 'novo') else 'novo' end, c ->> 'platform_status',
        v_assignee, nullif(c ->> 'external_assignee_id', ''), nullif(c ->> 'external_assignee_name', ''), c ->> 'via',
        (c ->> 'external_updated_at')::timestamptz)
      returning * into v_conv;
      v_new_conv := v_new_conv + 1;
    else
      update public.ldo_support_conversations set
        contact_id = v_contact, subject = coalesce(left(c ->> 'subject', 300), subject),
        platform_status = coalesce(c ->> 'platform_status', platform_status), via = coalesce(c ->> 'via', via),
        external_updated_at = coalesce((c ->> 'external_updated_at')::timestamptz, external_updated_at),
        status = case when v_platform_truth and v_status is not null then v_status else status end,
        assignee_id = case when v_platform_truth then v_assignee else assignee_id end,
        external_assignee_id = case when v_platform_truth then nullif(c ->> 'external_assignee_id', '') else external_assignee_id end,
        external_assignee_name = case when v_platform_truth then nullif(c ->> 'external_assignee_name', '') else external_assignee_name end,
        updated_at = now()
      where id = v_conv.id
      returning * into v_conv;
    end if;

    v_new_inbound := 0;
    for m in select value from jsonb_array_elements(coalesce(c -> 'messages', '[]'::jsonb)) loop
      if m ->> 'kind' not in ('inbound', 'outbound', 'note') or nullif(m ->> 'external_id', '') is null then
        continue;
      end if;
      if exists (select 1 from public.ldo_support_messages where conversation_id = v_conv.id and external_id = m ->> 'external_id') then
        -- Confirmações de entrega/leitura só quando o canal as dá.
        if m ->> 'delivery' in ('delivered', 'read') then
          update public.ldo_support_messages set delivery = m ->> 'delivery'
          where conversation_id = v_conv.id and external_id = m ->> 'external_id' and kind = 'outbound'
            and delivery in ('accepted', 'delivered', 'uncertain', 'sending');
        end if;
        continue;
      end if;
      -- Uma resposta enviada pelo dashboard cujo resultado ficou incerto é reconhecida aqui
      -- (mesmo texto, mesmo tipo, até 15 minutos), em vez de aparecer duplicada.
      v_match := null;
      if m ->> 'kind' in ('outbound', 'note') then
        select id into v_match from public.ldo_support_messages
        where conversation_id = v_conv.id and external_id is null and kind = m ->> 'kind' and delivery in ('sending', 'uncertain')
          and btrim(body) = btrim(coalesce(m ->> 'body', ''))
          and abs(extract(epoch from (created_at - (m ->> 'created_at')::timestamptz))) < 900
        order by created_at limit 1;
      end if;
      if v_match is not null then
        update public.ldo_support_messages set external_id = m ->> 'external_id',
          delivery = case when kind = 'outbound' then coalesce(nullif(m ->> 'delivery', ''), 'accepted') else null end,
          delivery_detail = 'Confirmado pela sincronização.', attachments = coalesce(m -> 'attachments', attachments)
        where id = v_match;
        continue;
      end if;
      insert into public.ldo_support_messages (conversation_id, external_id, kind, author_name, author_external_id, author_user_id, body,
        attachments, created_at, delivery)
      values (v_conv.id, m ->> 'external_id', m ->> 'kind', left(m ->> 'author_name', 200), m ->> 'author_external_id',
        case when v_platform_truth then (select z.user_id from public.ldo_support_zendesk_connections z where z.zendesk_user_id = m ->> 'author_external_id') end,
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

-- Resultado de um envio. Só o servidor o define, depois da resposta da plataforma.
create function public.ldo_support_finish_send(p_token text, p_message uuid, p_delivery text, p_detail text, p_external_id text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_conv uuid;
begin
  perform ldo_private.bi_check(p_token);
  if p_delivery is not null and p_delivery not in ('accepted', 'delivered', 'read', 'failed', 'uncertain') then
    raise exception 'Estado inválido.' using errcode = '22023';
  end if;
  update public.ldo_support_messages set
    delivery = case when kind = 'note' and p_delivery = 'accepted' then null else p_delivery end,
    delivery_detail = left(p_detail, 500),
    external_id = coalesce(nullif(p_external_id, ''), external_id)
  where id = p_message
  returning conversation_id into v_conv;
  if v_conv is not null then
    perform ldo_private.support_summarize(v_conv);
  end if;
end;
$$;

create function public.ldo_support_log(p_token text, p_actor uuid, p_conversation uuid, p_action text, p_details jsonb) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform ldo_private.bi_check(p_token);
  insert into public.ldo_support_audit (actor, conversation_id, action, details)
  values (p_actor, p_conversation, left(p_action, 60), coalesce(p_details, '{}'::jsonb));
end;
$$;

-- Dados de uma conversa e de uma mensagem para o servidor (anexos, verificação de envios).
create function public.ldo_support_server_message(p_token text, p_message uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform ldo_private.bi_check(p_token);
  return (select jsonb_build_object('message', to_jsonb(m), 'conversation', to_jsonb(c),
      'contact_external_id', (select external_id from public.ldo_support_contacts where id = c.contact_id))
    from public.ldo_support_messages m join public.ldo_support_conversations c on c.id = m.conversation_id where m.id = p_message);
end;
$$;

create function public.ldo_support_server_conversation(p_token text, p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform ldo_private.bi_check(p_token);
  return (select to_jsonb(c) || jsonb_build_object('contact', (select to_jsonb(k) from public.ldo_support_contacts k where k.id = c.contact_id))
    from public.ldo_support_conversations c where c.id = p_id);
end;
$$;

-- ---------------------------------------------------------------- acessos

revoke all on function
  public.ldo_support_list(text, text, text, text, text),
  public.ldo_support_conversation(text, uuid),
  public.ldo_support_users(text),
  public.ldo_support_mark_read(text, uuid, boolean),
  public.ldo_support_presence_ping(text, uuid, boolean),
  public.ldo_support_set_local(text, uuid, boolean, text, boolean, uuid),
  public.ldo_support_link_contact(text, uuid, text),
  public.ldo_support_begin_send(text, uuid, text, text, uuid),
  public.ldo_support_admin_state(text),
  public.ldo_support_save_settings(text, integer),
  public.ldo_support_set_user_access(text, uuid, boolean),
  public.ldo_support_oauth_begin(text, text),
  public.ldo_support_oauth_consume(text, text),
  public.ldo_support_zendesk_disconnect(text, uuid),
  public.ldo_support_zendesk_save(text, uuid, jsonb),
  public.ldo_support_zendesk_get(text, uuid),
  public.ldo_support_zendesk_sync_user(text),
  public.ldo_support_zendesk_claim(text, uuid, integer),
  public.ldo_support_zendesk_rotate(text, uuid, integer, jsonb),
  public.ldo_support_zendesk_fail(text, uuid, integer, text),
  public.ldo_support_sync_claim(text, text, boolean),
  public.ldo_support_sync_finish(text, text, boolean, text, text, text, jsonb, integer),
  public.ldo_support_source_status(text, text, text, text),
  public.ldo_support_ingest(text, text, jsonb),
  public.ldo_support_finish_send(text, uuid, text, text, text),
  public.ldo_support_log(text, uuid, uuid, text, jsonb),
  public.ldo_support_server_message(text, uuid),
  public.ldo_support_server_conversation(text, uuid)
from public, authenticated;
grant execute on function
  public.ldo_support_list(text, text, text, text, text),
  public.ldo_support_conversation(text, uuid),
  public.ldo_support_users(text),
  public.ldo_support_mark_read(text, uuid, boolean),
  public.ldo_support_presence_ping(text, uuid, boolean),
  public.ldo_support_set_local(text, uuid, boolean, text, boolean, uuid),
  public.ldo_support_link_contact(text, uuid, text),
  public.ldo_support_begin_send(text, uuid, text, text, uuid),
  public.ldo_support_admin_state(text),
  public.ldo_support_save_settings(text, integer),
  public.ldo_support_set_user_access(text, uuid, boolean),
  public.ldo_support_oauth_begin(text, text),
  public.ldo_support_oauth_consume(text, text),
  public.ldo_support_zendesk_disconnect(text, uuid),
  public.ldo_support_zendesk_save(text, uuid, jsonb),
  public.ldo_support_zendesk_get(text, uuid),
  public.ldo_support_zendesk_sync_user(text),
  public.ldo_support_zendesk_claim(text, uuid, integer),
  public.ldo_support_zendesk_rotate(text, uuid, integer, jsonb),
  public.ldo_support_zendesk_fail(text, uuid, integer, text),
  public.ldo_support_sync_claim(text, text, boolean),
  public.ldo_support_sync_finish(text, text, boolean, text, text, text, jsonb, integer),
  public.ldo_support_source_status(text, text, text, text),
  public.ldo_support_ingest(text, text, jsonb),
  public.ldo_support_finish_send(text, uuid, text, text, text),
  public.ldo_support_log(text, uuid, uuid, text, jsonb),
  public.ldo_support_server_message(text, uuid),
  public.ldo_support_server_conversation(text, uuid)
to anon;

-- ldo_list_users passa a indicar o acesso ao Apoio ao Cliente.
create or replace function public.ldo_list_users(p_session text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := ldo_private.session_user_id(p_session);
  v_super boolean;
  v_managed uuid[];
begin
  if v_me is null then
    raise exception 'Sessão inválida.' using errcode = '42501';
  end if;
  select is_super_admin into v_super from public.ldo_app_users where id = v_me;
  v_managed := ldo_private.managed_stores(v_me);
  if not v_super and cardinality(v_managed) = 0 then
    raise exception 'Sem permissão para gerir utilizadores.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', u.id,
      'username', u.username,
      'full_name', u.full_name,
      'email', case when v_super or u.id = v_me then u.email end,
      'receive_reports', u.receive_reports,
      'is_super_admin', u.is_super_admin,
      'online_access', u.online_access,
      'support_access', u.support_access,
      'active', u.active,
      'store_access', case when v_super then u.store_access else (
        select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from jsonb_each_text(u.store_access) a(k, v)
        where k::uuid = any (v_managed)) end,
      'editable', v_super or (
        u.id <> v_me and not u.is_super_admin and not u.online_access and not u.support_access
        and not exists (select 1 from jsonb_each_text(u.store_access) a(k, v) where v <> 'store' or not (k::uuid = any (v_managed)))),
      'has_password', u.password_hash is not null,
      'must_change_password', u.must_change_password,
      'locked', coalesce(u.locked_until > now(), false),
      'last_login_at', u.last_login_at
    ) order by u.active desc, coalesce(u.full_name, u.username))
    from public.ldo_app_users u
    where u.username is not null and (v_super or u.id = v_me or exists (
      select 1 from jsonb_object_keys(u.store_access) k where k::uuid = any (v_managed)))
  ), '[]'::jsonb);
end;
$$;
