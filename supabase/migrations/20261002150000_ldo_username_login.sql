-- Login por utilizador e palavra-passe, sem Supabase Auth.
--
-- As palavras-passe ficam cifradas (bcrypt, pgcrypto) em ldo_app_users. ldo_login
-- devolve um token de sessão aleatório; só o seu hash fica em ldo_app_sessions.
-- Todas as funções recebem p_session e verificam a sessão e as permissões aqui,
-- por isso o dashboard só precisa da chave pública do projeto. As tabelas não
-- são acessíveis diretamente (anon/authenticated sem privilégios).
-- Apagar é sempre uma marca (deleted_at / revoked_at): nada se perde do histórico.

-- ---------------------------------------------------------------- tabelas

alter table public.ldo_app_users
  alter column email drop not null,
  add column username text unique check (username ~ '^[a-z0-9][a-z0-9._-]{2,39}$'),
  add column password_hash text,
  add column password_changed_at timestamptz,
  add column must_change_password boolean not null default false,
  add column failed_logins integer not null default 0,
  add column locked_until timestamptz,
  -- {"<store id>": "manager" | "store"}
  add column store_access jsonb not null default '{}'::jsonb check (jsonb_typeof(store_access) = 'object');

alter table public.ldo_store_sales
  add column deleted_at timestamptz,
  add column deleted_by uuid references public.ldo_app_users (id);

create table public.ldo_app_sessions (
  id uuid primary key default gen_random_uuid(),
  token_hash bytea not null unique,
  user_id uuid not null references public.ldo_app_users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);
create index ldo_app_sessions_user_idx on public.ldo_app_sessions (user_id);
alter table public.ldo_app_sessions enable row level security;

revoke all on public.ldo_app_users, public.ldo_app_stores, public.ldo_app_user_stores, public.ldo_store_sales,
  public.ldo_store_sales_history, public.ldo_app_audit, public.ldo_app_sessions from anon, authenticated;

-- ---------------------------------------------------------------- sessão e permissões

-- Sessões criadas antes da última mudança de palavra-passe deixam de valer.
create function ldo_private.session_user_id(p_session text) returns uuid
language sql stable security definer set search_path = '' as $$
  select u.id
  from public.ldo_app_sessions s
  join public.ldo_app_users u on u.id = s.user_id
  where s.token_hash = extensions.digest(coalesce(p_session, ''), 'sha256')
    and s.revoked_at is null and s.expires_at > now() and u.active
    and s.created_at >= coalesce(u.password_changed_at, '-infinity'::timestamptz);
$$;

-- 'manager', 'store' ou null. O Super Admin é Gestor de todas as lojas.
create function ldo_private.user_level(p_user uuid, p_store uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case when u.is_super_admin then 'manager' else u.store_access ->> p_store::text end
  from public.ldo_app_users u
  join public.ldo_app_stores s on s.id = p_store
  where u.id = p_user and u.active and (s.active or u.is_super_admin);
$$;

create function ldo_private.new_session(p_user uuid) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_token text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  insert into public.ldo_app_sessions (token_hash, user_id, expires_at)
  values (extensions.digest(v_token, 'sha256'), p_user, now() + interval '12 hours');
  return v_token;
end;
$$;

create function ldo_private.managed_stores(p_user uuid) returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(s.id), '{}')
  from public.ldo_app_users u
  join public.ldo_app_stores s on s.active
  where u.id = p_user and u.active and (u.is_super_admin or u.store_access ->> s.id::text = 'manager');
$$;

revoke all on function ldo_private.session_user_id(text), ldo_private.user_level(uuid, uuid),
  ldo_private.new_session(uuid), ldo_private.managed_stores(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- login

-- Cinco palavras-passe erradas bloqueiam a conta 15 minutos. Devolve o estado em vez
-- de dar erro, para que a contagem de falhas fique gravada.
create function public.ldo_login(p_username text, p_password text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_user public.ldo_app_users;
begin
  select * into v_user from public.ldo_app_users
  where username = lower(btrim(coalesce(p_username, ''))) and active;
  if v_user.id is null or v_user.password_hash is null then
    perform extensions.crypt(coalesce(p_password, ''), extensions.gen_salt('bf', 10));
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  if v_user.locked_until > now() then
    return jsonb_build_object('ok', false, 'reason', 'locked');
  end if;
  if extensions.crypt(coalesce(p_password, ''), v_user.password_hash) <> v_user.password_hash then
    update public.ldo_app_users set
      failed_logins = case when failed_logins + 1 >= 5 then 0 else failed_logins + 1 end,
      locked_until = case when failed_logins + 1 >= 5 then now() + interval '15 minutes' else locked_until end
    where id = v_user.id;
    return jsonb_build_object('ok', false, 'reason', case when v_user.failed_logins + 1 >= 5 then 'locked' else 'invalid' end);
  end if;
  update public.ldo_app_users set failed_logins = 0, locked_until = null, last_login_at = now() where id = v_user.id;
  return jsonb_build_object('ok', true, 'token', ldo_private.new_session(v_user.id), 'must_change_password', v_user.must_change_password);
end;
$$;

create function public.ldo_logout(p_session text) returns void
language sql volatile security definer set search_path = '' as $$
  update public.ldo_app_sessions set revoked_at = now()
  where token_hash = extensions.digest(coalesce(p_session, ''), 'sha256') and revoked_at is null;
$$;

create function public.ldo_me(p_session text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', u.id,
    'username', u.username,
    'full_name', u.full_name,
    'is_super_admin', u.is_super_admin,
    'online_access', u.online_access or u.is_super_admin,
    'must_change_password', u.must_change_password,
    'stores', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'code', s.code, 'name', s.name, 'level', l.level) order by s.sort_order, s.name)
      from public.ldo_app_stores s
      cross join lateral (select case when u.is_super_admin then 'manager' else u.store_access ->> s.id::text end as level) l
      where s.active and l.level is not null
    ), '[]'::jsonb)
  )
  from public.ldo_app_users u
  where u.id = ldo_private.session_user_id(p_session);
$$;

-- Termina as outras sessões e devolve um token novo para esta.
create function public.ldo_change_password(p_session text, p_current text, p_new text) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me uuid := ldo_private.session_user_id(p_session);
  v_hash text;
begin
  if v_me is null then
    raise exception 'Sessão inválida.' using errcode = '42501';
  end if;
  if length(coalesce(p_new, '')) < 8 then
    raise exception 'A nova palavra-passe tem de ter pelo menos 8 caracteres.' using errcode = '22023';
  end if;
  select password_hash into v_hash from public.ldo_app_users where id = v_me;
  if extensions.crypt(coalesce(p_current, ''), v_hash) <> v_hash then
    raise exception 'A palavra-passe atual não está correta.' using errcode = '22023';
  end if;
  update public.ldo_app_users set
    password_hash = extensions.crypt(p_new, extensions.gen_salt('bf', 10)),
    password_changed_at = now(), must_change_password = false
  where id = v_me;
  update public.ldo_app_sessions set revoked_at = now() where user_id = v_me and revoked_at is null;
  return ldo_private.new_session(v_me);
end;
$$;

-- ---------------------------------------------------------------- utilizadores e lojas

create function public.ldo_list_users(p_session text) returns jsonb
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
      'is_super_admin', u.is_super_admin,
      'online_access', u.online_access,
      'active', u.active,
      'store_access', case when v_super then u.store_access else (
        select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from jsonb_each_text(u.store_access) a(k, v)
        where k::uuid = any (v_managed)) end,
      -- A Gestor can only edit people whose access is entirely Loja level in the stores they manage.
      'editable', v_super or (
        u.id <> v_me and not u.is_super_admin and not u.online_access
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

-- p_stores: {"<store id>": "manager" | "store"}. p_password vazio mantém a atual.
-- Super Admin: tudo. Gestor: apenas utilizadores de nível Loja, só nas lojas que gere.
create function public.ldo_save_user(
  p_session text,
  p_user_id uuid,
  p_username text,
  p_full_name text,
  p_is_super_admin boolean,
  p_online_access boolean,
  p_active boolean,
  p_stores jsonb,
  p_password text,
  p_must_change boolean
) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me uuid := ldo_private.session_user_id(p_session);
  v_super boolean;
  v_managed uuid[];
  v_username text := lower(btrim(coalesce(p_username, '')));
  v_name text := nullif(btrim(coalesce(p_full_name, '')), '');
  v_password text := coalesce(p_password, '');
  v_target public.ldo_app_users;
  v_id uuid;
begin
  if v_me is null then
    raise exception 'Sessão inválida.' using errcode = '42501';
  end if;
  select is_super_admin into v_super from public.ldo_app_users where id = v_me;
  v_managed := ldo_private.managed_stores(v_me);
  if v_username !~ '^[a-z0-9][a-z0-9._-]{2,39}$' then
    raise exception 'Nome de utilizador inválido: 3 a 40 letras minúsculas, números, ponto, hífen ou _.' using errcode = '22023';
  end if;
  p_stores := coalesce(p_stores, '{}'::jsonb);
  if jsonb_typeof(p_stores) <> 'object' or exists (
    select 1 from jsonb_each_text(p_stores) a(k, v)
    where v not in ('manager', 'store')
      or not exists (select 1 from public.ldo_app_stores s where s.id::text = k)
  ) then
    raise exception 'Loja ou nível inválido.' using errcode = '22023';
  end if;
  if v_password <> '' and length(v_password) < 8 then
    raise exception 'A palavra-passe tem de ter pelo menos 8 caracteres.' using errcode = '22023';
  end if;

  if p_user_id is null then
    if v_password = '' then
      raise exception 'Indique uma palavra-passe inicial.' using errcode = '22023';
    end if;
  else
    select * into v_target from public.ldo_app_users where id = p_user_id;
    if v_target.id is null then
      raise exception 'Utilizador não encontrado.' using errcode = 'P0002';
    end if;
  end if;
  if exists (select 1 from public.ldo_app_users where username = v_username and id is distinct from p_user_id) then
    raise exception 'Já existe um utilizador com este nome.' using errcode = '23505';
  end if;

  if not v_super then
    if cardinality(v_managed) = 0 then
      raise exception 'Sem permissão para gerir utilizadores.' using errcode = '42501';
    end if;
    if coalesce(p_is_super_admin, false) or coalesce(p_online_access, false) then
      raise exception 'Só o Super Admin pode dar acesso Super Admin ou Loja Online.' using errcode = '42501';
    end if;
    if p_stores = '{}'::jsonb then
      raise exception 'Escolha pelo menos uma loja.' using errcode = '22023';
    end if;
    if exists (select 1 from jsonb_each_text(p_stores) a(k, v) where v <> 'store' or not (k::uuid = any (v_managed))) then
      raise exception 'Um Gestor só pode dar o nível Loja nas lojas que gere.' using errcode = '42501';
    end if;
    if p_user_id is not null and (p_user_id = v_me or v_target.is_super_admin or v_target.online_access or exists (
      select 1 from jsonb_each_text(v_target.store_access) a(k, v) where v <> 'store' or not (k::uuid = any (v_managed))
    )) then
      raise exception 'Este utilizador tem acessos fora das suas lojas. Peça ao Super Admin.' using errcode = '42501';
    end if;
  elsif p_user_id is not null and v_target.is_super_admin and v_target.active
    and not (coalesce(p_is_super_admin, false) and coalesce(p_active, true))
    and not exists (select 1 from public.ldo_app_users where is_super_admin and active and id <> p_user_id) then
    raise exception 'Tem de existir sempre pelo menos um Super Admin ativo.' using errcode = '42501';
  end if;

  if p_user_id is null then
    insert into public.ldo_app_users (username, full_name, is_super_admin, online_access, active, store_access,
      password_hash, password_changed_at, must_change_password, invited_by, updated_by)
    values (v_username, v_name, coalesce(p_is_super_admin, false), coalesce(p_online_access, false), coalesce(p_active, true),
      p_stores, extensions.crypt(v_password, extensions.gen_salt('bf', 10)), now(), coalesce(p_must_change, true), v_me, v_me)
    returning id into v_id;
  else
    update public.ldo_app_users set
      username = v_username,
      full_name = v_name,
      is_super_admin = coalesce(p_is_super_admin, false),
      online_access = coalesce(p_online_access, false),
      active = coalesce(p_active, true),
      store_access = p_stores,
      updated_by = v_me,
      updated_at = now()
    where id = p_user_id
    returning id into v_id;
    -- A new password ends the person's open sessions.
    if v_password <> '' then
      update public.ldo_app_users set
        password_hash = extensions.crypt(v_password, extensions.gen_salt('bf', 10)),
        password_changed_at = now(), must_change_password = coalesce(p_must_change, true),
        failed_logins = 0, locked_until = null
      where id = v_id;
    end if;
  end if;

  insert into public.ldo_app_audit (actor, action, target, details)
  values (v_me, case when p_user_id is null then 'user.create' else 'user.update' end, v_id,
    jsonb_build_object('username', v_username, 'super', coalesce(p_is_super_admin, false),
      'online', coalesce(p_online_access, false), 'active', coalesce(p_active, true), 'stores', p_stores,
      'password_reset', v_password <> ''));
  return v_id;
end;
$$;

create function public.ldo_list_stores(p_session text) returns jsonb
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
      'managers', (select count(*) from public.ldo_app_users u where u.active and u.store_access ->> s.id::text = 'manager'),
      'staff', (select count(*) from public.ldo_app_users u where u.active and u.store_access ->> s.id::text = 'store')
    ) order by s.sort_order, s.name)
    from public.ldo_app_stores s
  ), '[]'::jsonb);
end;
$$;

create function public.ldo_save_store(
  p_session text,
  p_store_id uuid,
  p_code text,
  p_name text,
  p_city text,
  p_active boolean,
  p_sort_order integer
) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me uuid := ldo_private.session_user_id(p_session);
  v_id uuid;
begin
  if v_me is null or not exists (select 1 from public.ldo_app_users where id = v_me and is_super_admin) then
    raise exception 'Só o Super Admin pode gerir lojas.' using errcode = '42501';
  end if;
  if exists (select 1 from public.ldo_app_stores where code = lower(btrim(p_code)) and id is distinct from p_store_id) then
    raise exception 'Já existe uma loja com este código.' using errcode = '23505';
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

create function public.ldo_store_sales_list(p_session text, p_store_id uuid, p_from date, p_to date)
returns table (
  id uuid, sale_date date, total_sales numeric, receipts integer, items integer, cash numeric, card numeric,
  other_payment numeric, notes text, created_by uuid, created_by_name text, created_at timestamptz,
  updated_by uuid, updated_by_name text, updated_at timestamptz
)
language sql stable security definer set search_path = '' as $$
  select s.id, s.sale_date, s.total_sales, s.receipts, s.items, s.cash, s.card, s.other_payment, s.notes,
    s.created_by, coalesce(c.full_name, c.username), s.created_at,
    s.updated_by, coalesce(u.full_name, u.username), s.updated_at
  from public.ldo_store_sales s
  join public.ldo_app_users c on c.id = s.created_by
  left join public.ldo_app_users u on u.id = s.updated_by
  where s.store_id = p_store_id and s.sale_date between p_from and p_to and s.deleted_at is null
    and ldo_private.user_level(ldo_private.session_user_id(p_session), p_store_id) is not null
  order by s.sale_date desc;
$$;

-- Loja: lança dias dos últimos 31 dias e corrige o próprio registo nas 24 h seguintes,
-- enquanto o Gestor não o tiver corrigido. Gestor / Super Admin: qualquer dia das suas lojas.
create function public.ldo_save_store_sale(
  p_session text,
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
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me uuid := ldo_private.session_user_id(p_session);
  v_level text := ldo_private.user_level(v_me, p_store_id);
  v_today date := (now() at time zone 'Europe/Lisbon')::date;
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
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
    values (p_store_id, p_sale_date, p_total_sales, p_receipts, p_items, p_cash, p_card, p_other_payment, v_notes, v_me)
    returning * into v_new;
  elsif v_old.deleted_at is not null then
    -- A day deleted by the Gestor can be launched again from scratch.
    update public.ldo_store_sales set
      total_sales = p_total_sales, receipts = p_receipts, items = p_items, cash = p_cash, card = p_card,
      other_payment = p_other_payment, notes = v_notes, created_by = v_me, created_at = now(),
      updated_by = null, updated_at = null, deleted_at = null, deleted_by = null
    where id = v_old.id
    returning * into v_new;
  else
    if v_level = 'store' and not (
      v_old.created_by = v_me
      and v_old.created_at > now() - interval '24 hours'
      and (v_old.updated_by is null or v_old.updated_by = v_me)
    ) then
      raise exception 'Este dia já foi lançado. Para corrigir, contacte o Gestor da loja.' using errcode = '42501';
    end if;
    update public.ldo_store_sales set
      total_sales = p_total_sales, receipts = p_receipts, items = p_items, cash = p_cash, card = p_card,
      other_payment = p_other_payment, notes = v_notes, updated_by = v_me, updated_at = now()
    where id = v_old.id
    returning * into v_new;
  end if;

  insert into public.ldo_store_sales_history (sale_id, store_id, sale_date, action, changed_by, before, after)
  values (v_new.id, p_store_id, p_sale_date,
    case when v_old.id is null or v_old.deleted_at is not null then 'create' else 'update' end, v_me,
    case when v_old.id is null then null else to_jsonb(v_old) end, to_jsonb(v_new));
  return v_new.id;
end;
$$;

-- Apagar marca o registo como apagado; os valores ficam no histórico.
create function public.ldo_remove_store_sale(p_session text, p_sale_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me uuid := ldo_private.session_user_id(p_session);
  v_old public.ldo_store_sales;
begin
  select * into v_old from public.ldo_store_sales where id = p_sale_id and deleted_at is null for update;
  if v_me is null or v_old.id is null or ldo_private.user_level(v_me, v_old.store_id) is distinct from 'manager' then
    raise exception 'Só o Gestor da loja pode apagar registos.' using errcode = '42501';
  end if;
  update public.ldo_store_sales set deleted_at = now(), deleted_by = v_me where id = p_sale_id;
  insert into public.ldo_store_sales_history (sale_id, store_id, sale_date, action, changed_by, before, after)
  values (v_old.id, v_old.store_id, v_old.sale_date, 'delete', v_me, to_jsonb(v_old), null);
end;
$$;

-- Comparação: só as lojas onde a pessoa é Gestor.
create function public.ldo_compare_sales(p_session text, p_from date, p_to date)
returns table (store_id uuid, sale_date date, total_sales numeric, receipts integer, items integer)
language sql stable security definer set search_path = '' as $$
  select s.store_id, s.sale_date, s.total_sales, s.receipts, s.items
  from public.ldo_store_sales s
  where s.deleted_at is null and s.sale_date between p_from and p_to and p_to - p_from <= 800
    and s.store_id = any (ldo_private.managed_stores(ldo_private.session_user_id(p_session)))
  order by s.sale_date;
$$;

-- ---------------------------------------------------------------- acessos

-- Só a chave pública (anon): as contas da outra aplicação neste projeto não precisam delas.

revoke all on function public.ldo_login(text, text), public.ldo_logout(text), public.ldo_me(text),
  public.ldo_change_password(text, text, text), public.ldo_list_users(text),
  public.ldo_save_user(text, uuid, text, text, boolean, boolean, boolean, jsonb, text, boolean),
  public.ldo_list_stores(text), public.ldo_save_store(text, uuid, text, text, text, boolean, integer),
  public.ldo_store_sales_list(text, uuid, date, date),
  public.ldo_save_store_sale(text, uuid, date, numeric, integer, integer, numeric, numeric, numeric, text),
  public.ldo_remove_store_sale(text, uuid), public.ldo_compare_sales(text, date, date) from public;
grant execute on function public.ldo_login(text, text), public.ldo_logout(text), public.ldo_me(text),
  public.ldo_change_password(text, text, text), public.ldo_list_users(text),
  public.ldo_save_user(text, uuid, text, text, boolean, boolean, boolean, jsonb, text, boolean),
  public.ldo_list_stores(text), public.ldo_save_store(text, uuid, text, text, text, boolean, integer),
  public.ldo_store_sales_list(text, uuid, date, date),
  public.ldo_save_store_sale(text, uuid, date, numeric, integer, integer, numeric, numeric, numeric, text),
  public.ldo_remove_store_sale(text, uuid), public.ldo_compare_sales(text, date, date) to anon;

-- As funções da versão com Supabase Auth deixam de estar acessíveis.
revoke all on function public.ldo_me(), public.ldo_claim_login(),
  public.ldo_save_store(uuid, text, text, text, boolean, integer),
  public.ldo_save_store_sale(uuid, date, numeric, integer, integer, numeric, numeric, numeric, text),
  public.ldo_store_sales_list(uuid, date, date), public.ldo_list_store_sales(uuid, date, date)
  from public, anon, authenticated;

-- O primeiro Super Admin recebe o utilizador luis.rocha; a palavra-passe temporária
-- é definida fora deste ficheiro e tem de ser mudada no primeiro acesso.
update public.ldo_app_users set username = 'luis.rocha', must_change_password = true
where email = 'luis.rocha@lojadoouro.pt' and username is null;
