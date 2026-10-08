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

### Investimento online e lojas físicas

O investimento Meta e Google separa-se em **Online**, **Loja física** (por loja) e **Partilhado** (`lib/bi/channels.ts`). Uma campanha com a palavra-chave de uma loja no nome (Administração → Lojas) é dessa loja; as restantes são do online. O Super Admin define exceções em Administração → Campanhas (tabela `ldo_campaign_channels`; vale para todo o histórico). O MER e o investimento do e-mail diário passam a contar só o online. A recolha guarda o detalhe das campanhas por dia, para separar qualquer período. Esta separação prepara a comparação com os orçamentos de 2027 (online e negócio físico).

### Apoio ao Cliente

`/apoio` centraliza as conversas do **Email** (caixa do apoio no Gmail), do **Zendesk** (tickets) e das mensagens privadas do **Facebook Messenger** e **Instagram** (Inbox Metricool, marca Loja do Ouro Jericó, blogId 2912472). **WhatsApp** está por configurar (fase seguinte, WhatsApp Cloud API, independente do Zendesk). Comentários de publicações e de anúncios ficam fora desta fase; a única resposta automática é a do email ("recebemos o seu email").

- **Acesso**: Super Admin ou utilizadores com "Apoio ao Cliente" (Administração → Utilizadores). Só o Super Admin vê `/apoio/configuracao` (ligações, frequência, acessos, diagnóstico).
- **Zendesk** (`goldstorepremium.zendesk.com`): OAuth por colaborador, para que cada resposta e nota saia com a autoria de quem a escreve. Scopes `tickets:read tickets:write users:read`. Redirect URL: `https://loja-do-ouro-dashboard.vercel.app/api/support/zendesk/callback`. O `state` é aleatório, de uso único (10 min), ligado à pessoa na BD e a um cookie httpOnly com PKCE. Tokens cifrados com AES-256-GCM (`SUPPORT_ENCRYPTION_KEY`); a renovação é feita por um só pedido de cada vez (lease em `ldo_support_zendesk_connections`), porque cada renovação invalida o par anterior. O Zendesk é a fonte de verdade de mensagens, estado e responsável: o dashboard escreve primeiro no Zendesk e guarda o que o Zendesk devolve; a sincronização nunca escreve no Zendesk. Uma resposta aceite pelo Zendesk só chega ao cliente se as notificações do canal estiverem ativas.
- **Email** (caixa `apoiocliente@lojadoouro.pt` no Google Workspace, canal "Email", para substituir o Zendesk): uma só ligação OAuth da caixa partilhada, feita pelo Super Admin em `/apoio/configuracao` (âmbito `gmail.modify`, app Internal, PKCE, `access_type=offline`; a rota de retorno confirma que a conta é a caixa do apoio). Redirect URI: `https://loja-do-ouro-dashboard.vercel.app/api/support/gmail/callback` (só produção). Chaves cifradas como as do Zendesk, renovadas por um só pedido de cada vez (lease e versão em `ldo_support_gmail`). Emails novos: aviso da Google por Pub/Sub (`POST /api/support/webhooks/gmail`, só com o token OIDC assinado pela Google para a conta de serviço `GMAIL_PUSH_SERVICE_ACCOUNT` e a audiência deste endereço) e a sincronização habitual, que lê o histórico da caixa (`historyId` no cursor da fonte; primeira passagem: 14 dias) e renova o `watch` antes dos 7 dias. O dashboard é a fonte de verdade do estado e do responsável. Respostas: `messages.send` na mesma conversa (`threadId`, `In-Reply-To`/`References`, "Re:" no assunto), texto e HTML, assinatura automática (`{nome}` = primeiro nome de quem envia) e até 5 anexos (imagens ou PDF). Resposta automática "recebemos o seu email" (desligada por omissão; texto dentro e fora do horário de Lisboa): só em conversas novas, uma vez por conversa e uma vez por dia por remetente, nunca a remetentes automáticos, listas, ao próprio domínio nem a spam/promoções. Para deixar o Zendesk: confirmar a entrada e as respostas, depois desligar o reencaminhamento do Gmail para o Zendesk e as respostas automáticas do Zendesk.
- **Facebook/Instagram** (Metricool, `METRICOOL_USER_TOKEN`): a Inbox não tem webhooks, por isso a sincronização é por consulta. Mensagens vêm da Metricool; estado interno, responsável e notas são do dashboard. Respostas só em texto nesta fase. A conta da marca é detetada automaticamente (ou indicada em `config.brand_id` da fonte); sem ela, conversas ambíguas não são interpretadas nem respondidas. Mensagens anuladas pelo cliente ficam marcadas e sem conteúdo.
- **Pesquisa**: a primeira sincronização Zendesk importa os tickets alterados nos últimos 30 dias; um ticket mais antigo abre-se pesquisando o número (`#1234`), que é lido do Zendesk a pedido. Uma conta de agente Zendesk só pode estar ligada a um colaborador.
- **Sincronização**: sem processos permanentes. Corre quando alguém tem `/apoio` aberto (frequência definida na configuração, 60 s por omissão), no botão Atualizar e às 06:00 UTC (`/api/cron/support-sync`, `CRON_SECRET`). Uma fonte de cada vez (lease); depois de erros a espera dobra até 30 minutos e respeita `Retry-After`. Uma falha numa plataforma não bloqueia as outras.
- **Modelo** (`ldo_support_*`): canal e conta de origem, ids externos com chaves únicas (canal, conta, id) e (conversa, id da mensagem), contactos por canal, estado interno e estado da plataforma, mensagens, notas, leituras por colaborador, presença, registo de ações e estado de sincronização. Conversas de canais diferentes ficam separadas; a associação ao cliente da loja online é manual por email (nunca pelo nome), com sugestões só por email ou telefone. As encomendas vêm da app Shopify existente.
- **Regras**: não lidas = mensagens do cliente que chegaram ao dashboard depois da última leitura de cada colaborador (a leitura só avança até à última mensagem mostrada no ecrã; não marca nada na plataforma). Uma mensagem nova do cliente reabre "Resolvido" como "Novo" (sem responsável) ou "Em atendimento" (com responsável), e passa "A aguardar cliente" a "Em atendimento"; no Zendesk é o Zendesk que reabre.
- **Envios**: A enviar → Aceite pela plataforma / Falhou / Resultado incerto; Entregue/Lida só com confirmação do canal. Cada envio tem uma chave única: repetir o pedido nunca envia duas vezes. Um resultado incerto não é repetido automaticamente: "Verificar" volta a ler a plataforma e a sincronização reconhece a mensagem; "Não foi enviada" devolve o texto ao rascunho. Notas internas nunca seguem por um caminho de envio ao cliente (no Zendesk são comentários privados).
- **Segurança**: credenciais e chamadas autenticadas só no servidor; o servidor identifica-se no Supabase com `BI_INGEST_TOKEN`; pedidos que alteram dados exigem a mesma origem e JSON; HTML recebido é convertido em texto; anexos passam pelo servidor, só imagens comuns abrem em linha. Webhook WhatsApp reservado em `/api/support/webhooks/whatsapp` (recusa tudo até estar configurado).

- **Anexos recebidos**: pré-visualização dentro do dashboard (imagens, PDF, vídeo, áudio) numa janela que abre e fecha sem descarregar. O tipo real é confirmado pelos bytes; SVG, HTML, Office e desconhecidos só se descarregam. Até 4 MB passam pelo servidor (limite das funções Vercel: 4,5 MB); anexos maiores do Zendesk abrem diretamente do endereço temporário do Zendesk. Zendesk exige os scopes `ticket_attachments:read`/`ticket_attachments:write` (scopes granulares desde agosto de 2026).
- **Anexos enviados**: imagens (e PDF no Zendesk) reduzidas no browser (máx. 2048 px, ≤ 3,5 MB, sem EXIF) e guardadas em `ldo_support_uploads` (bytes apagados ao fim de 30 dias). Zendesk: carregadas com `/api/v2/uploads` e ligadas ao comentário (até 5). Facebook/Instagram: uma imagem por mensagem, servida durante 1 hora em `/api/support/media/<token>` (token aleatório de 32 bytes) para a Meta a ir buscar — só funciona no domínio de produção (as previews estão protegidas).
- **Produtos da loja**: pesquisa de produtos ativos publicados, coleções e (com `read_online_store_pages` na app Shopify) páginas, para inserir o link na resposta; "Link + foto" anexa a fotografia do produto.
- **Assistente de IA** (Claude Opus 5.5, `@anthropic-ai/sdk`, `ANTHROPIC_API_KEY` só no servidor): separador "Assistente IA" na coluna do cliente e botão "Sugerir resposta" no campo de resposta. Propõe respostas e responde a perguntas da equipa com base na conversa, no cliente, na base de conhecimento (escrita pelo Super Admin em `/apoio/configuracao`), nas lojas físicas do dashboard e na loja online (políticas com `read_legal_policies`, páginas com `read_online_store_pages`). Ferramentas só de leitura: produtos, detalhe de produto, encomendas do cliente da conversa (pelo email do contacto, nunca escolhido pela IA), encomenda pelo número (detalhes só se for do email do cliente), respostas anteriores da equipa e outras conversas do mesmo cliente. Nunca envia: a proposta só passa para o campo de resposta com "Usar na resposta". Mensagens de clientes entram como dados (sinais `<` `>` neutralizados); ligações da proposta que nenhuma fonte mencionou ficam em "Confirmar antes de enviar". Cada pedido fica em `ldo_support_ai_messages` (visível só a quem o fez; apagado ao fim de 180 dias), com custo estimado; limite diário por pessoa e orçamento mensal na configuração. Cache de prompts: instruções e base de conhecimento (1 h) e contexto da conversa (5 min).

- **Chat do site** (botão flutuante no tema Shopify, canal "Chat do site"): o dashboard é a fonte de verdade. Rotas públicas `/api/chat/start` e `/api/chat/messages` (CORS só para as origens de `SITE_CHAT_ORIGINS`, por omissão www.lojadoouro.pt, lojadoouro.pt e lojadoouro-online.myshopify.com). Cada visitante recebe um token aleatório (na BD só o hash, `ldo_support_site_visitors`) que só dá acesso à sua conversa; notas internas nunca saem. Nome, email (obrigatório) e mensagem; o email escrito no chat fica em `claimed_email` e não conta para encomendas, sugestões nem IA. Com `SITE_CHAT_SECRET` (o mesmo valor na definição do tema), o tema assina o email de quem tem sessão iniciada e o dashboard confirma-o. Limites na BD (5 conversas por IP/hora, 20 mensagens/5 min por conversa, 300 conversas/hora no total), campo-armadilha contra robôs. O widget pergunta por novas mensagens a cada 3,5 s com o chat aberto (30 s fechado); a resposta passa a Entregue/Lida quando o chat a recebe. Quem já saiu do site (sem contacto há 45 s) recebe a resposta por email (Resend, `SITE_CHAT_FROM`, `SITE_CHAT_REPLY_TO`, `SITE_CHAT_URL`; agrupados por resposta ainda não vista), com o primeiro nome de quem respondeu. No tema entra só a secção `shopify/sections/ldo-chat.liquid` (Personalizar tema → Rodapé → Adicionar secção → "Chat Loja do Ouro"), com todas as definições; o código do widget é servido pelo dashboard em `/site-chat/ldo-chat.js` (público, cache de 5 minutos), por isso atualiza-se publicando o dashboard. A secção pode desligar o chatbot antigo da Bluedot. Teste sem o site: `/apoio/chat-teste`. Depois de o cliente iniciar o chat, o widget envia a página em que está, o carrinho (lido de `/cart.js` da loja) e o início da visita; o separador Cliente mostra "No site agora" e a IA também usa esta informação (marcada como não confirmada). Uma conversa confirmada (cliente com sessão iniciada) só continua com a mesma sessão da loja; o cliente pode "Terminar conversa" no próprio widget. Avisos por email agrupados e com nova tentativa, numa passagem que corre enquanto a equipa tem o Apoio ao Cliente aberto. Limites também por rede (/24) e por IP nas mensagens.
Variáveis novas: `SUPPORT_ENCRYPTION_KEY` (obrigatória para o Zendesk e o Gmail), `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GMAIL_PUBSUB_TOPIC` e `GMAIL_PUSH_SERVICE_ACCOUNT` (email pelo Gmail; opcionais `GMAIL_MAILBOX`, `GMAIL_REDIRECT_URI`, `GMAIL_PUSH_AUDIENCE`), `ANTHROPIC_API_KEY` (assistente de IA; sem ela o separador mostra "por configurar"), `ANTHROPIC_WORKSPACE_ID` (só para chaves que não pertencem a um workspace; enviado no cabeçalho `anthropic-workspace-id`), opcionais do chat do site `SITE_CHAT_SECRET`, `SITE_CHAT_ORIGINS`, `SITE_CHAT_FROM`, `SITE_CHAT_REPLY_TO` e `SITE_CHAT_URL`, opcionais `ZENDESK_SUBDOMAIN` e `SUPPORT_PUBLIC_URL`. Reutiliza `ZENDESK_CLIENT_ID`, `ZENDESK_CLIENT_SECRET`, `METRICOOL_USER_TOKEN`, `BI_INGEST_TOKEN` e `CRON_SECRET`. Ver `supabase/migrations/20261007120000_ldo_support.sql`.

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
- `app/apoio/`, `app/api/support/`, `components/support/`, `lib/support/` — Apoio ao Cliente (adaptadores `zendesk`, `metricool`, `whatsapp`; `sync`, `service`, `rules`).
- `components/shell.tsx` — menu e barra superior, conforme as permissões.
- `lib/session.ts`, `lib/viewer.ts`, `lib/permissions.ts`, `lib/rate-limit.ts` — login, sessão e permissões; `lib/store-records.ts` — leitura dos formulários e totais das lojas físicas.
- `components/dashboard/` — uma secção por ficheiro (`overview`, `sales`, `marketing`, `audience`, `quality`), mais `trend`, `ui` e `format`.
- `lib/bi/` — `model` (cálculos e regras de estado das encomendas), `periods`, `store` (leitura), `live` + `windsor` (modo direto), `ingest` + `shopify` + `supabase-write` (recolha).

A CI corre `npm ci`, `npm test` e `npm run build` em cada pull request e em cada push para `main`.

**Responsável das conversas** (`supabase/migrations/20261008170000_ldo_support_ownership.sql`, regras também em `lib/support/rules.ts`): só o responsável responde ao cliente; numa conversa sem responsável, quem responde primeiro (ou carrega em "Assumir conversa") fica responsável. Os colegas podem deixar notas internas. O responsável ou o Super Admin transferem a conversa ("Transferir para…"); deixar sem responsável é só para o Super Admin. As mudanças aparecem na própria conversa. No chat do site o cliente vê o primeiro nome de quem o atende ("A falar com Bárbara") e o aviso "A conversa foi transferida para Diana." (vem do registo, não é uma mensagem). Quem recebe uma conversa recebe um email com a ligação direta (`/apoio?conversa=<id>`), se tiver email na ficha de utilizador; remetente `SUPPORT_EMAIL_FROM` (ou `SITE_CHAT_FROM`), com o domínio verificado no Resend. As respostas no chat do site aceitam formatação simples construída pelo widget (nunca HTML): parágrafos, listas ("- " ou "1. "), **negrito** e ligações; a ligação de um produto da loja sozinha numa linha aparece como cartão com foto e preço (lidos de `/products/<handle>.js` na própria loja).

**Terminar a conversa no chat do site** (`supabase/migrations/20261008180000_ldo_support_site_end.sql`, `/api/chat/end`): a confirmação aparece dentro do chat (não a janela do browser), com a opção "Enviar-me uma cópia desta conversa por email" (só para o email que o cliente indicou; uma vez, porque a conversa deixa de responder ao token). No fim, um ecrã de agradecimento com "Iniciar nova conversa". A equipa vê na conversa "O cliente terminou a conversa no site"; as respostas que der depois continuam a seguir por email.

**Encomendas no painel do cliente**: cada encomenda abre com os produtos comprados (foto, quantidade, opção, referência e preço), a ligação à Shopify e à página da encomenda do cliente, e o telemóvel registado na loja (da encomenda, da morada de envio ou da ficha do cliente). Os números de encomenda que o cliente escreve na conversa ("#12345", "encomenda nº 12345") aparecem como botões para abrir a encomenda (`/api/support/orders`); se não for do email do contacto, o painel avisa para confirmar a identidade antes de partilhar dados. O telemóvel é um dado protegido: sem essa autorização na app Shopify (e `read_customers` para a ficha do cliente) as encomendas aparecem na mesma, com uma nota.
