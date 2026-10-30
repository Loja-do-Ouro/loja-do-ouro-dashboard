# Estados da conversa
<!-- resumo: O que querem dizer Novo, Em atendimento, A aguardar cliente e Resolvido, quem os muda, o que muda sozinho e quando uma conversa reabre. -->
<!-- termos: estado, estados, status, novo, em atendimento, a aguardar cliente, aguardar, pendente, pending, resolvido, resolver, fechar, fechado, closed, solved, reabrir, reaberta, reopen, arquivar, concluir, terminar conversa, ciclo de vida -->
<!-- atualizado: 2026-10-30 -->

Cada conversa tem um de quatro estados. O estado diz à equipa o que falta fazer e decide em que separadores a conversa aparece (por exemplo, as resolvidas saem de **Minhas** e de **Sem responsável**).

## Os quatro estados
<!-- perguntas: O que quer dizer cada estado? | Qual a diferença entre Em atendimento e A aguardar cliente? | Quando devo pôr uma conversa como Resolvido? -->

| Estado | Quer dizer | Quando usar |
| --- | --- | --- |
| Novo | Ninguém tratou ainda | Fica assim até alguém responder ou mudar o estado |
| Em atendimento | Alguém da equipa está a tratar | Enquanto a equipa ainda tem alguma coisa a fazer (confirmar stock, falar com a loja, preparar uma resposta) |
| A aguardar cliente | A bola está do lado do cliente | Depois de fazer uma pergunta ou pedir uma informação ao cliente |
| Resolvido | Assunto tratado | Quando não falta nada; se o cliente voltar a escrever, a conversa reabre sozinha |

> **Dica:** Responder não muda o estado para "A aguardar cliente" nem para "Resolvido": isso é sempre uma escolha sua. Uma conversa esquecida em "Em atendimento" continua em **Minhas** até a resolver.

## Mudar o estado
<!-- perguntas: Como mudo o estado de uma conversa? | Porque é que não consigo mudar o estado? | Quem pode mudar o estado? -->

1. Abra a conversa.
2. Na coluna lateral, separador **Cliente**, secção **Atendimento**, escolha o novo estado na lista **Estado**.
3. A mudança grava logo e fica no **Registo** da conversa ("Ana mudou o estado → Resolvido").

Pode mudar o estado de uma conversa sem responsável ou de uma conversa sua. Se a conversa estiver com uma colega, a lista fica bloqueada com a explicação "Só o responsável (ou o Super Admin) muda o estado.". O Super Admin muda sempre.

Mudar o estado **não** o torna responsável pela conversa. Para isso, veja [Responsável e transferências](/apoio/documentacao/responsavel-e-transferencias).

## O que muda sozinho
<!-- perguntas: Porque é que a conversa mudou de estado sozinha? | Quando é que uma conversa reabre? | O cliente escreveu numa conversa resolvida, o que acontece? | Uma conversa resolvida volta a aparecer? -->

- **Responder a uma conversa "Novo"** passa-a a **Em atendimento** e, se não tinha responsável, torna-o responsável (exceto no Zendesk ligado, onde o estado vem do Zendesk).
- **Uma mensagem nova do cliente** reabre a conversa:
  - **Resolvido** com responsável passa a **Em atendimento** (o responsável mantém-se);
  - **Resolvido** sem responsável passa a **Novo**;
  - **A aguardar cliente** passa a **Em atendimento**;
  - Novo e Em atendimento ficam como estão.
- **Pedido de avaliação**: uma resposta do cliente só com a nota (por exemplo "5" ou "⭐⭐⭐⭐") ou só "não" **não** reabre a conversa. Uma nota de 1 ou 2 numa conversa resolvida devolve-a a **Novo**, sem responsável, para acompanhamento. Uma nota com texto ("4, mas a caixa veio amolgada") reabre como qualquer mensagem. Ver [Avaliação e desempenho](/apoio/documentacao/avaliacao-e-desempenho).
- **Comentários públicos**: um comentário em **Novo**, sem responsável, a que a marca já respondeu fora do dashboard (por exemplo, na própria app do Instagram) passa sozinho a **Resolvido**. Comentários antigos importados (já respondidos ou sem atividade há mais de 7 dias) entram como **Resolvido**.

No separador Cliente, nas conversas que não são do Zendesk, aparece a lembrança: "Estado e responsável pertencem ao dashboard; uma nova mensagem do cliente reabre uma conversa resolvida."

## Resolver uma conversa
<!-- perguntas: O que acontece quando marco Resolvido? | O que é a caixa Marcar como resolvida? | O cliente vai receber alguma mensagem quando resolvo? -->

Escolha **Resolvido** na lista **Estado**. O que acontece a seguir depende de como o Super Admin configurou o pedido de avaliação:

- **Desligado** — a conversa fica resolvida e nada é enviado ao cliente.
- **Perguntar ao resolver** — aparece a caixa **Marcar como resolvida?** com a opção "Pedir ao cliente uma avaliação do atendimento (1 a 5)" (já marcada quando é possível pedir), a indicação "A nota conta para Nome (quem mais respondeu nesta conversa)." ou o motivo para não haver pedido. Carregue em **Resolver** ou em **Cancelar** (Esc).
- **Automático** — resolve logo e, se a conversa cumprir as regras, aparece "Pedido de avaliação agendado (atendimento de Nome)." O cliente recebe o pedido alguns minutos depois.

Tudo sobre o pedido de avaliação em [Avaliação e desempenho](/apoio/documentacao/avaliacao-e-desempenho).

> **Nota:** As conversas resolvidas sem atividade antes da data do histórico visível deixam de aparecer na lista, mas não são apagadas. Ver [Histórico visível](/apoio/documentacao/historico-visivel).

## Estados nas conversas do Zendesk
<!-- perguntas: Porque não consigo pôr um ticket Zendesk em Novo? | O estado do Zendesk é o mesmo do dashboard? -->

Com o Zendesk **ligado**, o Zendesk manda no estado dos tickets: a mudança é gravada no Zendesk com a sua conta, e no separador Cliente aparece "Estado no Zendesk: …". A correspondência é:

| No Zendesk | No dashboard |
| --- | --- |
| new | Novo |
| open, hold | Em atendimento |
| pending | A aguardar cliente |
| solved, closed | Resolvido |

O Zendesk não deixa voltar a "new", por isso **Novo** não se pode escolher num ticket que já saiu desse estado. É o Zendesk que reabre um ticket quando o cliente responde.

Com o Zendesk **desligado (só histórico)**, estado e responsável dos tickets antigos ficam só no dashboard e não mudam no Zendesk. Ver [WhatsApp e Zendesk](/apoio/documentacao/whatsapp-zendesk).

## Boas práticas
<!-- perguntas: Devo resolver logo depois de responder? | Quando uso A aguardar cliente? -->

- Depois de fazer uma pergunta ao cliente, ponha **A aguardar cliente**: quando ele responder, a conversa volta a **Em atendimento** e aparece-lhe em **Não lidas**.
- Resolva quando o assunto estiver mesmo fechado. Se o cliente só agradecer, pode resolver de novo.
- Ao fim do dia, veja **Minhas**: o que lá está ainda é seu. Se for de férias ou faltar, peça ao Super Admin ou transfira as conversas a uma colega.
