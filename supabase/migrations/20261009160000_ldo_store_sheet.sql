-- Lojas físicas: importação noturna da folha Google "Análise de Vendas" (um separador por loja) para ldo_shop_sales.
-- * Ligação Google só de leitura (spreadsheets.readonly), feita pelo Super Admin; chaves cifradas no servidor
--   (AES-256-GCM, SUPPORT_ENCRYPTION_KEY), como as do Gmail; nunca chegam ao browser.
-- * A folha não tem identificador de linha: a importação compara cada loja/dia com a última versão importada
--   (impressão digital do conteúdo) e, quando muda, substitui os registos da folha desse dia.
-- * Prioridades: um dia com registos do formulário fica com o formulário (os da folha saem); um dia com registos
--   da folha corrigidos ou apagados por um Gestor não é tocado (aparece no relatório da importação).
-- * Os registos importados em outubro ('import') vêm desta mesma folha e passam a ser geridos por ela ('sheet').
-- * Autor dos registos: o utilizador técnico importacao.excel (inativo, não entra no dashboard).

alter table public.ldo_shop_sales drop constraint ldo_shop_sales_source_check;
alter table public.ldo_shop_sales add constraint ldo_shop_sales_source_check check (source in ('form', 'import', 'sheet'));

create table public.ldo_store_sheet (
  id integer primary key default 1 check (id = 1),
  spreadsheet_id text not null default '1V4ChedmSAERZyx97YC1mDg9jHRMHfgcsYXGDqNg7f6E' check (spreadsheet_id ~ '^[A-Za-z0-9_-]{20,100}$'),
  email text check (length(email) <= 254),
  scope text,
  refresh_ct text,
  access_ct text,
  access_expires_at timestamptz,
  version integer not null default 1,
  refresh_lease_until timestamptz,
  status text not null default 'not_connected' check (status in ('not_connected', 'active', 'reconnect')),
  status_detail text,
  connected_by uuid references public.ldo_app_users (id) on delete set null,
  connected_at timestamptz,
  run_lease_until timestamptz,
  updated_at timestamptz not null default now()
);
insert into public.ldo_store_sheet (id) values (1);

create table public.ldo_store_sheet_days (
  store_id uuid not null references public.ldo_app_stores (id) on delete cascade,
  day date not null,
  hash text not null check (hash ~ '^[0-9a-f]{64}$'),
  rows integer not null check (rows >= 0),
  synced_at timestamptz not null default now(),
  primary key (store_id, day)
);

create table public.ldo_store_sheet_runs (
  id bigint generated always as identity primary key,
  trigger text not null check (length(trigger) <= 40),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running', 'completed', 'partial', 'failed')),
  days_changed integer not null default 0,
  rows_inserted integer not null default 0,
  rows_removed integer not null default 0,
  skipped jsonb not null default '[]'::jsonb check (jsonb_typeof(skipped) = 'array'),
  issues jsonb not null default '[]'::jsonb check (jsonb_typeof(issues) = 'array'),
  detail text check (length(detail) <= 2000)
);
create index ldo_store_sheet_runs_started_idx on public.ldo_store_sheet_runs (started_at desc);

alter table public.ldo_store_sheet enable row level security;
alter table public.ldo_store_sheet_days enable row level security;
alter table public.ldo_store_sheet_runs enable row level security;
revoke all on public.ldo_store_sheet, public.ldo_store_sheet_days, public.ldo_store_sheet_runs from anon, authenticated;

-- Super Admin pela sessão do dashboard.
create function ldo_private.sheet_super(p_session text) returns uuid
language sql stable security definer set search_path = '' as $$
  select u.id from public.ldo_app_users u
  where u.id = ldo_private.session_user_id(p_session) and u.active and u.is_super_admin;
$$;
revoke all on function ldo_private.sheet_super(text) from public, anon, authenticated;

-- Código de opção válido ou null (a folha nunca impede a importação de um registo por causa de uma opção).
create function ldo_private.option_or_null(p_list text, p_code text) returns text
language sql stable security definer set search_path = '' as $$
  select case when p_code is not null and exists (select 1 from public.ldo_options o where o.list = p_list and o.code = p_code)
    then p_code end;
$$;
revoke all on function ldo_private.option_or_null(text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------- Super Admin (sessão)

create function public.ldo_store_sheet_status(p_session text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if ldo_private.sheet_super(p_session) is null then
    raise exception 'Só o Super Admin gere a importação das lojas.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'connection', (select jsonb_build_object('spreadsheet_id', s.spreadsheet_id, 'email', s.email, 'status', s.status,
        'status_detail', s.status_detail, 'connected_at', s.connected_at,
        'connected_by', (select coalesce(u.full_name, u.username) from public.ldo_app_users u where u.id = s.connected_by),
        'running', s.run_lease_until > now())
      from public.ldo_store_sheet s where s.id = 1),
    'runs', coalesce((select jsonb_agg(to_jsonb(r) order by r.started_at desc)
      from (select * from public.ldo_store_sheet_runs order by started_at desc limit 15) r), '[]'::jsonb),
    'days', (select jsonb_build_object('count', count(*), 'from', min(day), 'to', max(day)) from public.ldo_store_sheet_days));
end;
$$;

create function public.ldo_store_sheet_save(p_session text, p_email text, p_scope text, p_refresh_ct text, p_access_ct text,
  p_access_expires_at timestamptz) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_me uuid := ldo_private.sheet_super(p_session);
begin
  if v_me is null then
    raise exception 'Só o Super Admin pode ligar a folha das lojas.' using errcode = '42501';
  end if;
  if p_refresh_ct is null or p_refresh_ct !~ '^v1\.' or p_access_ct is null or p_access_ct !~ '^v1\.' then
    raise exception 'Ligação inválida.' using errcode = '22023';
  end if;
  update public.ldo_store_sheet set email = lower(p_email), scope = p_scope, refresh_ct = p_refresh_ct, access_ct = p_access_ct,
    access_expires_at = p_access_expires_at, version = version + 1, refresh_lease_until = null, status = 'active',
    status_detail = null, connected_by = v_me, connected_at = now(), updated_at = now()
  where id = 1;
  insert into public.ldo_app_audit (actor, action, target, details)
  values (v_me, 'store_sheet.connect', 'ldo_store_sheet', jsonb_build_object('email', lower(p_email)));
end;
$$;

create function public.ldo_store_sheet_disconnect(p_session text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_me uuid := ldo_private.sheet_super(p_session);
begin
  if v_me is null then
    raise exception 'Só o Super Admin pode desligar a folha das lojas.' using errcode = '42501';
  end if;
  update public.ldo_store_sheet set email = null, scope = null, refresh_ct = null, access_ct = null, access_expires_at = null,
    version = version + 1, refresh_lease_until = null, status = 'not_connected', status_detail = null, connected_by = null,
    connected_at = null, updated_at = now()
  where id = 1;
  insert into public.ldo_app_audit (actor, action, target, details) values (v_me, 'store_sheet.disconnect', 'ldo_store_sheet', '{}'::jsonb);
end;
$$;

create function public.ldo_store_sheet_set_spreadsheet(p_session text, p_spreadsheet_id text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_me uuid := ldo_private.sheet_super(p_session);
begin
  if v_me is null then
    raise exception 'Só o Super Admin gere a importação das lojas.' using errcode = '42501';
  end if;
  if coalesce(p_spreadsheet_id, '') !~ '^[A-Za-z0-9_-]{20,100}$' then
    raise exception 'Identificador da folha inválido.' using errcode = '22023';
  end if;
  update public.ldo_store_sheet set spreadsheet_id = p_spreadsheet_id, updated_at = now() where id = 1;
  insert into public.ldo_app_audit (actor, action, target, details)
  values (v_me, 'store_sheet.spreadsheet', 'ldo_store_sheet', jsonb_build_object('spreadsheet_id', p_spreadsheet_id));
end;
$$;

-- ---------------------------------------------------------------- servidor (token)

create function public.ldo_store_sheet_get(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform ldo_private.bi_check(p_token);
  return (select to_jsonb(s) - 'run_lease_until' from public.ldo_store_sheet s where s.id = 1);
end;
$$;

create function public.ldo_store_sheet_claim(p_token text, p_version integer) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform ldo_private.bi_check(p_token);
  update public.ldo_store_sheet set refresh_lease_until = now() + interval '30 seconds'
  where id = 1 and version = p_version and status = 'active' and (refresh_lease_until is null or refresh_lease_until < now());
  return found;
end;
$$;

create function public.ldo_store_sheet_rotate(p_token text, p_version integer, p_access_ct text, p_access_expires_at timestamptz,
  p_refresh_ct text) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform ldo_private.bi_check(p_token);
  update public.ldo_store_sheet set access_ct = p_access_ct, access_expires_at = p_access_expires_at,
    refresh_ct = coalesce(p_refresh_ct, refresh_ct), version = version + 1, refresh_lease_until = null, updated_at = now()
  where id = 1 and version = p_version;
  return found;
end;
$$;

create function public.ldo_store_sheet_fail(p_token text, p_version integer, p_detail text) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform ldo_private.bi_check(p_token);
  update public.ldo_store_sheet set status = 'reconnect', status_detail = left(p_detail, 300), access_ct = null, refresh_ct = null,
    refresh_lease_until = null, version = version + 1, updated_at = now()
  where id = 1 and version = p_version;
end;
$$;

-- Uma importação de cada vez (10 minutos); devolve o id da execução ou null se outra estiver a correr.
create function public.ldo_store_sheet_run_begin(p_token text, p_trigger text) returns bigint
language plpgsql volatile security definer set search_path = '' as $$
declare v_id bigint;
begin
  perform ldo_private.bi_check(p_token);
  update public.ldo_store_sheet set run_lease_until = now() + interval '10 minutes'
  where id = 1 and (run_lease_until is null or run_lease_until < now());
  if not found then
    return null;
  end if;
  update public.ldo_store_sheet_runs set status = 'failed', finished_at = now(), detail = coalesce(detail, 'Interrompida.')
  where status = 'running' and started_at < now() - interval '10 minutes';
  insert into public.ldo_store_sheet_runs (trigger) values (left(coalesce(nullif(p_trigger, ''), 'manual'), 40)) returning id into v_id;
  return v_id;
end;
$$;

create function public.ldo_store_sheet_run_finish(p_token text, p_run bigint, p_status text, p_days_changed integer,
  p_rows_inserted integer, p_rows_removed integer, p_skipped jsonb, p_issues jsonb, p_detail text) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform ldo_private.bi_check(p_token);
  update public.ldo_store_sheet_runs set finished_at = now(),
    status = case when p_status in ('completed', 'partial', 'failed') then p_status else 'failed' end,
    days_changed = greatest(coalesce(p_days_changed, 0), 0), rows_inserted = greatest(coalesce(p_rows_inserted, 0), 0),
    rows_removed = greatest(coalesce(p_rows_removed, 0), 0),
    skipped = case when jsonb_typeof(p_skipped) = 'array' then p_skipped else '[]'::jsonb end,
    issues = case when jsonb_typeof(p_issues) = 'array' then p_issues else '[]'::jsonb end,
    detail = left(p_detail, 2000)
  where id = p_run;
  update public.ldo_store_sheet set run_lease_until = null where id = 1;
end;
$$;

-- O que já está importado: impressão digital por loja/dia, dias com registos da folha ou da importação de outubro
-- sem impressão digital, e os dias protegidos (formulário ou correções de um Gestor).
create function public.ldo_store_sheet_state(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform ldo_private.bi_check(p_token);
  return jsonb_build_object(
    'stores', coalesce((select jsonb_agg(jsonb_build_object('code', s.code, 'name', s.name, 'active', s.active)) from public.ldo_app_stores s), '[]'::jsonb),
    'days', coalesce((select jsonb_agg(jsonb_build_object('store_code', s.code, 'day', d.day, 'hash', d.hash))
      from public.ldo_store_sheet_days d join public.ldo_app_stores s on s.id = d.store_id), '[]'::jsonb),
    'imported', coalesce((select jsonb_agg(distinct jsonb_build_object('store_code', s.code, 'day', r.sale_date))
      from public.ldo_shop_sales r join public.ldo_app_stores s on s.id = r.store_id
      where r.source in ('sheet', 'import') and r.deleted_at is null), '[]'::jsonb),
    'protected', coalesce((select jsonb_agg(distinct jsonb_build_object('store_code', s.code, 'day', r.sale_date,
        'reason', case when r.source = 'form' then 'form' else 'edited' end))
      from public.ldo_shop_sales r join public.ldo_app_stores s on s.id = r.store_id
      where (r.source = 'form' and r.deleted_at is null)
        or (r.source in ('sheet', 'import') and (r.updated_by is not null or r.deleted_at is not null))), '[]'::jsonb));
end;
$$;

-- Aplica os dias que mudaram: p_days = [{store_code, day, hash, rows: [...] | null}] (rows null ou [] = o dia saiu da
-- folha). Cada dia é confirmado aqui, na mesma transação: com registos do formulário fica o formulário (os da folha
-- saem); com registos da folha corrigidos ou apagados por um Gestor não se toca. Devolve os números e os dias saltados.
create function public.ldo_store_sheet_apply(p_token text, p_days jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  d jsonb;
  v_store uuid;
  v_day date;
  v_actor uuid := (select id from public.ldo_app_users where username = 'importacao.excel');
  v_today date := (now() at time zone 'Europe/Lisbon')::date;
  v_changed integer := 0;
  v_inserted integer := 0;
  v_removed integer := 0;
  v_n integer;
  v_skipped jsonb := '[]'::jsonb;
begin
  perform ldo_private.bi_check(p_token);
  if v_actor is null then
    raise exception 'Utilizador técnico importacao.excel em falta.' using errcode = 'P0002';
  end if;
  for d in select value from jsonb_array_elements(case when jsonb_typeof(p_days) = 'array' then p_days else '[]'::jsonb end) loop
    select id into v_store from public.ldo_app_stores where code = d ->> 'store_code';
    v_day := case when coalesce(d ->> 'day', '') ~ '^\d{4}-\d{2}-\d{2}$' then (d ->> 'day')::date end;
    if v_store is null or v_day is null or v_day > v_today then
      v_skipped := v_skipped || jsonb_build_object('store_code', d ->> 'store_code', 'day', d ->> 'day', 'reason', 'invalid');
      continue;
    end if;
    perform pg_advisory_xact_lock(hashtext('ldo_store_sheet:' || v_store::text || ':' || v_day::text));
    -- Formulário: os registos da folha saem (sem dupla contagem) e o dia fica com o formulário.
    if exists (select 1 from public.ldo_shop_sales where store_id = v_store and sale_date = v_day and source = 'form' and deleted_at is null) then
      delete from public.ldo_shop_sales where store_id = v_store and sale_date = v_day and source in ('sheet', 'import')
        and updated_by is null and deleted_at is null;
      get diagnostics v_n = row_count;
      v_removed := v_removed + v_n;
      delete from public.ldo_store_sheet_days where store_id = v_store and day = v_day;
      v_skipped := v_skipped || jsonb_build_object('store_code', d ->> 'store_code', 'day', v_day, 'reason', 'form');
      continue;
    end if;
    -- Correções de um Gestor nos registos da folha: o dia não é tocado.
    if exists (select 1 from public.ldo_shop_sales where store_id = v_store and sale_date = v_day and source in ('sheet', 'import')
        and (updated_by is not null or deleted_at is not null)) then
      v_skipped := v_skipped || jsonb_build_object('store_code', d ->> 'store_code', 'day', v_day, 'reason', 'edited');
      continue;
    end if;
    delete from public.ldo_shop_sales where store_id = v_store and sale_date = v_day and source in ('sheet', 'import');
    get diagnostics v_n = row_count;
    v_removed := v_removed + v_n;
    if jsonb_typeof(d -> 'rows') = 'array' and jsonb_array_length(d -> 'rows') > 0 then
      insert into public.ldo_shop_sales (store_id, sale_date, sale_number, sold, total_value, campaign, campaign_code, client_type,
        seen_where, bought_online, purpose, restock, no_sale_reason, looking_for, notes, items, source, created_by, created_at)
      select v_store, v_day, left(nullif(btrim(r ->> 'sale_number'), ''), 40), coalesce((r ->> 'sold')::boolean, true),
        case when jsonb_typeof(r -> 'total_value') = 'number' and (r ->> 'total_value')::numeric >= 0
          then round((r ->> 'total_value')::numeric, 2) end,
        case when jsonb_typeof(r -> 'campaign') = 'boolean' then (r ->> 'campaign')::boolean end,
        ldo_private.option_or_null('campaign', r ->> 'campaign_code'),
        ldo_private.option_or_null('client_type', r ->> 'client_type'),
        ldo_private.option_or_null('seen_where', r ->> 'seen_where'),
        case when jsonb_typeof(r -> 'bought_online') = 'boolean' then (r ->> 'bought_online')::boolean end,
        ldo_private.option_or_null('purpose', r ->> 'purpose'),
        ldo_private.option_or_null('restock', r ->> 'restock'),
        ldo_private.option_or_null('no_sale_reason', r ->> 'no_sale_reason'),
        left(nullif(btrim(r ->> 'looking_for'), ''), 300), left(nullif(btrim(r ->> 'notes'), ''), 1000),
        coalesce((select jsonb_agg(jsonb_build_object('reference', left(nullif(btrim(i ->> 'reference'), ''), 40),
            'material', ldo_private.option_or_null('material', i ->> 'material'),
            'product_type', ldo_private.option_or_null('product_type', i ->> 'product_type')) order by n)
          from jsonb_array_elements(case when jsonb_typeof(r -> 'items') = 'array' then r -> 'items' else '[]'::jsonb end)
            with ordinality as it(i, n) where n <= 30), '[]'::jsonb),
        'sheet', v_actor, now()
      from jsonb_array_elements(d -> 'rows') r;
      get diagnostics v_n = row_count;
      v_inserted := v_inserted + v_n;
      insert into public.ldo_store_sheet_days (store_id, day, hash, rows, synced_at)
      values (v_store, v_day, d ->> 'hash', v_n, now())
      on conflict (store_id, day) do update set hash = excluded.hash, rows = excluded.rows, synced_at = now();
    else
      delete from public.ldo_store_sheet_days where store_id = v_store and day = v_day;
    end if;
    v_changed := v_changed + 1;
  end loop;
  return jsonb_build_object('changed', v_changed, 'inserted', v_inserted, 'removed', v_removed, 'skipped', v_skipped);
end;
$$;

revoke all on function
  public.ldo_store_sheet_status(text),
  public.ldo_store_sheet_save(text, text, text, text, text, timestamptz),
  public.ldo_store_sheet_disconnect(text),
  public.ldo_store_sheet_set_spreadsheet(text, text),
  public.ldo_store_sheet_get(text),
  public.ldo_store_sheet_claim(text, integer),
  public.ldo_store_sheet_rotate(text, integer, text, timestamptz, text),
  public.ldo_store_sheet_fail(text, integer, text),
  public.ldo_store_sheet_run_begin(text, text),
  public.ldo_store_sheet_run_finish(text, bigint, text, integer, integer, integer, jsonb, jsonb, text),
  public.ldo_store_sheet_state(text),
  public.ldo_store_sheet_apply(text, jsonb)
from public, authenticated;
grant execute on function
  public.ldo_store_sheet_status(text),
  public.ldo_store_sheet_save(text, text, text, text, text, timestamptz),
  public.ldo_store_sheet_disconnect(text),
  public.ldo_store_sheet_set_spreadsheet(text, text),
  public.ldo_store_sheet_get(text),
  public.ldo_store_sheet_claim(text, integer),
  public.ldo_store_sheet_rotate(text, integer, text, timestamptz, text),
  public.ldo_store_sheet_fail(text, integer, text),
  public.ldo_store_sheet_run_begin(text, text),
  public.ldo_store_sheet_run_finish(text, bigint, text, integer, integer, integer, jsonb, jsonb, text),
  public.ldo_store_sheet_state(text),
  public.ldo_store_sheet_apply(text, jsonb)
to anon;
