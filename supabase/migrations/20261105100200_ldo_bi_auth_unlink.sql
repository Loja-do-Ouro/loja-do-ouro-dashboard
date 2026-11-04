-- [rev. S-M9] Fecha a ponte entre o Supabase Auth e os dados do dashboard. Num commit próprio e aplicada só com a
-- autorização do dono; pode ser recusada sem bloquear a plataforma de criadores.
--
-- O dashboard deixou de usar o Supabase Auth (20261002150000_ldo_username_login.sql) e lê o BI por ldo_bi_read,
-- com token. Ficava uma ponte entre um JWT do Supabase Auth (o do protótipo de criadores) e dados do dashboard:
-- ldo_app_users.auth_user_id e as políticas de leitura das tabelas ldo_bi_* (has_online() e ldo_bi_members).
-- Não mexe em dados do BI nem nas tabelas do protótipo. ldo_bi_members fica (sem acesso) até à limpeza do protótipo.
--
-- As tabelas ldo_bi_* não são criadas em nenhuma migração do repositório, por isso o SQL percorre o catálogo em vez
-- de as nomear. Em produção (leitura de pg_policies a 04-11-2026) há três políticas para authenticated:
-- ldo_bi_online_read e ldo_bi_member_read nas seis tabelas de dados, e ldo_bi_member_self em ldo_bi_members. Por
-- isso apagam-se TODAS as políticas das ldo_bi_* que se aplicam a public, anon ou authenticated (não só as duas com
-- o nome conhecido), e retiram-se os privilégios também ao pseudo-papel PUBLIC.

update public.ldo_app_users set auth_user_id = null where auth_user_id is not null;

do $$
declare
  p record;
  t record;
begin
  for p in select pol.tablename, pol.policyname from pg_catalog.pg_policies pol
           where pol.schemaname = 'public' and pol.tablename like 'ldo\_bi\_%'
             and pol.roles && array['public', 'anon', 'authenticated']::name[] loop
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
  end loop;
  for t in select c.relname from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm') and c.relname like 'ldo\_bi\_%' loop
    execute format('revoke all on public.%I from public, anon, authenticated', t.relname);
  end loop;
end;
$$;

-- As funções de permissão da versão com Supabase Auth (20261002120000…sql:110-157) só serviam essas políticas.
revoke execute on function ldo_private.current_user_id(), ldo_private.is_super(), ldo_private.has_online(),
  ldo_private.store_level(uuid), ldo_private.can_see_user(uuid) from authenticated;
revoke usage on schema ldo_private from authenticated;
