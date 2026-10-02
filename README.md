# Loja do Ouro · Administração

Dashboard privado Next.js para consultar os fechos do negócio. A entrada destaca ontem, a semana civil anterior e o mês civil anterior em Europe/Lisbon. O calendário permite consultar outras datas completas.

## Desenvolvimento

```sh
npm ci
npm test
npm run build
npm run dev
```

Copiar `.env.example` para um ficheiro de ambiente local e preencher apenas as credenciais autorizadas. Nunca incluir credenciais ou dados comerciais no Git.

## Dados

O servidor lê as tabelas `public.ldo_bi_*` quando a ligação privada está configurada. Na sua ausência, mantém a leitura direta através da chave Windsor já existente em produção. Não altera dados, acesso anónimo ou RLS. O login privado existente continua a proteger a aplicação.

São necessários `BI_SUPABASE_URL`, `BI_SUPABASE_PUBLISHABLE_KEY` e uma credencial válida em `BI_SUPABASE_ACCESS_TOKEN` pertencente a um membro BI. Tokens de sessão exigem renovação. Uma chave de servidor existente em `SUPABASE_SERVICE_ROLE_KEY` é também suportada; deve permanecer num segredo do ambiente Vercel, nunca no cliente ou no repositório.

### Recolha noturna

`/api/cron/ingest` (Vercel Cron, 01:15 UTC, protegido por `CRON_SECRET`) grava nas tabelas `ldo_bi_*`:

- Shopify Admin API (`SHOPIFY_ADMIN_TOKEN`, scopes `read_reports` e `read_orders`): relatório de vendas, sessões e expedições por dia via ShopifyQL; totais oficiais e ticket médio dos períodos fechados; coorte de encomendas por dia com paginação completa; produtos.
- Windsor: Meta, Google Ads e GA4 por dia; totais GA4 do período; campanhas, ações, canais, públicos, CRM, pesquisa e Merchant dos três períodos fechados.
- Controlos calculados sobre o que ficou guardado, e um registo em `ldo_bi_runs` com o resultado (`completed` ou `partial`).

Por omissão recolhe os três últimos dias fechados, para apanhar revisões tardias. Um backfill aceita `?from=AAAA-MM-DD&to=AAAA-MM-DD` (até 62 dias):

```sh
curl -H "Authorization: Bearer $CRON_SECRET" "https://<domínio>/api/cron/ingest?from=2026-09-15&to=2026-09-30"
```

Escreve com `SUPABASE_SERVICE_ROLE_KEY`, só no servidor. `/api/cron/refresh` continua disponível como monitor de cobertura, a pedido.

### Cache

As leituras Windsor do modo direto são reutilizadas durante 15 minutos e os fechos guardados durante 5 minutos. A recolha invalida a cache ao terminar. Falhas de leitura nunca ficam em cache.

O modo direto consulta os conectores, que podem servir cache upstream, e distingue os valores observados dos fechos oficiais.

### Acesso

Cinco tentativas falhadas no login bloqueiam o cliente durante 15 minutos (memória da instância; uma regra de rate limit na firewall Vercel acrescenta um limite global). Mudar `DASHBOARD_PASSWORD` termina todas as sessões abertas.

Dados em falta não são zero. Utilizadores distintos e ticket médio exigem consulta oficial de todo o período. A concordância de totais não certifica tracking. Custos incompletos não permitem calcular lucro.

No modo direto, Shopify representa uma coorte recolhida pela data de criação portuguesa, com estado observado na consulta e cobertura não certificada. Linhas de reversão são excluídas por `order_count`; conflitos e moedas incompatíveis suspendem os agregados. Não se substituem `total_sales`, `average_order_value` ou MER por valores desta coorte. GA4 consulta utilizadores no período inteiro. Campanhas, ações, públicos, CRM e pesquisa são conjuntos distintos, com limitações explícitas.

O build de produção verifica login e acesso às quatro fontes principais, sem registar credenciais ou dados comerciais. Uma falha bloqueia a publicação e preserva a versão existente; em emergência, `RELEASE_SKIP_DATA_CHECK=1` publica uma correção mantendo a verificação do login. Ver [auditoria](docs/dashboard-audit.md).

## Estrutura

- `app/page.tsx` — enquadramento, períodos e navegação.
- `components/dashboard/` — uma secção por ficheiro (`overview`, `sales`, `marketing`, `audience`, `quality`), mais `trend`, `ui` e `format`.
- `lib/bi/` — `model` (cálculos e regras de estado das encomendas), `periods`, `store` (leitura), `live` + `windsor` (modo direto), `ingest` + `shopify` + `supabase-write` (recolha).

A CI corre `npm ci`, `npm test` e `npm run build` em cada pull request e em cada push para `main`.
