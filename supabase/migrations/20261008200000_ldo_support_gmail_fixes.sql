-- Email (Gmail), correções da revisão: o email indicado no formulário de contacto da loja (Reply-To de um
-- remetente da Shopify) não é verificado. Fica em claimed_email, como o email escrito no chat do site: aparece
-- à equipa como "não confirmado" e não serve para mostrar encomendas até a equipa associar o cliente.
-- O contacto destes emails fica sem email (só external_id = endereço de resposta), para a identidade de
-- confiança (email) vir só do From autenticado pelo Gmail.

create function public.ldo_support_gmail_claimed(p_token text, p_addresses text[]) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform ldo_private.bi_check(p_token);
  update public.ldo_support_contacts k set claimed_email = k.external_id, updated_at = now()
  from public.ldo_support_sources s
  where s.id = 'gmail' and k.channel = s.channel and k.account = s.account
    and k.external_id = any (coalesce(p_addresses, '{}')) and k.email is null
    and length(k.external_id) <= 254 and k.claimed_email is distinct from k.external_id;
end;
$$;

revoke all on function public.ldo_support_gmail_claimed(text, text[]) from public, authenticated;
grant execute on function public.ldo_support_gmail_claimed(text, text[]) to anon;
