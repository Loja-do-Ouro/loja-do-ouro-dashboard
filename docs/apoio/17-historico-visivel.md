# Histórico visível
<!-- resumo: Porque é que conversas antigas resolvidas deixam de aparecer na lista, na pesquisa e na IA, como encontrar uma conversa antiga e o que acontece quando o cliente volta a escrever. Nada é apagado. -->
<!-- termos: histórico, histórico visível, conversas antigas, conversa antiga, arquivo, arquivadas, ocultas, escondidas, desapareceu, não encontro, tickets antigos, data de corte, 1 de setembro, mensagens anteriores, mostrar, esconder, apagado, eliminado, retenção -->
<!-- atualizado: 2026-10-30 -->

Para a caixa de entrada não ficar cheia de conversas antigas já tratadas, o sistema mostra só as conversas com atividade a partir de uma data, chamada **histórico visível**. A data de origem é **1 de setembro de 2026**; o Super Admin pode mudá-la. A data em vigor aparece no fim da lista: "A mostrar conversas com atividade desde 1 de setembro de 2026 e as que estão por resolver."

> **Nota:** Nada é apagado. As conversas ocultas continuam guardadas e voltam a aparecer se o cliente escrever.

## A regra exata
<!-- perguntas: Que conversas ficam ocultas? | Uma conversa por resolver pode ficar oculta? -->

Uma conversa fica oculta quando **as duas** condições se verificam:

1. está **Resolvido**; e
2. a última mensagem (ou, sem mensagens, a criação da conversa) é **anterior** à data do histórico visível.

Uma conversa **por resolver** (Novo, Em atendimento, A aguardar cliente) **nunca** fica oculta, por mais antiga que seja.

## Onde deixam de aparecer
<!-- perguntas: A IA vê as conversas antigas? | As conversas ocultas contam nos separadores? -->

As conversas ocultas ficam fora:

- da lista e das contagens dos separadores;
- da pesquisa;
- das sugestões de "outras conversas do mesmo cliente";
- do assistente de IA (outras conversas do cliente, respostas anteriores da equipa).

O relatório Satisfação e desempenho não é afetado.

## Como encontrar uma conversa antiga
<!-- perguntas: Não encontro uma conversa antiga | Como abro um ticket Zendesk antigo? | Como vejo uma conversa de agosto? -->

- **Ticket Zendesk**: pesquise o número exato do ticket (por exemplo `#1234`) — aparece mesmo que esteja oculto.
- **Ligação direta**: um endereço `/apoio?conversa=…` (por exemplo, de um email de transferência ou da página Satisfação e desempenho) abre qualquer conversa.
- **Na própria plataforma**: o histórico completo continua no Gmail, no Meta Business Suite ou no Zendesk.
- Se precisar de ver muitas conversas antigas, peça ao Super Admin que recue a data.

## Quando um cliente antigo volta a escrever
<!-- perguntas: Um cliente antigo escreveu, vejo as mensagens antigas? | O que é Mensagens anteriores a 1 de setembro? -->

A conversa reaparece na lista como qualquer outra (reaberta pela mensagem nova). As mensagens anteriores à data ficam recolhidas atrás de "Mensagens anteriores a 1 de setembro de 2026 (N) — Mostrar". Carregue em **Mostrar** para as ver e em **Esconder** para as recolher.

Essas mensagens antigas também não são enviadas à IA nem à revisão: a IA só vê a conversa a partir da data.

## Mudar a data (Super Admin)
<!-- perguntas: Como mudo a data do histórico visível? | Quantas conversas estão ocultas? -->

Em **Configuração do apoio → Histórico visível**, escolha a data em **Histórico visível a partir de** e carregue em **Guardar**. Não se aceitam datas no futuro. O painel mostra quantas conversas resolvidas estão ocultas com a data atual ("Ocultas agora: N conversas resolvidas…").

> **Lei:** Ocultar não é apagar: os dados continuam guardados e sujeitos às regras de conservação. Ver [Durante quanto tempo guardamos](/apoio/documentacao/protecao-de-dados#durante-quanto-tempo-guardamos).
