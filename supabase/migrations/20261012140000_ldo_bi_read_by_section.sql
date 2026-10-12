-- A leitura dos fechos trazia todos os conjuntos guardados do intervalo (~9 MB em outubro de 2026, quase tudo geografia
-- GA4 e anúncios Meta). Com várias visitas em simultâneo passava os 3 s do papel anon (57014) e, por ter mais de 2 MB,
-- nunca ficava na cache de dados do Next: cada visita voltava a ler tudo.
-- Agora cada secção pede só o que usa (lib/bi/read-plan.ts):
--   ldo_bi_read: diários, qualidade, relatórios, recolhas e regras, e só os conjuntos nomeados em p_datasets
--     ('fonte/conjunto', ou '*/conjunto' para todas as fontes) dentro do intervalo; sem p_datasets traz todos, como antes.
--   ldo_bi_read_detail: o detalhe de um período, exato (p_exact) ou recomposto por dias (p_daily).
-- As duas têm statement_timeout próprio: o PostgREST (12.2+, db-hoisted-tx-settings) aplica-o à transação do pedido,
-- por cima dos 3 s do papel anon.

-- Uma segunda função com o mesmo nome deixaria o PostgREST sem saber qual chamar; a antiga sai na mesma transação.
drop function public.ldo_bi_read(text, date, date);

create function public.ldo_bi_read(p_token text, p_from date, p_to date, p_datasets text[] default null) returns jsonb
language plpgsql stable security definer set search_path = '' set statement_timeout = '8s' as $$
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
      from public.ldo_bi_datasets x where x.period_start >= p_from and x.period_end <= p_to
        and (p_datasets is null or x.source || '/' || x.dataset = any(p_datasets) or '*/' || x.dataset = any(p_datasets))), '[]'::jsonb),
    'quality', coalesce((select jsonb_agg(to_jsonb(q) order by q.created_at desc, q.id)
      from public.ldo_bi_quality q where q.metric_date between p_from and p_to), '[]'::jsonb),
    'reports', coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc, r.id)
      from public.ldo_bi_reports r where r.period_start >= p_from and r.period_end <= p_to), '[]'::jsonb),
    'runs', coalesce((select jsonb_agg(to_jsonb(u) order by u.started_at desc)
      from public.ldo_bi_runs u where u.started_at >= p_to::timestamptz), '[]'::jsonb),
    'channels', ldo_private.channel_rules()
  );
end;
$$;

-- Detalhe de um período, como detail() em lib/bi/model.ts: o conjunto do período exato e, para os de p_daily, os dias
-- do período quando o exato não existe ou não é utilizável (estado failed, running ou partial, como usable() no modelo).
create function public.ldo_bi_read_detail(p_token text, p_from date, p_to date, p_exact text[], p_daily text[] default '{}')
returns jsonb
language plpgsql stable security definer set search_path = '' set statement_timeout = '8s' as $$
begin
  perform ldo_private.bi_check(p_token);
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 400 then
    raise exception 'Intervalo inválido.' using errcode = '22023';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('source', x.source, 'dataset', x.dataset, 'period_start', x.period_start,
      'period_end', x.period_end, 'rows', x.rows, 'metadata', x.metadata, 'fetched_at', x.fetched_at, 'status', x.status, 'run_id', x.run_id)
      order by x.source, x.dataset, x.period_start, x.period_end)
    from public.ldo_bi_datasets x
    where (x.period_start = p_from and x.period_end = p_to
        and x.source || '/' || x.dataset = any(coalesce(p_exact, '{}') || coalesce(p_daily, '{}')))
      or (x.period_start = x.period_end and x.period_start between p_from and p_to
        and x.source || '/' || x.dataset = any(p_daily)
        and not exists (select 1 from public.ldo_bi_datasets e
          where e.source = x.source and e.dataset = x.dataset and e.period_start = p_from and e.period_end = p_to
            and e.status not in ('failed', 'running', 'partial')))), '[]'::jsonb);
end;
$$;

revoke all on function public.ldo_bi_read(text, date, date, text[]), public.ldo_bi_read_detail(text, date, date, text[], text[])
  from public, authenticated;
grant execute on function public.ldo_bi_read(text, date, date, text[]), public.ldo_bi_read_detail(text, date, date, text[], text[])
  to anon;

-- Janelas móveis de 3 dias de uma recolha de setembro que já não corre: nada no dashboard as lê.
delete from public.ldo_bi_datasets where source = 'shopify' and dataset = 'orders_updated';
