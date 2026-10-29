-- Configuração do apoio (Super Admin): cada fonte passa a trazer a conta da marca detetada nas conversas
-- (cursor.brand: o id da página de Facebook ou da conta de Instagram) e a última mensagem recebida de um cliente.
-- * "Validar ligações" compara a página de Facebook ligada à marca na Metricool com a das conversas guardadas.
-- * A última mensagem recebida mostra uma fonte que sincroniza sem erros mas deixou de receber mensagens novas
--   (como o Facebook a 28-10-2026: a Metricool respondia, sem nada novo).
-- O resto do cursor continua fora (pontos de continuação das plataformas). Igual à versão de 20261007120000 em tudo
-- o resto; os privilégios da função mantêm-se (create or replace).

create or replace function public.ldo_support_admin_state(p_session text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if ldo_private.support_super(p_session) is null then
    raise exception 'Só o Super Admin configura o Apoio ao Cliente.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'settings', (select to_jsonb(s) from public.ldo_support_settings s where id = 1),
    'sources', coalesce((select jsonb_agg((to_jsonb(s) - 'cursor') || jsonb_build_object('brand', s.cursor ->> 'brand',
      'last_inbound_at', (select max(c.last_inbound_at) from public.ldo_support_conversations c where c.source_id = s.id)) order by s.id)
      from public.ldo_support_sources s), '[]'::jsonb),
    'connections', coalesce((select jsonb_agg(jsonb_build_object('user_id', z.user_id, 'name', coalesce(u.full_name, u.username),
      'zendesk_name', z.zendesk_name, 'zendesk_email', z.zendesk_email, 'zendesk_role', z.zendesk_role, 'scope', z.scope,
      'status', z.status, 'status_detail', z.status_detail, 'access_expires_at', z.access_expires_at,
      'refresh_expires_at', z.refresh_expires_at, 'connected_at', z.connected_at, 'updated_at', z.updated_at))
      from public.ldo_support_zendesk_connections z join public.ldo_app_users u on u.id = z.user_id), '[]'::jsonb),
    'users', coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'name', coalesce(u.full_name, u.username), 'username', u.username,
      'support_access', u.support_access, 'is_super_admin', u.is_super_admin) order by coalesce(u.full_name, u.username))
      from public.ldo_app_users u where u.active and u.username is not null), '[]'::jsonb),
    'counts', (select jsonb_build_object('conversations', count(*), 'open', count(*) filter (where status <> 'resolvido'))
      from public.ldo_support_conversations),
    'audit', coalesce((select jsonb_agg(jsonb_build_object('action', l.action, 'details', l.details, 'created_at', l.created_at,
      'actor', coalesce((select coalesce(full_name, username) from public.ldo_app_users where id = l.actor), 'Sistema')) order by l.created_at desc)
      from (select * from public.ldo_support_audit where conversation_id is null order by created_at desc limit 20) l), '[]'::jsonb)
  );
end;
$$;
