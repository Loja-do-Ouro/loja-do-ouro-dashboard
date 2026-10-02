-- Registos das lojas físicas, que substituem os dois Excel:
-- - "Análise de Vendas" → ldo_shop_sales: um registo por cliente atendido (com ou sem venda).
-- - "Eficácia das campanhas de marketing" → ldo_gold_entries: um registo por cliente da
--   compra de ouro (venda de ouro usado ou contrato/penhor), com como conheceu a loja.
--   ldo_gold_monthly guarda os totais mensais importados do Excel (2022 em diante).
-- As escolhas dos formulários vivem em ldo_options e são geridas pelo Super Admin.
-- Mesmas regras de sempre: tudo passa por funções que verificam a sessão e as permissões.

-- ---------------------------------------------------------------- tabelas

create table public.ldo_options (
  list text not null check (list in ('campaign', 'material', 'product_type', 'client_type', 'seen_where', 'purpose', 'restock', 'no_sale_reason', 'heard_from')),
  code text not null check (code ~ '^[a-z0-9_]{1,40}$'),
  label text not null check (length(btrim(label)) between 1 and 80),
  sort_order integer not null default 100,
  active boolean not null default true,
  -- seen_where / heard_from: a opção conta como "internet".
  digital boolean not null default false,
  primary key (list, code)
);

create table public.ldo_shop_sales (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.ldo_app_stores (id),
  sale_date date not null,
  sale_number text check (sale_number is null or length(sale_number) <= 40),
  sold boolean not null default true,
  total_value numeric(12, 2) check (total_value >= 0),
  campaign boolean,
  campaign_code text,
  client_type text,
  seen_where text,
  bought_online boolean,
  purpose text,
  restock text,
  no_sale_reason text,
  looking_for text check (looking_for is null or length(looking_for) <= 300),
  notes text check (notes is null or length(notes) <= 1000),
  -- [{"reference": "...", "material": "<code>", "product_type": "<code>"}]
  items jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
  source text not null default 'form' check (source in ('form', 'import')),
  created_by uuid not null references public.ldo_app_users (id),
  created_at timestamptz not null default now(),
  updated_by uuid references public.ldo_app_users (id),
  updated_at timestamptz,
  deleted_at timestamptz,
  deleted_by uuid references public.ldo_app_users (id)
);
create index ldo_shop_sales_store_date_idx on public.ldo_shop_sales (store_id, sale_date);

create table public.ldo_gold_entries (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.ldo_app_stores (id),
  entry_date date not null,
  operation text not null check (operation in ('used', 'pawn')),
  heard_from text,
  closed boolean not null default false,
  grams_9 numeric(10, 2) check (grams_9 >= 0), value_9 numeric(12, 2) check (value_9 >= 0),
  grams_14 numeric(10, 2) check (grams_14 >= 0), value_14 numeric(12, 2) check (value_14 >= 0),
  grams_18 numeric(10, 2) check (grams_18 >= 0), value_18 numeric(12, 2) check (value_18 >= 0),
  grams_19 numeric(10, 2) check (grams_19 >= 0), value_19 numeric(12, 2) check (value_19 >= 0),
  grams_22 numeric(10, 2) check (grams_22 >= 0), value_22 numeric(12, 2) check (value_22 >= 0),
  grams_24 numeric(10, 2) check (grams_24 >= 0), value_24 numeric(12, 2) check (value_24 >= 0),
  notes text check (notes is null or length(notes) <= 1000),
  created_by uuid not null references public.ldo_app_users (id),
  created_at timestamptz not null default now(),
  updated_by uuid references public.ldo_app_users (id),
  updated_at timestamptz,
  deleted_at timestamptz,
  deleted_by uuid references public.ldo_app_users (id)
);
create index ldo_gold_entries_store_date_idx on public.ldo_gold_entries (store_id, entry_date);

create table public.ldo_gold_monthly (
  store_id uuid not null references public.ldo_app_stores (id),
  month date not null check (extract(day from month) = 1),
  operation text not null check (operation in ('used', 'pawn')),
  visitors integer check (visitors >= 0),
  digital_visitors integer check (digital_visitors >= 0),
  grams_9 numeric(10, 2), value_9 numeric(12, 2),
  grams_14 numeric(10, 2), value_14 numeric(12, 2),
  grams_18 numeric(10, 2), value_18 numeric(12, 2),
  grams_19 numeric(10, 2), value_19 numeric(12, 2),
  grams_22 numeric(10, 2), value_22 numeric(12, 2),
  grams_24 numeric(10, 2), value_24 numeric(12, 2),
  source text not null default 'excel',
  primary key (store_id, month, operation)
);

create table public.ldo_record_history (
  id bigint generated always as identity primary key,
  record_table text not null check (record_table in ('ldo_shop_sales', 'ldo_gold_entries')),
  record_id uuid not null,
  store_id uuid not null references public.ldo_app_stores (id),
  action text not null check (action in ('create', 'update', 'delete')),
  changed_by uuid not null references public.ldo_app_users (id),
  changed_at timestamptz not null default now(),
  before jsonb,
  after jsonb
);
create index ldo_record_history_record_idx on public.ldo_record_history (record_table, record_id);

alter table public.ldo_options enable row level security;
alter table public.ldo_shop_sales enable row level security;
alter table public.ldo_gold_entries enable row level security;
alter table public.ldo_gold_monthly enable row level security;
alter table public.ldo_record_history enable row level security;
revoke all on public.ldo_options, public.ldo_shop_sales, public.ldo_gold_entries, public.ldo_gold_monthly,
  public.ldo_record_history from anon, authenticated;

-- Palavra que identifica a campanha Google Ads da loja (ex.: "FOZ" em "FOZ - 10km").
alter table public.ldo_app_stores add column ads_keyword text check (ads_keyword is null or length(ads_keyword) <= 40);
update public.ldo_app_stores s set ads_keyword = k.kw
from (values ('figueira-da-foz', 'FOZ'), ('santarem', 'SANTAREM'), ('cartaxo', 'CARTAXO'), ('loures', 'LOURES'),
  ('tomar', 'TOMAR'), ('entroncamento', 'ENTRONCAMENTO'), ('torres-novas', 'TORRES NOVAS'), ('benfica', 'BENFICA'),
  ('fatima', 'FATIMA'), ('coimbra', 'COIMBRA'), ('abrantes', 'ABRANTES'), ('leiria-jerico', 'JERICO'), ('leiria-city', 'LEIRIA CITY')) k(code, kw)
where s.code = k.code;

insert into public.ldo_options (list, code, label, sort_order, digital) values
  ('campaign', 'saldos', 'Saldos', 10, false),
  ('campaign', 'verao', 'Campanha de verão', 20, false),
  ('campaign', 'fe', 'Campanha Fé', 30, false),
  ('campaign', 'desconto', 'Desconto / promoção', 40, false),
  ('campaign', 'stock_off', 'Stock off', 50, false),
  ('campaign', 'outra', 'Outra campanha', 90, false),
  ('material', 'ouro', 'Ouro', 10, false),
  ('material', 'prata', 'Prata', 20, false),
  ('material', 'aco', 'Aço', 30, false),
  ('material', 'metal_comum', 'Metal comum', 40, false),
  ('material', 'relogio', 'Relógio', 50, false),
  ('material', 'outro', 'Outro', 90, false),
  ('product_type', 'fio', 'Fio', 10, false),
  ('product_type', 'brincos', 'Brincos', 20, false),
  ('product_type', 'pulseira', 'Pulseira', 30, false),
  ('product_type', 'anel', 'Anel', 40, false),
  ('product_type', 'medalha', 'Medalha', 50, false),
  ('product_type', 'colar', 'Colar', 60, false),
  ('product_type', 'argolas', 'Argolas', 70, false),
  ('product_type', 'aliancas', 'Alianças', 80, false),
  ('product_type', 'cruz', 'Cruz / crucifixo', 90, false),
  ('product_type', 'escapulario', 'Escapulário', 100, false),
  ('product_type', 'terco', 'Terço', 110, false),
  ('product_type', 'alfinete', 'Alfinete', 120, false),
  ('product_type', 'escrava', 'Escrava', 130, false),
  ('product_type', 'barra', 'Barra de ouro', 140, false),
  ('product_type', 'moeda', 'Moeda / libra', 150, false),
  ('product_type', 'relogio', 'Relógio', 160, false),
  ('product_type', 'conjunto', 'Conjunto', 170, false),
  ('product_type', 'outro', 'Outro', 900, false),
  ('client_type', 'novo', 'Novo', 10, false),
  ('client_type', 'habitual', 'Habitual', 20, false),
  ('client_type', 'passagem', 'De passagem / turista', 30, false),
  ('seen_where', 'loja', 'Na loja', 10, false),
  ('seen_where', 'montra', 'Na montra', 20, false),
  ('seen_where', 'site', 'No site', 30, true),
  ('seen_where', 'redes_sociais', 'Instagram / Facebook', 40, true),
  ('seen_where', 'telefone', 'Telefone / WhatsApp / chat', 50, false),
  ('seen_where', 'recomendacao', 'Recomendação', 60, false),
  ('seen_where', 'outro', 'Outro', 90, false),
  ('purpose', 'oferta', 'Para oferecer', 10, false),
  ('purpose', 'proprio', 'Uso próprio', 20, false),
  ('purpose', 'investimento', 'Investimento', 30, false),
  ('restock', 'pedido', 'Pedi reposição', 10, false),
  ('restock', 'tenho_similar', 'Não pedi — tenho similar em loja', 20, false),
  ('restock', 'a_pedido', 'Não pedi — vem a pedido do cliente', 30, false),
  ('restock', 'nao', 'Não é preciso', 40, false),
  ('no_sale_reason', 'caro', 'Achou caro', 10, false),
  ('no_sale_reason', 'sem_tamanho', 'Não havia o tamanho', 20, false),
  ('no_sale_reason', 'sem_stock', 'Não havia o modelo em loja', 30, false),
  ('no_sale_reason', 'troca', 'Troca', 40, false),
  ('no_sale_reason', 'so_ver', 'Só veio ver / vai pensar', 50, false),
  ('no_sale_reason', 'outro', 'Outro motivo', 90, false),
  ('heard_from', 'google', 'Google (pesquisa ou mapas)', 10, true),
  ('heard_from', 'redes_sociais', 'Facebook / Instagram', 20, true),
  ('heard_from', 'site', 'Site da Loja do Ouro', 30, true),
  ('heard_from', 'outro_digital', 'Outro meio na internet', 40, true),
  ('heard_from', 'recomendacao', 'Recomendação de alguém', 50, false),
  ('heard_from', 'montra', 'Passou na loja / montra', 60, false),
  ('heard_from', 'cliente', 'Já era cliente', 70, false),
  ('heard_from', 'publicidade', 'Rádio / jornal / folheto', 80, false),
  ('heard_from', 'outro', 'Outro', 90, false);

-- ---------------------------------------------------------------- regras comuns

create function ldo_private.option_ok(p_list text, p_code text) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_code is null or exists (select 1 from public.ldo_options where list = p_list and code = p_code and active);
$$;

-- Loja: corrige o próprio registo nas 24 h seguintes, enquanto ninguém o tiver corrigido. Gestor: sempre.
create function ldo_private.can_change(p_level text, p_me uuid, p_created_by uuid, p_created_at timestamptz, p_updated_by uuid)
returns boolean language sql immutable set search_path = '' as $$
  select p_level = 'manager' or (p_level = 'store' and p_created_by = p_me
    and p_created_at > now() - interval '24 hours' and (p_updated_by is null or p_updated_by = p_me));
$$;

-- Data permitida: nunca futura; a Loja só até 31 dias atrás.
create function ldo_private.check_date(p_level text, p_date date) returns void
language plpgsql stable set search_path = '' as $$
declare v_today date := (now() at time zone 'Europe/Lisbon')::date;
begin
  if p_date is null or p_date > v_today then
    raise exception 'A data não pode ser futura.' using errcode = '22023';
  end if;
  if p_level = 'store' and p_date < v_today - 31 then
    raise exception 'Datas com mais de 31 dias só podem ser lançadas pelo Gestor.' using errcode = '42501';
  end if;
end;
$$;

revoke all on function ldo_private.option_ok(text, text), ldo_private.can_change(text, uuid, uuid, timestamptz, uuid),
  ldo_private.check_date(text, date) from public, anon, authenticated;

-- A sessão passa a incluir a palavra Google Ads de cada loja.
create or replace function public.ldo_me(p_session text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', u.id,
    'username', u.username,
    'full_name', u.full_name,
    'is_super_admin', u.is_super_admin,
    'online_access', u.online_access or u.is_super_admin,
    'must_change_password', u.must_change_password,
    'stores', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'code', s.code, 'name', s.name, 'level', l.level, 'ads_keyword', s.ads_keyword)
        order by s.sort_order, s.name)
      from public.ldo_app_stores s
      cross join lateral (select case when u.is_super_admin then 'manager' else u.store_access ->> s.id::text end as level) l
      where s.active and l.level is not null
    ), '[]'::jsonb)
  )
  from public.ldo_app_users u
  where u.id = ldo_private.session_user_id(p_session);
$$;

-- ---------------------------------------------------------------- listas de opções

create function public.ldo_list_options(p_session text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when ldo_private.session_user_id(p_session) is null then null else coalesce((
    select jsonb_agg(jsonb_build_object('list', o.list, 'code', o.code, 'label', o.label, 'sort_order', o.sort_order,
      'active', o.active, 'digital', o.digital) order by o.list, o.sort_order, o.label)
    from public.ldo_options o), '[]'::jsonb) end;
$$;

create function public.ldo_save_option(p_session text, p_list text, p_code text, p_label text, p_sort_order integer,
  p_active boolean, p_digital boolean) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare v_me uuid := ldo_private.session_user_id(p_session);
begin
  if v_me is null or not exists (select 1 from public.ldo_app_users where id = v_me and is_super_admin) then
    raise exception 'Só o Super Admin pode gerir as listas.' using errcode = '42501';
  end if;
  insert into public.ldo_options (list, code, label, sort_order, active, digital)
  values (p_list, p_code, btrim(p_label), coalesce(p_sort_order, 100), coalesce(p_active, true), coalesce(p_digital, false))
  on conflict (list, code) do update set label = excluded.label, sort_order = excluded.sort_order,
    active = excluded.active, digital = excluded.digital;
  insert into public.ldo_app_audit (actor, action, details)
  values (v_me, 'option.save', jsonb_build_object('list', p_list, 'code', p_code, 'label', p_label, 'active', p_active));
  return p_code;
end;
$$;

-- ---------------------------------------------------------------- vendas e atendimentos

create function public.ldo_save_shop_sale(p_session text, p_id uuid, p_store_id uuid, p_data jsonb) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me uuid := ldo_private.session_user_id(p_session);
  v_old public.ldo_shop_sales;
  v_new public.ldo_shop_sales;
  v_store uuid := p_store_id;
  v_level text;
  v_date date := nullif(p_data ->> 'sale_date', '')::date;
  v_sold boolean := coalesce((p_data ->> 'sold')::boolean, true);
  v_value numeric := nullif(p_data ->> 'total_value', '')::numeric;
  v_items jsonb := coalesce(p_data -> 'items', '[]'::jsonb);
  v_item jsonb;
begin
  if p_id is not null then
    select * into v_old from public.ldo_shop_sales where id = p_id and deleted_at is null for update;
    if v_old.id is null then
      raise exception 'Registo não encontrado.' using errcode = 'P0002';
    end if;
    v_store := v_old.store_id;
  end if;
  v_level := ldo_private.user_level(v_me, v_store);
  if v_me is null or v_level is null then
    raise exception 'Sem permissão para esta loja.' using errcode = '42501';
  end if;
  if v_old.id is not null and not ldo_private.can_change(v_level, v_me, v_old.created_by, v_old.created_at, v_old.updated_by) then
    raise exception 'Este registo já não pode ser alterado aqui. Para corrigir, contacte o Gestor da loja.' using errcode = '42501';
  end if;
  perform ldo_private.check_date(v_level, v_date);
  if v_sold and (v_value is null or v_value <= 0) then
    raise exception 'Indique o valor da venda.' using errcode = '22023';
  end if;
  if not v_sold and nullif(p_data ->> 'no_sale_reason', '') is null then
    raise exception 'Indique o motivo de não venda.' using errcode = '22023';
  end if;
  if not (ldo_private.option_ok('campaign', nullif(p_data ->> 'campaign_code', ''))
    and ldo_private.option_ok('client_type', nullif(p_data ->> 'client_type', ''))
    and ldo_private.option_ok('seen_where', nullif(p_data ->> 'seen_where', ''))
    and ldo_private.option_ok('purpose', nullif(p_data ->> 'purpose', ''))
    and ldo_private.option_ok('restock', nullif(p_data ->> 'restock', ''))
    and ldo_private.option_ok('no_sale_reason', nullif(p_data ->> 'no_sale_reason', ''))) then
    raise exception 'Uma das opções escolhidas não é válida.' using errcode = '22023';
  end if;
  if jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) > 30 then
    raise exception 'Lista de artigos inválida.' using errcode = '22023';
  end if;
  for v_item in select * from jsonb_array_elements(v_items) loop
    if jsonb_typeof(v_item) <> 'object' or length(coalesce(v_item ->> 'reference', '')) > 40
      or not ldo_private.option_ok('material', nullif(v_item ->> 'material', ''))
      or not ldo_private.option_ok('product_type', nullif(v_item ->> 'product_type', '')) then
      raise exception 'Há um artigo com dados inválidos.' using errcode = '22023';
    end if;
  end loop;

  if v_old.id is null then
    insert into public.ldo_shop_sales (store_id, sale_date, sale_number, sold, total_value, campaign, campaign_code, client_type,
      seen_where, bought_online, purpose, restock, no_sale_reason, looking_for, notes, items, created_by)
    values (v_store, v_date, nullif(btrim(p_data ->> 'sale_number'), ''), v_sold, case when v_sold then v_value end,
      (p_data ->> 'campaign')::boolean, nullif(p_data ->> 'campaign_code', ''), nullif(p_data ->> 'client_type', ''),
      nullif(p_data ->> 'seen_where', ''), (p_data ->> 'bought_online')::boolean, nullif(p_data ->> 'purpose', ''),
      nullif(p_data ->> 'restock', ''), nullif(p_data ->> 'no_sale_reason', ''), nullif(btrim(p_data ->> 'looking_for'), ''),
      nullif(btrim(p_data ->> 'notes'), ''), v_items, v_me)
    returning * into v_new;
  else
    update public.ldo_shop_sales set
      sale_date = v_date, sale_number = nullif(btrim(p_data ->> 'sale_number'), ''), sold = v_sold,
      total_value = case when v_sold then v_value end, campaign = (p_data ->> 'campaign')::boolean,
      campaign_code = nullif(p_data ->> 'campaign_code', ''), client_type = nullif(p_data ->> 'client_type', ''),
      seen_where = nullif(p_data ->> 'seen_where', ''), bought_online = (p_data ->> 'bought_online')::boolean,
      purpose = nullif(p_data ->> 'purpose', ''), restock = nullif(p_data ->> 'restock', ''),
      no_sale_reason = nullif(p_data ->> 'no_sale_reason', ''), looking_for = nullif(btrim(p_data ->> 'looking_for'), ''),
      notes = nullif(btrim(p_data ->> 'notes'), ''), items = v_items, updated_by = v_me, updated_at = now()
    where id = v_old.id
    returning * into v_new;
  end if;
  insert into public.ldo_record_history (record_table, record_id, store_id, action, changed_by, before, after)
  values ('ldo_shop_sales', v_new.id, v_store, case when v_old.id is null then 'create' else 'update' end, v_me,
    case when v_old.id is null then null else to_jsonb(v_old) end, to_jsonb(v_new));
  return v_new.id;
end;
$$;

create function public.ldo_remove_shop_sale(p_session text, p_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me uuid := ldo_private.session_user_id(p_session);
  v_old public.ldo_shop_sales;
begin
  select * into v_old from public.ldo_shop_sales where id = p_id and deleted_at is null for update;
  if v_me is null or v_old.id is null or ldo_private.user_level(v_me, v_old.store_id) is distinct from 'manager' then
    raise exception 'Só o Gestor da loja pode apagar registos.' using errcode = '42501';
  end if;
  update public.ldo_shop_sales set deleted_at = now(), deleted_by = v_me where id = p_id;
  insert into public.ldo_record_history (record_table, record_id, store_id, action, changed_by, before)
  values ('ldo_shop_sales', p_id, v_old.store_id, 'delete', v_me, to_jsonb(v_old));
end;
$$;

-- Sem loja indicada: todas as lojas a que a pessoa tem acesso.
create function public.ldo_list_shop_sales(p_session text, p_store_id uuid, p_from date, p_to date)
returns table (
  id uuid, store_id uuid, sale_date date, sale_number text, sold boolean, total_value numeric, campaign boolean,
  campaign_code text, client_type text, seen_where text, bought_online boolean, purpose text, restock text,
  no_sale_reason text, looking_for text, notes text, items jsonb, source text,
  created_by uuid, created_by_name text, created_at timestamptz, updated_by uuid, updated_by_name text, updated_at timestamptz
)
language sql stable security definer set search_path = '' as $$
  with me as (select ldo_private.session_user_id(p_session) as id)
  select s.id, s.store_id, s.sale_date, s.sale_number, s.sold, s.total_value, s.campaign, s.campaign_code, s.client_type,
    s.seen_where, s.bought_online, s.purpose, s.restock, s.no_sale_reason, s.looking_for, s.notes, s.items, s.source,
    s.created_by, coalesce(c.full_name, c.username), s.created_at, s.updated_by, coalesce(u.full_name, u.username), s.updated_at
  from public.ldo_shop_sales s
  cross join me
  join public.ldo_app_users c on c.id = s.created_by
  left join public.ldo_app_users u on u.id = s.updated_by
  where s.deleted_at is null and s.sale_date between p_from and p_to and p_to - p_from <= 800
    and (p_store_id is null or s.store_id = p_store_id)
    and ldo_private.user_level(me.id, s.store_id) is not null
  order by s.sale_date desc, s.created_at desc;
$$;

-- ---------------------------------------------------------------- compra de ouro

create function public.ldo_save_gold_entry(p_session text, p_id uuid, p_store_id uuid, p_data jsonb) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me uuid := ldo_private.session_user_id(p_session);
  v_old public.ldo_gold_entries;
  v_new public.ldo_gold_entries;
  v_store uuid := p_store_id;
  v_level text;
  v_date date := nullif(p_data ->> 'entry_date', '')::date;
  v_op text := p_data ->> 'operation';
  v_heard text := nullif(p_data ->> 'heard_from', '');
  n numeric[];
  k text;
begin
  if p_id is not null then
    select * into v_old from public.ldo_gold_entries where id = p_id and deleted_at is null for update;
    if v_old.id is null then
      raise exception 'Registo não encontrado.' using errcode = 'P0002';
    end if;
    v_store := v_old.store_id;
  end if;
  v_level := ldo_private.user_level(v_me, v_store);
  if v_me is null or v_level is null then
    raise exception 'Sem permissão para esta loja.' using errcode = '42501';
  end if;
  if v_old.id is not null and not ldo_private.can_change(v_level, v_me, v_old.created_by, v_old.created_at, v_old.updated_by) then
    raise exception 'Este registo já não pode ser alterado aqui. Para corrigir, contacte o Gestor da loja.' using errcode = '42501';
  end if;
  perform ldo_private.check_date(v_level, v_date);
  if v_op is null or v_op not in ('used', 'pawn') then
    raise exception 'Escolha o tipo: venda de ouro usado ou contrato.' using errcode = '22023';
  end if;
  if v_heard is null or not ldo_private.option_ok('heard_from', v_heard) then
    raise exception 'Indique como o cliente conheceu a Loja do Ouro.' using errcode = '22023';
  end if;
  foreach k in array array['grams_9','value_9','grams_14','value_14','grams_18','value_18','grams_19','value_19','grams_22','value_22','grams_24','value_24'] loop
    n := n || nullif(p_data ->> k, '')::numeric;
  end loop;
  if exists (select 1 from unnest(n) x where x < 0) then
    raise exception 'Gramas e valores não podem ser negativos.' using errcode = '22023';
  end if;

  if v_old.id is null then
    insert into public.ldo_gold_entries (store_id, entry_date, operation, heard_from, closed,
      grams_9, value_9, grams_14, value_14, grams_18, value_18, grams_19, value_19, grams_22, value_22, grams_24, value_24,
      notes, created_by)
    values (v_store, v_date, v_op, v_heard, coalesce((p_data ->> 'closed')::boolean, false),
      n[1], n[2], n[3], n[4], n[5], n[6], n[7], n[8], n[9], n[10], n[11], n[12],
      nullif(btrim(p_data ->> 'notes'), ''), v_me)
    returning * into v_new;
  else
    update public.ldo_gold_entries set entry_date = v_date, operation = v_op, heard_from = v_heard,
      closed = coalesce((p_data ->> 'closed')::boolean, false),
      grams_9 = n[1], value_9 = n[2], grams_14 = n[3], value_14 = n[4], grams_18 = n[5], value_18 = n[6],
      grams_19 = n[7], value_19 = n[8], grams_22 = n[9], value_22 = n[10], grams_24 = n[11], value_24 = n[12],
      notes = nullif(btrim(p_data ->> 'notes'), ''), updated_by = v_me, updated_at = now()
    where id = v_old.id
    returning * into v_new;
  end if;
  insert into public.ldo_record_history (record_table, record_id, store_id, action, changed_by, before, after)
  values ('ldo_gold_entries', v_new.id, v_store, case when v_old.id is null then 'create' else 'update' end, v_me,
    case when v_old.id is null then null else to_jsonb(v_old) end, to_jsonb(v_new));
  return v_new.id;
end;
$$;

create function public.ldo_remove_gold_entry(p_session text, p_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me uuid := ldo_private.session_user_id(p_session);
  v_old public.ldo_gold_entries;
begin
  select * into v_old from public.ldo_gold_entries where id = p_id and deleted_at is null for update;
  if v_me is null or v_old.id is null or ldo_private.user_level(v_me, v_old.store_id) is distinct from 'manager' then
    raise exception 'Só o Gestor da loja pode apagar registos.' using errcode = '42501';
  end if;
  update public.ldo_gold_entries set deleted_at = now(), deleted_by = v_me where id = p_id;
  insert into public.ldo_record_history (record_table, record_id, store_id, action, changed_by, before)
  values ('ldo_gold_entries', p_id, v_old.store_id, 'delete', v_me, to_jsonb(v_old));
end;
$$;

create function public.ldo_list_gold_entries(p_session text, p_store_id uuid, p_from date, p_to date)
returns table (
  id uuid, store_id uuid, entry_date date, operation text, heard_from text, closed boolean,
  grams_9 numeric, value_9 numeric, grams_14 numeric, value_14 numeric, grams_18 numeric, value_18 numeric,
  grams_19 numeric, value_19 numeric, grams_22 numeric, value_22 numeric, grams_24 numeric, value_24 numeric, notes text,
  created_by uuid, created_by_name text, created_at timestamptz, updated_by uuid, updated_by_name text, updated_at timestamptz
)
language sql stable security definer set search_path = '' as $$
  with me as (select ldo_private.session_user_id(p_session) as id)
  select g.id, g.store_id, g.entry_date, g.operation, g.heard_from, g.closed,
    g.grams_9, g.value_9, g.grams_14, g.value_14, g.grams_18, g.value_18, g.grams_19, g.value_19,
    g.grams_22, g.value_22, g.grams_24, g.value_24, g.notes,
    g.created_by, coalesce(c.full_name, c.username), g.created_at, g.updated_by, coalesce(u.full_name, u.username), g.updated_at
  from public.ldo_gold_entries g
  cross join me
  join public.ldo_app_users c on c.id = g.created_by
  left join public.ldo_app_users u on u.id = g.updated_by
  where g.deleted_at is null and g.entry_date between p_from and p_to and p_to - p_from <= 800
    and (p_store_id is null or g.store_id = p_store_id)
    and ldo_private.user_level(me.id, g.store_id) is not null
  order by g.entry_date desc, g.created_at desc;
$$;

create function public.ldo_list_gold_monthly(p_session text, p_store_id uuid, p_from date, p_to date)
returns setof public.ldo_gold_monthly
language sql stable security definer set search_path = '' as $$
  select m.* from public.ldo_gold_monthly m
  where m.month between date_trunc('month', p_from)::date and p_to
    and (p_store_id is null or m.store_id = p_store_id)
    and ldo_private.user_level(ldo_private.session_user_id(p_session), m.store_id) is not null
  order by m.month, m.store_id, m.operation;
$$;

-- ---------------------------------------------------------------- lojas (palavra Google Ads)

create or replace function public.ldo_list_stores(p_session text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := ldo_private.session_user_id(p_session);
begin
  if v_me is null or not exists (select 1 from public.ldo_app_users where id = v_me and is_super_admin) then
    raise exception 'Só o Super Admin pode gerir lojas.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', s.id, 'code', s.code, 'name', s.name, 'city', s.city, 'active', s.active, 'sort_order', s.sort_order,
      'ads_keyword', s.ads_keyword,
      'managers', (select count(*) from public.ldo_app_users u where u.active and u.store_access ->> s.id::text = 'manager'),
      'staff', (select count(*) from public.ldo_app_users u where u.active and u.store_access ->> s.id::text = 'store')
    ) order by s.sort_order, s.name)
    from public.ldo_app_stores s
  ), '[]'::jsonb);
end;
$$;

create function public.ldo_save_store(
  p_session text, p_store_id uuid, p_code text, p_name text, p_city text, p_active boolean, p_sort_order integer, p_ads_keyword text
) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_id uuid := public.ldo_save_store(p_session, p_store_id, p_code, p_name, p_city, p_active, p_sort_order);
begin
  update public.ldo_app_stores set ads_keyword = nullif(btrim(coalesce(p_ads_keyword, '')), '') where id = v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------- importação dos Excel (usada uma vez)

-- Chamada por scripts/import-store-excel.py através de um utilizador Super Admin temporário.
-- Depois da importação o acesso foi retirado (revoke abaixo) e o utilizador desativado.
create function public.ldo_import_records(p_session text, p_kind text, p_rows jsonb) returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me uuid := ldo_private.session_user_id(p_session);
  v_count integer;
begin
  if v_me is null or not exists (select 1 from public.ldo_app_users where id = v_me and is_super_admin) then
    raise exception 'Só o Super Admin pode importar.' using errcode = '42501';
  end if;
  if p_kind = 'sales' then
    insert into public.ldo_shop_sales (store_id, sale_date, sale_number, sold, total_value, campaign, campaign_code, client_type,
      seen_where, bought_online, purpose, restock, no_sale_reason, looking_for, notes, items, source, created_by)
    select s.id, r.sale_date, r.sale_number, r.sold, r.total_value, r.campaign, r.campaign_code, r.client_type,
      r.seen_where, r.bought_online, r.purpose, r.restock, r.no_sale_reason, left(r.looking_for, 300), r.notes,
      coalesce(r.items, '[]'::jsonb), 'import', v_me
    from jsonb_to_recordset(p_rows) as r(store text, sale_date date, sale_number text, sold boolean, total_value numeric,
      campaign boolean, campaign_code text, client_type text, seen_where text, bought_online boolean, purpose text,
      restock text, no_sale_reason text, looking_for text, notes text, items jsonb)
    join public.ldo_app_stores s on s.code = r.store;
  elsif p_kind = 'gold_monthly' then
    insert into public.ldo_gold_monthly (store_id, month, operation, visitors, digital_visitors,
      grams_9, value_9, grams_14, value_14, grams_18, value_18, grams_19, value_19, grams_22, value_22, grams_24, value_24)
    select s.id, r.month, r.operation, r.visitors, r.digital_visitors,
      r.grams_9, r.value_9, r.grams_14, r.value_14, r.grams_18, r.value_18, r.grams_19, r.value_19,
      r.grams_22, r.value_22, r.grams_24, r.value_24
    from jsonb_to_recordset(p_rows) as r(store text, month date, operation text, visitors integer, digital_visitors integer,
      grams_9 numeric, value_9 numeric, grams_14 numeric, value_14 numeric, grams_18 numeric, value_18 numeric,
      grams_19 numeric, value_19 numeric, grams_22 numeric, value_22 numeric, grams_24 numeric, value_24 numeric)
    join public.ldo_app_stores s on s.code = r.store
    on conflict (store_id, month, operation) do update set visitors = excluded.visitors,
      digital_visitors = excluded.digital_visitors, grams_9 = excluded.grams_9, value_9 = excluded.value_9,
      grams_14 = excluded.grams_14, value_14 = excluded.value_14, grams_18 = excluded.grams_18, value_18 = excluded.value_18,
      grams_19 = excluded.grams_19, value_19 = excluded.value_19, grams_22 = excluded.grams_22, value_22 = excluded.value_22,
      grams_24 = excluded.grams_24, value_24 = excluded.value_24;
  else
    raise exception 'Tipo de importação desconhecido.' using errcode = '22023';
  end if;
  get diagnostics v_count = row_count;
  insert into public.ldo_app_audit (actor, action, details) values (v_me, 'import.' || p_kind, jsonb_build_object('rows', v_count));
  return v_count;
end;
$$;

-- ---------------------------------------------------------------- acessos

revoke all on function public.ldo_list_options(text), public.ldo_save_option(text, text, text, text, integer, boolean, boolean),
  public.ldo_save_shop_sale(text, uuid, uuid, jsonb), public.ldo_remove_shop_sale(text, uuid),
  public.ldo_list_shop_sales(text, uuid, date, date),
  public.ldo_save_gold_entry(text, uuid, uuid, jsonb), public.ldo_remove_gold_entry(text, uuid),
  public.ldo_list_gold_entries(text, uuid, date, date), public.ldo_list_gold_monthly(text, uuid, date, date),
  public.ldo_save_store(text, uuid, text, text, text, boolean, integer, text),
  public.ldo_import_records(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.ldo_list_options(text), public.ldo_save_option(text, text, text, text, integer, boolean, boolean),
  public.ldo_save_shop_sale(text, uuid, uuid, jsonb), public.ldo_remove_shop_sale(text, uuid),
  public.ldo_list_shop_sales(text, uuid, date, date),
  public.ldo_save_gold_entry(text, uuid, uuid, jsonb), public.ldo_remove_gold_entry(text, uuid),
  public.ldo_list_gold_entries(text, uuid, date, date), public.ldo_list_gold_monthly(text, uuid, date, date),
  public.ldo_save_store(text, uuid, text, text, text, boolean, integer, text) to anon;

-- A versão anterior (totais diários provisórios, ldo_store_sales) deixa de ser usada.
revoke all on function public.ldo_store_sales_list(text, uuid, date, date),
  public.ldo_save_store_sale(text, uuid, date, numeric, integer, integer, numeric, numeric, numeric, text),
  public.ldo_remove_store_sale(text, uuid), public.ldo_compare_sales(text, date, date) from public, anon, authenticated;
