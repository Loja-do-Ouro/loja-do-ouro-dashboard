-- Leilão, fase 3: cartão pelo formulário embutido da easypay (Checkout, na nossa página, sem sair do site).
-- A sessão de checkout é criada no servidor (checkout_id); o pagamento da easypay (provider_ref) só existe quando o
-- cliente conclui, e liga-se ao nosso registo pela key (o id da caução ou do pagamento).

alter table public.ldo_auc_deposits add column checkout_id text check (checkout_id is null or length(checkout_id) <= 64);
alter table public.ldo_auc_payments add column checkout_id text check (checkout_id is null or length(checkout_id) <= 64);

create function public.ldo_auc_checkout_created(p_token text, p_kind text, p_id uuid, p_checkout text) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform ldo_private.bi_check(p_token);
  if p_kind = 'deposit' then
    update public.ldo_auc_deposits set checkout_id = p_checkout, updated_at = now() where id = p_id and status = 'pending';
  elsif p_kind = 'payment' then
    update public.ldo_auc_payments set checkout_id = p_checkout where id = p_id and status = 'pending';
  else
    raise exception 'Tipo inválido.' using errcode = '22023';
  end if;
end;
$$;

-- Estado lido na easypay de um pagamento cuja key é o id do nosso registo: liga a referência (se ainda não estiver)
-- e aplica o estado como ldo_auc_provider_sync.
create function public.ldo_auc_provider_sync_key(p_token text, p_key uuid, p_ref text, p_status text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform ldo_private.bi_check(p_token);
  update public.ldo_auc_deposits set provider_ref = p_ref, updated_at = now()
  where id = p_key and provider_ref is null and status = 'pending'
    and not exists (select 1 from public.ldo_auc_deposits where provider_ref = p_ref);
  update public.ldo_auc_payments set provider_ref = p_ref
  where id = p_key and provider_ref is null and status = 'pending'
    and not exists (select 1 from public.ldo_auc_payments where provider_ref = p_ref);
  return public.ldo_auc_provider_sync(p_token, p_ref, p_status);
end;
$$;

-- Checkouts de cartão ainda sem pagamento: os recentes para confirmar na easypay; os abandonados há mais de um dia falham.
create function public.ldo_auc_checkout_pending(p_token text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform ldo_private.bi_check(p_token);
  update public.ldo_auc_deposits set status = 'failed', detail = 'Pagamento com cartão não concluído.', updated_at = now()
  where status = 'pending' and checkout_id is not null and provider_ref is null and created_at < now() - interval '1 day';
  update public.ldo_auc_payments set status = 'failed', detail = 'Pagamento com cartão não concluído.'
  where status = 'pending' and checkout_id is not null and provider_ref is null and created_at < now() - interval '1 day';
  return coalesce((select jsonb_agg(x) from (
    select jsonb_build_object('kind', 'deposit', 'id', id, 'checkout', checkout_id) x from public.ldo_auc_deposits
    where status = 'pending' and checkout_id is not null and provider_ref is null and created_at < now() - interval '2 minutes'
    union all
    select jsonb_build_object('kind', 'payment', 'id', id, 'checkout', checkout_id) from public.ldo_auc_payments
    where status = 'pending' and checkout_id is not null and provider_ref is null and created_at < now() - interval '2 minutes'
    limit 50) s), '[]'::jsonb);
end;
$$;

revoke all on function public.ldo_auc_checkout_created(text, text, uuid, text), public.ldo_auc_provider_sync_key(text, uuid, text, text),
  public.ldo_auc_checkout_pending(text) from public, authenticated;
grant execute on function public.ldo_auc_checkout_created(text, text, uuid, text), public.ldo_auc_provider_sync_key(text, uuid, text, text),
  public.ldo_auc_checkout_pending(text) to anon;
