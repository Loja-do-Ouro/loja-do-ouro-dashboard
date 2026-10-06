-- O servidor do dashboard (recolha noturna e leitura dos fechos) identifica-se com um token
-- próprio, guardado aqui só como hash. Dispensa a chave service_role, que dá acesso a tudo.
--   insert into ldo_private.bi_token values (1, extensions.digest('<BI_INGEST_TOKEN>', 'sha256'));
create table ldo_private.bi_token (id integer primary key check (id = 1), token_hash bytea not null);
revoke all on ldo_private.bi_token from public, anon, authenticated;

create function ldo_private.bi_token_ok(p_token text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from ldo_private.bi_token where token_hash = extensions.digest(coalesce(p_token, ''), 'sha256'));
$$;
revoke all on function ldo_private.bi_token_ok(text) from public, anon, authenticated;

create function ldo_private.bi_check(p_token text) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not ldo_private.bi_token_ok(p_token) then
    raise exception 'Sem permissão.' using errcode = '42501';
  end if;
end;
$$;
revoke all on function ldo_private.bi_check(text) from public, anon, authenticated;

-- Leitura dos fechos de um intervalo (as mesmas consultas que o dashboard fazia por REST).
create function public.ldo_bi_read(p_token text, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform ldo_private.bi_check(p_token);
  if p_to - p_from > 800 then
    raise exception 'Intervalo demasiado longo.' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'daily', coalesce((select jsonb_agg(jsonb_build_object('source', d.source, 'metric_date', d.metric_date, 'metrics', d.metrics,
      'fetched_at', d.fetched_at, 'status', d.status, 'run_id', d.run_id) order by d.source, d.metric_date)
      from public.ldo_bi_daily d where d.metric_date between p_from and p_to), '[]'::jsonb),
    'datasets', coalesce((select jsonb_agg(jsonb_build_object('source', x.source, 'dataset', x.dataset, 'period_start', x.period_start,
      'period_end', x.period_end, 'rows', x.rows, 'metadata', x.metadata, 'fetched_at', x.fetched_at, 'status', x.status, 'run_id', x.run_id)
      order by x.source, x.dataset, x.period_start, x.period_end)
      from public.ldo_bi_datasets x where x.period_start >= p_from and x.period_end <= p_to), '[]'::jsonb),
    'quality', coalesce((select jsonb_agg(to_jsonb(q) order by q.created_at desc, q.id)
      from public.ldo_bi_quality q where q.metric_date between p_from and p_to), '[]'::jsonb),
    'reports', coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc, r.id)
      from public.ldo_bi_reports r where r.period_start >= p_from and r.period_end <= p_to), '[]'::jsonb),
    'runs', coalesce((select jsonb_agg(to_jsonb(u) order by u.started_at desc)
      from public.ldo_bi_runs u where u.started_at >= p_to::timestamptz), '[]'::jsonb)
  );
end;
$$;

-- Gravação: só as três tabelas de factos, sempre por upsert na chave natural.
create function public.ldo_bi_write(p_token text, p_table text, p_rows jsonb) returns integer
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
    on conflict (source, metric_date) do update set metrics = excluded.metrics, fetched_at = excluded.fetched_at,
      status = excluded.status, run_id = excluded.run_id;
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

create function public.ldo_bi_start_run(p_token text, p_trigger text, p_notes text) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform ldo_private.bi_check(p_token);
  insert into public.ldo_bi_runs (trigger_type, status, notes) values (left(p_trigger, 40), 'running', left(p_notes, 4000))
  returning id into v_id;
  return v_id;
end;
$$;

create function public.ldo_bi_finish_run(p_token text, p_id uuid, p_status text, p_notes text) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform ldo_private.bi_check(p_token);
  if p_status not in ('completed', 'partial', 'failed') then
    raise exception 'Estado inválido.' using errcode = '22023';
  end if;
  update public.ldo_bi_runs set status = p_status, notes = left(p_notes, 4000), completed_at = now() where id = p_id;
end;
$$;

-- Uma recolha "em curso" há horas foi interrompida; fica marcada como falhada.
create function public.ldo_bi_close_stale_runs(p_token text, p_hours integer) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform ldo_private.bi_check(p_token);
  update public.ldo_bi_runs set status = 'failed', completed_at = now()
  where status = 'running' and started_at < now() - make_interval(hours => greatest(coalesce(p_hours, 6), 1));
end;
$$;

revoke all on function public.ldo_bi_read(text, date, date), public.ldo_bi_write(text, text, jsonb),
  public.ldo_bi_start_run(text, text, text), public.ldo_bi_finish_run(text, uuid, text, text),
  public.ldo_bi_close_stale_runs(text, integer) from public, authenticated;
grant execute on function public.ldo_bi_read(text, date, date), public.ldo_bi_write(text, text, jsonb),
  public.ldo_bi_start_run(text, text, text), public.ldo_bi_finish_run(text, uuid, text, text),
  public.ldo_bi_close_stale_runs(text, integer) to anon;
