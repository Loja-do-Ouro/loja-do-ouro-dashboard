# Configuração do apoio
<!-- resumo: Guia do Super Admin para todas as opções da Configuração do apoio e da IA do apoio: ligações, sincronização, email, respostas automáticas, assistente e base de conhecimento, chat do site, acessos, revisão, respostas aprovadas e pedido de avaliação. -->
<!-- publico: super-admin -->
<!-- termos: configuração, configurar, definições, settings, admin, administração, Super Admin, ligações, integrações, Validar ligações, diagnóstico, Zendesk, Metricool, Gmail, ligar Gmail, sincronização, frequência, Sincronizar agora, WhatsApp, histórico visível, assinatura, horário, respostas automáticas, assistente, IA, ANTHROPIC_API_KEY, orçamento, limite diário, base de conhecimento, chat do site, acessos, dar acesso, retirar acesso, novo utilizador, revisão, critérios, respostas aprovadas, base de conhecimento aprendida, propostas automáticas, pedido de avaliação, auditoria, limpezas -->
<!-- atualizado: 2026-10-30 -->

Só o Super Admin vê estas páginas. Quem não é Super Admin e tenta abri-las volta à sua página inicial, e a base de dados recusa qualquer alteração ("Só o Super Admin configura o Apoio ao Cliente."). Há duas páginas:

- **Configuração do apoio** (menu APOIO AO CLIENTE → Configuração do apoio): "Ligações às plataformas, sincronização e acessos."
- **IA do apoio** (ligações **Configurar a revisão**, **Rever as respostas** ou **Configurar o pedido de avaliação** dentro da primeira): revisão das respostas antes de enviar, base de conhecimento aprendida (respostas aprovadas) e pedido de avaliação.

As alterações às definições ficam registadas (quem, quando, o quê).

## Validar ligações
<!-- perguntas: Como verifico se as ligações estão a funcionar? | Para que serve Validar ligações? -->

O botão **Validar ligações**, no topo, abre a mesma página com um diagnóstico de cada plataforma: a marca da Metricool, a página do Facebook e o Instagram ligados, as autorizações da Inbox e a estrutura dos comentários. O diagnóstico só mostra identificadores, estados, datas e contagens, nunca textos, nomes ou dados pessoais. Use-o quando um canal estiver **Bloqueado** ou em **Erro**.

## Zendesk
<!-- perguntas: Como desligo o Zendesk? | Como desligo a conta Zendesk de uma colaboradora? | Como volto a ligar o Zendesk? -->

Painel **Zendesk** (TICKETS):

- **Conta**, **No dashboard** (Ligado ou Desligado), **Cliente OAuth**, **Cifra dos tokens**, **Scopes pedidos** e **Redirect URL** (estado técnico da ligação).
- Tabela **Colaborador / Conta Zendesk / Estado** com cada agente ligado ("Ligado" ou "Voltar a ligar", e a data até à qual a ligação se renova). **Desligar** remove a ligação dessa pessoa.
- **Desligar o Zendesk** (com a caixa "Confirmo: deixa de entrar e de sair qualquer mensagem pelo Zendesk no dashboard"): o canal passa a "Desligado (só histórico)", as ligações de todos os agentes são revogadas e apagadas, e os tickets importados ficam como histórico. Se alguma revogação falhar, a mensagem diz quantas e onde as revogar no Zendesk.
- Com o Zendesk desligado: **Revogar e apagar as ligações que ficaram** e **Voltar a ligar o Zendesk** (com a caixa "Confirmo: o estado e o responsável dos tickets Zendesk voltam a vir do Zendesk, e as alterações feitas só aqui podem perder-se"). Depois de voltar a ligar, cada pessoa liga outra vez a sua conta.

Cada colaboradora liga a sua própria conta de agente (botão **Ligar Zendesk** nas Conversas). Nenhuma resposta usa a conta do administrador. Uma resposta aceite pelo Zendesk só chega ao cliente se as notificações (triggers) do canal estiverem ativas.

## Facebook e Instagram (Metricool)
<!-- perguntas: Como está ligado o Facebook ao dashboard? | O Facebook ficou bloqueado, como resolvo? -->

Painel **Facebook e Instagram (Metricool)** (MENSAGENS PRIVADAS): **Marca** (blogId e userId), **Token Metricool** (o mesmo das Redes sociais), **Sincronização** (consulta periódica: a Inbox da Metricool não tem avisos) e **Anexos na resposta**.

> **Nota:** O painel ainda diz "Anexos na resposta: Não nesta fase (só texto)" e "Comentários de publicações e de anúncios ficam fora desta fase", mas hoje as respostas privadas aceitam uma imagem e os comentários são um canal próprio. O que vale é o comportamento descrito em [Facebook e Instagram](/apoio/documentacao/facebook-instagram) e [Comentários públicos](/apoio/documentacao/comentarios-publicos).

Quando a Metricool perde a ligação (indicador **Bloqueado**), a mensagem de erro explica a causa: a ligação da rede em falta na marca, ou a autorização da Meta anulada (por exemplo, mudança de palavra-passe ou perda de acesso à página). Use **Validar ligações**, confirme com a Metricool e volte a ligar a rede na mesma marca, com a conta do token da API e um perfil com controlo total da página.

As respostas públicas aos comentários começam desligadas e só devem ser ligadas depois de validadas num comentário de teste.

## Sincronização
<!-- perguntas: Como mudo a frequência da sincronização? | O que faz Sincronizar agora? -->

Painel **Sincronização** (FONTES):

- **Frequência com o dashboard aberto (segundos)**: entre 30 e 3600, de 10 em 10; de origem, 60. Carregue em **Guardar**.
- Tabela **Fonte / Estado / Última sincronização / Próxima**, com o último erro, o número de falhas seguidas e a "Última mensagem recebida" de cada fonte. Estados: Ativo, A aguardar, Erro, Bloqueado, Por configurar, Desligado.
- **Sincronizar agora**: lê todas as fontes, **mesmo as que estão em espera depois de erros** (útil depois de corrigir uma ligação).

O painel diz também quantas conversas estão guardadas e quantas estão por resolver. A sincronização corre com alguém nas Conversas, no botão Atualizar, de 5 em 5 minutos pela verificação automática e numa passagem diária. Ver [Canais](/apoio/documentacao/canais#quando-as-mensagens-chegam).

## WhatsApp
<!-- perguntas: Como ligo o WhatsApp? -->

Painel **WhatsApp** (FASE SEGUINTE): só informativo. Número e conta empresarial "Reservado … por configurar"; o webhook recusa pedidos até estar configurado. Nada foi ligado e o WhatsApp dos telemóveis não foi alterado.

## Histórico visível
<!-- perguntas: Onde mudo a data do histórico visível? -->

Painel **Histórico visível** (CONVERSAS): **Histórico visível a partir de** (só datas até hoje) e **Guardar**. Mostra quantas conversas resolvidas estão ocultas. Ver [Histórico visível](/apoio/documentacao/historico-visivel).

## Email (Gmail)
<!-- perguntas: Como ligo a caixa Gmail? | Como mudo a assinatura dos emails? | Como ligo a resposta automática do email? | Como defino o horário de atendimento do email? -->

Painel **Email (Gmail)** (CAIXA DO APOIO).

**Ligação** (à esquerda): **Caixa**, **Ligação** ("Por ligar", "Ligada" ou "Voltar a ligar", com quem ligou e quando), **Cliente OAuth**, **Cifra das chaves**, **Avisos da Google** (ativos até… e renovados sozinhos), **Redirect URI**, **Endereço dos avisos** e **Sincronização**.

- **Ligar Gmail** / **Voltar a ligar Gmail**: só funciona no dashboard de produção (o endereço registado na Google). Entre com a conta da caixa do apoio.
- **Desligar a caixa** (com "Confirmo"): o canal Email deixa de receber e enviar.

Só entram os emails que chegam depois de a caixa ser ligada. Para deixar de usar o Zendesk para o email: depois de confirmar que os emails entram e as respostas chegam, desligue no Gmail o reencaminhamento para o Zendesk e, no Zendesk, as respostas automáticas, para o cliente não receber mensagens em duplicado.

**Definições** (à direita):

| Campo | Para que serve |
| --- | --- |
| Assinatura automática | Entra em todas as respostas por email; `{nome}` é trocado pelo primeiro nome de quem responde (até 2000 caracteres) |
| Resposta automática ligada ("recebemos o seu email") | Liga ou desliga a confirmação de receção |
| Texto dentro do horário | Texto da confirmação dentro do horário (até 4000 caracteres) |
| Texto fora do horário | Texto da confirmação fora do horário (até 4000 caracteres) |
| Dias úteis, Sábado, Domingo | Horário de Lisboa no formato `09:30-13:00, 14:00-18:30`; vazio = fechado |

O horário só escolhe o texto da resposta automática; os feriados não contam. Um horário mal escrito é recusado ("Horário de … não reconhecido…"). Carregue em **Guardar**.

## Respostas automáticas — Facebook e Instagram
<!-- perguntas: Como ligo as respostas automáticas do Instagram? | Como mudo o agradecimento às reações? -->

Painel **Respostas automáticas — Facebook e Instagram** (MENSAGENS PRIVADAS):

| Campo | Para que serve |
| --- | --- |
| Respostas automáticas ligadas | Liga ou desliga (é preciso pelo menos um texto) |
| Pedido de apoio fora do horário | Mensagem a quem escreve fora do horário (até 1000 caracteres) |
| Pedido de apoio dentro do horário (opcional) | Vazio = dentro do horário a equipa responde, sem resposta automática |
| Agradecimento a reações (story, gosto, emoji) | Vazio = não agradece (até 300 caracteres) |
| Dias úteis, Sábado, Domingo | Horário de Lisboa (por exemplo 07:00-21:00); com os três vazios, a mensagem de fora do horário sai sempre |

`{nome}` é trocado pelo primeiro nome da pessoa (no Instagram, o nome de utilizador). Só se responde a mensagens chegadas depois de ligar a função e com menos de 3 horas.

Este interruptor controla também o separador **Automáticas** das Conversas: com as respostas automáticas ligadas, as conversas novas só com reações saem da lista principal para esse separador (mesmo com o agradecimento vazio); desligadas, ficam na lista principal. Ver [Respostas automáticas](/apoio/documentacao/respostas-automaticas#o-separador-automaticas).

> **Atenção:** Antes de ligar, no Meta Business Suite → Caixa de entrada → Automatizações, desligue a "Mensagem de ausência" no Facebook e no Instagram, para o cliente não receber duas mensagens.

As regras completas estão em [Respostas automáticas](/apoio/documentacao/respostas-automaticas).

## Assistente de IA
<!-- perguntas: Como desligo o assistente de IA? | Como mudo o limite diário da IA? | Quanto custa a IA? | Como configuro a chave da Anthropic? -->

Painel **Assistente de IA** (RESPOSTAS COM IA). À esquerda, o estado:

- **Chave da Anthropic** (variável ANTHROPIC_API_KEY, sensível, na Vercel) e **Workspace da Anthropic** (ANTHROPIC_WORKSPACE_ID, só se a chave não pertencer a um workspace).
- **Modelo**: Claude Opus 5.5, esforço médio.
- **O que a IA lê** e **Loja online** (quantas políticas e páginas publicadas a IA consegue ler, e o que falta).
- **Este mês**: custo estimado, pedidos e pedidos com erro.
- **Revisão antes de enviar**, **Base de conhecimento aprendida** e **Pedido de avaliação**: resumo e ligação para a página IA do apoio. A linha da base de conhecimento aprendida diz se as propostas automáticas estão ligadas, o custo do mês e o orçamento, os pedidos, quantas propostas há por rever e quantas respostas estão em uso pela IA (ligação **Rever as respostas**).
- Tabela **Pessoa / Pedidos / Custo estimado** do mês (sem o conteúdo dos pedidos).

À direita, o formulário:

| Campo | Valor de origem | Limites |
| --- | --- | --- |
| Assistente ligado | Ligado | — |
| Pedidos por pessoa e por dia | 80 | 0 a 1000 |
| Orçamento mensal (US$) | 30 | 0 a 10 000 |

Um campo vazio nunca conta como 0. Ao atingir o orçamento do mês, os pedidos param até ao mês seguinte ou até o aumentar. O custo é uma estimativa; a fatura da Anthropic é a referência.

Para criar a chave: console.anthropic.com → API Keys → Create Key; depois, na Vercel, Settings → Environment Variables → ANTHROPIC_API_KEY (Sensitive, Production e Preview) e um novo deploy.

## Base de conhecimento
<!-- perguntas: Como ensino coisas à IA? | Como acrescento informação à base de conhecimento? | O que devo escrever na base de conhecimento? -->

Dentro do painel do assistente, a **Base de conhecimento** é o que a IA deve saber sobre a empresa e que não está na loja online: moradas e horários das lojas, prazos e custos de envio, trocas e garantias, reparações, gravações, compra de ouro, tom de voz e assinatura. **A IA trata isto como verdade**: escreva só o que está em vigor.

- Cada secção tem **Título** (até 120 caracteres), **Ordem** (0 a 10 000) e texto (até 20 000 caracteres). **Guardar secção** grava; **Apagar secção** (com "Confirmo") apaga.
- **Nova secção** → título, ordem e texto → **Criar secção**.
- Secções sem texto são ignoradas ("por preencher"). No total, até 60 secções e 150 000 caracteres.
- A mesma base serve o assistente e a revisão das respostas, e prevalece sobre as [respostas aprovadas](/apoio/documentacao/respostas-aprovadas). Os telefones, moradas e emails da empresa que estão aqui são aceites nos cartões das respostas aprovadas; um telefone ou outro número da empresa que não esteja na base de conhecimento, nas lojas nem na assinatura do email é recusado como dado pessoal (uma morada só dá aviso).
- Cada alteração fica registada.

> **Dica:** Escreva frases curtas e factuais, com os valores em vigor (por exemplo, "Envios para os Açores e a Madeira: prazo de N dias úteis; portes de X €."). Quando uma regra mudar, atualize logo a secção: a IA e a revisão passam a usar o texto novo no pedido seguinte.

## Chat do site
<!-- perguntas: Como está instalado o chat no site? | Porque é que o email do chat não fica confirmado? | Onde mudo as cores e o horário do chat? -->

Painel **Chat do site** (BOTÃO NO SITE): **Estado**, **Sites autorizados** (SITE_CHAT_ORIGINS), **Clientes com sessão** (SITE_CHAT_SECRET, com o mesmo valor na definição do tema; sem ele, o email escrito no chat fica não confirmado) e **Aviso por email** (o envio de emails aos clientes que saíram do site; precisa de um domínio verificado no Resend).

O botão instala-se no tema Shopify com a secção "Chat Loja do Ouro" (Personalizar tema → Rodapé → Adicionar secção), onde ficam as cores, os textos, a posição e o horário. O código do chat vem do dashboard. **Testar o chat** abre a página de teste ([Chat do site](/apoio/documentacao/chat-do-site#testar-o-chat)).

## Quem usa o Apoio ao Cliente
<!-- perguntas: Como dou acesso ao apoio a uma pessoa nova? | Como retiro o acesso ao apoio? | Como crio uma colaboradora nova no apoio? -->

Painel **Quem usa o Apoio ao Cliente** (ACESSOS): lista **Pessoa / Acesso** (Super Admin, Apoio ao Cliente ou Sem acesso) com **Dar acesso** e **Retirar acesso**. Cada mudança fica registada.

Para uma pessoa nova:

1. Em **Administração → Utilizadores**, crie o utilizador (com email, para receber os avisos de transferência) e marque **Apoio ao Cliente** em "Acessos gerais".
2. Se o Zendesk estiver ligado, garanta que tem licença de agente (o plano Zendesk Team tem 3) e peça-lhe que carregue em **Ligar Zendesk**.
3. Envie-lhe o artigo [Começar aqui](/apoio/documentacao/comecar-aqui) e informe-a, por escrito, de como funciona a avaliação por pessoa ([Dados dos colaboradores e avaliação do atendimento](/apoio/documentacao/dados-dos-colaboradores)).

Quando alguém sai da equipa: retire o acesso, transfira as conversas que estavam com essa pessoa e desligue a conta Zendesk dela (painel Zendesk → **Desligar**).

## IA do apoio: revisão antes de enviar
<!-- perguntas: Como ligo a revisão da IA? | Como mudo os critérios da revisão? | Que modelo usar na revisão? -->

Página **IA do apoio**, painel **Revisão da IA antes de enviar** (QUALIDADE DAS RESPOSTAS):

| Campo | Opções | Origem |
| --- | --- | --- |
| Revisão da IA antes de enviar | Desligada · Opcional (cada pessoa pode desligar) · Para todos | Desligada |
| Modelo da revisão | Rápido e económico (Claude Haiku 5.5) · Mais cuidadoso (Claude Sonnet 5.5) | Haiku |
| Orçamento mensal da revisão (US$) | 0 a 10 000 | 5 |
| Critérios de qualidade e de bom atendimento | Um por linha, até 4000 caracteres | 11 critérios |

Ao lado: **Este mês (totais da equipa)**, a aceitação das sugestões nos últimos 14 dias (com um alerta abaixo de 20%: "torne os critérios mais claros ou mais exigentes") e as suas próprias revisões. Nunca há números por pessoa.

A revisão tem orçamento próprio, não conta para o limite diário do assistente e tem um máximo de 300 revisões por pessoa e por dia. Sem a chave da Anthropic, as respostas seguem sem revisão. Funcionamento completo em [Revisão da IA antes de enviar](/apoio/documentacao/revisao-ia-antes-de-enviar).

## IA do apoio: base de conhecimento aprendida
<!-- perguntas: Como ligo as propostas automáticas das respostas aprovadas? | Onde reviso as respostas aprovadas? | Qual é o orçamento da base de conhecimento aprendida? -->

Página **IA do apoio**, painel **Base de conhecimento aprendida** (RESPOSTAS APROVADAS), entre a revisão e o pedido de avaliação:

| Campo | Opções | Origem |
| --- | --- | --- |
| Propostas automáticas a partir das conversas | Ligada ou desligada (até 12 conversas por dia, na passagem diária) | Desligada |
| Orçamento mensal das propostas (US$) | 0 a 10 000 | 8 |

Carregue em **Guardar**. Ao lado: **Este mês** (custo, pedidos à IA, propostas novas, confirmações de respostas que já existiam, sem pergunta geral e retiradas pelas regras de segurança), **Respostas** (propostas, aprovadas, em uso pela IA, marcadas para respostas automáticas e arquivadas), **Publicação** (a última) e o botão **Publicar alterações (n)**.

Por baixo ficam os separadores **Propostas**, **Aprovadas** e **Arquivadas**, a pesquisa, os cartões com as ações (**Guardar correções**, **Guardar e aprovar**, **Arquivar**, **Juntar**, **Permitir em respostas automáticas**) e o formulário **Nova resposta**. O botão "Guardar como resposta aprovada" das Conversas funciona sempre, com as propostas automáticas ligadas ou desligadas. Sem a chave da Anthropic não há propostas. Funcionamento completo, confirmação de cada cartão, recusas e avisos em [Respostas aprovadas](/apoio/documentacao/respostas-aprovadas).

## IA do apoio: pedido de avaliação
<!-- perguntas: Como ligo o pedido de avaliação? | Que canais têm pedido de avaliação? | Quanto tempo depois de resolver sai o pedido? -->

Página **IA do apoio**, painel **Pedido de avaliação depois de resolver** (SATISFAÇÃO DOS CLIENTES). Funciona sem IA, com custo zero.

| Campo | Opções | Origem |
| --- | --- | --- |
| Pedido de avaliação ao cliente | Desligado · Perguntar ao resolver · Automático (recomendado) | Desligado |
| Espera antes do pedido no Messenger, no Instagram e no email (minutos) | 0 a 120 | 10 |
| Canais | Messenger (Facebook), Instagram Direct, Email, Chat do site | Todos |

Ao lado, os totais do mês: pedidos enviados, não enviados pelas regras, com falha, sem pedido por escolha (modo Perguntar), avaliações e notas de 1 ou 2 a acompanhar.

> **Atenção:** Antes de ligar pela primeira vez, informe a equipa, por escrito, de que as avaliações passam a contar por pessoa. Os resultados por pessoa só começam na data em que o pedido é ligado pela primeira vez. Ver [Dados dos colaboradores e avaliação do atendimento](/apoio/documentacao/dados-dos-colaboradores).

## Tarefas automáticas e limpezas
<!-- perguntas: Que limpezas automáticas o sistema faz? | Quando corre a passagem diária? -->

| Tarefa | Quando |
| --- | --- |
| Verificação automática (redes sociais, email, Zendesk, comentários, respostas automáticas, pedidos de avaliação) | De 5 em 5 minutos |
| Passagem diária de sincronização e limpezas (e, com as propostas automáticas ligadas, leitura de até 12 conversas para propor respostas aprovadas) | Todos os dias às 06:00 UTC |
| Avisos por email do chat do site | No máximo uma vez por minuto, enquanto alguém tem as Conversas abertas |

Limpezas da passagem diária:

| O quê | Apagado ao fim de |
| --- | --- |
| Ficheiros enviados pela equipa | Até 30 dias, ou menos quando o anexo já fica guardado na plataforma (1 dia se nunca foram enviados) |
| Pedidos ao assistente de IA | 180 dias |
| Dados do visitante do chat do site (sessão, página, carrinho) | 180 dias sem atividade |
| Registo das revisões da IA | 365 dias |
| Comentário escrito numa avaliação (a nota fica) | 12 meses |
| Respostas aprovadas: propostas sem novas confirmações | 180 dias |
| Respostas aprovadas arquivadas | 365 dias |
| Registo dos pedidos de propostas à IA (a conversa de origem só nos pedidos sem cartão) | 365 dias (a conversa, 180 dias) |
| Conversas lidas para as propostas | 180 dias depois da última vez |
| Respostas guardadas com o botão "Guardar como resposta aprovada" (a mensagem e o dia) | 365 dias |

A passagem diária tira também a marca "Permitir em respostas automáticas" às respostas aprovadas que expiraram ou que não são revistas há mais de 90 dias.

Conversas, mensagens, notas internas, contactos e registos de ações **não têm prazo nem botão para apagar**. Ver [Proteção de dados no Apoio ao Cliente](/apoio/documentacao/protecao-de-dados#durante-quanto-tempo-guardamos) e os pontos em aberto aí descritos.
