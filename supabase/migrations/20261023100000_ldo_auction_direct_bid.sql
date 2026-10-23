-- Leilão: licitação direta ao lado da licitação automática.
-- Direta («Licitar já X €»): o preço passa logo para X, e X é também o máximo de quem licita. Automática (como até
-- aqui): o máximo fica secreto e o preço só sobe quando outro licitante licita contra. Em ambos os casos, se o líder
-- tiver um máximo automático maior, responde por ele (empate: ganha quem chegou primeiro). O líder não licita contra
-- si próprio: só pode subir o seu máximo.

create function ldo_private.auc_place_bid(p_lot uuid, p_customer uuid, p_max numeric, p_ip_hash text, p_direct boolean) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_s public.ldo_auc_settings;
  v_l public.ldo_auc_lots;
  v_e public.ldo_auc_events;
  v_c public.ldo_auc_customers;
  v_now timestamptz := clock_timestamp();
  v_max numeric := round(p_max, 2);
  v_min numeric;
  v_price numeric;
  v_leader uuid;
  v_leader_max numeric;
  v_outbid uuid;
  v_close timestamptz;
  v_extended boolean := false;
  v_deposit numeric;
begin
  select * into v_s from public.ldo_auc_settings where id = 1;
  select * into v_l from public.ldo_auc_lots where id = p_lot for update;
  if v_l.id is null then
    raise exception 'Lote não encontrado.' using errcode = 'P0002';
  end if;
  select * into v_e from public.ldo_auc_events where id = v_l.event_id;
  if v_l.status <> 'ready' or v_e.status <> 'published' or v_now < v_e.opens_at or v_l.close_at is null or v_now >= v_l.close_at then
    raise exception 'Este lote não está aberto a licitações.' using errcode = '22023';
  end if;
  select * into v_c from public.ldo_auc_customers where id = p_customer;
  if v_c.id is null or v_c.deleted_at is not null or v_c.level = 'blocked' then
    raise exception 'Esta conta não pode licitar.' using errcode = '42501';
  end if;
  if v_c.is_staff then
    raise exception 'Funcionários e familiares não podem licitar.' using errcode = '42501';
  end if;
  if v_c.email_verified_at is null then
    raise exception 'Confirme o seu email antes de licitar.' using errcode = '42501';
  end if;
  if v_max is null or v_max <= 0 or v_max > 9999999999 then
    raise exception 'Indique um valor válido.' using errcode = '22023';
  end if;

  -- O líder sobe o seu máximo: não é uma licitação pública e não prolonga o lote. (Não licita contra si próprio.)
  if v_l.leader_id = p_customer then
    if p_direct then
      raise exception 'Já lidera este lote. Pode subir o seu máximo automático.' using errcode = '22023';
    end if;
    if v_max <= v_l.leader_max then
      raise exception 'O seu máximo atual já é de %.', ldo_private.auc_eur(v_l.leader_max) using errcode = '22023';
    end if;
    if v_max >= v_s.verified_threshold and v_c.level not in ('verified', 'vip') then
      raise exception 'Para licitar a partir de % precisa de conta verificada.', ldo_private.auc_eur(v_s.verified_threshold) using errcode = '42501';
    end if;
    insert into public.ldo_auc_bids (lot_id, customer_id, amount, max_amount, kind, ip_hash)
    values (p_lot, p_customer, v_l.current_price, v_max, 'max_raise', p_ip_hash);
    v_price := v_l.current_price;
    if v_l.reserve_price is not null and v_price < v_l.reserve_price and v_max >= v_l.reserve_price then
      v_price := v_l.reserve_price;
      insert into public.ldo_auc_bids (lot_id, customer_id, amount, kind, ip_hash) values (p_lot, p_customer, v_price, 'auto', p_ip_hash);
    end if;
    update public.ldo_auc_lots set leader_max = v_max, current_price = v_price,
      bid_count = (select count(*) from public.ldo_auc_bids where lot_id = p_lot and kind <> 'max_raise')
    where id = p_lot;
    return jsonb_build_object('status', 'leading', 'price', v_price, 'max', v_max, 'close_at', v_l.close_at, 'extended', false,
      'reserve_met', v_l.reserve_price is null or v_price >= v_l.reserve_price,
      'min_next', v_price + ldo_private.auc_increment(v_price, v_s.increments));
  end if;

  v_min := ldo_private.auc_min_bid(v_l, v_s.increments);
  if v_max < v_min then
    raise exception 'A licitação mínima é %.', ldo_private.auc_eur(v_min) using errcode = '22023';
  end if;
  if (case when p_direct then v_max else v_min end) >= v_s.verified_threshold and v_c.level not in ('verified', 'vip') then
    raise exception 'Para licitar a partir de % precisa de conta verificada.', ldo_private.auc_eur(v_s.verified_threshold) using errcode = '42501';
  end if;
  v_deposit := ldo_private.auc_deposit_amount(v_l, v_s);
  if v_deposit > 0 and not exists (select 1 from public.ldo_auc_deposits d
      where d.customer_id = p_customer and d.lot_id = p_lot and d.status = 'held') then
    raise exception 'Este lote exige uma caução de % antes de licitar.', ldo_private.auc_eur(v_deposit) using errcode = '42501';
  end if;

  if v_l.leader_id is null then
    -- Primeira licitação: começa na base (direta: no valor indicado).
    v_price := case when p_direct then v_max else v_l.start_price end;
    v_leader := p_customer;
    v_leader_max := v_max;
    insert into public.ldo_auc_bids (lot_id, customer_id, amount, max_amount, kind, ip_hash)
    values (p_lot, p_customer, v_price, v_max, 'bid', p_ip_hash);
  elsif v_max > v_l.leader_max then
    -- Novo líder: paga um incremento acima do máximo anterior (ou o seu máximo, se for menos).
    if v_l.leader_max > v_l.current_price then
      insert into public.ldo_auc_bids (lot_id, customer_id, amount, kind) values (p_lot, v_l.leader_id, v_l.leader_max, 'auto');
    end if;
    v_price := case when p_direct then v_max
      else least(v_max, v_l.leader_max + ldo_private.auc_increment(v_l.leader_max, v_s.increments)) end;
    v_leader := p_customer;
    v_leader_max := v_max;
    v_outbid := v_l.leader_id;
    insert into public.ldo_auc_bids (lot_id, customer_id, amount, max_amount, kind, ip_hash)
    values (p_lot, p_customer, v_price, v_max, 'bid', p_ip_hash);
  else
    -- O máximo do líder chega: o líder responde automaticamente (empate: ganha quem chegou primeiro).
    insert into public.ldo_auc_bids (lot_id, customer_id, amount, max_amount, kind, ip_hash)
    values (p_lot, p_customer, v_max, v_max, 'bid', p_ip_hash);
    v_price := least(v_l.leader_max, v_max + ldo_private.auc_increment(v_max, v_s.increments));
    v_leader := v_l.leader_id;
    v_leader_max := v_l.leader_max;
    insert into public.ldo_auc_bids (lot_id, customer_id, amount, kind) values (p_lot, v_leader, v_price, 'auto');
  end if;

  -- Reserva: se o máximo do líder a cobre, o preço sobe logo até ela.
  if v_l.reserve_price is not null and v_price < v_l.reserve_price and v_leader_max >= v_l.reserve_price then
    v_price := v_l.reserve_price;
    insert into public.ldo_auc_bids (lot_id, customer_id, amount, kind) values (p_lot, v_leader, v_price, 'auto');
  end if;

  -- Antisniping.
  v_close := v_l.close_at;
  if v_l.close_at - v_now <= make_interval(secs => v_s.extend_window_seconds) then
    v_close := greatest(v_l.close_at, v_now + make_interval(mins => v_s.extend_minutes));
    v_extended := v_close > v_l.close_at;
  end if;

  update public.ldo_auc_lots set
    current_price = v_price, leader_id = v_leader, leader_max = v_leader_max, close_at = v_close,
    extensions = extensions + case when v_extended then 1 else 0 end,
    bid_count = (select count(*) from public.ldo_auc_bids where lot_id = p_lot and kind <> 'max_raise'),
    bidder_count = (select count(distinct customer_id) from public.ldo_auc_bids where lot_id = p_lot)
  where id = p_lot;

  -- Emails: quem perdeu a liderança; e, se prolongou, todos os que licitaram no lote.
  if v_outbid is not null then
    insert into public.ldo_auc_outbox (kind, customer_id, lot_id, payload)
    values ('outbid', v_outbid, p_lot, jsonb_build_object('price', v_price, 'close_at', v_close));
  end if;
  if v_extended then
    insert into public.ldo_auc_outbox (kind, customer_id, lot_id, payload)
    select 'extended', b.customer_id, p_lot, jsonb_build_object('price', v_price, 'close_at', v_close)
    from (select distinct customer_id from public.ldo_auc_bids where lot_id = p_lot) b;
  end if;

  return jsonb_build_object(
    'status', case when v_leader = p_customer then 'leading' else 'outbid' end,
    'price', v_price, 'max', case when v_leader = p_customer then v_leader_max end,
    'close_at', v_close, 'extended', v_extended,
    'reserve_met', v_l.reserve_price is null or v_price >= v_l.reserve_price,
    'min_next', v_price + ldo_private.auc_increment(v_price, v_s.increments));
end;
$$;
revoke all on function ldo_private.auc_place_bid(uuid, uuid, numeric, text, boolean) from public, anon, authenticated;

-- Licitar (o cliente vem da sessão). p_direct: licitação direta. Até 30 licitações por minuto por cliente.
create function public.ldo_auc_bid(p_token text, p_session text, p_lot uuid, p_max numeric, p_ip_hash text, p_direct boolean)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_me uuid;
begin
  perform ldo_private.bi_check(p_token);
  v_me := ldo_private.auc_customer(p_session);
  if v_me is null then
    raise exception 'Entre na sua conta para licitar.' using errcode = '42501';
  end if;
  if (select count(*) from public.ldo_auc_bids where customer_id = v_me and created_at > now() - interval '1 minute') >= 30 then
    raise exception 'Demasiadas licitações seguidas. Aguarde um momento.' using errcode = '22023';
  end if;
  return ldo_private.auc_place_bid(p_lot, v_me, p_max, case when p_ip_hash ~ '^[0-9a-f]{64}$' then p_ip_hash end, coalesce(p_direct, false));
end;
$$;
revoke all on function public.ldo_auc_bid(text, text, uuid, numeric, text, boolean) from public, authenticated;
grant execute on function public.ldo_auc_bid(text, text, uuid, numeric, text, boolean) to anon;

-- A versão antiga (sem p_direct) continua a servir o site até à publicação nova, como licitação automática.
create or replace function public.ldo_auc_bid(p_token text, p_session text, p_lot uuid, p_max numeric, p_ip_hash text) returns jsonb
language sql volatile security definer set search_path = '' as $$
  select public.ldo_auc_bid(p_token, p_session, p_lot, p_max, p_ip_hash, false);
$$;
drop function ldo_private.auc_place_bid(uuid, uuid, numeric, text);
