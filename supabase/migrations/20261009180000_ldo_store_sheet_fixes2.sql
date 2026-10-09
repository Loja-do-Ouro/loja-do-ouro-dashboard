-- Folha das lojas: correções da 2.ª verificação.
-- * Um registo da folha que um Gestor mudou de dia continua a proteger o dia de origem mesmo depois de a importação
--   o marcar como apagado (o dia de destino passou a ter formulário): senão a venda voltava a entrar no dia de
--   origem e contava duas vezes.
-- * Quando um dia volta a vir da folha depois de o formulário ser retirado, e uma correção de um Gestor nesse dia
--   tinha sido substituída pelo formulário, a execução regista-o ('correction_lost'); a correção fica no histórico.

-- Registo da folha corrigido por um Gestor e mudado de dia (apagado ou não).
create function ldo_private.sheet_moved(r public.ldo_shop_sales) returns boolean
language sql immutable set search_path = '' as $$
  select r.source in ('sheet', 'import') and r.updated_by is not null and r.sheet_day is distinct from r.sale_date;
$$;
revoke all on function ldo_private.sheet_moved(public.ldo_shop_sales) from public, anon, authenticated;

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
          cross join lateral (values (r.sale_date, ldo_private.sheet_edited(r, v_actor)),
            (r.sheet_day, ldo_private.sheet_edited(r, v_actor) or ldo_private.sheet_moved(r))) d(day, hit)
          where d.day is not null and d.hit
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
    if exists (select 1 from public.ldo_shop_sales r where r.store_id = v_store
        and ((r.sale_date = v_day and ldo_private.sheet_edited(r, v_actor))
          or (r.sheet_day = v_day and (ldo_private.sheet_edited(r, v_actor) or ldo_private.sheet_moved(r))))) then
      v_skipped := v_skipped || jsonb_build_object('store_code', d ->> 'store_code', 'day', v_day, 'reason', 'edited');
      continue;
    end if;
    -- O dia volta a vir da folha depois de o formulário ser retirado: uma correção de um Gestor que o formulário
    -- substituiu fica só no histórico. Avisa uma vez (na primeira reimportação, quando o dia ainda não tem hash).
    if exists (select 1 from public.ldo_shop_sales where store_id = v_store and sale_date = v_day and source in ('sheet', 'import')
        and deleted_by = v_actor and updated_by is not null)
      and not exists (select 1 from public.ldo_store_sheet_days where store_id = v_store and day = v_day) then
      v_skipped := v_skipped || jsonb_build_object('store_code', d ->> 'store_code', 'day', v_day, 'reason', 'correction_lost');
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
