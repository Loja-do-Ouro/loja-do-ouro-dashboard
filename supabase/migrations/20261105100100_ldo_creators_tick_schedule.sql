-- Agendamento da verificação automática da plataforma de criadores (a cada 5 minutos): fila de emails e, durante uma
-- rotação da chave, a regravação dos dados cifrados (ldo_cr_reseal_*). Aplicar só depois de o endpoint
-- /api/c/tick estar em produção. O token vem do Vault (criado em 20261105100000_ldo_creators_a.sql) e é confirmado
-- por ldo_cr_tick_check. Parar: select cron.unschedule('ldo-creators-tick');
-- A limpeza diária por prazos (ldo-creators-retention, 03:41) não chama nenhuma rota e já fica agendada na migração A.

select cron.schedule('ldo-creators-tick', '*/5 * * * *', $job$
  select net.http_post(
    url := 'https://loja-do-ouro-dashboard.vercel.app/api/c/tick',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'ldo_creators_tick'),
      'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000)
$job$);
