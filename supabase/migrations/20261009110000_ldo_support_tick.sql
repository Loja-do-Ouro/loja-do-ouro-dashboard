-- Verificação automática do Apoio ao Cliente a cada 5 minutos (pg_cron + pg_net), para o Facebook e o Instagram
-- (a Metricool não tem avisos) e as respostas automáticas saírem mesmo com o dashboard fechado.
-- O token é gerado aqui e fica cifrado no Vault do Supabase: não passa por ninguém, nem pelas variáveis da Vercel.
-- O pedido a /api/support/webhooks/tick traz "Bearer <token>" e é esta base de dados que o confirma.
-- O agendamento em si fica em 20261009110100_ldo_support_tick_schedule.sql (só depois do deploy do endpoint).

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'ldo_support_tick',
  'Token da verificação automática do Apoio ao Cliente (pg_cron -> /api/support/webhooks/tick)')
where not exists (select 1 from vault.secrets where name = 'ldo_support_tick');

create function public.ldo_support_tick_check(p_token text, p_value text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_secret text;
begin
  perform ldo_private.bi_check(p_token);
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'ldo_support_tick';
  return v_secret is not null and coalesce(p_value, '') <> ''
    and extensions.digest(p_value, 'sha256') = extensions.digest(v_secret, 'sha256');
end;
$$;

revoke all on function public.ldo_support_tick_check(text, text) from public, authenticated;
grant execute on function public.ldo_support_tick_check(text, text) to anon;
