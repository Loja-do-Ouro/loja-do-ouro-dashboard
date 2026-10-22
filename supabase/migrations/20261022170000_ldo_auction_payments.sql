-- Leilão, fase 3: cauções e pagamentos pela easypay.
-- Caução: autorização (cativação) no cartão ou no MB WAY antes da primeira licitação nos lotes que a pedem; libertada
-- (void) depois do fecho para quem não ganhou e quando o vencedor paga; capturada se o vencedor não pagar no prazo.
-- Pagamento do lote ganho: Multibanco (entidade e referência), MB WAY ou cartão; ou registado pela equipa (transferência,
-- loja). O servidor (BI_INGEST_TOKEN) cria os pedidos na easypay e confirma sempre o estado lendo-o na easypay; a BD
-- guarda o estado e decide o que falta fazer.

alter table public.ldo_auc_settings
  add column hold_days integer not null default 5 check (hold_days between 1 and 7),
  add column payment_methods text[] not null default array['mb', 'mbw', 'cc']
    check (payment_methods <@ array['mb', 'mbw', 'cc'] and cardinality(payment_methods) >= 1);

alter table public.ldo_auc_deposits
  add column method text check (method is null or method in ('cc', 'mbw')),
  add column checkout_url text check (checkout_url is null or checkout_url ~ '^https://'),
  add column detail text check (detail is null or length(detail) <= 500),
  add column released_at timestamptz,
  add column captured_at timestamptz,
  add column lease_until timestamptz,
  add column attempts integer not null default 0;
create unique index ldo_auc_deposits_ref_idx on public.ldo_auc_deposits (provider_ref) where provider_ref is not null;

-- Pagamento do lote ganho (um por tentativa; só um pode ficar pago).
create table public.ldo_auc_payments (
  id uuid primary key default gen_random_uuid(),
  lot_id uuid not null references public.ldo_auc_lots (id) on delete restrict,
  customer_id uuid not null references public.ldo_auc_customers (id) on delete restrict,
  amount numeric(12,2) not null check (amount > 0),
  method text not null check (method in ('mb', 'mbw', 'cc', 'manual')),
  provider text not null default 'easypay' check (provider in ('easypay', 'manual')),
  provider_ref text,
  status text not null default 'pending' check (status in ('pending', 'paid', 'failed', 'cancelled')),
  entity text check (entity is null or entity ~ '^[0-9]{5}$'),
  reference text check (reference is null or reference ~ '^[0-9]{9}$'),
  checkout_url text check (checkout_url is null or checkout_url ~ '^https://'),
  expires_at timestamptz,
  paid_at timestamptz,
  detail text check (detail is null or length(detail) <= 500),
  created_by uuid references public.ldo_app_users (id) on delete set null,
  created_at timestamptz not null default now(),
  lease_until timestamptz
);
create unique index ldo_auc_payments_ref_idx on public.ldo_auc_payments (provider_ref) where provider_ref is not null;
create unique index ldo_auc_payments_paid_idx on public.ldo_auc_payments (lot_id) where status = 'paid';
create index ldo_auc_payments_lot_idx on public.ldo_auc_payments (lot_id, created_at desc);

alter table public.ldo_auc_payments enable row level security;
revoke all on public.ldo_auc_payments from anon, authenticated;

-- Novos avisos por email: caução cativa, pagamento recebido e caução retida.
alter table public.ldo_auc_outbox drop constraint ldo_auc_outbox_kind_check;
alter table public.ldo_auc_outbox add constraint ldo_auc_outbox_kind_check
  check (kind in ('outbid', 'extended', 'ending_soon', 'won', 'lost', 'reserve_not_met', 'withdrawn', 'deposit_held', 'paid', 'deposit_captured'));

-- ---------------------------------------------------------------- ajudas

-- Cliente da sessão que pode licitar/pagar (email confirmado, não colaborador).
create function ldo_private.auc_buyer(p_session text) returns public.ldo_auc_customers
language plpgsql stable security definer set search_path = '' as $$
declare v_c public.ldo_auc_customers;
begin
  select * into v_c from public.ldo_auc_customers where id = ldo_private.auc_customer(p_session);
  if v_c.id is null then
    raise exception 'Entre na sua conta para continuar.' using errcode = '42501';
  end if;
  if v_c.email_verified_at is null then
    raise exception 'Confirme o seu email antes de continuar.' using errcode = '42501';
  end if;
  if v_c.is_staff then
    raise exception 'Contas de colaboradores não podem licitar.' using errcode = '42501';
  end if;
  return v_c;
end;
$$;

-- Telemóvel para o MB WAY: o indicado ou o da conta, no formato +351912345678.
create function ldo_private.auc_mbway_phone(p_phone text, p_c public.ldo_auc_customers) returns text
language plpgsql immutable set search_path = '' as $$
declare v text := nullif(regexp_replace(coalesce(p_phone, ''), '[[:space:]().-]', '', 'g'), '');
begin
  if v is not null and v ~ '^9[0-9]{8}$' then
    v := '+351' || v;
  end if;
  v := coalesce(v, p_c.phone);
  if v is null or v !~ '^\+[1-9][0-9]{6,14}$' then
    raise exception 'Indique o telemóvel associado ao MB WAY (ex.: 912 345 678).' using errcode = '22023';
  end if;
  return v;
end;
$$;

revoke all on function ldo_private.auc_buyer(text), ldo_private.auc_mbway_phone(text, public.ldo_auc_customers)
  from public, anon, authenticated;

-- ---------------------------------------------------------------- caução

-- Pedido de caução para um lote: devolve os dados para o pedido de autorização na easypay.
create function public.ldo_auc_deposit_start(p_token text, p_session text, p_lot uuid, p_method text, p_phone text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_c public.ldo_auc_customers;
  v_l public.ldo_auc_lots;
  v_e public.ldo_auc_events;
  v_s public.ldo_auc_settings;
  v_amount numeric;
  v_phone text;
  v_id uuid;
begin
  perform ldo_private.bi_check(p_token);
  v_c := ldo_private.auc_buyer(p_session);
  select * into v_s from public.ldo_auc_settings where id = 1;
  select * into v_l from public.ldo_auc_lots where id = p_lot;
  select * into v_e from public.ldo_auc_events where id = v_l.event_id;
  if v_l.id is null or v_l.status <> 'ready' or v_e.status <> 'published' or now() >= v_l.close_at then
    raise exception 'Este lote não está aberto a licitações.' using errcode = '22023';
  end if;
  if p_method not in ('cc', 'mbw') or not (p_method = any (v_s.payment_methods)) then
    raise exception 'Escolha cartão ou MB WAY.' using errcode = '22023';
  end if;
  v_amount := ldo_private.auc_deposit_amount(v_l, v_s);
  if v_amount <= 0 then
    raise exception 'Este lote não pede caução.' using errcode = '22023';
  end if;
  if exists (select 1 from public.ldo_auc_deposits where customer_id = v_c.id and lot_id = p_lot and status = 'held') then
    return jsonb_build_object('status', 'held');
  end if;
  if p_method = 'mbw' then
    v_phone := ldo_private.auc_mbway_phone(p_phone, v_c);
  end if;
  update public.ldo_auc_deposits set status = 'failed', detail = 'Substituída por um novo pedido.', updated_at = now()
  where customer_id = v_c.id and lot_id = p_lot and status = 'pending';
  insert into public.ldo_auc_deposits (customer_id, lot_id, amount, status, provider, method)
  values (v_c.id, p_lot, v_amount, 'pending', 'easypay', p_method) returning id into v_id;
  return jsonb_build_object('status', 'new', 'id', v_id, 'amount', v_amount, 'method', p_method, 'phone', v_phone,
    'name', v_c.name, 'email', v_c.email, 'lot_title', v_l.title, 'lot_position', v_l.position, 'event_slug', v_e.slug);
end;
$$;

-- Resposta da easypay ao pedido (caução ou pagamento): referência, página do cartão, entidade/referência Multibanco.
-- Sem p_ref: o pedido falhou (p_data.error).
create function public.ldo_auc_provider_created(p_token text, p_kind text, p_id uuid, p_ref text, p_data jsonb) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform ldo_private.bi_check(p_token);
  if p_kind = 'deposit' then
    if p_ref is null then
      update public.ldo_auc_deposits set status = 'failed', detail = left(coalesce(p_data ->> 'error', 'Pedido recusado.'), 500), updated_at = now()
      where id = p_id and status = 'pending';
    else
      update public.ldo_auc_deposits set provider_ref = p_ref, checkout_url = nullif(p_data ->> 'url', ''), updated_at = now()
      where id = p_id and status = 'pending';
    end if;
  elsif p_kind = 'payment' then
    if p_ref is null then
      update public.ldo_auc_payments set status = 'failed', detail = left(coalesce(p_data ->> 'error', 'Pedido recusado.'), 500)
      where id = p_id and status = 'pending';
    else
      update public.ldo_auc_payments set provider_ref = p_ref, checkout_url = nullif(p_data ->> 'url', ''),
        entity = nullif(p_data ->> 'entity', ''), reference = nullif(p_data ->> 'reference', ''),
        expires_at = nullif(p_data ->> 'expires_at', '')::timestamptz
      where id = p_id and status = 'pending';
    end if;
  else
    raise exception 'Tipo inválido.' using errcode = '22023';
  end if;
end;
$$;

-- Estado lido na easypay (notificação ou verificação): authorised = caução cativa; paid = pago (ou caução capturada);
-- failed/error/deleted = falhou. Devolve o que mudou.
create function public.ldo_auc_provider_sync(p_token text, p_ref text, p_status text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_d public.ldo_auc_deposits;
  v_p public.ldo_auc_payments;
  v_s public.ldo_auc_settings;
begin
  perform ldo_private.bi_check(p_token);
  select * into v_s from public.ldo_auc_settings where id = 1;
  select * into v_d from public.ldo_auc_deposits where provider_ref = p_ref for update;
  if v_d.id is not null then
    if p_status = 'authorised' and v_d.status = 'pending' then
      update public.ldo_auc_deposits set status = 'held', expires_at = now() + make_interval(days => v_s.hold_days), updated_at = now()
      where id = v_d.id;
      insert into public.ldo_auc_outbox (kind, customer_id, lot_id, payload)
      values ('deposit_held', v_d.customer_id, v_d.lot_id, jsonb_build_object('amount', v_d.amount,
        'expires_at', now() + make_interval(days => v_s.hold_days)));
      return jsonb_build_object('kind', 'deposit', 'id', v_d.id, 'status', 'held');
    elsif p_status in ('failed', 'error', 'deleted') and v_d.status = 'pending' then
      update public.ldo_auc_deposits set status = 'failed', detail = 'Não autorizada.', updated_at = now() where id = v_d.id;
      return jsonb_build_object('kind', 'deposit', 'id', v_d.id, 'status', 'failed');
    end if;
    return jsonb_build_object('kind', 'deposit', 'id', v_d.id, 'status', v_d.status, 'unchanged', true);
  end if;
  select * into v_p from public.ldo_auc_payments where provider_ref = p_ref for update;
  if v_p.id is not null then
    if p_status = 'paid' and v_p.status in ('pending', 'failed', 'cancelled')
       and not exists (select 1 from public.ldo_auc_payments where lot_id = v_p.lot_id and status = 'paid') then
      update public.ldo_auc_payments set status = 'paid', paid_at = now(), detail = null where id = v_p.id;
      update public.ldo_auc_payments set status = 'cancelled' where lot_id = v_p.lot_id and status = 'pending' and id <> v_p.id;
      insert into public.ldo_auc_outbox (kind, customer_id, lot_id, payload)
      values ('paid', v_p.customer_id, v_p.lot_id, jsonb_build_object('amount', v_p.amount, 'method', v_p.method));
      return jsonb_build_object('kind', 'payment', 'id', v_p.id, 'status', 'paid');
    elsif p_status in ('failed', 'error', 'deleted') and v_p.status = 'pending' then
      update public.ldo_auc_payments set status = 'failed', detail = 'Pagamento não concluído.' where id = v_p.id;
      return jsonb_build_object('kind', 'payment', 'id', v_p.id, 'status', 'failed');
    end if;
    return jsonb_build_object('kind', 'payment', 'id', v_p.id, 'status', v_p.status, 'unchanged', true);
  end if;
  return jsonb_build_object('kind', null);
end;
$$;

-- ---------------------------------------------------------------- pagamento do lote ganho

create function public.ldo_auc_pay_start(p_token text, p_session text, p_lot uuid, p_method text, p_phone text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_c public.ldo_auc_customers;
  v_l public.ldo_auc_lots;
  v_e public.ldo_auc_events;
  v_s public.ldo_auc_settings;
  v_p public.ldo_auc_payments;
  v_phone text;
begin
  perform ldo_private.bi_check(p_token);
  v_c := ldo_private.auc_buyer(p_session);
  select * into v_s from public.ldo_auc_settings where id = 1;
  select * into v_l from public.ldo_auc_lots where id = p_lot for update;
  if v_l.id is null or v_l.status <> 'closed' or v_l.result <> 'sold' or v_l.leader_id <> v_c.id then
    raise exception 'Este lote não está por pagar na sua conta.' using errcode = '22023';
  end if;
  if exists (select 1 from public.ldo_auc_payments where lot_id = p_lot and status = 'paid') then
    raise exception 'Este lote já está pago. Obrigado!' using errcode = '22023';
  end if;
  if p_method not in ('mb', 'mbw', 'cc') or not (p_method = any (v_s.payment_methods)) then
    raise exception 'Escolha Multibanco, MB WAY ou cartão.' using errcode = '22023';
  end if;
  select * into v_e from public.ldo_auc_events where id = v_l.event_id;
  -- Referência Multibanco ainda válida: a mesma (evita duas referências para o mesmo lote).
  select * into v_p from public.ldo_auc_payments where lot_id = p_lot and status = 'pending' and method = 'mb'
    and provider_ref is not null and (expires_at is null or expires_at > now() + interval '1 hour')
  order by created_at desc limit 1;
  if p_method = 'mb' and v_p.id is not null then
    return jsonb_build_object('status', 'existing', 'id', v_p.id);
  end if;
  if p_method = 'mbw' then
    v_phone := ldo_private.auc_mbway_phone(p_phone, v_c);
  end if;
  update public.ldo_auc_payments set status = 'cancelled', detail = 'Substituído por um novo pedido.'
  where lot_id = p_lot and status = 'pending' and method <> 'mb';
  insert into public.ldo_auc_payments (lot_id, customer_id, amount, method, provider)
  values (p_lot, v_c.id, v_l.current_price, p_method, 'easypay') returning * into v_p;
  return jsonb_build_object('status', 'new', 'id', v_p.id, 'amount', v_p.amount, 'method', p_method, 'phone', v_phone,
    'name', v_c.name, 'email', v_c.email, 'nif', v_c.nif, 'lot_title', v_l.title, 'lot_position', v_l.position,
    'event_slug', v_e.slug, 'due_at', v_l.payment_due_at);
end;
$$;

-- Caução e pagamento do cliente num lote (painel do lote e conta).
create function public.ldo_auc_lot_money(p_token text, p_session text, p_lot uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_me uuid;
begin
  perform ldo_private.bi_check(p_token);
  v_me := ldo_private.auc_customer(p_session);
  if v_me is null then
    return null;
  end if;
  return jsonb_build_object(
    'deposit', (select jsonb_build_object('id', d.id, 'status', d.status, 'amount', d.amount, 'method', d.method,
        'checkout_url', case when d.status = 'pending' then d.checkout_url end, 'expires_at', d.expires_at, 'detail', d.detail)
      from public.ldo_auc_deposits d where d.lot_id = p_lot and d.customer_id = v_me order by d.created_at desc limit 1),
    'payment', (select jsonb_build_object('id', p.id, 'status', p.status, 'amount', p.amount, 'method', p.method, 'entity', p.entity,
        'reference', p.reference, 'checkout_url', case when p.status = 'pending' then p.checkout_url end, 'expires_at', p.expires_at,
        'paid_at', p.paid_at, 'detail', p.detail)
      from public.ldo_auc_payments p where p.lot_id = p_lot and p.customer_id = v_me
      order by (p.status = 'paid') desc, p.created_at desc limit 1));
end;
$$;

-- ---------------------------------------------------------------- trabalho do servidor

-- O que falta fazer na easypay, reservado 5 minutos:
-- - void: cauções cativas de quem não ganhou, de lotes retirados, e do vencedor que já pagou;
-- - capture: caução do vencedor que não pagou no prazo;
-- - check: pedidos pendentes há mais de 2 minutos (se a notificação não chegou).
create function public.ldo_auc_money_jobs(p_token text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_lease timestamptz := now() + interval '5 minutes';
  v_out jsonb := '[]'::jsonb;
  v_part jsonb;
begin
  perform ldo_private.bi_check(p_token);
  -- Cativações que já caducaram na easypay deixam de contar (em lotes ainda abertos o cliente renova-a).
  update public.ldo_auc_deposits set status = 'released', released_at = now(), detail = 'Cativação caducada.', updated_at = now()
  where provider = 'easypay' and status = 'held' and expires_at < now();

  with picked as (
    select d.id, case
        when l.status = 'withdrawn' or (l.status = 'closed' and not (l.result = 'sold' and l.leader_id = d.customer_id)) then 'void'
        when l.status = 'closed' and exists (select 1 from public.ldo_auc_payments p where p.lot_id = l.id and p.status = 'paid') then 'void'
        when l.status = 'closed' and l.result = 'sold' and l.leader_id = d.customer_id and l.payment_due_at < now() then 'capture'
      end as action
    from public.ldo_auc_deposits d join public.ldo_auc_lots l on l.id = d.lot_id
    where d.provider = 'easypay' and d.status = 'held' and d.provider_ref is not null and d.attempts < 5
      and (d.lease_until is null or d.lease_until < now())
    for update of d skip locked
  ), jobs as (
    update public.ldo_auc_deposits d set lease_until = v_lease from picked
    where d.id = picked.id and picked.action is not null returning d.id, d.provider_ref, d.amount, picked.action
  )
  select coalesce(jsonb_agg(jsonb_build_object('kind', 'deposit', 'action', action, 'id', id, 'ref', provider_ref, 'amount', amount)), '[]'::jsonb)
  into v_part from jobs;
  v_out := v_out || v_part;

  with picked as (
    select d.id from public.ldo_auc_deposits d
    where d.provider = 'easypay' and d.status = 'pending' and d.provider_ref is not null
      and d.created_at < now() - interval '2 minutes' and d.created_at > now() - interval '3 days'
      and (d.lease_until is null or d.lease_until < now())
    for update skip locked limit 50
  ), jobs as (
    update public.ldo_auc_deposits d set lease_until = v_lease from picked where d.id = picked.id returning d.id, d.provider_ref
  )
  select coalesce(jsonb_agg(jsonb_build_object('kind', 'deposit', 'action', 'check', 'id', id, 'ref', provider_ref)), '[]'::jsonb)
  into v_part from jobs;
  v_out := v_out || v_part;

  with picked as (
    select p.id from public.ldo_auc_payments p
    where p.provider = 'easypay' and p.status = 'pending' and p.provider_ref is not null
      and p.created_at < now() - interval '2 minutes' and p.created_at > now() - interval '35 days'
      and (p.lease_until is null or p.lease_until < now())
    for update skip locked limit 50
  ), jobs as (
    update public.ldo_auc_payments p set lease_until = v_lease from picked where p.id = picked.id returning p.id, p.provider_ref
  )
  select coalesce(jsonb_agg(jsonb_build_object('kind', 'payment', 'action', 'check', 'id', id, 'ref', provider_ref)), '[]'::jsonb)
  into v_part from jobs;
  return v_out || v_part;
end;
$$;

-- Resultado de um void/capture/check feito na easypay.
create function public.ldo_auc_money_done(p_token text, p_kind text, p_id uuid, p_action text, p_ok boolean, p_detail text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_d public.ldo_auc_deposits;
begin
  perform ldo_private.bi_check(p_token);
  if p_kind = 'payment' then
    update public.ldo_auc_payments set lease_until = null, detail = coalesce(left(p_detail, 500), detail) where id = p_id;
    return;
  end if;
  select * into v_d from public.ldo_auc_deposits where id = p_id for update;
  if v_d.id is null then
    return;
  end if;
  if p_action = 'void' and p_ok then
    update public.ldo_auc_deposits set status = 'released', released_at = now(), lease_until = null, detail = left(p_detail, 500), updated_at = now()
    where id = p_id and status = 'held';
  elsif p_action = 'capture' and p_ok then
    update public.ldo_auc_deposits set status = 'captured', captured_at = now(), lease_until = null, detail = left(p_detail, 500), updated_at = now()
    where id = p_id and status = 'held';
    insert into public.ldo_auc_outbox (kind, customer_id, lot_id, payload)
    values ('deposit_captured', v_d.customer_id, v_d.lot_id, jsonb_build_object('amount', v_d.amount));
  elsif p_action = 'check' then
    update public.ldo_auc_deposits set lease_until = null where id = p_id;
  else
    update public.ldo_auc_deposits set attempts = attempts + 1, lease_until = null, detail = left(p_detail, 500), updated_at = now() where id = p_id;
  end if;
end;
$$;

-- ---------------------------------------------------------------- backoffice

-- Cauções e pagamentos de um lote (página do lote no backoffice).
create function public.ldo_auc_lot_money_admin(p_session text, p_lot uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform ldo_private.auc_require(p_session);
  return jsonb_build_object(
    'deposits', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'alias', c.alias, 'email', c.email, 'amount', d.amount, 'status', d.status,
        'method', d.method, 'provider', d.provider, 'provider_ref', d.provider_ref, 'expires_at', d.expires_at, 'detail', d.detail,
        'created_at', d.created_at) order by d.created_at desc)
      from public.ldo_auc_deposits d join public.ldo_auc_customers c on c.id = d.customer_id where d.lot_id = p_lot), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'alias', c.alias, 'email', c.email, 'amount', p.amount, 'status', p.status,
        'method', p.method, 'provider', p.provider, 'provider_ref', p.provider_ref, 'entity', p.entity, 'reference', p.reference,
        'paid_at', p.paid_at, 'detail', p.detail, 'created_at', p.created_at) order by p.created_at desc)
      from public.ldo_auc_payments p join public.ldo_auc_customers c on c.id = p.customer_id where p.lot_id = p_lot), '[]'::jsonb));
end;
$$;

-- Pagamento recebido fora da easypay (transferência, loja): marca o lote como pago.
create function public.ldo_auc_payment_manual(p_session text, p_lot uuid, p_note text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me uuid := ldo_private.auc_require(p_session);
  v_l public.ldo_auc_lots;
begin
  select * into v_l from public.ldo_auc_lots where id = p_lot for update;
  if v_l.id is null or v_l.status <> 'closed' or v_l.result <> 'sold' then
    raise exception 'Só um lote vendido pode ser marcado como pago.' using errcode = '22023';
  end if;
  if exists (select 1 from public.ldo_auc_payments where lot_id = p_lot and status = 'paid') then
    raise exception 'Este lote já está pago.' using errcode = '22023';
  end if;
  update public.ldo_auc_payments set status = 'cancelled', detail = 'Pago por outro meio.' where lot_id = p_lot and status = 'pending';
  insert into public.ldo_auc_payments (lot_id, customer_id, amount, method, provider, status, paid_at, detail, created_by)
  values (p_lot, v_l.leader_id, v_l.current_price, 'manual', 'manual', 'paid', now(), left(btrim(coalesce(p_note, '')), 500), v_me);
  insert into public.ldo_auc_outbox (kind, customer_id, lot_id, payload)
  values ('paid', v_l.leader_id, p_lot, jsonb_build_object('amount', v_l.current_price, 'method', 'manual'));
  insert into public.ldo_app_audit (actor, action, target, details) values (v_me, 'auction.payment_manual', p_lot, jsonb_build_object('note', p_note));
end;
$$;

revoke all on function
  public.ldo_auc_deposit_start(text, text, uuid, text, text),
  public.ldo_auc_provider_created(text, text, uuid, text, jsonb),
  public.ldo_auc_provider_sync(text, text, text),
  public.ldo_auc_pay_start(text, text, uuid, text, text),
  public.ldo_auc_lot_money(text, text, uuid),
  public.ldo_auc_money_jobs(text),
  public.ldo_auc_money_done(text, text, uuid, text, boolean, text),
  public.ldo_auc_lot_money_admin(text, uuid),
  public.ldo_auc_payment_manual(text, uuid, text)
from public, authenticated;
grant execute on function
  public.ldo_auc_deposit_start(text, text, uuid, text, text),
  public.ldo_auc_provider_created(text, text, uuid, text, jsonb),
  public.ldo_auc_provider_sync(text, text, text),
  public.ldo_auc_pay_start(text, text, uuid, text, text),
  public.ldo_auc_lot_money(text, text, uuid),
  public.ldo_auc_money_jobs(text),
  public.ldo_auc_money_done(text, text, uuid, text, boolean, text),
  public.ldo_auc_lot_money_admin(text, uuid),
  public.ldo_auc_payment_manual(text, uuid, text)
to anon;
