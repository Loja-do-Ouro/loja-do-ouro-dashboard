-- Utilizadores por convite, lojas físicas e vendas diárias das lojas.
--
-- Este projeto Supabase é partilhado com outra aplicação: nada aqui altera as
-- tabelas dela (profiles, stores, ...). Tudo o que é do dashboard usa o prefixo
-- ldo_. As tabelas só têm políticas de LEITURA; qualquer escrita passa pelas
-- funções ldo_* abaixo, que verificam as permissões de quem chama.

create schema if not exists ldo_private;
revoke all on schema ldo_private from public, anon;
grant usage on schema ldo_private to authenticated;

-- ---------------------------------------------------------------- tabelas

create table public.ldo_app_users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(btrim(email)) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  full_name text check (full_name is null or length(full_name) <= 120),
  auth_user_id uuid unique references auth.users (id) on delete set null,
  is_super_admin boolean not null default false,
  online_access boolean not null default false,
  active boolean not null default true,
  invited_by uuid references public.ldo_app_users (id),
  created_at timestamptz not null default now(),
  updated_by uuid references public.ldo_app_users (id),
  updated_at timestamptz not null default now(),
  last_login_at timestamptz
);

create table public.ldo_app_stores (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(code) <= 40),
  name text not null check (length(btrim(name)) between 2 and 80),
  city text check (city is null or length(city) <= 80),
  active boolean not null default true,
  sort_order integer not null default 100,
  created_by uuid references public.ldo_app_users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Nível por loja: 'manager' (Gestor) ou 'store' (Loja).
create table public.ldo_app_user_stores (
  user_id uuid not null references public.ldo_app_users (id) on delete cascade,
  store_id uuid not null references public.ldo_app_stores (id) on delete cascade,
  level text not null check (level in ('manager', 'store')),
  granted_by uuid references public.ldo_app_users (id),
  created_at timestamptz not null default now(),
  primary key (user_id, store_id)
);
create index ldo_app_user_stores_store_idx on public.ldo_app_user_stores (store_id);

-- Campos provisórios até chegar o modelo Excel das lojas.
create table public.ldo_store_sales (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.ldo_app_stores (id),
  sale_date date not null,
  total_sales numeric(12, 2) not null check (total_sales >= 0),
  receipts integer check (receipts >= 0),
  items integer check (items >= 0),
  cash numeric(12, 2) check (cash >= 0),
  card numeric(12, 2) check (card >= 0),
  other_payment numeric(12, 2) check (other_payment >= 0),
  notes text check (notes is null or length(notes) <= 1000),
  created_by uuid not null references public.ldo_app_users (id),
  created_at timestamptz not null default now(),
  updated_by uuid references public.ldo_app_users (id),
  updated_at timestamptz,
  unique (store_id, sale_date)
);

-- Histórico imutável: quem lançou, corrigiu ou apagou cada registo, com antes/depois.
create table public.ldo_store_sales_history (
  id bigint generated always as identity primary key,
  sale_id uuid not null,
  store_id uuid not null references public.ldo_app_stores (id),
  sale_date date not null,
  action text not null check (action in ('create', 'update', 'delete')),
  changed_by uuid not null references public.ldo_app_users (id),
  changed_at timestamptz not null default now(),
  before jsonb,
  after jsonb
);
create index ldo_store_sales_history_sale_idx on public.ldo_store_sales_history (store_id, sale_date);

-- Registo das alterações a utilizadores e lojas.
create table public.ldo_app_audit (
  id bigint generated always as identity primary key,
  actor uuid not null references public.ldo_app_users (id),
  action text not null,
  target uuid,
  details jsonb,
  created_at timestamptz not null default now()
);

alter table public.ldo_app_users enable row level security;
alter table public.ldo_app_stores enable row level security;
alter table public.ldo_app_user_stores enable row level security;
alter table public.ldo_store_sales enable row level security;
alter table public.ldo_store_sales_history enable row level security;
alter table public.ldo_app_audit enable row level security;

revoke all on public.ldo_app_users, public.ldo_app_stores, public.ldo_app_user_stores,
  public.ldo_store_sales, public.ldo_store_sales_history, public.ldo_app_audit from anon, authenticated;
grant select on public.ldo_app_users, public.ldo_app_stores, public.ldo_app_user_stores,
  public.ldo_store_sales, public.ldo_store_sales_history, public.ldo_app_audit to authenticated;

-- ---------------------------------------------------------------- funções de permissão

create function ldo_private.current_user_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select u.id from public.ldo_app_users u
  where u.auth_user_id = (select auth.uid()) and u.active;
$$;

create function ldo_private.is_super() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.ldo_app_users u
    where u.auth_user_id = (select auth.uid()) and u.active and u.is_super_admin
  );
$$;

create function ldo_private.has_online() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.ldo_app_users u
    where u.auth_user_id = (select auth.uid()) and u.active and (u.is_super_admin or u.online_access)
  );
$$;

-- 'manager', 'store' ou null. O Super Admin é Gestor de todas as lojas.
create function ldo_private.store_level(p_store uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when ldo_private.is_super() then 'manager'
    else (
      select us.level from public.ldo_app_user_stores us
      join public.ldo_app_users u on u.id = us.user_id
      join public.ldo_app_stores s on s.id = us.store_id
      where us.store_id = p_store and u.auth_user_id = (select auth.uid()) and u.active and s.active
    )
  end;
$$;

create function ldo_private.can_see_user(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select ldo_private.is_super()
    or p_user = ldo_private.current_user_id()
    or exists (
      select 1 from public.ldo_app_user_stores target
      where target.user_id = p_user and ldo_private.store_level(target.store_id) = 'manager'
    );
$$;

revoke all on function ldo_private.current_user_id(), ldo_private.is_super(), ldo_private.has_online(),
  ldo_private.store_level(uuid), ldo_private.can_see_user(uuid) from public, anon;
grant execute on function ldo_private.current_user_id(), ldo_private.is_super(), ldo_private.has_online(),
  ldo_private.store_level(uuid), ldo_private.can_see_user(uuid) to authenticated;

-- ---------------------------------------------------------------- políticas (só leitura)

create policy ldo_app_users_read on public.ldo_app_users for select to authenticated
  using (ldo_private.can_see_user(id));
create policy ldo_app_stores_read on public.ldo_app_stores for select to authenticated
  using (ldo_private.is_super() or ldo_private.store_level(id) is not null);
create policy ldo_app_user_stores_read on public.ldo_app_user_stores for select to authenticated
  using (user_id = ldo_private.current_user_id() or ldo_private.store_level(store_id) = 'manager');
create policy ldo_store_sales_read on public.ldo_store_sales for select to authenticated
  using (ldo_private.store_level(store_id) is not null);
create policy ldo_store_sales_history_read on public.ldo_store_sales_history for select to authenticated
  using (ldo_private.store_level(store_id) = 'manager');
create policy ldo_app_audit_read on public.ldo_app_audit for select to authenticated
  using (ldo_private.is_super());

-- Dados da loja online: quem tem acesso Loja Online (ou Super Admin) passa a ler os fechos BI.
create policy ldo_bi_online_read on public.ldo_bi_daily for select to authenticated using (ldo_private.has_online());
create policy ldo_bi_online_read on public.ldo_bi_datasets for select to authenticated using (ldo_private.has_online());
create policy ldo_bi_online_read on public.ldo_bi_quality for select to authenticated using (ldo_private.has_online());
create policy ldo_bi_online_read on public.ldo_bi_raw for select to authenticated using (ldo_private.has_online());
create policy ldo_bi_online_read on public.ldo_bi_reports for select to authenticated using (ldo_private.has_online());
create policy ldo_bi_online_read on public.ldo_bi_runs for select to authenticated using (ldo_private.has_online());

-- ---------------------------------------------------------------- perfil da sessão

create function public.ldo_me() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', u.id,
    'email', u.email,
    'full_name', u.full_name,
    'is_super_admin', u.is_super_admin,
    'online_access', u.online_access or u.is_super_admin,
    'stores', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'code', s.code, 'name', s.name, 'level', l.level)
        order by s.sort_order, s.name)
      from public.ldo_app_stores s
      cross join lateral (select ldo_private.store_level(s.id) as level) l
      where s.active and l.level is not null
    ), '[]'::jsonb)
  )
  from public.ldo_app_users u
  where u.auth_user_id = (select auth.uid()) and u.active;
$$;

-- Chamada logo após o login Google: liga a conta ao convite pelo email confirmado.
create function public.ldo_claim_login() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text;
  v_id uuid;
begin
  if v_uid is null then
    return null;
  end if;
  select id into v_id from public.ldo_app_users where auth_user_id = v_uid and active;
  if v_id is null then
    select lower(email) into v_email from auth.users where id = v_uid and email_confirmed_at is not null;
    if v_email is null then
      return null;
    end if;
    update public.ldo_app_users set auth_user_id = v_uid
      where email = v_email and auth_user_id is null and active
      returning id into v_id;
    if v_id is null then
      return null;
    end if;
  end if;
  update public.ldo_app_users set last_login_at = now() where id = v_id;
  return public.ldo_me();
end;
$$;

-- ---------------------------------------------------------------- gestão de utilizadores

-- p_stores: [{"store_id": "...", "level": "manager"|"store"}]
-- Super Admin: tudo. Gestor: apenas utilizadores de nível Loja, só nas lojas que gere.
create function public.ldo_save_user(
  p_user_id uuid,
  p_email text,
  p_full_name text,
  p_is_super_admin boolean,
  p_online_access boolean,
  p_active boolean,
  p_stores jsonb
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := ldo_private.current_user_id();
  v_super boolean := ldo_private.is_super();
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_name text := nullif(btrim(coalesce(p_full_name, '')), '');
  v_target public.ldo_app_users;
  v_managed uuid[];
  v_id uuid;
  v_item jsonb;
begin
  if v_me is null then
    raise exception 'Sessão inválida.' using errcode = '42501';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Email inválido.' using errcode = '22023';
  end if;
  p_stores := coalesce(p_stores, '[]'::jsonb);
  if jsonb_typeof(p_stores) <> 'array' then
    raise exception 'Lista de lojas inválida.' using errcode = '22023';
  end if;
  for v_item in select * from jsonb_array_elements(p_stores) loop
    if coalesce(v_item ->> 'level', '') not in ('manager', 'store')
      or not exists (select 1 from public.ldo_app_stores where id = (v_item ->> 'store_id')::uuid) then
      raise exception 'Loja ou nível inválido.' using errcode = '22023';
    end if;
  end loop;

  if p_user_id is not null then
    select * into v_target from public.ldo_app_users where id = p_user_id;
    if v_target.id is null then
      raise exception 'Utilizador não encontrado.' using errcode = 'P0002';
    end if;
  elsif exists (select 1 from public.ldo_app_users where email = v_email) then
    raise exception 'Já existe um utilizador com este email.' using errcode = '23505';
  end if;

  if not v_super then
    select array_agg(us.store_id) into v_managed
    from public.ldo_app_user_stores us join public.ldo_app_stores s on s.id = us.store_id
    where us.user_id = v_me and us.level = 'manager' and s.active;
    if v_managed is null then
      raise exception 'Sem permissão para gerir utilizadores.' using errcode = '42501';
    end if;
    if coalesce(p_is_super_admin, false) or coalesce(p_online_access, false) then
      raise exception 'Só o Super Admin pode dar acesso Super Admin ou Loja Online.' using errcode = '42501';
    end if;
    if jsonb_array_length(p_stores) = 0 then
      raise exception 'Escolha pelo menos uma loja.' using errcode = '22023';
    end if;
    if exists (
      select 1 from jsonb_array_elements(p_stores) e
      where e ->> 'level' <> 'store' or not ((e ->> 'store_id')::uuid = any (v_managed))
    ) then
      raise exception 'Um Gestor só pode dar o nível Loja nas lojas que gere.' using errcode = '42501';
    end if;
    if p_user_id is not null then
      if p_user_id = v_me then
        raise exception 'Não pode alterar as suas próprias permissões.' using errcode = '42501';
      end if;
      if v_target.is_super_admin or v_target.online_access or exists (
        select 1 from public.ldo_app_user_stores us
        where us.user_id = p_user_id and (us.level <> 'store' or not (us.store_id = any (v_managed)))
      ) then
        raise exception 'Este utilizador tem acessos fora das suas lojas. Peça ao Super Admin.' using errcode = '42501';
      end if;
    end if;
  elsif p_user_id is not null and v_target.is_super_admin and v_target.active
    and not (coalesce(p_is_super_admin, false) and coalesce(p_active, true))
    and not exists (
      select 1 from public.ldo_app_users
      where is_super_admin and active and id <> p_user_id
    ) then
    raise exception 'Tem de existir sempre pelo menos um Super Admin ativo.' using errcode = '42501';
  end if;

  if p_user_id is null then
    insert into public.ldo_app_users (email, full_name, is_super_admin, online_access, active, invited_by, updated_by)
    values (v_email, v_name, coalesce(p_is_super_admin, false), coalesce(p_online_access, false),
      coalesce(p_active, true), v_me, v_me)
    returning id into v_id;
  else
    v_id := p_user_id;
    if v_email <> v_target.email and exists (select 1 from public.ldo_app_users where email = v_email and id <> v_id) then
      raise exception 'Já existe um utilizador com este email.' using errcode = '23505';
    end if;
    update public.ldo_app_users set
      email = v_email,
      full_name = v_name,
      is_super_admin = coalesce(p_is_super_admin, false),
      online_access = coalesce(p_online_access, false),
      active = coalesce(p_active, true),
      -- Um email novo tem de voltar a entrar com a conta Google desse email.
      auth_user_id = case when v_email = v_target.email then auth_user_id else null end,
      updated_by = v_me,
      updated_at = now()
    where id = v_id;
  end if;

  delete from public.ldo_app_user_stores where user_id = v_id;
  insert into public.ldo_app_user_stores (user_id, store_id, level, granted_by)
  select distinct on ((e ->> 'store_id')::uuid) v_id, (e ->> 'store_id')::uuid, e ->> 'level', v_me
  from jsonb_array_elements(p_stores) e;

  insert into public.ldo_app_audit (actor, action, target, details)
  values (v_me, case when p_user_id is null then 'user.create' else 'user.update' end, v_id,
    jsonb_build_object('email', v_email, 'super', coalesce(p_is_super_admin, false),
      'online', coalesce(p_online_access, false), 'active', coalesce(p_active, true), 'stores', p_stores));
  return v_id;
end;
$$;

create function public.ldo_save_store(
  p_store_id uuid,
  p_code text,
  p_name text,
  p_city text,
  p_active boolean,
  p_sort_order integer
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := ldo_private.current_user_id();
  v_id uuid;
begin
  if v_me is null or not ldo_private.is_super() then
    raise exception 'Só o Super Admin pode gerir lojas.' using errcode = '42501';
  end if;
  if p_store_id is null then
    insert into public.ldo_app_stores (code, name, city, active, sort_order, created_by)
    values (lower(btrim(p_code)), btrim(p_name), nullif(btrim(coalesce(p_city, '')), ''),
      coalesce(p_active, true), coalesce(p_sort_order, 100), v_me)
    returning id into v_id;
  else
    update public.ldo_app_stores set
      code = lower(btrim(p_code)), name = btrim(p_name), city = nullif(btrim(coalesce(p_city, '')), ''),
      active = coalesce(p_active, true), sort_order = coalesce(p_sort_order, 100), updated_at = now()
    where id = p_store_id
    returning id into v_id;
    if v_id is null then
      raise exception 'Loja não encontrada.' using errcode = 'P0002';
    end if;
  end if;
  insert into public.ldo_app_audit (actor, action, target, details)
  values (v_me, case when p_store_id is null then 'store.create' else 'store.update' end, v_id,
    jsonb_build_object('code', lower(btrim(p_code)), 'name', btrim(p_name), 'active', coalesce(p_active, true)));
  return v_id;
end;
$$;

-- ---------------------------------------------------------------- vendas diárias

-- Loja: lança dias dos últimos 31 dias e corrige o próprio registo nas 24 h seguintes
-- (enquanto o Gestor não o tiver corrigido).
-- Gestor / Super Admin: lança e corrige qualquer dia das suas lojas.
create function public.ldo_save_store_sale(
  p_store_id uuid,
  p_sale_date date,
  p_total_sales numeric,
  p_receipts integer,
  p_items integer,
  p_cash numeric,
  p_card numeric,
  p_other_payment numeric,
  p_notes text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := ldo_private.current_user_id();
  v_level text := ldo_private.store_level(p_store_id);
  v_today date := (now() at time zone 'Europe/Lisbon')::date;
  v_old public.ldo_store_sales;
  v_new public.ldo_store_sales;
begin
  if v_me is null or v_level is null then
    raise exception 'Sem permissão para esta loja.' using errcode = '42501';
  end if;
  if p_sale_date is null or p_sale_date > v_today then
    raise exception 'A data não pode ser futura.' using errcode = '22023';
  end if;
  if v_level = 'store' and p_sale_date < v_today - 31 then
    raise exception 'Datas com mais de 31 dias só podem ser lançadas pelo Gestor.' using errcode = '42501';
  end if;
  if p_total_sales is null or p_total_sales < 0 then
    raise exception 'Indique o total de vendas.' using errcode = '22023';
  end if;

  select * into v_old from public.ldo_store_sales where store_id = p_store_id and sale_date = p_sale_date for update;
  if v_old.id is null then
    insert into public.ldo_store_sales (store_id, sale_date, total_sales, receipts, items, cash, card, other_payment, notes, created_by)
    values (p_store_id, p_sale_date, p_total_sales, p_receipts, p_items, p_cash, p_card, p_other_payment,
      nullif(btrim(coalesce(p_notes, '')), ''), v_me)
    returning * into v_new;
  else
    -- A Loja não altera um registo que o Gestor já corrigiu.
    if v_level = 'store' and not (
      v_old.created_by = v_me
      and v_old.created_at > now() - interval '24 hours'
      and (v_old.updated_by is null or v_old.updated_by = v_me)
    ) then
      raise exception 'Este dia já foi lançado. Para corrigir, contacte o Gestor da loja.' using errcode = '42501';
    end if;
    update public.ldo_store_sales set
      total_sales = p_total_sales, receipts = p_receipts, items = p_items, cash = p_cash, card = p_card,
      other_payment = p_other_payment, notes = nullif(btrim(coalesce(p_notes, '')), ''),
      updated_by = v_me, updated_at = now()
    where id = v_old.id
    returning * into v_new;
  end if;

  insert into public.ldo_store_sales_history (sale_id, store_id, sale_date, action, changed_by, before, after)
  values (v_new.id, p_store_id, p_sale_date, case when v_old.id is null then 'create' else 'update' end, v_me,
    case when v_old.id is null then null else to_jsonb(v_old) end, to_jsonb(v_new));
  return v_new.id;
end;
$$;

create function public.ldo_delete_store_sale(p_sale_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := ldo_private.current_user_id();
  v_old public.ldo_store_sales;
begin
  select * into v_old from public.ldo_store_sales where id = p_sale_id for update;
  if v_me is null or v_old.id is null or ldo_private.store_level(v_old.store_id) is distinct from 'manager' then
    raise exception 'Só o Gestor da loja pode apagar registos.' using errcode = '42501';
  end if;
  delete from public.ldo_store_sales where id = p_sale_id;
  insert into public.ldo_store_sales_history (sale_id, store_id, sale_date, action, changed_by, before, after)
  values (v_old.id, v_old.store_id, v_old.sale_date, 'delete', v_me, to_jsonb(v_old), null);
end;
$$;

-- Lançamentos de uma loja com o nome de quem lançou/corrigiu (a Loja não lê a tabela de utilizadores).
create function public.ldo_store_sales_list(p_store_id uuid, p_from date, p_to date)
returns table (
  id uuid, sale_date date, total_sales numeric, receipts integer, items integer, cash numeric, card numeric,
  other_payment numeric, notes text, created_by uuid, created_by_name text, created_at timestamptz,
  updated_by uuid, updated_by_name text, updated_at timestamptz
)
language sql stable security definer set search_path = '' as $$
  select s.id, s.sale_date, s.total_sales, s.receipts, s.items, s.cash, s.card, s.other_payment, s.notes,
    s.created_by, coalesce(c.full_name, split_part(c.email, '@', 1)), s.created_at,
    s.updated_by, coalesce(u.full_name, split_part(u.email, '@', 1)), s.updated_at
  from public.ldo_store_sales s
  join public.ldo_app_users c on c.id = s.created_by
  left join public.ldo_app_users u on u.id = s.updated_by
  where s.store_id = p_store_id and s.sale_date between p_from and p_to
    and ldo_private.store_level(p_store_id) is not null
  order by s.sale_date desc;
$$;

revoke all on function public.ldo_me(), public.ldo_claim_login(),
  public.ldo_save_user(uuid, text, text, boolean, boolean, boolean, jsonb),
  public.ldo_save_store(uuid, text, text, text, boolean, integer),
  public.ldo_save_store_sale(uuid, date, numeric, integer, integer, numeric, numeric, numeric, text),
  public.ldo_delete_store_sale(uuid), public.ldo_store_sales_list(uuid, date, date) from public, anon;
grant execute on function public.ldo_me(), public.ldo_claim_login(),
  public.ldo_save_user(uuid, text, text, boolean, boolean, boolean, jsonb),
  public.ldo_save_store(uuid, text, text, text, boolean, integer),
  public.ldo_save_store_sale(uuid, date, numeric, integer, integer, numeric, numeric, numeric, text),
  public.ldo_delete_store_sale(uuid), public.ldo_store_sales_list(uuid, date, date) to authenticated;

-- ---------------------------------------------------------------- dados iniciais

-- Primeiro Super Admin (o dono do projeto), ligado à conta que já existe.
insert into public.ldo_app_users (email, full_name, is_super_admin, online_access, auth_user_id)
select 'luis.rocha@lojadoouro.pt', 'Luís Rocha', true, true,
  (select id from auth.users where lower(email) = 'luis.rocha@lojadoouro.pt')
on conflict (email) do nothing;

-- Lojas iniciais copiadas da lista já existente no projeto; geridas a partir daqui no backoffice.
insert into public.ldo_app_stores (code, name, city, sort_order, active)
select s.slug,
  case when s.name like 'Loja do Ouro Premium — %' then regexp_replace(s.name, '^Loja do Ouro Premium — ', '') || ' (Premium)'
       else regexp_replace(s.name, '^Loja do Ouro — ', '') end,
  s.city, s.sort_order, s.active
from public.stores s
on conflict (code) do nothing;
