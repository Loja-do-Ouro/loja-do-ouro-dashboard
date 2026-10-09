-- Folha das lojas: correções da revisão.
-- * sheet_day: o dia da folha de onde veio cada registo (sheet/import). Um Gestor pode mudar a data de um registo
--   da folha; o dia de origem fica também protegido, para a venda não voltar a entrar nesse dia (em duplicado).
-- * Um dia tem uma só razão de proteção: o formulário ganha. Os registos da folha corrigidos por um Gestor nesse
--   dia são marcados como apagados pela importação (com histórico); os restantes saem.
-- * O apply bloqueia os registos do dia antes de decidir, para não apagar uma correção de um Gestor que esteja a
--   ser gravada ao mesmo tempo, e nunca apaga registos corrigidos ou apagados.
-- * Mudar de folha desliga a ligação: a nova ligação confirma o acesso à nova folha.
-- * Auditoria: ldo_app_audit.target é um uuid (de utilizador ou loja); a ligação da folha não tem, fica null.

alter table public.ldo_shop_sales add column sheet_day date;
comment on column public.ldo_shop_sales.sheet_day is 'Dia da folha "Análise de Vendas" de onde veio o registo (sheet/import); não muda quando um Gestor corrige a data.';

-- Registos já importados: o dia antes da primeira correção da data, ou o dia atual.
update public.ldo_shop_sales r set sheet_day = coalesce(
    (select (h.before ->> 'sale_date')::date from public.ldo_record_history h
      where h.record_table = 'ldo_shop_sales' and h.record_id = r.id and h.before ? 'sale_date'
      order by h.changed_at, h.id limit 1),
    r.sale_date)
where r.source in ('sheet', 'import') and r.sheet_day is null;

create or replace function public.ldo_store_sheet_set_spreadsheet(p_session text, p_spreadsheet_id text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_me uuid := ldo_private.sheet_super(p_session);
begin
  if v_me is null then
    raise exception 'Só o Super Admin gere a importação das lojas.' using errcode = '42501';
  end if;
  if coalesce(p_spreadsheet_id, '') !~ '^[A-Za-z0-9_-]{20,100}$' then
    raise exception 'Identificador da folha inválido.' using errcode = '22023';
  end if;
  -- A autorização foi dada para a folha anterior: a ligação tem de ser feita de novo (e confirma o acesso).
  update public.ldo_store_sheet set spreadsheet_id = p_spreadsheet_id, email = null, scope = null, refresh_ct = null,
    access_ct = null, access_expires_at = null, version = version + 1, refresh_lease_until = null, status = 'not_connected',
    status_detail = null, connected_by = null, connected_at = null, updated_at = now()
  where id = 1 and spreadsheet_id is distinct from p_spreadsheet_id;
  if found then
    insert into public.ldo_app_audit (actor, action, target, details)
    values (v_me, 'store_sheet.spreadsheet', null, jsonb_build_object('spreadsheet_id', p_spreadsheet_id));
  end if;
end;
$$;

create or replace function public.ldo_store_sheet_save(p_session text, p_email text, p_scope text, p_refresh_ct text, p_access_ct text,
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
  values (v_me, 'store_sheet.connect', null, jsonb_build_object('email', lower(p_email)));
end;
$$;

create or replace function public.ldo_store_sheet_disconnect(p_session text) returns void
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
  insert into public.ldo_app_audit (actor, action, target, details) values (v_me, 'store_sheet.disconnect', null, '{}'::jsonb);
end;
$$;

-- Registos da folha corrigidos por um Gestor (ativos com updated_by) ou apagados por alguém que não a importação.
create function ldo_private.sheet_edited(r public.ldo_shop_sales, p_actor uuid) returns boolean
language sql immutable set search_path = '' as $$
  select r.source in ('sheet', 'import')
    and ((r.deleted_at is null and r.updated_by is not null) or (r.deleted_at is not null and r.deleted_by is distinct from p_actor));
$$;
revoke all on function ldo_private.sheet_edited(public.ldo_shop_sales, uuid) from public, anon, authenticated;

create or replace function public.ldo_store_sheet_state(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_actor uuid := (select id from public.ldo_app_users where username = 'importacao.excel');
begin
  perform ldo_private.bi_check(p_token);
  return jsonb_build_object(
    'stores', coalesce((select jsonb_agg(jsonb_build_object('code', s.code, 'name', s.name, 'active', s.active)) from public.ldo_app_stores s), '[]'::jsonb),
    'days', coalesce((select jsonb_agg(jsonb_build_object('store_code', s.code, 'day', d.day, 'hash', d.hash))
      from public.ldo_store_sheet_days d join public.ldo_app_stores s on s.id = d.store_id), '[]'::jsonb),
    'imported', coalesce((select jsonb_agg(distinct jsonb_build_object('store_code', s.code, 'day', r.sale_date))
      from public.ldo_shop_sales r join public.ldo_app_stores s on s.id = r.store_id
      where r.source in ('sheet', 'import') and r.deleted_at is null), '[]'::jsonb),
    -- Uma razão por dia: o formulário ganha. Os registos corrigidos protegem o dia atual e o dia de origem.
    'protected', coalesce((select jsonb_agg(jsonb_build_object('store_code', s.code, 'day', p.day, 'reason', p.reason))
      from (
        select x.store_id, x.day, case when bool_or(x.form) then 'form' else 'edited' end as reason
        from (
          select r.store_id, r.sale_date as day, true as form from public.ldo_shop_sales r
          where r.source = 'form' and r.deleted_at is null
          union all
          select r.store_id, d.day, false from public.ldo_shop_sales r
          cross join lateral (values (r.sale_date), (r.sheet_day)) d(day)
          where d.day is not null and ldo_private.sheet_edited(r, v_actor)
        ) x
        group by x.store_id, x.day
      ) p join public.ldo_app_stores s on s.id = p.store_id), '[]'::jsonb));
end;
$$;

create or replace function public.ldo_store_sheet_apply(p_token text, p_days jsonb) returns jsonb
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
  v_old public.ldo_shop_sales;
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
    -- Espera pelas correções e remoções em curso nos registos deste dia; as verificações seguintes já as veem.
    perform 1 from public.ldo_shop_sales where store_id = v_store and (sale_date = v_day or sheet_day = v_day) for update;

    -- Formulário: o dia fica só com o formulário. Os registos da folha saem; os corrigidos por um Gestor ficam
    -- marcados como apagados pela importação (com histórico, para se poder ver a correção).
    if exists (select 1 from public.ldo_shop_sales where store_id = v_store and sale_date = v_day and source = 'form' and deleted_at is null) then
      delete from public.ldo_shop_sales where store_id = v_store and sale_date = v_day and source in ('sheet', 'import')
        and updated_by is null and deleted_at is null;
      get diagnostics v_n = row_count;
      v_removed := v_removed + v_n;
      for v_old in select * from public.ldo_shop_sales where store_id = v_store and sale_date = v_day
          and source in ('sheet', 'import') and deleted_at is null loop
        update public.ldo_shop_sales set deleted_at = now(), deleted_by = v_actor where id = v_old.id;
        insert into public.ldo_record_history (record_table, record_id, store_id, action, changed_by, before)
        values ('ldo_shop_sales', v_old.id, v_old.store_id, 'delete', v_actor, to_jsonb(v_old));
        v_removed := v_removed + 1;
      end loop;
      delete from public.ldo_store_sheet_days where store_id = v_store and day = v_day;
      v_skipped := v_skipped || jsonb_build_object('store_code', d ->> 'store_code', 'day', v_day, 'reason', 'form');
      continue;
    end if;
    -- Correções de um Gestor nos registos da folha (neste dia ou vindos deste dia): o dia não é tocado.
    if exists (select 1 from public.ldo_shop_sales r where r.store_id = v_store and (r.sale_date = v_day or r.sheet_day = v_day)
        and ldo_private.sheet_edited(r, v_actor)) then
      v_skipped := v_skipped || jsonb_build_object('store_code', d ->> 'store_code', 'day', v_day, 'reason', 'edited');
      continue;
    end if;
    delete from public.ldo_shop_sales where store_id = v_store and sale_date = v_day and source in ('sheet', 'import')
      and updated_by is null and deleted_at is null;
    get diagnostics v_n = row_count;
    v_removed := v_removed + v_n;
    if jsonb_typeof(d -> 'rows') = 'array' and jsonb_array_length(d -> 'rows') > 0 then
      insert into public.ldo_shop_sales (store_id, sale_date, sheet_day, sale_number, sold, total_value, campaign, campaign_code,
        client_type, seen_where, bought_online, purpose, restock, no_sale_reason, looking_for, notes, items, source, created_by, created_at)
      select v_store, v_day, v_day, left(nullif(btrim(r ->> 'sale_number'), ''), 40), coalesce((r ->> 'sold')::boolean, true),
        case when jsonb_typeof(r -> 'total_value') = 'number' and (r ->> 'total_value')::numeric between 0 and 9999999999.99
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
