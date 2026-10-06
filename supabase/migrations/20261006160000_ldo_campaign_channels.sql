-- Destino do investimento em anúncios: online, loja física ou partilhado.
-- Por omissão uma campanha é da loja cuja palavra-chave (ldo_app_stores.ads_keyword) aparece no
-- nome; as restantes são do online. Esta tabela guarda só as exceções definidas pelo Super Admin.
create table public.ldo_campaign_channels (
  source text not null check (source in ('meta', 'google_ads')),
  campaign text not null,
  channel text not null check (channel in ('auto', 'online', 'store', 'shared')),
  store_id uuid references public.ldo_app_stores (id),
  updated_by uuid references public.ldo_app_users (id),
  updated_at timestamptz not null default now(),
  primary key (source, campaign),
  check (channel <> 'store' or store_id is not null)
);
alter table public.ldo_campaign_channels enable row level security;
revoke all on public.ldo_campaign_channels from anon, authenticated;

create function ldo_private.channel_rules() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'stores', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'keyword', s.ads_keyword) order by s.sort_order)
      from public.ldo_app_stores s), '[]'::jsonb),
    'overrides', coalesce((select jsonb_agg(jsonb_build_object('source', c.source, 'campaign', c.campaign, 'channel', c.channel, 'store_id', c.store_id))
      from public.ldo_campaign_channels c where c.channel <> 'auto'), '[]'::jsonb));
$$;
revoke all on function ldo_private.channel_rules() from public, anon, authenticated;

create function public.ldo_list_campaign_channels(p_session text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_me uuid := ldo_private.session_user_id(p_session);
begin
  if v_me is null or not exists (select 1 from public.ldo_app_users u where u.id = v_me and u.active
      and (u.is_super_admin or u.online_access or exists (select 1 from jsonb_each_text(u.store_access) a(k, v) where v = 'manager'))) then
    raise exception 'Sem permissão.' using errcode = '42501';
  end if;
  return ldo_private.channel_rules();
end;
$$;

create function public.ldo_save_campaign_channel(p_session text, p_source text, p_campaign text, p_channel text, p_store_id uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare v_me uuid := ldo_private.session_user_id(p_session);
begin
  if v_me is null or not exists (select 1 from public.ldo_app_users where id = v_me and active and is_super_admin) then
    raise exception 'Só o Super Admin pode classificar campanhas.' using errcode = '42501';
  end if;
  if p_channel = 'store' and p_store_id is null then
    raise exception 'Escolha a loja da campanha.' using errcode = '22023';
  end if;
  insert into public.ldo_campaign_channels (source, campaign, channel, store_id, updated_by, updated_at)
  values (p_source, left(btrim(p_campaign), 300), p_channel, case when p_channel = 'store' then p_store_id end, v_me, now())
  on conflict (source, campaign) do update set channel = excluded.channel, store_id = excluded.store_id,
    updated_by = excluded.updated_by, updated_at = now();
end;
$$;

revoke all on function public.ldo_list_campaign_channels(text), public.ldo_save_campaign_channel(text, text, text, text, uuid) from public, authenticated;
grant execute on function public.ldo_list_campaign_channels(text), public.ldo_save_campaign_channel(text, text, text, text, uuid) to anon;

-- Os fechos lidos pelo servidor passam a trazer as regras de destino do investimento.
create or replace function public.ldo_bi_read(p_token text, p_from date, p_to date) returns jsonb
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
      from public.ldo_bi_runs u where u.started_at >= p_to::timestamptz), '[]'::jsonb),
    'channels', ldo_private.channel_rules()
  );
end;
$$;
