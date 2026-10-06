-- Instagram e Facebook (Metricool) podem responder a uma ressincronização com campos em falta:
-- nesses casos junta-se ao que já estava guardado em vez de o substituir.
create or replace function public.ldo_bi_write(p_token text, p_table text, p_rows jsonb) returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare n integer;
begin
  perform ldo_private.bi_check(p_token);
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Linhas inválidas.' using errcode = '22023';
  end if;
  if p_table = 'ldo_bi_daily' then
    insert into public.ldo_bi_daily (source, metric_date, metrics, fetched_at, status, run_id)
    select r.source, r.metric_date, r.metrics, r.fetched_at, r.status, r.run_id
    from jsonb_to_recordset(p_rows) as r(source text, metric_date date, metrics jsonb, fetched_at timestamptz, status text, run_id uuid)
    on conflict (source, metric_date) do update set
      metrics = case when excluded.source in ('instagram', 'facebook_page') then public.ldo_bi_daily.metrics || excluded.metrics else excluded.metrics end,
      fetched_at = excluded.fetched_at, status = excluded.status, run_id = excluded.run_id;
  elsif p_table = 'ldo_bi_datasets' then
    insert into public.ldo_bi_datasets (source, dataset, period_start, period_end, rows, metadata, fetched_at, status, run_id)
    select r.source, r.dataset, r.period_start, r.period_end, r.rows, r.metadata, r.fetched_at, r.status, r.run_id
    from jsonb_to_recordset(p_rows) as r(source text, dataset text, period_start date, period_end date, rows jsonb, metadata jsonb,
      fetched_at timestamptz, status text, run_id uuid)
    on conflict (source, dataset, period_start, period_end) do update set rows = excluded.rows, metadata = excluded.metadata,
      fetched_at = excluded.fetched_at, status = excluded.status, run_id = excluded.run_id;
  elsif p_table = 'ldo_bi_quality' then
    insert into public.ldo_bi_quality (run_id, metric_date, code, severity, message, evidence)
    select r.run_id, r.metric_date, r.code, r.severity, r.message, coalesce(r.evidence, '{}'::jsonb)
    from jsonb_to_recordset(p_rows) as r(run_id uuid, metric_date date, code text, severity text, message text, evidence jsonb)
    on conflict (run_id, metric_date, code) do update set severity = excluded.severity, message = excluded.message,
      evidence = excluded.evidence;
  else
    raise exception 'Tabela não autorizada.' using errcode = '42501';
  end if;
  get diagnostics n = row_count;
  return n;
end;
$$;
