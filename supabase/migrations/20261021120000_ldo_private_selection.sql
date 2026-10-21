-- Loja Online: Private Selection, a página reservada da loja Shopify ("Loja do Ouro Private Selection" para quem
-- está em português e em Portugal, "Gold Store Premium Private Selection" para os restantes).
--
-- * Quem preenche o formulário da página (nome, email e telemóvel) fica logo membro ativo e recebe a senha por
--   email cerca de 30 minutos depois: o envio fica na fila desta base de dados e a verificação automática de 5 em
--   5 minutos trata-o (30 a 35 minutos). Quem é adicionado pela equipa recebe o email logo.
-- * Uma só senha para todos, definida no dashboard (Super Admin e Loja Online). Fica em bcrypt, para a
--   verificação feita aqui, e cifrada no servidor (AES-256-GCM, SUPPORT_ENCRYPTION_KEY), só para os emails: a
--   base de dados nunca vê a chave. Mudar a senha termina todas as sessões da loja.
-- * Remover é sempre uma marca. Um membro removido que peça de novo (o mesmo email, o mesmo endereço com "+…" ou o
--   mesmo telemóvel) recebe a mesma resposta neutra, sem email e sem voltar a ficar ativo; só a equipa o pode
--   adicionar outra vez.
-- * Sessões da loja: token aleatório (só o hash fica guardado), válido 30 dias e confirmado em cada visita da
--   página reservada; remover o membro termina as dele e mudar a senha termina todas. A senha é partilhada: quem a
--   conhece entra com o email de qualquer membro ativo, por isso entrar não prova quem é a pessoa.
-- * Klaviyo (lista "Clientes Private Selection"): fila por membro (upsert / remove), tratada pelo servidor. A
--   inscrição no marketing segue uma só vez por consentimento (klaviyo_subscribed_at).
-- * As rotas públicas nunca dizem se um email é membro. ldo_ps_events guarda IP, rede e email só em hash, para os
--   limites contra abuso, e é limpa ao fim de 30 dias.
--
-- Tabelas sem acesso direto (anon/authenticated sem privilégios). A equipa usa funções com p_session; as rotas
-- públicas e as filas usam o token do servidor (BI_INGEST_TOKEN, ldo_private.bi_check). As ações da equipa ficam
-- em ldo_app_audit (private.*).

-- ---------------------------------------------------------------- tabelas

-- Configuração (uma linha). password_changed_at invalida as sessões abertas antes da mudança.
create table public.ldo_ps_settings (
  id integer primary key check (id = 1),
  password_hash text,
  password_ct text check (password_ct is null or password_ct ~ '^v1\.'),
  password_changed_at timestamptz,
  password_changed_by uuid references public.ldo_app_users (id),
  delay_minutes integer not null default 30 check (delay_minutes between 0 and 1440),
  session_days integer not null default 30 check (session_days between 1 and 365),
  entry_path text not null default '/products/pulseira-marquesa-em-ouro-19kl-20-1cm?view=private-selection'
    check (entry_path ~ '^/' and length(entry_path) <= 500),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.ldo_app_users (id),
  check ((password_hash is null) = (password_ct is null))
);
insert into public.ldo_ps_settings (id) values (1);

-- Um membro por email. Email da senha: por enviar enquanto email_sent_at é null e email_due_at está definido (até
-- 5 tentativas); email_due_at null sem envio = cancelado. Klaviyo: klaviyo_action pendente (null = nada a fazer);
-- klaviyo_subscribed_at é quando a inscrição no marketing seguiu (só uma vez: uma edição da equipa nunca volta a
-- inscrever quem entretanto saiu nos emails da Klaviyo).
-- *_lease_until é a reserva de quem está a enviar e o *_done só conta com essa mesma reserva: mexer na fila anula-a
-- e o resultado desse envio deixa de contar (o envio volta a ser feito com os dados atuais).
create table public.ldo_ps_members (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(btrim(email)) and length(email) <= 254
    and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]{2,}$'),
  name text not null check (length(name) between 1 and 120),
  phone text not null check (phone ~ '^\+[1-9][0-9]{6,14}$'),
  locale text not null check (locale in ('pt', 'en', 'es', 'fr', 'de', 'it')),
  brand text not null check (brand in ('ldo', 'gsp')),
  origin text check (origin is null or length(origin) <= 200),
  source text not null check (source in ('form', 'admin')),
  consent_marketing boolean not null default false,
  consent_at timestamptz,
  ip_hash text check (ip_hash is null or ip_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'active' check (status in ('active', 'removed')),
  created_at timestamptz not null default now(),
  created_by uuid references public.ldo_app_users (id),
  removed_at timestamptz,
  removed_by uuid references public.ldo_app_users (id),
  email_due_at timestamptz,
  email_sent_at timestamptz,
  email_attempts integer not null default 0,
  email_lease_until timestamptz,
  email_detail text check (email_detail is null or length(email_detail) <= 500),
  klaviyo_action text check (klaviyo_action in ('upsert', 'remove')),
  klaviyo_due_at timestamptz,
  klaviyo_synced_at timestamptz,
  klaviyo_subscribed_at timestamptz,
  klaviyo_attempts integer not null default 0,
  klaviyo_lease_until timestamptz,
  klaviyo_detail text check (klaviyo_detail is null or length(klaviyo_detail) <= 500),
  last_login_at timestamptz,
  check ((status = 'removed') = (removed_at is not null))
);
create index ldo_ps_members_created_idx on public.ldo_ps_members (created_at desc);
create index ldo_ps_members_email_due_idx on public.ldo_ps_members (email_due_at) where email_sent_at is null and status = 'active';
create index ldo_ps_members_klaviyo_due_idx on public.ldo_ps_members (klaviyo_due_at) where klaviyo_action is not null;

-- Sessões da página reservada. Só o hash (sha256) do token fica guardado.
create table public.ldo_ps_sessions (
  id uuid primary key default gen_random_uuid(),
  token_hash bytea not null unique,
  member_id uuid not null references public.ldo_ps_members (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_seen_at timestamptz
);
create index ldo_ps_sessions_member_idx on public.ldo_ps_sessions (member_id);

-- Pedidos e falhas de entrada das rotas públicas, só para os limites contra abuso (também os bloqueios da entrada,
-- iguais para membros e para emails que não o são). client_key: o mesmo pedido repetido pelo browser não conta
-- duas vezes.
create table public.ldo_ps_events (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('request', 'login_fail')),
  ip_hash text check (ip_hash is null or ip_hash ~ '^[0-9a-f]{64}$'),
  ip_prefix_hash text check (ip_prefix_hash is null or ip_prefix_hash ~ '^[0-9a-f]{64}$'),
  email_hash text check (email_hash is null or email_hash ~ '^[0-9a-f]{64}$'),
  client_key text check (client_key is null or length(client_key) <= 64),
  created_at timestamptz not null default now()
);
create index ldo_ps_events_created_idx on public.ldo_ps_events (created_at);
create index ldo_ps_events_ip_idx on public.ldo_ps_events (ip_hash, created_at) where ip_hash is not null;
create index ldo_ps_events_prefix_idx on public.ldo_ps_events (ip_prefix_hash, created_at) where ip_prefix_hash is not null;
create index ldo_ps_events_email_idx on public.ldo_ps_events (email_hash, created_at) where email_hash is not null;

alter table public.ldo_ps_settings enable row level security;
alter table public.ldo_ps_members enable row level security;
alter table public.ldo_ps_sessions enable row level security;
alter table public.ldo_ps_events enable row level security;
revoke all on public.ldo_ps_settings, public.ldo_ps_members, public.ldo_ps_sessions, public.ldo_ps_events from anon, authenticated;

-- ---------------------------------------------------------------- permissões

-- Quem gere a Private Selection: Super Admin ou acesso Loja Online (canManagePrivateSelection no dashboard).
create function ldo_private.ps_admin(p_session text) returns uuid
language sql stable security definer set search_path = '' as $$
  select u.id from public.ldo_app_users u
  where u.id = ldo_private.session_user_id(p_session) and u.active and (u.is_super_admin or u.online_access);
$$;

-- Caixa de correio de um email, para reconhecer um membro removido que peça com outra forma do mesmo endereço: sem a
-- etiqueta "+…" e, no Gmail, sem pontos.
create function ldo_private.ps_mailbox(p_email text) returns text
language sql immutable set search_path = '' as $$
  select case when split_part(p_email, '@', 2) in ('gmail.com', 'googlemail.com')
    then replace(split_part(split_part(p_email, '@', 1), '+', 1), '.', '') || '@gmail.com'
    else split_part(split_part(p_email, '@', 1), '+', 1) || '@' || split_part(p_email, '@', 2) end;
$$;

revoke all on function ldo_private.ps_admin(text) from public, anon, authenticated;
revoke all on function ldo_private.ps_mailbox(text) from public, anon, authenticated;

-- ---------------------------------------------------------------- equipa (sessão)

-- Membros (mais recentes primeiro) e o estado da senha. Nunca devolve a senha, o hash nem a cifra.
create function public.ldo_ps_list(p_session text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_me uuid := ldo_private.ps_admin(p_session);
begin
  if v_me is null then
    raise exception 'Sem acesso à Private Selection.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id, 'name', m.name, 'email', m.email, 'phone', m.phone, 'locale', m.locale, 'brand', m.brand,
        'source', m.source, 'status', m.status, 'consent_marketing', m.consent_marketing, 'created_at', m.created_at,
        'created_by_name', coalesce(c.full_name, c.username), 'removed_at', m.removed_at,
        'removed_by_name', coalesce(r.full_name, r.username),
        'email_due_at', m.email_due_at, 'email_sent_at', m.email_sent_at, 'email_attempts', m.email_attempts,
        'email_detail', m.email_detail, 'klaviyo_action', m.klaviyo_action, 'klaviyo_synced_at', m.klaviyo_synced_at,
        'klaviyo_subscribed_at', m.klaviyo_subscribed_at, 'klaviyo_attempts', m.klaviyo_attempts,
        'klaviyo_detail', m.klaviyo_detail, 'last_login_at', m.last_login_at
      ) order by m.created_at desc)
      from public.ldo_ps_members m
      left join public.ldo_app_users c on c.id = m.created_by
      left join public.ldo_app_users r on r.id = m.removed_by
    ), '[]'::jsonb),
    'settings', (
      select jsonb_build_object('has_password', s.password_hash is not null, 'password_changed_at', s.password_changed_at,
        'password_changed_by_name', coalesce(u.full_name, u.username), 'delay_minutes', s.delay_minutes,
        'session_days', s.session_days, 'entry_path', s.entry_path)
      from public.ldo_ps_settings s
      left join public.ldo_app_users u on u.id = s.password_changed_by
      where s.id = 1)
  );
end;
$$;

-- Adicionar uma pessoa: cria o membro ou volta a ativar um removido (reactivated). Se já for membro ativo, os dados
-- passam a ser os indicados. Em todos os casos o email com a senha sai já e o Klaviyo fica na fila (sem nova
-- inscrição no marketing: o consentimento só vem do formulário e segue uma vez).
create function public.ldo_ps_add(p_session text, p_name text, p_email text, p_phone text, p_locale text, p_brand text)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me uuid := ldo_private.ps_admin(p_session);
  v_name text := left(btrim(regexp_replace(coalesce(p_name, ''), '[[:space:][:cntrl:]]+', ' ', 'g')), 120);
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_phone text := btrim(coalesce(p_phone, ''));
  v_m public.ldo_ps_members;
  v_existing boolean;
  v_reactivated boolean := false;
begin
  if v_me is null then
    raise exception 'Sem acesso à Private Selection.' using errcode = '42501';
  end if;
  if v_name = '' then
    raise exception 'Indique o nome.' using errcode = '22023';
  end if;
  if length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]{2,}$' then
    raise exception 'Indique um email válido.' using errcode = '22023';
  end if;
  if v_phone !~ '^\+[1-9][0-9]{6,14}$' then
    raise exception 'Indique o telemóvel com o indicativo do país (ex.: +351 912 345 678).' using errcode = '22023';
  end if;
  if coalesce(p_locale, '') not in ('pt', 'en', 'es', 'fr', 'de', 'it') then
    raise exception 'Língua inválida.' using errcode = '22023';
  end if;
  if coalesce(p_brand, '') not in ('ldo', 'gsp') then
    raise exception 'Marca inválida.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('ldo_ps_email:' || v_email, 0));
  select * into v_m from public.ldo_ps_members where email = v_email for update;
  v_existing := v_m.id is not null;
  if not v_existing then
    insert into public.ldo_ps_members (email, name, phone, locale, brand, source, created_by, email_due_at, klaviyo_action, klaviyo_due_at)
    values (v_email, v_name, v_phone, p_locale, p_brand, 'admin', v_me, now(), 'upsert', now())
    returning * into v_m;
  else
    v_reactivated := v_m.status = 'removed';
    update public.ldo_ps_members set
      name = v_name, phone = v_phone, locale = p_locale, brand = p_brand, status = 'active',
      source = case when v_reactivated then 'admin' else source end,
      created_at = case when v_reactivated then now() else created_at end,
      created_by = case when v_reactivated then v_me else created_by end,
      removed_at = null, removed_by = null,
      email_due_at = now(), email_sent_at = null, email_attempts = 0, email_lease_until = null, email_detail = null,
      klaviyo_action = 'upsert', klaviyo_due_at = now(), klaviyo_attempts = 0, klaviyo_lease_until = null, klaviyo_detail = null
    where id = v_m.id;
  end if;

  insert into public.ldo_app_audit (actor, action, target, details)
  values (v_me, 'private.add', v_m.id, jsonb_build_object('email', v_email, 'reactivated', v_reactivated,
    'already_active', v_existing and not v_reactivated));
  return jsonb_build_object('id', v_m.id, 'reactivated', v_reactivated);
end;
$$;

-- Remover marca o membro como removido: termina as sessões, cancela o email que ainda não saiu e põe a saída da
-- lista do Klaviyo na fila (o perfil no Klaviyo nunca é apagado).
create function public.ldo_ps_remove(p_session text, p_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me uuid := ldo_private.ps_admin(p_session);
  v_m public.ldo_ps_members;
begin
  if v_me is null then
    raise exception 'Sem acesso à Private Selection.' using errcode = '42501';
  end if;
  select * into v_m from public.ldo_ps_members where id = p_id for update;
  if v_m.id is null then
    raise exception 'Membro não encontrado.' using errcode = 'P0002';
  end if;
  if v_m.status = 'removed' then
    return;
  end if;
  update public.ldo_ps_members set status = 'removed', removed_at = now(), removed_by = v_me,
    email_due_at = case when email_sent_at is null then null else email_due_at end, email_lease_until = null,
    klaviyo_action = 'remove', klaviyo_due_at = now(), klaviyo_attempts = 0, klaviyo_lease_until = null, klaviyo_detail = null
  where id = p_id;
  update public.ldo_ps_sessions set revoked_at = now() where member_id = p_id and revoked_at is null;
  insert into public.ldo_app_audit (actor, action, target, details)
  values (v_me, 'private.remove', p_id, jsonb_build_object('email', v_m.email));
end;
$$;

-- Voltar a enviar o email com a senha (só membros ativos): sai já, com as tentativas a zero.
create function public.ldo_ps_resend(p_session text, p_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me uuid := ldo_private.ps_admin(p_session);
  v_m public.ldo_ps_members;
begin
  if v_me is null then
    raise exception 'Sem acesso à Private Selection.' using errcode = '42501';
  end if;
  select * into v_m from public.ldo_ps_members where id = p_id for update;
  if v_m.id is null then
    raise exception 'Membro não encontrado.' using errcode = 'P0002';
  end if;
  if v_m.status <> 'active' then
    raise exception 'Esta pessoa foi removida: adicione-a de novo para lhe enviar a senha.' using errcode = '22023';
  end if;
  update public.ldo_ps_members set email_due_at = now(), email_sent_at = null, email_attempts = 0,
    email_lease_until = null, email_detail = null
  where id = p_id;
  insert into public.ldo_app_audit (actor, action, target, details)
  values (v_me, 'private.resend', p_id, jsonb_build_object('email', v_m.email));
end;
$$;

-- Klaviyo parada depois de 5 falhas (ex.: chave sem acesso às listas): a ação pendente volta à fila já, com as
-- tentativas a zero e sem mexer no estado do membro (serve também para tirar da lista quem foi removido).
create function public.ldo_ps_klaviyo_retry(p_session text, p_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me uuid := ldo_private.ps_admin(p_session);
  v_m public.ldo_ps_members;
begin
  if v_me is null then
    raise exception 'Sem acesso à Private Selection.' using errcode = '42501';
  end if;
  select * into v_m from public.ldo_ps_members where id = p_id for update;
  if v_m.id is null then
    raise exception 'Membro não encontrado.' using errcode = 'P0002';
  end if;
  if v_m.klaviyo_action is null then
    raise exception 'Não há nada por fazer na Klaviyo para esta pessoa.' using errcode = '22023';
  end if;
  update public.ldo_ps_members set klaviyo_due_at = now(), klaviyo_attempts = 0, klaviyo_lease_until = null, klaviyo_detail = null
  where id = p_id;
  insert into public.ldo_app_audit (actor, action, target, details)
  values (v_me, 'private.klaviyo', p_id, jsonb_build_object('email', v_m.email, 'klaviyo_action', v_m.klaviyo_action));
end;
$$;

-- Nova senha para todos. p_password_ct é a mesma senha cifrada no servidor (só serve para os emails).
-- Termina todas as sessões da loja; com p_notify_all, todos os membros ativos voltam a receber o email já.
-- Um email que esteja a sair neste momento leva a senha antiga: perde a reserva e volta a sair com a nova.
create function public.ldo_ps_set_password(p_session text, p_password text, p_password_ct text, p_notify_all boolean)
returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me uuid := ldo_private.ps_admin(p_session);
  v_first boolean;
  v_queued integer := 0;
begin
  if v_me is null then
    raise exception 'Sem acesso à Private Selection.' using errcode = '42501';
  end if;
  if length(coalesce(p_password, '')) < 8 then
    raise exception 'A senha tem de ter pelo menos 8 caracteres.' using errcode = '22023';
  end if;
  if length(p_password) > 100 then
    raise exception 'A senha pode ter no máximo 100 caracteres.' using errcode = '22023';
  end if;
  if coalesce(p_password_ct, '') !~ '^v1\.' then
    raise exception 'Não foi possível cifrar a senha.' using errcode = '22023';
  end if;
  select password_hash is null into v_first from public.ldo_ps_settings where id = 1 for update;
  update public.ldo_ps_settings set
    password_hash = extensions.crypt(p_password, extensions.gen_salt('bf', 10)),
    password_ct = p_password_ct, password_changed_at = now(), password_changed_by = v_me,
    updated_at = now(), updated_by = v_me
  where id = 1;
  -- Membros antes das sessões, pela mesma ordem de ldo_ps_remove (evita bloqueios mútuos se correrem ao mesmo tempo).
  update public.ldo_ps_members set email_lease_until = null where email_sent_at is null and email_lease_until > now();
  if coalesce(p_notify_all, false) then
    update public.ldo_ps_members set email_due_at = now(), email_sent_at = null, email_attempts = 0,
      email_lease_until = null, email_detail = null
    where status = 'active';
    get diagnostics v_queued = row_count;
  end if;
  update public.ldo_ps_sessions set revoked_at = now() where revoked_at is null and expires_at > now();
  insert into public.ldo_app_audit (actor, action, target, details)
  values (v_me, 'private.password', null, jsonb_build_object('first', v_first, 'notify_all', coalesce(p_notify_all, false),
    'queued', v_queued));
end;
$$;

-- Página da loja onde está a Private Selection (o botão do email). Só o caminho: o domínio e a língua vêm da
-- marca e da língua de cada membro.
create function public.ldo_ps_set_settings(p_session text, p_entry_path text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me uuid := ldo_private.ps_admin(p_session);
  v_path text := btrim(coalesce(p_entry_path, ''));
begin
  if v_me is null then
    raise exception 'Sem acesso à Private Selection.' using errcode = '42501';
  end if;
  if v_path !~ '^/' or v_path ~ '^//' or v_path ~ '[[:space:][:cntrl:]]' or length(v_path) > 500 then
    raise exception 'Indique só o caminho da página na loja, a começar por "/" (ex.: /products/nome-da-peca?view=private-selection).'
      using errcode = '22023';
  end if;
  update public.ldo_ps_settings set entry_path = v_path, updated_at = now(), updated_by = v_me
  where id = 1 and entry_path is distinct from v_path;
  if found then
    insert into public.ldo_app_audit (actor, action, target, details)
    values (v_me, 'private.settings', null, jsonb_build_object('entry_path', v_path));
  end if;
end;
$$;

-- ---------------------------------------------------------------- servidor (token): rotas públicas

-- Pedido de acesso pelo formulário da loja. A rota responde sempre "pedido recebido"; o estado é só para o servidor:
--   created  → membro novo, ativo; o email com a senha sai daqui a delay_minutes e o Klaviyo fica na fila.
--   existing → nada a fazer: o email já está na fila ou saiu há menos de 24 h, o mesmo email pediu há menos de
--              10 minutos, ou é o mesmo pedido repetido pelo browser (p_client_key).
--   requeued → membro ativo cujo email saiu há mais de 24 h (ou falhou): volta a sair daqui a delay_minutes.
--   blocked  → membro removido, ou email novo da mesma caixa de correio (ldo_private.ps_mailbox) ou com o telemóvel
--              de um removido: fica como está, sem email.
-- Os dados de um membro que já existe nunca mudam por aqui (o email do formulário não está confirmado), a não ser
-- o consentimento do marketing: um membro ativo que marque agora a caixa passa a tê-lo (nunca é retirado por aqui).
-- Limites: 3 pedidos por IP e 10 por rede por hora, 300 no total por hora (P0429; o limite geral tem mensagem
-- própria, que o servidor regista).
create function public.ldo_ps_request(p_token text, p_name text, p_email text, p_phone text, p_locale text, p_brand text,
  p_origin text, p_consent boolean, p_ip_hash text, p_ip_prefix_hash text, p_client_key text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_name text := left(btrim(regexp_replace(coalesce(p_name, ''), '[[:space:][:cntrl:]]+', ' ', 'g')), 120);
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_phone text := btrim(coalesce(p_phone, ''));
  v_key text := case when p_client_key ~ '^[A-Za-z0-9_-]{8,64}$' then lower(p_client_key) end;
  v_email_hash text;
  v_recent boolean;
  v_delay interval;
  v_m public.ldo_ps_members;
begin
  perform ldo_private.bi_check(p_token);
  if coalesce(p_ip_hash, '') !~ '^[0-9a-f]{64}$' or coalesce(p_ip_prefix_hash, '') !~ '^[0-9a-f]{64}$'
     or coalesce(p_locale, '') not in ('pt', 'en', 'es', 'fr', 'de', 'it') or coalesce(p_brand, '') not in ('ldo', 'gsp') then
    raise exception 'Pedido inválido.' using errcode = '22023';
  end if;
  if v_name = '' then
    raise exception 'Indique o seu nome.' using errcode = '22023';
  end if;
  if length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]{2,}$' then
    raise exception 'Indique um email válido.' using errcode = '22023';
  end if;
  if v_phone !~ '^\+[1-9][0-9]{6,14}$' then
    raise exception 'Indique o telemóvel com o indicativo do país.' using errcode = '22023';
  end if;
  v_email_hash := encode(extensions.digest(v_email, 'sha256'), 'hex');
  -- O mesmo pedido repetido (resposta perdida, duplo clique) não conta para os limites.
  if v_key is not null and exists (select 1 from public.ldo_ps_events where kind = 'request' and client_key = v_key
      and email_hash = v_email_hash and created_at > now() - interval '1 hour') then
    return jsonb_build_object('status', 'existing');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('ldo_ps_ip:' || p_ip_prefix_hash, 0));
  if (select count(*) from public.ldo_ps_events where kind = 'request' and ip_hash = p_ip_hash and created_at > now() - interval '1 hour') >= 3
     or (select count(*) from public.ldo_ps_events where kind = 'request' and ip_prefix_hash = p_ip_prefix_hash
        and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'Demasiados pedidos. Tente novamente mais tarde.' using errcode = 'P0429';
  end if;
  if (select count(*) from public.ldo_ps_events where kind = 'request' and created_at > now() - interval '1 hour') >= 300 then
    raise exception 'Limite geral de pedidos de acesso atingido.' using errcode = 'P0429';
  end if;
  v_recent := exists (select 1 from public.ldo_ps_events where kind = 'request' and email_hash = v_email_hash
    and created_at > now() - interval '10 minutes');
  insert into public.ldo_ps_events (kind, ip_hash, ip_prefix_hash, email_hash, client_key)
  values ('request', p_ip_hash, p_ip_prefix_hash, v_email_hash, v_key);
  delete from public.ldo_ps_events where created_at < now() - interval '30 days';
  if v_recent then
    return jsonb_build_object('status', 'existing');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('ldo_ps_email:' || v_email, 0));
  select * into v_m from public.ldo_ps_members where email = v_email for update;
  select make_interval(mins => delay_minutes) into v_delay from public.ldo_ps_settings where id = 1;
  if v_m.id is null then
    -- Um removido não volta com outra forma do mesmo endereço nem com o mesmo telemóvel. Com outro email e outro
    -- telemóvel não há como o reconhecer.
    if exists (select 1 from public.ldo_ps_members r where r.status = 'removed'
        and (r.phone = v_phone or ldo_private.ps_mailbox(r.email) = ldo_private.ps_mailbox(v_email))) then
      return jsonb_build_object('status', 'blocked');
    end if;
    insert into public.ldo_ps_members (email, name, phone, locale, brand, origin, source, consent_marketing, consent_at, ip_hash,
      email_due_at, klaviyo_action, klaviyo_due_at)
    values (v_email, v_name, v_phone, p_locale, p_brand, left(nullif(btrim(coalesce(p_origin, '')), ''), 200), 'form',
      coalesce(p_consent, false), case when p_consent then now() end, p_ip_hash, now() + v_delay, 'upsert', now());
    return jsonb_build_object('status', 'created');
  end if;
  if v_m.status = 'removed' then
    return jsonb_build_object('status', 'blocked');
  end if;
  -- Caixa do marketing marcada por quem ainda não tinha dado o consentimento (ex.: adicionado pela equipa): a
  -- Klaviyo inscreve-o na próxima passagem. A resposta continua a mesma.
  if coalesce(p_consent, false) and not v_m.consent_marketing then
    update public.ldo_ps_members set consent_marketing = true, consent_at = now(),
      klaviyo_action = 'upsert', klaviyo_due_at = now(), klaviyo_attempts = 0, klaviyo_lease_until = null, klaviyo_detail = null
    where id = v_m.id;
  end if;
  if v_m.email_sent_at > now() - interval '24 hours'
     or (v_m.email_sent_at is null and v_m.email_due_at is not null and v_m.email_attempts < 5) then
    return jsonb_build_object('status', 'existing');
  end if;
  update public.ldo_ps_members set email_due_at = now() + v_delay, email_sent_at = null, email_attempts = 0,
    email_lease_until = null, email_detail = null
  where id = v_m.id;
  return jsonb_build_object('status', 'requeued');
end;
$$;

-- Entrada na página reservada (email + senha partilhada). Devolve o estado em vez de dar erro, para as falhas
-- ficarem gravadas. Nunca diz se o email é membro: email desconhecido, membro removido ou senha ainda por definir
-- fazem o mesmo trabalho (bcrypt) e respondem 'invalid'. Bloqueios (contados em ldo_ps_events, iguais para membros
-- e para emails que não o são):
-- * 5 falhas do mesmo email a partir da mesma rede em 15 minutos bloqueiam esse email nessa rede; quem está noutra
--   rede (o próprio membro, por exemplo) continua a entrar;
-- * com 20 falhas numa hora, a rede só entra com a senha certa de um membro: as outras tentativas respondem
--   'locked' (um email que não é membro sem bcrypt nem registo).
-- A configuração fica bloqueada para leitura (for share): uma senha mudada ao mesmo tempo ou espera por esta entrada
-- e termina a sessão nova, ou fica gravada antes e a entrada já usa a senha nova.
-- Só devolve o primeiro nome (para a saudação da página): a senha é partilhada, por isso entrar só prova que se
-- conhece o email de um membro.
create function public.ldo_ps_login(p_token text, p_email text, p_password text, p_ip_prefix_hash text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_email_hash text := encode(extensions.digest(v_email, 'sha256'), 'hex');
  v_busy boolean;
  v_s public.ldo_ps_settings;
  v_m public.ldo_ps_members;
  v_token text;
  v_expires timestamptz;
begin
  perform ldo_private.bi_check(p_token);
  if coalesce(p_ip_prefix_hash, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'Pedido inválido.' using errcode = '22023';
  end if;
  if (select count(*) from public.ldo_ps_events where kind = 'login_fail' and email_hash = v_email_hash
      and ip_prefix_hash = p_ip_prefix_hash and created_at > now() - interval '15 minutes') >= 5 then
    return jsonb_build_object('ok', false, 'reason', 'locked');
  end if;
  v_busy := (select count(*) from public.ldo_ps_events where kind = 'login_fail' and ip_prefix_hash = p_ip_prefix_hash
    and created_at > now() - interval '1 hour') >= 20;
  select * into v_s from public.ldo_ps_settings where id = 1 for share;
  if v_s.password_hash is not null then
    select * into v_m from public.ldo_ps_members where email = v_email and status = 'active' for update;
  end if;

  if v_m.id is null then
    -- O mesmo bcrypt que um membro faria, também com a rede travada: o tempo da resposta não diz se o email é membro.
    perform extensions.crypt(coalesce(p_password, ''), extensions.gen_salt('bf', 10));
    if v_busy then
      return jsonb_build_object('ok', false, 'reason', 'locked');
    end if;
  elsif extensions.crypt(coalesce(p_password, ''), v_s.password_hash) = v_s.password_hash then
    v_token := encode(extensions.gen_random_bytes(32), 'hex');
    v_expires := now() + make_interval(days => v_s.session_days);
    insert into public.ldo_ps_sessions (token_hash, member_id, expires_at)
    values (extensions.digest(v_token, 'sha256'), v_m.id, v_expires);
    update public.ldo_ps_members set last_login_at = now() where id = v_m.id;
    return jsonb_build_object('ok', true, 'token', v_token, 'expires_at', v_expires, 'name', split_part(v_m.name, ' ', 1));
  end if;

  insert into public.ldo_ps_events (kind, ip_prefix_hash, email_hash) values ('login_fail', p_ip_prefix_hash, v_email_hash);
  return jsonb_build_object('ok', false, 'reason', case when v_busy
    or (select count(*) from public.ldo_ps_events where kind = 'login_fail' and email_hash = v_email_hash
      and ip_prefix_hash = p_ip_prefix_hash and created_at > now() - interval '15 minutes') >= 5 then 'locked' else 'invalid' end);
end;
$$;

-- Confirma a sessão em cada visita da página reservada. Só vale se não foi terminada nem expirou, se o membro
-- continua ativo e se a senha não mudou depois da entrada. Como na entrada, só o primeiro nome.
create function public.ldo_ps_session(p_token text, p_session text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_id uuid;
  v_name text;
  v_expires timestamptz;
  v_seen timestamptz;
begin
  perform ldo_private.bi_check(p_token);
  select s.id, split_part(m.name, ' ', 1), s.expires_at, s.last_seen_at into v_id, v_name, v_expires, v_seen
  from public.ldo_ps_sessions s
  join public.ldo_ps_members m on m.id = s.member_id
  join public.ldo_ps_settings c on c.id = 1
  where s.token_hash = extensions.digest(coalesce(p_session, ''), 'sha256')
    and s.revoked_at is null and s.expires_at > now() and m.status = 'active'
    and s.created_at >= coalesce(c.password_changed_at, '-infinity'::timestamptz);
  if v_id is null then
    return jsonb_build_object('ok', false);
  end if;
  if v_seen is null or v_seen < now() - interval '1 minute' then
    update public.ldo_ps_sessions set last_seen_at = now() where id = v_id;
  end if;
  return jsonb_build_object('ok', true, 'name', v_name, 'expires_at', v_expires);
end;
$$;

create function public.ldo_ps_logout(p_token text, p_session text) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform ldo_private.bi_check(p_token);
  update public.ldo_ps_sessions set revoked_at = now()
  where token_hash = extensions.digest(coalesce(p_session, ''), 'sha256') and revoked_at is null;
end;
$$;

-- ---------------------------------------------------------------- servidor (token): filas

-- Email com a senha: reserva (2 minutos) os membros ativos cujo email está na hora, até 5 tentativas. Sem senha
-- definida não sai nada (os pedidos ficam à espera). Leva a senha cifrada, o caminho da página e a reserva (lease),
-- que o ldo_ps_email_done tem de devolver.
-- Um envio de cada vez: o Resend aceita poucos pedidos por segundo e várias passagens correm ao mesmo tempo
-- (verificação de 5 em 5 minutos, página da equipa, formulário). Enquanto outra passagem tem emails reservados,
-- esta não reserva nenhum.
-- A configuração fica bloqueada para leitura até ao fim: uma senha nova gravada ao mesmo tempo espera e depois
-- anula estas reservas (o email volta a sair com a senha nova).
create function public.ldo_ps_email_claim(p_token text, p_limit integer) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_s public.ldo_ps_settings;
  v_out jsonb;
begin
  perform ldo_private.bi_check(p_token);
  perform pg_advisory_xact_lock(hashtext('ldo_ps_email_claim'));
  if exists (select 1 from public.ldo_ps_members where email_lease_until > now()) then
    return '[]'::jsonb;
  end if;
  select * into v_s from public.ldo_ps_settings where id = 1 for share;
  if v_s.password_hash is null or v_s.password_ct is null then
    return '[]'::jsonb;
  end if;
  with due as (
    select m.id from public.ldo_ps_members m
    where m.status = 'active' and m.email_sent_at is null and m.email_due_at <= now() and m.email_attempts < 5
      and (m.email_lease_until is null or m.email_lease_until < now())
    order by m.email_due_at
    limit least(greatest(coalesce(p_limit, 10), 1), 50)
    for update skip locked
  ), claimed as (
    update public.ldo_ps_members m set email_lease_until = now() + interval '2 minutes'
    from due where m.id = due.id
    returning m.id, m.name, m.email, m.locale, m.brand, m.email_due_at, m.email_lease_until
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'lease', c.email_lease_until, 'name', c.name, 'email', c.email,
      'locale', c.locale, 'brand', c.brand, 'password_ct', v_s.password_ct, 'entry_path', v_s.entry_path) order by c.email_due_at), '[]'::jsonb)
  into v_out
  from claimed c;
  return v_out;
end;
$$;

-- Resultado do envio (p_detail: id do Resend ou o erro). Com falha volta a tentar daqui a 30 minutos. Só conta se
-- a reserva ainda for a deste envio (p_lease, devolvida pelo ldo_ps_email_claim): reenviar, remover ou mudar a
-- senha anulam-na, e outra passagem que entretanto reserve o mesmo membro tem uma reserva diferente.
create function public.ldo_ps_email_done(p_token text, p_id uuid, p_lease timestamptz, p_ok boolean, p_detail text) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform ldo_private.bi_check(p_token);
  if p_ok then
    update public.ldo_ps_members set email_sent_at = now(), email_lease_until = null, email_detail = left(p_detail, 500)
    where id = p_id and email_sent_at is null and email_lease_until = p_lease;
  else
    update public.ldo_ps_members set email_attempts = email_attempts + 1, email_due_at = now() + interval '30 minutes',
      email_lease_until = null, email_detail = left(p_detail, 500)
    where id = p_id and email_sent_at is null and email_lease_until = p_lease;
  end if;
end;
$$;

-- Klaviyo: reserva (2 minutos) os membros com uma ação pendente (upsert ou remove), até 5 tentativas. lease é a
-- reserva, que o ldo_ps_klaviyo_done tem de devolver; subscribe diz se este upsert também inscreve no marketing
-- (com consentimento e ainda sem inscrição enviada).
create function public.ldo_ps_klaviyo_claim(p_token text, p_limit integer) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_out jsonb;
begin
  perform ldo_private.bi_check(p_token);
  with due as (
    select m.id from public.ldo_ps_members m
    where m.klaviyo_action is not null and m.klaviyo_due_at <= now() and m.klaviyo_attempts < 5
      and (m.klaviyo_lease_until is null or m.klaviyo_lease_until < now())
    order by m.klaviyo_due_at
    limit least(greatest(coalesce(p_limit, 10), 1), 50)
    for update skip locked
  ), claimed as (
    update public.ldo_ps_members m set klaviyo_lease_until = now() + interval '2 minutes'
    from due where m.id = due.id
    returning m.*
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'lease', c.klaviyo_lease_until, 'action', c.klaviyo_action,
      'name', c.name, 'email', c.email, 'phone', c.phone, 'locale', c.locale, 'brand', c.brand, 'source', c.source,
      'consent_marketing', c.consent_marketing, 'consent_at', c.consent_at, 'created_at', c.created_at,
      'subscribe', c.klaviyo_action = 'upsert' and c.consent_marketing and c.klaviyo_subscribed_at is null) order by c.klaviyo_due_at), '[]'::jsonb)
  into v_out
  from claimed c;
  return v_out;
end;
$$;

-- Resultado da sincronização. Com falha volta a tentar daqui a 30 minutos. Só conta se a reserva (p_lease) e a ação
-- (p_action) ainda forem as desta sincronização: uma ação nova entretanto (ex.: remover durante o upsert) anula a
-- reserva e é feita a seguir. Um upsert com consentimento que correu bem marca a inscrição como enviada.
create function public.ldo_ps_klaviyo_done(p_token text, p_id uuid, p_lease timestamptz, p_action text, p_ok boolean, p_detail text)
returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform ldo_private.bi_check(p_token);
  if p_ok then
    update public.ldo_ps_members set klaviyo_action = null, klaviyo_due_at = null, klaviyo_synced_at = now(),
      klaviyo_subscribed_at = case when p_action = 'upsert' and consent_marketing then coalesce(klaviyo_subscribed_at, now())
        else klaviyo_subscribed_at end,
      klaviyo_attempts = 0, klaviyo_lease_until = null, klaviyo_detail = left(p_detail, 500)
    where id = p_id and klaviyo_lease_until = p_lease and klaviyo_action = p_action;
  else
    update public.ldo_ps_members set klaviyo_attempts = klaviyo_attempts + 1, klaviyo_due_at = now() + interval '30 minutes',
      klaviyo_lease_until = null, klaviyo_detail = left(p_detail, 500)
    where id = p_id and klaviyo_lease_until = p_lease and klaviyo_action = p_action;
  end if;
end;
$$;

-- ---------------------------------------------------------------- acessos

-- Só a chave pública (anon): a equipa entra com p_session e o servidor com o token; nada é acessível sem eles.
revoke all on function
  public.ldo_ps_list(text),
  public.ldo_ps_add(text, text, text, text, text, text),
  public.ldo_ps_remove(text, uuid),
  public.ldo_ps_resend(text, uuid),
  public.ldo_ps_klaviyo_retry(text, uuid),
  public.ldo_ps_set_password(text, text, text, boolean),
  public.ldo_ps_set_settings(text, text),
  public.ldo_ps_request(text, text, text, text, text, text, text, boolean, text, text, text),
  public.ldo_ps_login(text, text, text, text),
  public.ldo_ps_session(text, text),
  public.ldo_ps_logout(text, text),
  public.ldo_ps_email_claim(text, integer),
  public.ldo_ps_email_done(text, uuid, timestamptz, boolean, text),
  public.ldo_ps_klaviyo_claim(text, integer),
  public.ldo_ps_klaviyo_done(text, uuid, timestamptz, text, boolean, text)
from public, authenticated;
grant execute on function
  public.ldo_ps_list(text),
  public.ldo_ps_add(text, text, text, text, text, text),
  public.ldo_ps_remove(text, uuid),
  public.ldo_ps_resend(text, uuid),
  public.ldo_ps_klaviyo_retry(text, uuid),
  public.ldo_ps_set_password(text, text, text, boolean),
  public.ldo_ps_set_settings(text, text),
  public.ldo_ps_request(text, text, text, text, text, text, text, boolean, text, text, text),
  public.ldo_ps_login(text, text, text, text),
  public.ldo_ps_session(text, text),
  public.ldo_ps_logout(text, text),
  public.ldo_ps_email_claim(text, integer),
  public.ldo_ps_email_done(text, uuid, timestamptz, boolean, text),
  public.ldo_ps_klaviyo_claim(text, integer),
  public.ldo_ps_klaviyo_done(text, uuid, timestamptz, text, boolean, text)
to anon;
