-- Leilão online da Loja do Ouro (leilao.lojadoouro.pt): bens próprios, leilões por tempo, licitação automática
-- (máximo secreto), antisniping, caução em lotes altos e fila de emails. Gerido no dashboard (Super Admin e Loja
-- Online); o site público chega com p_token (servidor) e a sessão do cliente.
--
-- Fase 1: dados, motor de licitação e fecho dos lotes. Contas de clientes, pagamentos (easypay) e emails ligam-se
-- nas fases seguintes, sobre estas tabelas.
--
-- Regras legais parametrizáveis em ldo_auc_settings (a validar com o advogado): garantia dos usados, aviso às
-- autoridades (ASAE/INCM), limiares de verificação de identidade. Funcionários e familiares não licitam (is_staff).

-- ---------------------------------------------------------------- definições

create table public.ldo_auc_settings (
  id integer primary key check (id = 1),
  -- Antisniping: uma licitação nos últimos extend_window_seconds põe o fecho a extend_minutes do momento da licitação.
  extend_window_seconds integer not null default 120 check (extend_window_seconds between 0 and 3600),
  extend_minutes integer not null default 10 check (extend_minutes between 1 and 60),
  -- Incrementos: [[a partir de, incremento], ...] por ordem crescente; o primeiro começa em 0.
  increments jsonb not null default '[[0,5],[100,10],[500,25],[1000,50],[2500,100],[5000,250],[10000,500]]'::jsonb
    check (jsonb_typeof(increments) = 'array' and jsonb_array_length(increments) between 1 and 30),
  -- Caução: em lotes cuja base (ou licitação mínima) atinja deposit_threshold, cativa-se deposit_percent (mínimo deposit_min).
  deposit_threshold numeric(12,2) not null default 2500 check (deposit_threshold >= 0),
  deposit_percent numeric(5,2) not null default 10 check (deposit_percent between 0 and 100),
  deposit_min numeric(12,2) not null default 100 check (deposit_min >= 0),
  -- Licitar a partir deste valor exige conta verificada (identidade confirmada pela equipa).
  verified_threshold numeric(12,2) not null default 3000 check (verified_threshold >= 0),
  payment_hours integer not null default 48 check (payment_hours between 1 and 336),
  default_stagger_seconds integer not null default 60 check (default_stagger_seconds between 0 and 3600),
  ending_soon_minutes integer not null default 60 check (ending_soon_minutes between 5 and 1440),
  new_warranty_months integer not null default 36 check (new_warranty_months between 0 and 120),
  used_warranty_months integer not null default 18 check (used_warranty_months between 0 and 120),
  authority_notice_days integer not null default 20 check (authority_notice_days between 0 and 90),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.ldo_app_users (id) on delete set null
);
insert into public.ldo_auc_settings (id) values (1);

-- ---------------------------------------------------------------- leilões (eventos) e lotes

create table public.ldo_auc_events (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(btrim(title)) between 1 and 160),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 80),
  intro text not null default '' check (length(intro) <= 4000),
  status text not null default 'draft' check (status in ('draft', 'published', 'cancelled')),
  opens_at timestamptz not null,
  first_close_at timestamptz not null,
  stagger_seconds integer not null default 60 check (stagger_seconds between 0 and 3600),
  -- Comunicação às autoridades (RJOC art. 65.º, se aplicável): data em que foi feita.
  authority_notice_at date,
  published_at timestamptz,
  created_by uuid references public.ldo_app_users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid references public.ldo_app_users (id) on delete set null,
  updated_at timestamptz not null default now(),
  check (first_close_at > opens_at)
);

create table public.ldo_auc_lots (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.ldo_auc_events (id) on delete restrict,
  position integer not null check (position between 1 and 9999),
  -- Produto da loja de onde veio (fotografias do CDN do Shopify).
  shopify_handle text check (shopify_handle is null or shopify_handle ~ '^[a-z0-9][a-z0-9-]{0,254}$'),
  shopify_product_id text check (shopify_product_id is null or shopify_product_id ~ '^[0-9]{1,20}$'),
  sku text check (sku is null or length(sku) <= 80),
  title text not null check (length(btrim(title)) between 1 and 200),
  description text not null default '' check (length(description) <= 20000),
  images jsonb not null default '[]'::jsonb check (jsonb_typeof(images) = 'array' and jsonb_array_length(images) <= 30),
  -- Informação obrigatória na venda de artigos com metal precioso (RJOC art. 64.º e 65.º).
  metal text check (metal is null or length(metal) <= 80),
  fineness text check (fineness is null or length(fineness) <= 40),
  weight_g numeric(10,3) check (weight_g is null or weight_g > 0),
  gems text check (gems is null or length(gems) <= 500),
  hallmarked boolean not null default true,
  condition text not null default 'used' check (condition in ('new', 'used')),
  condition_report text not null default '' check (length(condition_report) <= 4000),
  warranty_months integer not null check (warranty_months between 0 and 120),
  start_price numeric(12,2) not null check (start_price > 0),
  reserve_price numeric(12,2) check (reserve_price is null or reserve_price >= start_price),
  buy_now_price numeric(12,2) check (buy_now_price is null or buy_now_price > start_price),
  -- Caução: auto (pelo limiar das definições), required (sempre) ou none (nunca).
  deposit_mode text not null default 'auto' check (deposit_mode in ('auto', 'required', 'none')),
  status text not null default 'draft' check (status in ('draft', 'ready', 'withdrawn', 'closed')),
  scheduled_close_at timestamptz,
  close_at timestamptz,
  extensions integer not null default 0,
  current_price numeric(12,2),
  leader_id uuid,
  leader_max numeric(12,2),
  bid_count integer not null default 0,
  bidder_count integer not null default 0,
  ending_notified_at timestamptz,
  result text check (result is null or result in ('sold', 'unsold')),
  closed_at timestamptz,
  payment_due_at timestamptz,
  created_by uuid references public.ldo_app_users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid references public.ldo_app_users (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (event_id, position)
);
create index ldo_auc_lots_open_idx on public.ldo_auc_lots (close_at) where status = 'ready';

-- ---------------------------------------------------------------- clientes

create table public.ldo_auc_customers (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (length(email) <= 254 and email = lower(email)),
  email_verified_at timestamptz,
  password_hash text,
  name text not null check (length(btrim(name)) between 1 and 120),
  -- Nome público: nunca o nome verdadeiro (RGPD, minimização).
  alias text not null unique check (length(alias) <= 40),
  nif text check (nif is null or nif ~ '^[0-9]{9}$'),
  phone text check (phone is null or phone ~ '^\+[1-9][0-9]{6,14}$'),
  birth_date date,
  address jsonb not null default '{}'::jsonb check (jsonb_typeof(address) = 'object'),
  country text not null default 'PT' check (country ~ '^[A-Z]{2}$'),
  -- registered: licita até verified_threshold; verified: identidade confirmada; vip; blocked.
  level text not null default 'registered' check (level in ('registered', 'verified', 'vip', 'blocked')),
  verified_at timestamptz,
  verified_by uuid references public.ldo_app_users (id) on delete set null,
  is_staff boolean not null default false,
  notes text not null default '' check (length(notes) <= 2000),
  marketing_consent boolean not null default false,
  marketing_consent_at timestamptz,
  terms_version text,
  terms_accepted_at timestamptz,
  created_at timestamptz not null default now(),
  last_login_at timestamptz,
  -- RGPD: conta apagada a pedido; os dados pessoais são retirados e as licitações ficam com o pseudónimo.
  deleted_at timestamptz
);

alter table public.ldo_auc_lots add constraint ldo_auc_lots_leader_fk
  foreign key (leader_id) references public.ldo_auc_customers (id) on delete restrict;

-- Sessões do site do leilão (só o hash do token).
create table public.ldo_auc_logins (
  id uuid primary key default gen_random_uuid(),
  token_hash bytea not null unique,
  customer_id uuid not null references public.ldo_auc_customers (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_seen_at timestamptz
);

-- ---------------------------------------------------------------- licitações, favoritos, cauções, emails

-- Histórico imutável: bid = licitação do cliente; auto = licitação automática pelo máximo dele; max_raise = o líder
-- subiu o seu máximo (não é pública).
create table public.ldo_auc_bids (
  id bigint generated always as identity primary key,
  lot_id uuid not null references public.ldo_auc_lots (id) on delete restrict,
  customer_id uuid not null references public.ldo_auc_customers (id) on delete restrict,
  amount numeric(12,2) not null check (amount > 0),
  max_amount numeric(12,2) check (max_amount is null or max_amount >= amount),
  kind text not null check (kind in ('bid', 'auto', 'max_raise')),
  ip_hash text check (ip_hash is null or ip_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default clock_timestamp()
);
create index ldo_auc_bids_lot_idx on public.ldo_auc_bids (lot_id, id);
create index ldo_auc_bids_customer_idx on public.ldo_auc_bids (customer_id, created_at);

create table public.ldo_auc_watch (
  customer_id uuid not null references public.ldo_auc_customers (id) on delete cascade,
  lot_id uuid not null references public.ldo_auc_lots (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (customer_id, lot_id)
);

-- Caução cativa (easypay, fase 3) ou registada pela equipa (manual). held conta para poder licitar.
create table public.ldo_auc_deposits (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.ldo_auc_customers (id) on delete restrict,
  lot_id uuid not null references public.ldo_auc_lots (id) on delete restrict,
  amount numeric(12,2) not null check (amount > 0),
  status text not null default 'pending' check (status in ('pending', 'held', 'captured', 'released', 'failed')),
  provider text not null default 'easypay' check (provider in ('easypay', 'manual')),
  provider_ref text,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index ldo_auc_deposits_active_idx on public.ldo_auc_deposits (customer_id, lot_id)
  where status in ('pending', 'held');

-- Fila de emails (outbid, extended, ending_soon, won, lost, reserve_not_met): enviada pelo servidor com o Resend.
create table public.ldo_auc_outbox (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('outbid', 'extended', 'ending_soon', 'won', 'lost', 'reserve_not_met', 'withdrawn')),
  customer_id uuid not null references public.ldo_auc_customers (id) on delete cascade,
  lot_id uuid references public.ldo_auc_lots (id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  due_at timestamptz not null default now(),
  sent_at timestamptz,
  attempts integer not null default 0,
  lease_until timestamptz,
  detail text,
  created_at timestamptz not null default now()
);
create index ldo_auc_outbox_due_idx on public.ldo_auc_outbox (due_at) where sent_at is null;

alter table public.ldo_auc_settings enable row level security;
alter table public.ldo_auc_events enable row level security;
alter table public.ldo_auc_lots enable row level security;
alter table public.ldo_auc_customers enable row level security;
alter table public.ldo_auc_logins enable row level security;
alter table public.ldo_auc_bids enable row level security;
alter table public.ldo_auc_watch enable row level security;
alter table public.ldo_auc_deposits enable row level security;
alter table public.ldo_auc_outbox enable row level security;
revoke all on public.ldo_auc_settings, public.ldo_auc_events, public.ldo_auc_lots, public.ldo_auc_customers,
  public.ldo_auc_logins, public.ldo_auc_bids, public.ldo_auc_watch, public.ldo_auc_deposits, public.ldo_auc_outbox
  from anon, authenticated;

-- ---------------------------------------------------------------- regras

-- Quem gere o leilão: Super Admin ou Loja Online.
create function ldo_private.auc_admin(p_session text) returns uuid
language sql stable security definer set search_path = '' as $$
  select u.id from public.ldo_app_users u
  where u.id = ldo_private.session_user_id(p_session) and u.active and (u.is_super_admin or u.online_access);
$$;

-- Valor em euros à portuguesa, para as mensagens: 1 234,50 €.
create function ldo_private.auc_eur(p numeric) returns text
language sql immutable set search_path = '' as $$
  select replace(replace(to_char(p, 'FM999,999,999,990.00'), ',', chr(160)), '.', ',') || chr(160) || '€';
$$;

-- Incremento para um preço: o do último degrau cujo início é <= preço.
create function ldo_private.auc_increment(p_price numeric, p_steps jsonb) returns numeric
language sql immutable set search_path = '' as $$
  select coalesce((
    select (s ->> 1)::numeric from jsonb_array_elements(p_steps) s
    where (s ->> 0)::numeric <= p_price order by (s ->> 0)::numeric desc limit 1), 1);
$$;

-- Licitação mínima aceite agora.
create function ldo_private.auc_min_bid(p_l public.ldo_auc_lots, p_steps jsonb) returns numeric
language sql immutable set search_path = '' as $$
  select case when p_l.leader_id is null then p_l.start_price
    else p_l.current_price + ldo_private.auc_increment(p_l.current_price, p_steps) end;
$$;

-- Caução necessária neste lote (0 = sem caução).
create function ldo_private.auc_deposit_amount(p_l public.ldo_auc_lots, p_s public.ldo_auc_settings) returns numeric
language sql immutable set search_path = '' as $$
  select case
    when p_l.deposit_mode = 'none' then 0
    when p_l.deposit_mode = 'required' or p_l.start_price >= p_s.deposit_threshold
      or coalesce(p_l.current_price, 0) >= p_s.deposit_threshold
      then greatest(p_s.deposit_min, round(p_l.start_price * p_s.deposit_percent / 100, 2))
    else 0 end;
$$;

-- Fecho previsto de um lote: primeiro fecho do leilão + (posição - 1) × intervalo.
create function ldo_private.auc_scheduled_close(p_e public.ldo_auc_events, p_position integer) returns timestamptz
language sql immutable set search_path = '' as $$
  select p_e.first_close_at + make_interval(secs => (p_position - 1) * p_e.stagger_seconds);
$$;

-- Pseudónimo público único: "Licitante 7K2F9".
create function ldo_private.auc_new_alias() returns text
language plpgsql volatile set search_path = '' as $$
declare v text;
begin
  loop
    v := 'Licitante ' || upper(substr(translate(encode(extensions.gen_random_bytes(6), 'base64'), '+/=0O1Il', ''), 1, 5));
    exit when length(v) = 15 and not exists (select 1 from public.ldo_auc_customers where alias = v);
  end loop;
  return v;
end;
$$;

-- ---------------------------------------------------------------- motor de licitação

-- Licitação de p_customer com o máximo p_max (licitação automática): o lote fica trancado durante a operação, a hora
-- é a do servidor. Devolve o estado para o cliente: leading/outbid, preço atual, próxima licitação mínima e fecho.
create function ldo_private.auc_place_bid(p_lot uuid, p_customer uuid, p_max numeric, p_ip_hash text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_s public.ldo_auc_settings;
  v_l public.ldo_auc_lots;
  v_e public.ldo_auc_events;
  v_c public.ldo_auc_customers;
  v_now timestamptz := clock_timestamp();
  v_max numeric := round(p_max, 2);
  v_min numeric;
  v_price numeric;
  v_leader uuid;
  v_leader_max numeric;
  v_outbid uuid;
  v_close timestamptz;
  v_extended boolean := false;
  v_deposit numeric;
begin
  select * into v_s from public.ldo_auc_settings where id = 1;
  select * into v_l from public.ldo_auc_lots where id = p_lot for update;
  if v_l.id is null then
    raise exception 'Lote não encontrado.' using errcode = 'P0002';
  end if;
  select * into v_e from public.ldo_auc_events where id = v_l.event_id;
  if v_l.status <> 'ready' or v_e.status <> 'published' or v_now < v_e.opens_at or v_l.close_at is null or v_now >= v_l.close_at then
    raise exception 'Este lote não está aberto a licitações.' using errcode = '22023';
  end if;
  select * into v_c from public.ldo_auc_customers where id = p_customer;
  if v_c.id is null or v_c.deleted_at is not null or v_c.level = 'blocked' then
    raise exception 'Esta conta não pode licitar.' using errcode = '42501';
  end if;
  if v_c.is_staff then
    raise exception 'Funcionários e familiares não podem licitar.' using errcode = '42501';
  end if;
  if v_c.email_verified_at is null then
    raise exception 'Confirme o seu email antes de licitar.' using errcode = '42501';
  end if;
  if v_max is null or v_max <= 0 or v_max > 9999999999 then
    raise exception 'Indique um valor válido.' using errcode = '22023';
  end if;

  -- O líder sobe o seu máximo: não é uma licitação pública e não prolonga o lote.
  if v_l.leader_id = p_customer then
    if v_max <= v_l.leader_max then
      raise exception 'O seu máximo atual já é de %.', ldo_private.auc_eur(v_l.leader_max) using errcode = '22023';
    end if;
    if v_max >= v_s.verified_threshold and v_c.level not in ('verified', 'vip') then
      raise exception 'Para licitar a partir de % precisa de conta verificada.', ldo_private.auc_eur(v_s.verified_threshold) using errcode = '42501';
    end if;
    insert into public.ldo_auc_bids (lot_id, customer_id, amount, max_amount, kind, ip_hash)
    values (p_lot, p_customer, v_l.current_price, v_max, 'max_raise', p_ip_hash);
    v_price := v_l.current_price;
    if v_l.reserve_price is not null and v_price < v_l.reserve_price and v_max >= v_l.reserve_price then
      v_price := v_l.reserve_price;
      insert into public.ldo_auc_bids (lot_id, customer_id, amount, kind, ip_hash) values (p_lot, p_customer, v_price, 'auto', p_ip_hash);
    end if;
    update public.ldo_auc_lots set leader_max = v_max, current_price = v_price,
      bid_count = (select count(*) from public.ldo_auc_bids where lot_id = p_lot and kind <> 'max_raise')
    where id = p_lot;
    return jsonb_build_object('status', 'leading', 'price', v_price, 'max', v_max, 'close_at', v_l.close_at, 'extended', false,
      'reserve_met', v_l.reserve_price is null or v_price >= v_l.reserve_price,
      'min_next', v_price + ldo_private.auc_increment(v_price, v_s.increments));
  end if;

  v_min := ldo_private.auc_min_bid(v_l, v_s.increments);
  if v_max < v_min then
    raise exception 'A licitação mínima é %.', ldo_private.auc_eur(v_min) using errcode = '22023';
  end if;
  if v_min >= v_s.verified_threshold and v_c.level not in ('verified', 'vip') then
    raise exception 'Para licitar a partir de % precisa de conta verificada.', ldo_private.auc_eur(v_s.verified_threshold) using errcode = '42501';
  end if;
  v_deposit := ldo_private.auc_deposit_amount(v_l, v_s);
  if v_deposit > 0 and not exists (select 1 from public.ldo_auc_deposits d
      where d.customer_id = p_customer and d.lot_id = p_lot and d.status = 'held') then
    raise exception 'Este lote exige uma caução de % antes de licitar.', ldo_private.auc_eur(v_deposit) using errcode = '42501';
  end if;

  if v_l.leader_id is null then
    -- Primeira licitação: começa na base.
    v_price := v_l.start_price;
    v_leader := p_customer;
    v_leader_max := v_max;
    insert into public.ldo_auc_bids (lot_id, customer_id, amount, max_amount, kind, ip_hash)
    values (p_lot, p_customer, v_price, v_max, 'bid', p_ip_hash);
  elsif v_max > v_l.leader_max then
    -- Novo líder: paga um incremento acima do máximo anterior (ou o seu máximo, se for menos).
    if v_l.leader_max > v_l.current_price then
      insert into public.ldo_auc_bids (lot_id, customer_id, amount, kind) values (p_lot, v_l.leader_id, v_l.leader_max, 'auto');
    end if;
    v_price := least(v_max, v_l.leader_max + ldo_private.auc_increment(v_l.leader_max, v_s.increments));
    v_leader := p_customer;
    v_leader_max := v_max;
    v_outbid := v_l.leader_id;
    insert into public.ldo_auc_bids (lot_id, customer_id, amount, max_amount, kind, ip_hash)
    values (p_lot, p_customer, v_price, v_max, 'bid', p_ip_hash);
  else
    -- O máximo do líder chega: o líder responde automaticamente (empate: ganha quem chegou primeiro).
    insert into public.ldo_auc_bids (lot_id, customer_id, amount, max_amount, kind, ip_hash)
    values (p_lot, p_customer, v_max, v_max, 'bid', p_ip_hash);
    v_price := least(v_l.leader_max, v_max + ldo_private.auc_increment(v_max, v_s.increments));
    v_leader := v_l.leader_id;
    v_leader_max := v_l.leader_max;
    insert into public.ldo_auc_bids (lot_id, customer_id, amount, kind) values (p_lot, v_leader, v_price, 'auto');
  end if;

  -- Reserva: se o máximo do líder a cobre, o preço sobe logo até ela.
  if v_l.reserve_price is not null and v_price < v_l.reserve_price and v_leader_max >= v_l.reserve_price then
    v_price := v_l.reserve_price;
    insert into public.ldo_auc_bids (lot_id, customer_id, amount, kind) values (p_lot, v_leader, v_price, 'auto');
  end if;

  -- Antisniping.
  v_close := v_l.close_at;
  if v_l.close_at - v_now <= make_interval(secs => v_s.extend_window_seconds) then
    v_close := greatest(v_l.close_at, v_now + make_interval(mins => v_s.extend_minutes));
    v_extended := v_close > v_l.close_at;
  end if;

  update public.ldo_auc_lots set
    current_price = v_price, leader_id = v_leader, leader_max = v_leader_max, close_at = v_close,
    extensions = extensions + case when v_extended then 1 else 0 end,
    bid_count = (select count(*) from public.ldo_auc_bids where lot_id = p_lot and kind <> 'max_raise'),
    bidder_count = (select count(distinct customer_id) from public.ldo_auc_bids where lot_id = p_lot)
  where id = p_lot;

  -- Emails: quem perdeu a liderança; e, se prolongou, todos os que licitaram no lote.
  if v_outbid is not null then
    insert into public.ldo_auc_outbox (kind, customer_id, lot_id, payload)
    values ('outbid', v_outbid, p_lot, jsonb_build_object('price', v_price, 'close_at', v_close));
  end if;
  if v_extended then
    insert into public.ldo_auc_outbox (kind, customer_id, lot_id, payload)
    select 'extended', b.customer_id, p_lot, jsonb_build_object('price', v_price, 'close_at', v_close)
    from (select distinct customer_id from public.ldo_auc_bids where lot_id = p_lot) b;
  end if;

  return jsonb_build_object(
    'status', case when v_leader = p_customer then 'leading' else 'outbid' end,
    'price', v_price, 'max', case when v_leader = p_customer then v_leader_max end,
    'close_at', v_close, 'extended', v_extended,
    'reserve_met', v_l.reserve_price is null or v_price >= v_l.reserve_price,
    'min_next', v_price + ldo_private.auc_increment(v_price, v_s.increments));
end;
$$;

-- Fecho dos lotes e aviso "a terminar" (pg_cron, de minuto a minuto). Devolve quantos lotes fechou.
create function ldo_private.auc_close_due() returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_s public.ldo_auc_settings;
  v_l public.ldo_auc_lots;
  v_n integer := 0;
  v_sold boolean;
begin
  select * into v_s from public.ldo_auc_settings where id = 1;

  -- "A terminar": favoritos e licitantes, uma vez por lote.
  for v_l in
    select l.* from public.ldo_auc_lots l join public.ldo_auc_events e on e.id = l.event_id
    where l.status = 'ready' and e.status = 'published' and l.ending_notified_at is null
      and l.close_at > now() and l.close_at - now() <= make_interval(mins => v_s.ending_soon_minutes)
    for update of l skip locked
  loop
    insert into public.ldo_auc_outbox (kind, customer_id, lot_id, payload)
    select 'ending_soon', x.customer_id, v_l.id, jsonb_build_object('close_at', v_l.close_at, 'price', v_l.current_price)
    from (select customer_id from public.ldo_auc_watch where lot_id = v_l.id
          union select customer_id from public.ldo_auc_bids where lot_id = v_l.id) x;
    update public.ldo_auc_lots set ending_notified_at = now() where id = v_l.id;
  end loop;

  for v_l in
    select l.* from public.ldo_auc_lots l join public.ldo_auc_events e on e.id = l.event_id
    where l.status = 'ready' and e.status = 'published' and l.close_at <= now()
    for update of l skip locked
  loop
    v_sold := v_l.leader_id is not null and (v_l.reserve_price is null or v_l.current_price >= v_l.reserve_price);
    update public.ldo_auc_lots set status = 'closed', result = case when v_sold then 'sold' else 'unsold' end,
      closed_at = now(), payment_due_at = case when v_sold then now() + make_interval(hours => v_s.payment_hours) end
    where id = v_l.id;
    if v_l.leader_id is not null then
      insert into public.ldo_auc_outbox (kind, customer_id, lot_id, payload)
      values (case when v_sold then 'won' else 'reserve_not_met' end, v_l.leader_id, v_l.id,
        jsonb_build_object('price', v_l.current_price,
          'payment_due_at', case when v_sold then now() + make_interval(hours => v_s.payment_hours) end));
    end if;
    insert into public.ldo_auc_outbox (kind, customer_id, lot_id, payload)
    select 'lost', b.customer_id, v_l.id, jsonb_build_object('price', v_l.current_price)
    from (select distinct customer_id from public.ldo_auc_bids where lot_id = v_l.id) b
    where b.customer_id is distinct from v_l.leader_id;
    -- Cauções de quem não ganhou deixam de contar (a libertação na easypay é feita pelo servidor, fase 3).
    update public.ldo_auc_deposits set status = 'released', updated_at = now()
    where lot_id = v_l.id and status in ('pending', 'held') and (not v_sold or customer_id <> v_l.leader_id) and provider = 'manual';
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

revoke all on function
  ldo_private.auc_admin(text),
  ldo_private.auc_eur(numeric),
  ldo_private.auc_increment(numeric, jsonb),
  ldo_private.auc_min_bid(public.ldo_auc_lots, jsonb),
  ldo_private.auc_deposit_amount(public.ldo_auc_lots, public.ldo_auc_settings),
  ldo_private.auc_scheduled_close(public.ldo_auc_events, integer),
  ldo_private.auc_new_alias(),
  ldo_private.auc_place_bid(uuid, uuid, numeric, text),
  ldo_private.auc_close_due()
from public, anon, authenticated;

-- ---------------------------------------------------------------- equipa (sessão do dashboard)

create function ldo_private.auc_require(p_session text) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v uuid := ldo_private.auc_admin(p_session);
begin
  if v is null then
    raise exception 'Sem acesso ao leilão.' using errcode = '42501';
  end if;
  return v;
end;
$$;
revoke all on function ldo_private.auc_require(text) from public, anon, authenticated;

-- Vista geral: definições, leilões (com contagens) e número de clientes.
create function public.ldo_auc_overview(p_session text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform ldo_private.auc_require(p_session);
  return jsonb_build_object(
    'settings', (select to_jsonb(s) - 'updated_by' from public.ldo_auc_settings s where id = 1),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id, 'title', e.title, 'slug', e.slug, 'status', e.status, 'opens_at', e.opens_at,
        'first_close_at', e.first_close_at, 'stagger_seconds', e.stagger_seconds, 'authority_notice_at', e.authority_notice_at,
        'lots', (select count(*) from public.ldo_auc_lots l where l.event_id = e.id and l.status <> 'withdrawn'),
        'ready', (select count(*) from public.ldo_auc_lots l where l.event_id = e.id and l.status = 'ready'),
        'bids', (select coalesce(sum(l.bid_count), 0) from public.ldo_auc_lots l where l.event_id = e.id),
        'sold', (select count(*) from public.ldo_auc_lots l where l.event_id = e.id and l.result = 'sold'),
        'sold_value', (select coalesce(sum(l.current_price), 0) from public.ldo_auc_lots l where l.event_id = e.id and l.result = 'sold'),
        'last_close_at', (select max(l.close_at) from public.ldo_auc_lots l where l.event_id = e.id and l.status in ('ready', 'closed'))
      ) order by e.opens_at desc)
      from public.ldo_auc_events e
    ), '[]'::jsonb),
    'customers', (select count(*) from public.ldo_auc_customers where deleted_at is null)
  );
end;
$$;

create function public.ldo_auc_settings_save(p_session text, p_data jsonb) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me uuid := ldo_private.auc_require(p_session);
  v_steps jsonb := p_data -> 'increments';
  v_prev numeric := -1;
  v_step jsonb;
begin
  if jsonb_typeof(v_steps) <> 'array' or jsonb_array_length(v_steps) = 0 then
    raise exception 'Indique os incrementos.' using errcode = '22023';
  end if;
  for v_step in select * from jsonb_array_elements(v_steps) loop
    if jsonb_typeof(v_step) <> 'array' or jsonb_array_length(v_step) <> 2 or (v_step ->> 0)::numeric <= v_prev
       or (v_step ->> 1)::numeric <= 0 then
      raise exception 'Incrementos inválidos: cada linha tem "a partir de" e "incremento", por ordem crescente.' using errcode = '22023';
    end if;
    v_prev := (v_step ->> 0)::numeric;
  end loop;
  if (v_steps -> 0 ->> 0)::numeric <> 0 then
    raise exception 'O primeiro incremento tem de começar em 0 €.' using errcode = '22023';
  end if;
  update public.ldo_auc_settings set
    extend_window_seconds = (p_data ->> 'extend_window_seconds')::integer,
    extend_minutes = (p_data ->> 'extend_minutes')::integer,
    increments = v_steps,
    deposit_threshold = (p_data ->> 'deposit_threshold')::numeric,
    deposit_percent = (p_data ->> 'deposit_percent')::numeric,
    deposit_min = (p_data ->> 'deposit_min')::numeric,
    verified_threshold = (p_data ->> 'verified_threshold')::numeric,
    payment_hours = (p_data ->> 'payment_hours')::integer,
    default_stagger_seconds = (p_data ->> 'default_stagger_seconds')::integer,
    ending_soon_minutes = (p_data ->> 'ending_soon_minutes')::integer,
    new_warranty_months = (p_data ->> 'new_warranty_months')::integer,
    used_warranty_months = (p_data ->> 'used_warranty_months')::integer,
    authority_notice_days = (p_data ->> 'authority_notice_days')::integer,
    updated_at = now(), updated_by = v_me
  where id = 1;
  insert into public.ldo_app_audit (actor, action, details) values (v_me, 'auction.settings', p_data);
exception
  when invalid_text_representation or numeric_value_out_of_range or not_null_violation or check_violation then
    raise exception 'Há um valor inválido nas definições (confirme os limites de cada campo).' using errcode = '22023';
end;
$$;

-- Criar ou alterar um leilão. Os fechos dos lotes sem licitações acompanham as datas.
create function public.ldo_auc_event_save(p_session text, p_id uuid, p_data jsonb) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me uuid := ldo_private.auc_require(p_session);
  v_e public.ldo_auc_events;
  v_title text := btrim(coalesce(p_data ->> 'title', ''));
  v_slug text := lower(btrim(coalesce(p_data ->> 'slug', '')));
  v_status text := coalesce(p_data ->> 'status', 'draft');
begin
  if v_title = '' then
    raise exception 'Indique o título do leilão.' using errcode = '22023';
  end if;
  if v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception 'O endereço só pode ter letras minúsculas, números e hífenes (ex.: joias-de-outono).' using errcode = '22023';
  end if;
  if v_status not in ('draft', 'published', 'cancelled') then
    raise exception 'Estado inválido.' using errcode = '22023';
  end if;
  if p_id is null then
    insert into public.ldo_auc_events (title, slug, intro, status, opens_at, first_close_at, stagger_seconds, authority_notice_at,
      published_at, created_by, updated_by)
    values (v_title, v_slug, coalesce(p_data ->> 'intro', ''), v_status, (p_data ->> 'opens_at')::timestamptz,
      (p_data ->> 'first_close_at')::timestamptz, (p_data ->> 'stagger_seconds')::integer,
      nullif(p_data ->> 'authority_notice_at', '')::date, case when v_status = 'published' then now() end, v_me, v_me)
    returning * into v_e;
  else
    update public.ldo_auc_events set title = v_title, slug = v_slug, intro = coalesce(p_data ->> 'intro', ''), status = v_status,
      opens_at = (p_data ->> 'opens_at')::timestamptz, first_close_at = (p_data ->> 'first_close_at')::timestamptz,
      stagger_seconds = (p_data ->> 'stagger_seconds')::integer,
      authority_notice_at = nullif(p_data ->> 'authority_notice_at', '')::date,
      published_at = case when v_status = 'published' then coalesce(published_at, now()) end,
      updated_by = v_me, updated_at = now()
    where id = p_id returning * into v_e;
    if v_e.id is null then
      raise exception 'Leilão não encontrado.' using errcode = 'P0002';
    end if;
  end if;
  -- Lotes ainda sem licitações seguem o calendário do leilão.
  update public.ldo_auc_lots l set scheduled_close_at = ldo_private.auc_scheduled_close(v_e, l.position),
    close_at = ldo_private.auc_scheduled_close(v_e, l.position)
  where l.event_id = v_e.id and l.bid_count = 0 and l.status in ('draft', 'ready');
  insert into public.ldo_app_audit (actor, action, target, details)
  values (v_me, case when p_id is null then 'auction.event_create' else 'auction.event_update' end, v_e.id,
    jsonb_build_object('title', v_e.title, 'status', v_e.status));
  return v_e.id;
exception
  when unique_violation then
    raise exception 'Já existe um leilão com este endereço.' using errcode = '22023';
  when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or not_null_violation then
    raise exception 'Confirme as datas e o intervalo entre lotes.' using errcode = '22023';
  when check_violation then
    raise exception 'Confirme as datas (o primeiro fecho tem de ser depois da abertura) e o intervalo entre lotes (0 a 3600 segundos).' using errcode = '22023';
end;
$$;

-- Leilão com os lotes (vista da equipa: inclui o líder e o máximo secreto).
create function public.ldo_auc_event_get(p_session text, p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_e public.ldo_auc_events;
begin
  perform ldo_private.auc_require(p_session);
  select * into v_e from public.ldo_auc_events where id = p_id;
  if v_e.id is null then
    raise exception 'Leilão não encontrado.' using errcode = 'P0002';
  end if;
  return jsonb_build_object('event', to_jsonb(v_e), 'lots', coalesce((
    select jsonb_agg(to_jsonb(l) || jsonb_build_object('leader_alias', c.alias, 'leader_email', c.email) order by l.position)
    from public.ldo_auc_lots l left join public.ldo_auc_customers c on c.id = l.leader_id
    where l.event_id = p_id
  ), '[]'::jsonb));
end;
$$;

-- Criar ou alterar um lote. Com licitações, só os textos e as fotografias podem mudar.
create function public.ldo_auc_lot_save(p_session text, p_id uuid, p_event uuid, p_data jsonb) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me uuid := ldo_private.auc_require(p_session);
  v_s public.ldo_auc_settings;
  v_e public.ldo_auc_events;
  v_l public.ldo_auc_lots;
  v_pos integer;
  v_cond text := coalesce(p_data ->> 'condition', 'used');
  v_images jsonb := coalesce(p_data -> 'images', '[]'::jsonb);
begin
  select * into v_s from public.ldo_auc_settings where id = 1;
  select * into v_e from public.ldo_auc_events where id = p_event;
  if v_e.id is null then
    raise exception 'Leilão não encontrado.' using errcode = 'P0002';
  end if;
  if btrim(coalesce(p_data ->> 'title', '')) = '' then
    raise exception 'Indique o título do lote.' using errcode = '22023';
  end if;
  if jsonb_typeof(v_images) <> 'array' or exists (select 1 from jsonb_array_elements_text(v_images) u where u !~ '^https://[a-z0-9.-]+/') then
    raise exception 'As fotografias têm de ser endereços https.' using errcode = '22023';
  end if;
  if p_id is not null then
    select * into v_l from public.ldo_auc_lots where id = p_id and event_id = p_event for update;
    if v_l.id is null then
      raise exception 'Lote não encontrado.' using errcode = 'P0002';
    end if;
    if v_l.status = 'closed' then
      raise exception 'Este lote já fechou.' using errcode = '22023';
    end if;
    if v_l.bid_count > 0 then
      update public.ldo_auc_lots set title = btrim(p_data ->> 'title'), description = coalesce(p_data ->> 'description', ''),
        images = v_images, condition_report = coalesce(p_data ->> 'condition_report', ''), updated_by = v_me, updated_at = now()
      where id = p_id;
      insert into public.ldo_app_audit (actor, action, target, details)
      values (v_me, 'auction.lot_update_texts', p_id, jsonb_build_object('title', p_data ->> 'title'));
      return p_id;
    end if;
    v_pos := coalesce((p_data ->> 'position')::integer, v_l.position);
  else
    v_pos := coalesce((p_data ->> 'position')::integer,
      (select coalesce(max(position), 0) + 1 from public.ldo_auc_lots where event_id = p_event));
  end if;
  if p_id is null then
    insert into public.ldo_auc_lots (event_id, position, shopify_handle, shopify_product_id, sku, title, description, images,
      metal, fineness, weight_g, gems, hallmarked, condition, condition_report, warranty_months, start_price, reserve_price,
      buy_now_price, deposit_mode, scheduled_close_at, close_at, created_by, updated_by)
    values (p_event, v_pos, nullif(p_data ->> 'shopify_handle', ''), nullif(p_data ->> 'shopify_product_id', ''),
      nullif(p_data ->> 'sku', ''), btrim(p_data ->> 'title'), coalesce(p_data ->> 'description', ''), v_images,
      nullif(p_data ->> 'metal', ''), nullif(p_data ->> 'fineness', ''), nullif(p_data ->> 'weight_g', '')::numeric,
      nullif(p_data ->> 'gems', ''), coalesce((p_data ->> 'hallmarked')::boolean, true), v_cond,
      coalesce(p_data ->> 'condition_report', ''),
      coalesce(nullif(p_data ->> 'warranty_months', '')::integer,
        case when v_cond = 'new' then v_s.new_warranty_months else v_s.used_warranty_months end),
      (p_data ->> 'start_price')::numeric, nullif(p_data ->> 'reserve_price', '')::numeric,
      nullif(p_data ->> 'buy_now_price', '')::numeric, coalesce(p_data ->> 'deposit_mode', 'auto'),
      ldo_private.auc_scheduled_close(v_e, v_pos), ldo_private.auc_scheduled_close(v_e, v_pos), v_me, v_me)
    returning * into v_l;
  else
    update public.ldo_auc_lots set position = v_pos, shopify_handle = nullif(p_data ->> 'shopify_handle', ''),
      shopify_product_id = nullif(p_data ->> 'shopify_product_id', ''), sku = nullif(p_data ->> 'sku', ''),
      title = btrim(p_data ->> 'title'), description = coalesce(p_data ->> 'description', ''), images = v_images,
      metal = nullif(p_data ->> 'metal', ''), fineness = nullif(p_data ->> 'fineness', ''),
      weight_g = nullif(p_data ->> 'weight_g', '')::numeric, gems = nullif(p_data ->> 'gems', ''),
      hallmarked = coalesce((p_data ->> 'hallmarked')::boolean, true), condition = v_cond,
      condition_report = coalesce(p_data ->> 'condition_report', ''),
      warranty_months = coalesce(nullif(p_data ->> 'warranty_months', '')::integer, warranty_months),
      start_price = (p_data ->> 'start_price')::numeric, reserve_price = nullif(p_data ->> 'reserve_price', '')::numeric,
      buy_now_price = nullif(p_data ->> 'buy_now_price', '')::numeric, deposit_mode = coalesce(p_data ->> 'deposit_mode', 'auto'),
      scheduled_close_at = ldo_private.auc_scheduled_close(v_e, v_pos), close_at = ldo_private.auc_scheduled_close(v_e, v_pos),
      updated_by = v_me, updated_at = now()
    where id = p_id returning * into v_l;
  end if;
  insert into public.ldo_app_audit (actor, action, target, details)
  values (v_me, case when p_id is null then 'auction.lot_create' else 'auction.lot_update' end, v_l.id,
    jsonb_build_object('title', v_l.title, 'start_price', v_l.start_price, 'reserve_price', v_l.reserve_price));
  return v_l.id;
exception
  when unique_violation then
    raise exception 'Já existe um lote com este número neste leilão.' using errcode = '22023';
  when check_violation then
    raise exception 'Confirme os preços: base maior que zero, reserva igual ou acima da base e "comprar já" acima da base.' using errcode = '22023';
  when invalid_text_representation or numeric_value_out_of_range or not_null_violation then
    raise exception 'Há um valor inválido no lote (preços, peso ou número).' using errcode = '22023';
end;
$$;

-- Pronto a licitar (ready), rascunho (draft) ou retirado (withdrawn: avisa quem licitou).
create function public.ldo_auc_lot_status(p_session text, p_id uuid, p_status text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me uuid := ldo_private.auc_require(p_session);
  v_l public.ldo_auc_lots;
begin
  if p_status not in ('draft', 'ready', 'withdrawn') then
    raise exception 'Estado inválido.' using errcode = '22023';
  end if;
  select * into v_l from public.ldo_auc_lots where id = p_id for update;
  if v_l.id is null then
    raise exception 'Lote não encontrado.' using errcode = 'P0002';
  end if;
  if v_l.status = 'closed' then
    raise exception 'Este lote já fechou.' using errcode = '22023';
  end if;
  if p_status = 'draft' and v_l.bid_count > 0 then
    raise exception 'Um lote com licitações não volta a rascunho: retire-o.' using errcode = '22023';
  end if;
  if p_status = 'ready' and (jsonb_array_length(v_l.images) = 0 or v_l.metal is null) then
    raise exception 'Antes de abrir: pelo menos uma fotografia e o metal (informação obrigatória).' using errcode = '22023';
  end if;
  update public.ldo_auc_lots set status = p_status, updated_by = v_me, updated_at = now() where id = p_id;
  if p_status = 'withdrawn' then
    insert into public.ldo_auc_outbox (kind, customer_id, lot_id)
    select 'withdrawn', b.customer_id, p_id from (select distinct customer_id from public.ldo_auc_bids where lot_id = p_id) b;
    update public.ldo_auc_deposits set status = 'released', updated_at = now()
    where lot_id = p_id and status in ('pending', 'held') and provider = 'manual';
  end if;
  insert into public.ldo_app_audit (actor, action, target, details)
  values (v_me, 'auction.lot_status', p_id, jsonb_build_object('status', p_status, 'bids', v_l.bid_count));
end;
$$;

-- Licitações de um lote (vista da equipa).
create function public.ldo_auc_lot_bids(p_session text, p_lot uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform ldo_private.auc_require(p_session);
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', b.id, 'amount', b.amount, 'max_amount', b.max_amount, 'kind', b.kind,
      'created_at', b.created_at, 'alias', c.alias, 'email', c.email, 'name', c.name) order by b.id desc)
    from public.ldo_auc_bids b join public.ldo_auc_customers c on c.id = b.customer_id
    where b.lot_id = p_lot
  ), '[]'::jsonb);
end;
$$;

-- Clientes (procura por nome, email, NIF ou pseudónimo).
create function public.ldo_auc_customers_list(p_session text, p_query text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_q text := '%' || lower(btrim(coalesce(p_query, ''))) || '%';
begin
  perform ldo_private.auc_require(p_session);
  return coalesce((
    select jsonb_agg(x order by x ->> 'created_at' desc) from (
      select jsonb_build_object('id', c.id, 'email', c.email, 'name', c.name, 'alias', c.alias, 'nif', c.nif, 'phone', c.phone,
        'level', c.level, 'is_staff', c.is_staff, 'email_verified_at', c.email_verified_at, 'verified_at', c.verified_at,
        'marketing_consent', c.marketing_consent, 'created_at', c.created_at, 'last_login_at', c.last_login_at, 'notes', c.notes,
        'bids', (select count(*) from public.ldo_auc_bids b where b.customer_id = c.id and b.kind = 'bid'),
        'won', (select count(*) from public.ldo_auc_lots l where l.leader_id = c.id and l.result = 'sold')) x
      from public.ldo_auc_customers c
      where c.deleted_at is null and (v_q = '%%' or lower(c.email) like v_q or lower(c.name) like v_q
        or coalesce(c.nif, '') like v_q or lower(c.alias) like v_q)
      order by c.created_at desc limit 300
    ) s
  ), '[]'::jsonb);
end;
$$;

-- Nível (registered, verified, vip, blocked), funcionário e notas internas.
create function public.ldo_auc_customer_update(p_session text, p_id uuid, p_level text, p_is_staff boolean, p_notes text)
returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me uuid := ldo_private.auc_require(p_session);
  v_c public.ldo_auc_customers;
begin
  if p_level not in ('registered', 'verified', 'vip', 'blocked') then
    raise exception 'Nível inválido.' using errcode = '22023';
  end if;
  select * into v_c from public.ldo_auc_customers where id = p_id and deleted_at is null for update;
  if v_c.id is null then
    raise exception 'Cliente não encontrado.' using errcode = 'P0002';
  end if;
  update public.ldo_auc_customers set level = p_level, is_staff = coalesce(p_is_staff, false),
    notes = left(coalesce(p_notes, ''), 2000),
    verified_at = case when p_level in ('verified', 'vip') and v_c.level not in ('verified', 'vip') then now()
                       when p_level in ('registered', 'blocked') then null else verified_at end,
    verified_by = case when p_level in ('verified', 'vip') and v_c.level not in ('verified', 'vip') then v_me
                       when p_level in ('registered', 'blocked') then null else verified_by end
  where id = p_id;
  if p_level = 'blocked' then
    update public.ldo_auc_logins set revoked_at = now() where customer_id = p_id and revoked_at is null;
  end if;
  insert into public.ldo_app_audit (actor, action, target, details)
  values (v_me, 'auction.customer_update', p_id, jsonb_build_object('level', p_level, 'is_staff', p_is_staff, 'previous_level', v_c.level));
end;
$$;

-- ---------------------------------------------------------------- fecho de minuto a minuto

select cron.schedule('ldo-auction-close', '* * * * *', $$select ldo_private.auc_close_due()$$);

-- ---------------------------------------------------------------- acessos

revoke all on function
  public.ldo_auc_overview(text),
  public.ldo_auc_settings_save(text, jsonb),
  public.ldo_auc_event_save(text, uuid, jsonb),
  public.ldo_auc_event_get(text, uuid),
  public.ldo_auc_lot_save(text, uuid, uuid, jsonb),
  public.ldo_auc_lot_status(text, uuid, text),
  public.ldo_auc_lot_bids(text, uuid),
  public.ldo_auc_customers_list(text, text),
  public.ldo_auc_customer_update(text, uuid, text, boolean, text)
from public, authenticated;
grant execute on function
  public.ldo_auc_overview(text),
  public.ldo_auc_settings_save(text, jsonb),
  public.ldo_auc_event_save(text, uuid, jsonb),
  public.ldo_auc_event_get(text, uuid),
  public.ldo_auc_lot_save(text, uuid, uuid, jsonb),
  public.ldo_auc_lot_status(text, uuid, text),
  public.ldo_auc_lot_bids(text, uuid),
  public.ldo_auc_customers_list(text, text),
  public.ldo_auc_customer_update(text, uuid, text, boolean, text)
to anon;
