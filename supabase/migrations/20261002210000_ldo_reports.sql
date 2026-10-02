-- Relatórios por email: quem os recebe, dias em que cada loja fecha, registo de envios.
-- Applied to the project as migrations ldo_reports, ldo_reports_lists, ldo_me_closed_weekdays and ldo_stores_closed_sunday.
alter table public.ldo_app_users add column receive_reports boolean not null default true;
alter table public.ldo_app_stores add column closed_weekdays integer[] not null default array[0]
  check (closed_weekdays <@ array[0, 1, 2, 3, 4, 5, 6]);

-- O servidor dos relatórios (tarefa agendada, sem sessão) identifica-se com um token cujo hash fica aqui:
--   insert into ldo_private.report_token values (1, extensions.digest('<REPORTS_TOKEN>', 'sha256'));
create table ldo_private.report_token (id integer primary key check (id = 1), token_hash bytea not null);
revoke all on ldo_private.report_token from public, anon, authenticated;

create table public.ldo_report_log (
  id bigint generated always as identity primary key,
  kind text not null,
  period_from date,
  period_to date,
  recipients text[] not null default '{}',
  status text not null check (status in ('sent', 'skipped', 'failed', 'preview')),
  detail text,
  created_at timestamptz not null default now()
);
alter table public.ldo_report_log enable row level security;
revoke all on public.ldo_report_log from anon, authenticated;

create function ldo_private.report_token_ok(p_token text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from ldo_private.report_token where token_hash = extensions.digest(coalesce(p_token, ''), 'sha256'));
$$;
revoke all on function ldo_private.report_token_ok(text) from public, anon, authenticated;

-- Tudo o que um relatório precisa, para todas as lojas, num só pedido.
create function public.ldo_report_snapshot(p_token text, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not ldo_private.report_token_ok(p_token) then
    raise exception 'Sem permissão.' using errcode = '42501';
  end if;
  if p_to - p_from > 800 then
    raise exception 'Intervalo demasiado longo.' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'stores', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'code', s.code, 'name', s.name, 'level', 'manager',
      'ads_keyword', s.ads_keyword, 'closed_weekdays', s.closed_weekdays) order by s.sort_order, s.name)
      from public.ldo_app_stores s where s.active), '[]'::jsonb),
    'options', coalesce((select jsonb_agg(jsonb_build_object('list', o.list, 'code', o.code, 'label', o.label,
      'sort_order', o.sort_order, 'active', o.active, 'digital', o.digital)) from public.ldo_options o), '[]'::jsonb),
    'sales', coalesce((select jsonb_agg(jsonb_build_object('store_id', x.store_id, 'sale_date', x.sale_date, 'sold', x.sold,
      'total_value', x.total_value, 'campaign', x.campaign, 'client_type', x.client_type, 'seen_where', x.seen_where,
      'bought_online', x.bought_online, 'items', x.items, 'created_at', x.created_at))
      from public.ldo_shop_sales x where x.deleted_at is null and x.sale_date between p_from and p_to), '[]'::jsonb),
    'gold', coalesce((select jsonb_agg(to_jsonb(g) - 'notes' - 'deleted_at' - 'deleted_by')
      from public.ldo_gold_entries g where g.deleted_at is null and g.entry_date between p_from and p_to), '[]'::jsonb),
    'gold_monthly', coalesce((select jsonb_agg(to_jsonb(m)) from public.ldo_gold_monthly m
      where m.month between date_trunc('month', p_from)::date and p_to), '[]'::jsonb),
    'recipients', coalesce((select jsonb_agg(jsonb_build_object('email', u.email, 'name', coalesce(u.full_name, u.username)))
      from public.ldo_app_users u where u.active and u.is_super_admin and u.receive_reports and u.email is not null), '[]'::jsonb)
  );
end;
$$;

create function public.ldo_report_log_add(p_token text, p_kind text, p_from date, p_to date, p_recipients text[], p_status text, p_detail text)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  if not ldo_private.report_token_ok(p_token) then
    raise exception 'Sem permissão.' using errcode = '42501';
  end if;
  insert into public.ldo_report_log (kind, period_from, period_to, recipients, status, detail)
  values (left(p_kind, 40), p_from, p_to, coalesce(p_recipients, '{}'), p_status, left(p_detail, 1000));
end;
$$;

create function public.ldo_list_report_log(p_session text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_me uuid := ldo_private.session_user_id(p_session);
begin
  if v_me is null or not exists (select 1 from public.ldo_app_users where id = v_me and is_super_admin) then
    raise exception 'Só o Super Admin vê os relatórios.' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(to_jsonb(l) order by l.created_at desc)
    from (select * from public.ldo_report_log order by created_at desc limit 60) l), '[]'::jsonb);
end;
$$;

-- Email e preferência de relatórios de um utilizador (Super Admin; ou a própria pessoa).
create function public.ldo_save_user_contact(p_session text, p_user_id uuid, p_email text, p_receive_reports boolean)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me uuid := ldo_private.session_user_id(p_session);
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
begin
  if v_me is null or not (p_user_id = v_me or exists (select 1 from public.ldo_app_users where id = v_me and is_super_admin)) then
    raise exception 'Sem permissão.' using errcode = '42501';
  end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Email inválido.' using errcode = '22023';
  end if;
  if v_email is not null and exists (select 1 from public.ldo_app_users where email = v_email and id <> p_user_id) then
    raise exception 'Este email já está associado a outro utilizador.' using errcode = '23505';
  end if;
  update public.ldo_app_users set email = v_email, receive_reports = coalesce(p_receive_reports, true), updated_at = now()
  where id = p_user_id;
end;
$$;

create function public.ldo_save_store_schedule(p_session text, p_store_id uuid, p_closed_weekdays integer[])
returns void language plpgsql volatile security definer set search_path = '' as $$
declare v_me uuid := ldo_private.session_user_id(p_session);
begin
  if v_me is null or not exists (select 1 from public.ldo_app_users where id = v_me and is_super_admin) then
    raise exception 'Só o Super Admin pode gerir lojas.' using errcode = '42501';
  end if;
  update public.ldo_app_stores set closed_weekdays = coalesce(p_closed_weekdays, '{}') where id = p_store_id;
end;
$$;

revoke all on function public.ldo_report_snapshot(text, date, date), public.ldo_report_log_add(text, text, date, date, text[], text, text),
  public.ldo_list_report_log(text), public.ldo_save_user_contact(text, uuid, text, boolean),
  public.ldo_save_store_schedule(text, uuid, integer[]) from public, authenticated;
grant execute on function public.ldo_report_snapshot(text, date, date), public.ldo_report_log_add(text, text, date, date, text[], text, text),
  public.ldo_list_report_log(text), public.ldo_save_user_contact(text, uuid, text, boolean),
  public.ldo_save_store_schedule(text, uuid, integer[]) to anon;

-- As listas do backoffice passam a mostrar o email/relatórios e os dias de fecho.
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
      'active', u.active,
      'store_access', case when v_super then u.store_access else (
        select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from jsonb_each_text(u.store_access) a(k, v)
        where k::uuid = any (v_managed)) end,
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
      'ads_keyword', s.ads_keyword, 'closed_weekdays', s.closed_weekdays,
      'managers', (select count(*) from public.ldo_app_users u where u.active and u.store_access ->> s.id::text = 'manager'),
      'staff', (select count(*) from public.ldo_app_users u where u.active and u.store_access ->> s.id::text = 'store')
    ) order by s.sort_order, s.name)
    from public.ldo_app_stores s
  ), '[]'::jsonb);
end;
$$;

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
