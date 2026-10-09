-- Agendamento da verificação automática (a cada 5 minutos). Aplicar só depois de o endpoint
-- /api/support/webhooks/tick estar em produção. Para parar: select cron.unschedule('ldo-support-tick');

select cron.schedule('ldo-support-tick', '*/5 * * * *', $job$
  select net.http_post(
    url := 'https://loja-do-ouro-dashboard.vercel.app/api/support/webhooks/tick',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'ldo_support_tick'),
      'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000)
$job$);
