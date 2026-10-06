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

O servidor lê e grava os fechos (`public.ldo_bi_*`) através das funções `ldo_bi_read`, `ldo_bi_write`, `ldo_bi_start_run`, `ldo_bi_finish_run` e `ldo_bi_close_stale_runs`, que exigem o token `BI_INGEST_TOKEN` (o hash está em `ldo_private.bi_token`). Não é precisa a chave `service_role`. Variáveis: `BI_SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `BI_INGEST_TOKEN`. Sem elas, o dashboard lê diretamente do Windsor.

### Recolha noturna

`/api/cron/ingest` (Vercel Cron, 01:15 UTC, protegido por `CRON_SECRET`) grava nas tabelas `ldo_bi_*`:

- Shopify Admin API (app criada no Dev Dashboard da Shopify, com `read_reports`, `read_orders`, `read_all_orders` e `read_products`; `SHOPIFY_CLIENT_ID` e `SHOPIFY_CLIENT_SECRET` trocados por um token de 24 h; um `SHOPIFY_ADMIN_TOKEN` antigo continua aceite): relatório de vendas, sessões e expedições por dia via ShopifyQL; totais oficiais e ticket médio dos períodos fechados; coorte de encomendas por dia com paginação completa; produtos.
- Windsor: Meta, Google Ads e GA4 por dia; totais GA4 do período; campanhas, ações, canais, públicos, pesquisa e Merchant dos três períodos fechados.
- Klaviyo API (`KLAVIYO_API_KEY`, chave privada só de leitura): campanhas e fluxos de email dos três períodos fechados, com destinatários, conversões e valor (métrica "Placed Order" da Shopify).
- Metricool API (`METRICOOL_USER_TOKEN`; `METRICOOL_USER_ID` e `METRICOOL_BLOG_ID` têm por omissão a marca Loja do Ouro): Instagram e página de Facebook por dia (seguidores, alcance, interações, publicações) e melhores publicações dos três períodos fechados — secção "Redes sociais".
- Uma fonte sem chave fica registada como falha parcial; as restantes são gravadas na mesma.
- Controlos calculados sobre o que ficou guardado, e um registo em `ldo_bi_runs` com o resultado (`completed` ou `partial`).

Por omissão recolhe os três últimos dias fechados, para apanhar revisões tardias. Um backfill aceita `?from=AAAA-MM-DD&to=AAAA-MM-DD` (até 62 dias):

```sh
curl -H "Authorization: Bearer $CRON_SECRET" "https://<domínio>/api/cron/ingest?from=2026-09-15&to=2026-09-30"
```

Escreve com `BI_INGEST_TOKEN`, só no servidor. `/api/cron/refresh` continua disponível como monitor de cobertura, a pedido.

### Cache

As leituras Windsor do modo direto são reutilizadas durante 15 minutos e os fechos guardados durante 5 minutos. A recolha invalida a cache ao terminar. Falhas de leitura nunca ficam em cache.

O modo direto consulta os conectores, que podem servir cache upstream, e distingue os valores observados dos fechos oficiais.

### Acesso

Cada pessoa entra com utilizador e palavra-passe, criados no backoffice (Utilizadores). As palavras-passe ficam cifradas em Supabase (bcrypt) e nunca passam pelo código do dashboard depois do login. `ldo_login` devolve um token de sessão aleatório, guardado num cookie httpOnly durante 12 horas. Cinco palavras-passe erradas bloqueiam a conta durante 15 minutos, e há também um limite por endereço de rede. Uma palavra-passe nova, definida pelo administrador ou pela própria pessoa, termina as sessões abertas. Quem recebe uma palavra-passe temporária tem de a mudar no primeiro acesso.

Permissões, independentes por utilizador:

- **Super Admin** — vê tudo, gere lojas e utilizadores, dá qualquer acesso (incluindo Super Admin). Tem de existir sempre um ativo.
- **Loja Online** — as secções Shopify, campanhas, públicos e qualidade.
- **Lojas físicas**, por loja: **Gestor** (vê e compara as suas lojas, corrige e apaga registos, gere utilizadores de nível Loja nessas lojas) ou **Loja** (lança as vendas diárias, corrige o próprio lançamento durante 24 horas, vê o histórico).

As regras são aplicadas em Supabase: as tabelas `ldo_app_*` e `ldo_store_sales*` não são acessíveis diretamente, e todas as leituras e escritas passam pelas funções `ldo_*`, que recebem o token de sessão e verificam as permissões. Por isso o dashboard só precisa da chave pública do projeto. Cada lançamento, correção e apagamento fica em `ldo_store_sales_history` (antes/depois, quem e quando); apagar é sempre uma marca, nunca uma remoção. Ver `supabase/migrations/`.

Variáveis: `BI_SUPABASE_URL` (ou `SUPABASE_URL`) e `SUPABASE_PUBLISHABLE_KEY`.

### Lojas físicas

Substituem os dois Excel das lojas (importados em outubro de 2026 com `scripts/import-store-excel.py`):

- **Vendas e atendimentos** (`/lojas`, antes "Análise de Vendas"): um registo por cliente atendido, com ou sem venda — n.º de venda, valor, artigos (referência, material, tipo), campanha, tipo de cliente, onde viu o produto, se já comprou online, para quem é, reposição, motivo de não venda e o que procurava.
- **Compra de ouro** (`/lojas/ouro`, antes "Eficácia das campanhas de marketing"): um registo por cliente que vem vender ouro usado ou fazer contrato, com como conheceu a Loja do Ouro (as opções marcadas como "internet" dão a % digital), se fechou negócio, e gramas e valor pago por quilate. Os meses anteriores (2022–set. 2026) vêm dos totais mensais do Excel.
- **Comparar lojas** (`/lojas/comparar`, Gestores): vendas, compra de ouro e gasto Google Ads por loja. A campanha conta para a loja cuja palavra (Administração → Lojas) aparece no nome; o custo por cliente da internet é uma relação, não prova de atribuição.
- **Ranking das lojas** (`/lojas/ranking`, Gestores): todas as lojas ordenadas por valor vendido ou por compra de ouro (ontem, semana, mês ou datas à escolha), com pódio, comparação com o período anterior e, para um só dia, as lojas que não registaram dados.
- **Listas de opções** (`/admin/opcoes`, Super Admin): as escolhas dos formulários.

### Relatórios por email

Tarefas agendadas no Vercel (`vercel.json`, horas UTC) chamam `/api/cron/reports` com `CRON_SECRET`:

- `?run=morning` (07:30 UTC): relatório diário do dia anterior; às segundas também o semanal e no dia 1 o mensal. Cada um inclui a loja online (vendas Shopify, investimento, sessões), o resumo das lojas físicas e o ranking das 13 lojas.
- `?run=evening` (21:00 UTC): alerta "lojas que não comunicaram dados" — lojas ativas, abertas nesse dia da semana (Administração → Lojas → dias de fecho), sem nenhum atendimento nem compra de ouro registado. Não é enviado se todas registaram.

Destinatários: Super Admins ativos com email e "Receber relatórios" (Administração → Utilizadores). Em Administração → Relatórios por email há a pré-visualização, o envio de teste e o registo de envios.

Variáveis: `RESEND_API_KEY` (envio via [Resend](https://resend.com)), `REPORTS_TOKEN` (acesso do servidor aos dados; o hash está em `ldo_private.report_token`), opcionais `REPORTS_FROM` (remetente, depois de verificar o domínio no Resend; até lá usa `onboarding@resend.dev`, que só entrega ao email da conta Resend) e `DASHBOARD_URL` (links nos emails).

Dados em falta não são zero. Utilizadores distintos e ticket médio exigem consulta oficial de todo o período. A concordância de totais não certifica tracking. Custos incompletos não permitem calcular lucro.

No modo direto, Shopify representa uma coorte recolhida pela data de criação portuguesa, com estado observado na consulta e cobertura não certificada. Linhas de reversão são excluídas por `order_count`; conflitos e moedas incompatíveis suspendem os agregados. Não se substituem `total_sales`, `average_order_value` ou MER por valores desta coorte. GA4 consulta utilizadores no período inteiro. Campanhas, ações, públicos, CRM e pesquisa são conjuntos distintos, com limitações explícitas.

O build de produção verifica a configuração do login e o acesso às quatro fontes principais, sem registar credenciais ou dados comerciais. Uma falha bloqueia a publicação e preserva a versão existente; em emergência, `RELEASE_SKIP_DATA_CHECK=1` publica uma correção mantendo a verificação do login. Ver [auditoria](docs/dashboard-audit.md).

## Estrutura

- `app/page.tsx` — loja online: enquadramento, períodos e secções.
- `app/lojas/` — vendas e atendimentos, compra de ouro e comparação entre lojas.
- `app/admin/` — utilizadores e lojas; `app/conta/` — mudar a própria palavra-passe.
- `components/shell.tsx` — menu e barra superior, conforme as permissões.
- `lib/session.ts`, `lib/viewer.ts`, `lib/permissions.ts`, `lib/rate-limit.ts` — login, sessão e permissões; `lib/store-records.ts` — leitura dos formulários e totais das lojas físicas.
- `components/dashboard/` — uma secção por ficheiro (`overview`, `sales`, `marketing`, `audience`, `quality`), mais `trend`, `ui` e `format`.
- `lib/bi/` — `model` (cálculos e regras de estado das encomendas), `periods`, `store` (leitura), `live` + `windsor` (modo direto), `ingest` + `shopify` + `supabase-write` (recolha).

A CI corre `npm ci`, `npm test` e `npm run build` em cada pull request e em cada push para `main`.
