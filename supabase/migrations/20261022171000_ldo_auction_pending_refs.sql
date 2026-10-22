-- Leilão, fase 3: referências easypay dos pedidos pendentes do cliente num lote (só para o servidor confirmar o estado
-- na easypay enquanto o cliente espera no ecrã; nunca vão para o browser).
create function public.ldo_auc_pending_refs(p_token text, p_session text, p_lot uuid) returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare v_me uuid;
begin
  perform ldo_private.bi_check(p_token);
  v_me := ldo_private.auc_customer(p_session);
  if v_me is null then
    return array[]::text[];
  end if;
  return array(
    select d.provider_ref from public.ldo_auc_deposits d
    where d.lot_id = p_lot and d.customer_id = v_me and d.status = 'pending' and d.provider_ref is not null
    union all
    select p.provider_ref from public.ldo_auc_payments p
    where p.lot_id = p_lot and p.customer_id = v_me and p.status = 'pending' and p.provider_ref is not null
  );
end;
$$;
revoke all on function public.ldo_auc_pending_refs(text, text, uuid) from public, authenticated;
grant execute on function public.ldo_auc_pending_refs(text, text, uuid) to anon;
