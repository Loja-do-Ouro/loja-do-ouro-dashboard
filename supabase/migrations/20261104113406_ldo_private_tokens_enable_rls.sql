-- Reforço pedido pelo verificador da Supabase (04-11-2026).
-- As tabelas só são lidas por funções SECURITY DEFINER do dono (postgres, BYPASSRLS),
-- por isso ligar o RLS sem políticas não muda nada para elas e fecha o acesso direto.
-- Já aplicada em produção a 04-11-2026; este ficheiro só acerta o histórico do repositório.
alter table ldo_private.report_token enable row level security;
alter table ldo_private.bi_token enable row level security;
