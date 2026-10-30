# Avaliação e desempenho
<!-- resumo: O pedido de avaliação ao cliente depois de resolver (modos, canais, regras, como a nota é lida e quem a vê) e a página Satisfação e desempenho. -->
<!-- termos: avaliação, avaliar, inquérito, inquérito de satisfação, satisfação, CSAT, NPS, nota, estrelas, rating, survey, feedback, pedido de avaliação, 1 a 5, nota baixa, reclamação, acompanhamento, desempenho, KPI, KPIs, métricas, indicadores, estatísticas, média, ranking, tempo de resposta, tempo até responder, produtividade, Satisfação e desempenho, não quer avaliações, opt-out -->
<!-- atualizado: 2026-10-30 -->

Depois de uma conversa resolvida, o cliente pode receber um pedido para avaliar o atendimento de 1 a 5. As notas alimentam a página **Satisfação e desempenho**. Tudo isto funciona **sem IA**.

## Como está configurado
<!-- perguntas: O pedido de avaliação está ligado? | Qual a diferença entre Perguntar ao resolver e Automático? -->

O Super Admin escolhe o modo:

- **Desligado** (de origem) — não há pedidos.
- **Perguntar ao resolver (quem resolve decide em cada conversa)** — ao resolver, aparece uma caixa para escolher se se pede a avaliação.
- **Automático (recomendado): pedido sempre que a conversa cumpre as regras** — o pedido é agendado sozinho.

Escolhe também os canais (de origem, todos): **Messenger (Facebook)**, **Instagram Direct**, **Email** e **Chat do site**. **Nunca** há pedidos nos comentários públicos, no Zendesk nem no WhatsApp.

## Ao resolver uma conversa
<!-- perguntas: O que aparece quando resolvo uma conversa? | Como peço uma avaliação ao cliente? | Posso não pedir a avaliação? -->

O pedido só é criado quando alguém muda a conversa para **Resolvido no próprio dashboard** (nunca quando a conversa é resolvida noutro sítio). Uma falha no pedido nunca desfaz o "Resolvido".

**Modo Perguntar:**

1. Escolha **Resolvido** na lista **Estado**.
2. Aparece **Marcar como resolvida?** ("A verificar o pedido de avaliação…").
3. Se for possível pedir, a caixa "Pedir ao cliente uma avaliação do atendimento (1 a 5)" vem marcada, com "A nota conta para Nome (quem mais respondeu nesta conversa).". Se não for possível, aparece o motivo ("Sem pedido de avaliação: …").
4. Carregue em **Resolver** (ou **Cancelar**/Esc para não resolver).

Desmarcar a caixa fica registado ("… resolveu sem pedir avaliação ao cliente") e conta na coluna "Resolvidas sem pedido de avaliação (%)".

**Modo Automático:** a conversa resolve logo e aparece "Pedido de avaliação agendado (atendimento de Nome).", "Pedido de avaliação no chat do site: aparece quando o cliente abrir o chat (…)." ou "Sem pedido de avaliação: (motivo).".

## Quando o pedido não sai
<!-- perguntas: Porque é que não foi pedida avaliação? | Quantas vezes se pode pedir avaliação ao mesmo cliente? -->

As regras são confirmadas ao resolver e outra vez na hora de enviar. Motivos possíveis:

| Motivo | Porquê |
| --- | --- |
| sem resposta enviada pelo dashboard | Só se avalia quem respondeu pelo dashboard |
| a última mensagem é do cliente | O cliente ficou à espera de resposta |
| fora da janela de 24 h do Messenger/Instagram | A Meta não aceitaria a mensagem |
| o cliente terminou a conversa no chat do site | Já não é possível mostrar o pedido |
| a última resposta pelo dashboard tem mais de 7 dias | Conversa antiga |
| o cliente pediu para não receber pedidos de avaliação | Respeitar a recusa |
| já foi pedida uma avaliação nesta conversa nos últimos 7 dias | No máximo um pedido por conversa em 7 dias |
| já foi pedida uma avaliação a este cliente nos últimos 30 dias | No máximo um pedido por contacto (o mesmo email, perfil ou chat) em 30 dias; o mesmo cliente noutro canal conta à parte |
| a conversa foi reaberta antes do envio | O cliente escreveu durante a espera |
| o endereço de email é da própria loja, de um sistema automático ou inválido | Nunca para endereços internos |

## O que o cliente recebe
<!-- perguntas: Que mensagem recebe o cliente a pedir avaliação? | Quanto tempo depois de resolver sai o pedido? | O cliente avalia com estrelas? -->

- **Messenger e Instagram**: em nome da página, depois da espera definida (10 minutos de origem; na prática uns 10 a 15 minutos). "Olá (nome)! Foi um gosto ajudar 💛 Para continuarmos a melhorar, como avalia o nosso atendimento? Responda apenas com um número de 1 (mau) a 5 (excelente). Obrigado!"
- **Email**: depois da mesma espera, com o primeiro nome de quem atendeu e a assinatura automática, a pedir uma resposta só com um número de 1 a 5, e a dizer que basta responder «NÃO» para não receber mais pedidos.
- **Chat do site**: logo, como estrelas dentro do chat ("Como avalia o atendimento de Ana?"), mas só quando o cliente abre o chat; se não o abrir em 72 horas, não sai. Nunca por email.

Se a conversa for reaberta durante a espera, o pedido não sai.

## Como a resposta do cliente é lida
<!-- perguntas: O cliente respondeu 5, a conversa reabre? | O cliente respondeu não, o que acontece? | O cliente deu a nota com um comentário -->

A nota é aceite durante **72 horas**, se for a primeira mensagem do cliente depois do pedido:

| O cliente responde | O que acontece |
| --- | --- |
| Só a nota: "5", "5/5", "4 de 5", "5 estrelas", "⭐⭐⭐⭐", "5 😊" | Nota registada; a conversa **não** reabre |
| Só "não", "parar" ou "stop" | Deixa de receber pedidos de avaliação; a conversa não reabre |
| Nota com texto: "5 obrigado", "2. Chegou partida" | Nota e comentário registados; a conversa reabre como com qualquer mensagem |
| Outra coisa qualquer | O pedido fecha sem nota e a mensagem é tratada normalmente |

"4,5" não conta como nota. Na lista, uma resposta só com a nota aparece como "Respondeu ao pedido de avaliação".

## Nota baixa (1 ou 2)
<!-- perguntas: O cliente deu nota 1, o que acontece? | O que faço a uma avaliação negativa? -->

Uma nota de 1 ou 2 (só a nota) devolve a conversa a **Novo**, **sem responsável** e por ler, com o acontecimento "Avaliação baixa (n/5): conversa reaberta para acompanhamento.". Alguém da equipa deve pegar nela, perceber o que correu mal e contactar o cliente.

No Messenger e no Instagram, quem responde só com a nota recebe um agradecimento automático (com uma nota de 1 ou 2, a dizer que um responsável da equipa vai analisar o caso). No chat do site, o cliente vê "Obrigado pela sua avaliação!".

## Quem é avaliado e quem vê a nota
<!-- perguntas: A nota conta para quem? | Quem vê a nota que o cliente me deu? | As colegas veem as minhas avaliações? -->

- A nota conta para **quem fez mais respostas pelo dashboard** nessa conversa, desde a última reabertura ou o último pedido (empate: quem respondeu por último). Nunca para quem só resolveu nem para o responsável que não respondeu.
- **O valor da nota e o comentário guardados, e o relatório por pessoa, só são visíveis para o Super Admin e para a pessoa avaliada.** Quando o cliente responde só com a nota ("5", estrelas), as outras pessoas veem "O cliente respondeu ao pedido de avaliação (a nota só é visível para quem foi avaliado e para o Super Admin)."
- **Uma resposta com texto fica visível a toda a equipa.** Se o cliente escrever, por exemplo, "2. Chegou partida", essa mensagem aparece na conversa (e na lista) como qualquer outra. Uma nota de 1 ou 2 reabre a conversa para acompanhamento e o Registo mostra "Avaliação baixa: conversa reaberta para acompanhamento." (sem o número, para quem não pode ver a nota).
- As mensagens automáticas aparecem identificadas como "(marca) · pedido de avaliação (automático)" e "agradecimento pela avaliação (automático)".

## O painel Avaliação do atendimento
<!-- perguntas: Como vejo o estado do pedido de avaliação? | Como marco que o cliente não quer avaliações? | Como cancelo um pedido de avaliação? -->

No separador **Cliente**, a secção **Avaliação do atendimento** mostra o último pedido: o estado ("Agendado", "Enviado, à espera da nota", "Avaliado", "Fechado sem nota: …", "Não enviado: …", "Por mostrar: aparece quando o cliente abrir o chat do site"), de quem é o atendimento e, para quem pode ver, "Nota: 4/5 — "comentário"".

- **O cliente não quer receber pedidos de avaliação** — se o cliente o pedir, marque esta caixa. Qualquer pessoa da equipa a marca; os pedidos agendados deixam de sair. Só o Super Admin a desmarca ("Só o Super Admin pode voltar a ativar.").
- **Cancelar pedido de avaliação** — só o Super Admin, num pedido agendado ou enviado, com um motivo (pelo menos 3 caracteres) que fica na conversa.

> **Lei:** "Não quero receber pedidos de avaliação" é uma oposição a um tratamento de dados: respeite-a sempre. Ver [Direitos dos clientes sobre os seus dados](/apoio/documentacao/direitos-dos-titulares#oposicao).

## A página Satisfação e desempenho
<!-- perguntas: Onde vejo as minhas avaliações? | Como vejo os resultados da equipa? | O que quer dizer cada coluna da página de desempenho? | Porque é que a minha média não aparece? -->

Menu **APOIO AO CLIENTE → Satisfação e desempenho**. Escolha o **Período** (últimos 12 meses, cada um dos últimos 6 meses, os 2 últimos trimestres ou o ano) e carregue em **Ver**. Sem escolha, mostra o mês atual, ou os últimos 12 meses se houver menos de 10 avaliações no mês.

- Cada pessoa vê **só a sua linha** ("Os seus resultados", linha "Eu").
- O Super Admin vê a **Equipa**: todas as pessoas, a linha de totais e o painel **A acompanhar (nota 1–2)**, com Quando, Cliente, Canal, Atendimento de, Nota, Comentário e **Abrir**.

| Coluna | O que conta |
| --- | --- |
| Pedidos enviados | Pedidos de avaliação enviados no período |
| Avaliações | Notas recebidas no período |
| Média (1–5) | Média das notas (só com 10 avaliações ou mais) |
| Satisfeitos (4–5) | Notas de 4 ou 5 (só com 10 avaliações ou mais) |
| Clientes que avaliaram (%) | Dos pedidos enviados, quantos tiveram nota |
| Resolvidas com resposta | Conversas de Messenger, Instagram, email e chat do site resolvidas no período, atribuídas pela mesma regra da nota |
| Resolvidas sem pedido de avaliação (%) | Das conversas em que se podia pedir, as que quem resolveu decidiu não pedir (modo Perguntar) |
| Tempo mediano até responder | Da primeira mensagem do cliente ainda sem resposta até à resposta pelo dashboard (mediana) |

Antes de o pedido de avaliação ser ligado pela primeira vez, a página diz "A satisfação por colaborador começa quando o Super Admin ligar o pedido de avaliação. Até lá não há resultados por pessoa.". Os resultados só contam a partir dessa data.

> **Nota:** Com menos de 10 avaliações, o resultado é pouco fiável e a média não aparece. Os números servem para acompanhar e melhorar o serviço; leia-os sempre com contexto. Ver [Dados dos colaboradores e avaliação do atendimento](/apoio/documentacao/dados-dos-colaboradores).
