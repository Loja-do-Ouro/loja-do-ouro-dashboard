-- Chat do site: o que o cliente está a fazer na loja (só depois de iniciar o chat).
--
-- O widget envia a página que o cliente está a ver, o carrinho (lido da própria loja no browser) e desde
-- quando está a navegar nesta visita. É informação enviada pelo browser do cliente: serve para ajudar no
-- atendimento, não é prova de nada (o cliente pode alterá-la) e não substitui as encomendas da Shopify.

alter table public.ldo_support_site_visitors
  add column page_title text check (page_title is null or length(page_title) <= 200),
  add column cart jsonb check (cart is null or (jsonb_typeof(cart) = 'object' and pg_column_size(cart) <= 16000)),
  add column visit_started_at timestamptz,
  add column pages_viewed integer check (pages_viewed is null or pages_viewed between 0 and 100000),
  add column context_at timestamptz;

-- Contexto enviado pelo widget (já validado e limpo no servidor). No máximo uma atualização a cada 5 s.
create function public.ldo_support_site_context(p_token text, p_token_hash text, p_identity_email text, p_page text, p_title text,
  p_cart jsonb, p_visit_started_at timestamptz, p_pages integer) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v public.ldo_support_site_visitors;
begin
  perform ldo_private.bi_check(p_token);
  v := ldo_private.site_visitor(p_token_hash, p_identity_email);
  if v.context_at is not null and v.context_at > now() - interval '5 seconds' then
    return;
  end if;
  update public.ldo_support_site_visitors set
    page_url = coalesce(left(p_page, 500), page_url),
    page_title = left(ldo_private.site_clean(p_title, 200), 200),
    cart = case when p_cart is not null and jsonb_typeof(p_cart) = 'object' and pg_column_size(p_cart) <= 16000 then p_cart else cart end,
    visit_started_at = case when p_visit_started_at between now() - interval '2 days' and now() + interval '5 minutes'
      then p_visit_started_at else visit_started_at end,
    pages_viewed = case when p_pages between 0 and 100000 then p_pages else pages_viewed end,
    context_at = now(),
    last_seen_at = now()
  where id = v.id;
end;
$$;

-- Para a equipa (painel do cliente): estado do visitante desta conversa do chat do site.
create function public.ldo_support_site_visitor_info(p_session text, p_conversation uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_me uuid := ldo_private.support_check(p_session);
begin
  return (select jsonb_build_object('page_url', v.page_url, 'page_title', v.page_title, 'cart', v.cart,
      'visit_started_at', v.visit_started_at, 'pages_viewed', v.pages_viewed, 'context_at', v.context_at,
      'last_seen_at', v.last_seen_at, 'created_at', v.created_at, 'verified', v.verified, 'now', now())
    from public.ldo_support_site_visitors v where v.conversation_id = p_conversation
    order by v.last_seen_at desc limit 1);
end;
$$;

revoke all on function public.ldo_support_site_context(text, text, text, text, text, jsonb, timestamptz, integer),
  public.ldo_support_site_visitor_info(text, uuid) from public, authenticated;
grant execute on function public.ldo_support_site_context(text, text, text, text, text, jsonb, timestamptz, integer),
  public.ldo_support_site_visitor_info(text, uuid) to anon;
