# Envio e entrega
<!-- resumo: O que acontece depois de carregar em Enviar: estados de cada mensagem, o que cada canal confirma e o que fazer quando uma mensagem falha ou fica com resultado incerto. -->
<!-- termos: envio, entrega, entregue, lida, aceite pela plataforma, falhou, falha, erro ao enviar, resultado incerto, incerto, a enviar, verificar, não foi enviada, reenviar, enviar outra vez, duplicado, mensagem duplicada, confirmei no Zendesk, copiar para o rascunho, delivery, status da mensagem, não chegou, cliente não recebeu, check, visto -->
<!-- atualizado: 2026-10-30 -->

Cada resposta enviada mostra por baixo um estado de entrega. Saber lê-lo evita a pior situação no apoio: o cliente receber a mesma mensagem duas vezes, ou não receber nenhuma.

## Os estados de uma mensagem enviada
<!-- perguntas: O que quer dizer Aceite pela plataforma? | Qual a diferença entre Entregue e Lida? | O que significa A enviar? | A mensagem chegou ao cliente? -->

| Estado | Quer dizer | O que fazer |
| --- | --- | --- |
| A enviar | O envio começou e ainda não há resposta da plataforma | Esperar. Se ficar assim, use **Verificar** |
| Aceite pela plataforma | A plataforma (Gmail, Metricool, Zendesk) aceitou a mensagem | Nada. É o estado normal na maioria dos canais |
| Entregue | O chat do cliente recebeu a mensagem (só no chat do site) | Nada |
| Lida | O cliente tem o chat aberto e viu-a (só no chat do site) | Nada |
| Falhou | A mensagem **não** saiu | Ler o motivo, corrigir e enviar de novo |
| Resultado incerto | Não se sabe se saiu (sem resposta da plataforma) | **Nunca reenviar** sem antes carregar em **Verificar** |

O detalhe (ou o motivo, em "Falhou" e "Resultado incerto") aparece ao lado do estado; em "Aceite pela plataforma", passe o rato por cima do estado para o ver.

## O que cada canal confirma
<!-- perguntas: Porque é que as mensagens do Facebook nunca ficam Lida? | O email mostra se o cliente leu? | Aceite pelo Zendesk quer dizer que o cliente recebeu? -->

| Canal | Até onde se sabe | Detalhe gravado na mensagem |
| --- | --- | --- |
| Email | Aceite pela plataforma | "Enviado pelo Gmail (apoiocliente@lojadoouro.pt), na mesma conversa e com a assinatura automática." |
| Facebook e Instagram | Aceite pela plataforma | "Aceite pela Metricool. Entrega no Messenger/Instagram sem confirmação pela API." |
| Comentários | Aceite pela plataforma | "Publicada pela Metricool como resposta pública ao comentário (visível para todos na publicação)." |
| Chat do site | Entregue e Lida | "No chat do site: passa a Entregue quando o chat do cliente a recebe e a Lida com o chat aberto." |
| Zendesk ligado | Aceite pela plataforma | "Aceite pelo Zendesk não significa entregue: o cliente só recebe se as notificações do Zendesk estiverem ativas para este canal." |

Só o chat do site diz se o cliente recebeu e leu. Nos outros canais, "Aceite pela plataforma" é o melhor que se consegue saber. No chat do site, se o cliente já tiver saído do site, o detalhe diz também se a resposta seguiu por email ("Cliente fora do site: resposta enviada também por email para …").

## Como o sistema evita mensagens em duplicado
<!-- perguntas: Se carregar duas vezes em Enviar o cliente recebe duas mensagens? | Perdi a internet ao enviar, posso tentar outra vez? | A mensagem foi enviada duas vezes? -->

Cada envio leva uma chave única ligada ao texto exato. Se carregar duas vezes, se a internet falhar a meio ou se o servidor não responder, voltar a carregar em **Enviar** com o **mesmo texto**, enquanto o pedido ficou sem resposta, não envia duas vezes: o sistema reconhece o pedido.

A proteção acaba quando o servidor responde. Depois de "Resultado incerto" o rascunho é limpo e a chave é apagada: se voltar a escrever ou colar o mesmo texto e carregar em Enviar, sai uma mensagem **nova**. Por isso, nesse caso, use primeiro **Verificar** (ver [Quando o resultado é incerto](/apoio/documentacao/envio-e-entrega#quando-o-resultado-e-incerto)).

Quando o servidor não responde, aparece o erro seguido de "O texto ficou no rascunho; pode tentar de novo sem risco de duplicar." Pode carregar outra vez em Enviar, sem mudar nada no texto.

Um "Resultado incerto" nunca é repetido automaticamente pelo sistema: a decisão é sempre de uma pessoa, depois de verificar.

## Quando a mensagem falha
<!-- perguntas: A mensagem diz Falhou, e agora? | O envio falhou, o cliente recebeu? | Como volto a enviar uma mensagem que falhou? -->

"Falhou" quer dizer que **nada chegou ao cliente**.

1. Leia o motivo ao lado do estado (por exemplo, a Meta recusou a imagem ou a caixa Gmail precisa de ser religada).
2. O texto ficou no rascunho. Se não estiver, carregue em **Copiar para o rascunho** na mensagem que falhou (só aparece nas suas mensagens).
3. Corrija o que for preciso (outra imagem, só o texto…) e envie de novo.
4. Se o motivo for de ligação (Gmail, Metricool, Zendesk), avise o Super Admin e, entretanto, responda na própria plataforma.

Alguns motivos não se resolvem a reenviar, como o erro Meta #551. Ver [Facebook e Instagram](/apoio/documentacao/facebook-instagram#erro-meta-551).

## Quando o resultado é incerto
<!-- perguntas: A minha mensagem ficou Resultado incerto, envio outra vez? | Para que serve o botão Verificar? | A mensagem ficou presa em A enviar -->

"Resultado incerto" (ou uma mensagem parada em "A enviar") quer dizer que a plataforma não respondeu: a mensagem **pode ter chegado ao cliente**.

1. **Não volte a enviar.**
2. Carregue em **Verificar** na própria mensagem. O sistema volta a ler a conversa na plataforma (nunca reenvia):
   - se encontrar a mensagem, ela passa a "Aceite pela plataforma" e está resolvido;
   - se não a encontrar, aparece "Ainda não encontrada na plataforma. Confirme lá antes de a marcar como não enviada.";
   - se a leitura não correr agora, aparece "A verificação não correu agora (…); tente dentro de momentos.".
3. Se continuar incerta, confirme na própria plataforma (Gmail → Enviados, Meta Business Suite, Zendesk).
4. Só se tiver a certeza de que **não** saiu, carregue em **Não foi enviada** (ver a secção seguinte).

No chat do site, **Verificar** confirma logo ("Disponível no chat do site (confirmado em Verificar).").

## Marcar como não enviada
<!-- perguntas: Como marco uma mensagem como não enviada? | Para que serve o botão Não foi enviada? -->

Use **Não foi enviada** só depois de confirmar na plataforma que a mensagem não está lá.

1. Carregue em **Não foi enviada** na mensagem.
2. Confirme: "Confirma que verificou na plataforma e a mensagem NÃO foi enviada? O texto volta ao rascunho."
3. A mensagem fica "Falhou" com "Marcado como não enviado por Nome depois de verificar." e o texto volta ao rascunho, pronto a corrigir e enviar.

Regras:

- Só funciona depois de passar **1 minuto** desde o envio; antes disso aparece "Aguarde um minuto e use primeiro "Verificar".".
- Nos comentários, o sistema relê a publicação antes: se a resposta lá estiver, aparece "A resposta foi encontrada na publicação: ficou como publicada.".
- Não aparece nas mensagens automáticas (pedido de avaliação, por exemplo).

## Zendesk desligado: Confirmei no Zendesk
<!-- perguntas: O que é o botão Confirmei no Zendesk? -->

Com o Zendesk desligado do dashboard, o sistema já não consegue ler o ticket. Num envio incerto aparece **Confirmei no Zendesk** em vez de **Verificar**: abra o ticket no Zendesk, confirme que a mensagem lá está e carregue no botão ("Confirma que viu no Zendesk que esta mensagem foi enviada?"). A mensagem fica "Aceite pela plataforma" com "Confirmado no Zendesk por Nome.".

## Problemas noutra conversa
<!-- perguntas: Enviei e mudei de conversa, como sei se correu bem? | O que é o ponto de exclamação na lista? -->

Pode enviar e passar logo à conversa seguinte. Se o envio correr mal:

- aparece um aviso no topo do ecrã com o nome do cliente, o problema e o botão **Abrir conversa**;
- a conversa fica com um **!** vermelho na lista;
- ao voltar à conversa, o erro aparece por baixo do campo de resposta.

O **!** aparece sempre que a conversa tem uma mensagem escrita pela equipa em "Falhou", "Resultado incerto" ou "A enviar" (as mensagens automáticas não contam).

> **Nota:** Uma mensagem que falhou fica em "Falhou" para sempre: voltar a enviar o texto cria uma mensagem nova. Por isso o **!** pode continuar na lista depois de o problema estar resolvido. Abra a conversa e confirme que a última resposta ficou "Aceite pela plataforma" (ou "Entregue").
