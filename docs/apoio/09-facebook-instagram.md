# Facebook e Instagram (mensagens privadas)
<!-- resumo: Como funcionam as mensagens privadas do Messenger e do Instagram Direct no dashboard: de onde vêm, como responder, a janela de 24 horas, o erro Meta #551 e as reações às stories. -->
<!-- termos: Facebook, Messenger, Instagram, Instagram Direct, DM, direct message, mensagem privada, inbox, Metricool, Meta, Meta Business Suite, Business Suite, página, story, stories, reação, gosto, like, emoji, 24 horas, janela de 24 h, #551, Meta 551, bloqueou a página, não aceita mensagens, imagem recusada, foto, @facebook.com, perfil -->
<!-- atualizado: 2026-10-30 -->

As mensagens privadas da página da Loja do Ouro no **Facebook Messenger** e no **Instagram Direct** entram nos canais **Facebook** e **Instagram**. O dashboard lê-as através da **Metricool**, que faz a ponte com a Meta. Os comentários nas publicações são outro canal: ver [Comentários públicos](/apoio/documentacao/comentarios-publicos).

## De onde vêm as mensagens e quando chegam
<!-- perguntas: Porque é que uma mensagem do Instagram demorou a chegar? | As mensagens do Facebook chegam logo? | De onde vêm as mensagens do Instagram? -->

A Metricool não avisa o dashboard quando chega uma mensagem, por isso o sistema vai lá buscá-las: de 5 em 5 minutos (mesmo com o dashboard fechado), com a frequência da configuração enquanto alguém tem as Conversas abertas e ao carregar em **Atualizar**. Uma mensagem nova pode demorar até cerca de 1 minuto a aparecer com as Conversas abertas, ou até 5 minutos com o dashboard fechado.

## Responder
<!-- perguntas: Como respondo a uma mensagem do Instagram? | Posso enviar fotografias no Messenger? | Porque é que a resposta no Instagram não fica Lida? | A resposta sai em nome de quem? -->

1. Confirme "Envia por: Instagram Direct · para (perfil)" ou "Facebook Messenger · para (nome)".
2. Escreva a resposta. Pode juntar **uma imagem** (JPEG ou PNG) por mensagem; PDF não.
3. Carregue em **Enviar ao cliente**.

A resposta sai em nome da página da marca, não com o seu nome; o dashboard regista quem a escreveu. Fica como "Aceite pela plataforma" ("Aceite pela Metricool. Entrega no Messenger/Instagram sem confirmação pela API."): a Metricool não diz se foi entregue ou lida, por isso nunca passa a "Entregue" nem a "Lida".

A imagem fica disponível para a Meta durante 1 hora num endereço temporário, só para ela a ir buscar.

## A janela de 24 horas da Meta
<!-- perguntas: Posso responder a um cliente do Instagram passados dias? | O que é a janela de 24 horas? | A resposta falhou porque passou muito tempo -->

A Meta limita as mensagens que as empresas enviam depois de passarem 24 horas sobre a última mensagem do cliente. No dashboard:

- **As respostas escritas pela equipa não são bloqueadas** pelo dashboard. Se a Meta as recusar, a mensagem fica "Falhou" com o motivo devolvido.
- **As mensagens automáticas respeitam a janela**: o pedido de avaliação só sai até 23 horas depois da última mensagem do cliente, e as respostas automáticas só respondem a mensagens recentes.

Responda o mais depressa possível às mensagens privadas. Se uma resposta tardia falhar, use outro contacto que o cliente tenha deixado (email ou telefone) ou espere que ele volte a escrever.

## Erro Meta #551
<!-- perguntas: Aparece Meta #551, o que quer dizer? | O cliente bloqueou a página? | Não consigo responder a um cliente do Messenger -->

"Não enviada: o Messenger (ou Instagram) não aceita mensagens nossas para esta pessoa (Meta #551)" quer dizer que a pessoa bloqueou a página, deixou de aceitar as nossas mensagens ou desativou a conta. A Meta não diz qual.

- **Voltar a enviar não resolve.** O campo de resposta fica bloqueado com a explicação até o cliente voltar a escrever.
- Se o cliente deixou telefone ou email na conversa, contacte-o por aí. O endereço …@facebook.com do perfil **não** é um email real.
- Se tinha um rascunho, aparece só para leitura com **Copiar** e **Passar para nota interna**.
- Pode sempre deixar uma nota interna.

## A Meta recusou a imagem
<!-- perguntas: A imagem não foi enviada no Instagram | A Meta recusou a imagem -->

"A Meta recusou a imagem (não a conseguiu obter ou o formato não é suportado). Nada foi enviado ao cliente; pode enviar só o texto ou outra imagem JPEG/PNG." Envie só o texto, ou tente outra imagem em JPEG ou PNG.

## Ligação à Metricool em baixo
<!-- perguntas: A Metricool recusou o acesso, o que faço? | O Facebook está bloqueado no dashboard | Erro interno da Metricool -->

Quando a Metricool perde a ligação à página ou a Meta anula a autorização, o indicador do canal fica **Bloqueado** e o campo de resposta mostra "A Metricool recusou o acesso a esta caixa de entrada ou perdeu a ligação à rede: nada sai por aqui até ser reposta. Responda entretanto no Meta Business Suite (ver Configuração do apoio → Validar ligações).".

1. Avise o Super Admin (só ele consegue repor a ligação).
2. Entretanto, responda aos clientes no **Meta Business Suite**.
3. Quando a ligação voltar, as respostas dadas no Meta Business Suite aparecem também na conversa do dashboard, como mensagens da marca (o dashboard lê a conversa toda).

"Erro interno da Metricool (…)" é uma falha do lado da Metricool. A própria mensagem diz se nada foi enviado (pode tentar outra vez) ou se deve confirmar no Meta Business Suite antes de reenviar.

## Reações, stories e o separador Automáticas
<!-- perguntas: Porque é que uma conversa do Instagram desapareceu da lista? | O que acontece quando alguém reage a uma story? | Onde estão as reações às stories? -->

Muitas mensagens do Instagram são só reações: um gosto, um emoji, uma reação ou menção numa story, um "lindo!". O que lhes acontece depende de o Super Admin ter ligado as **respostas automáticas do Facebook e do Instagram** (começam desligadas):

- **Com as respostas automáticas desligadas**, estas conversas ficam na lista principal, em **Todas** e em **Sem responsável**, como qualquer outra; o separador **Automáticas** fica vazio.
- **Com as respostas automáticas ligadas**, quando uma conversa só tem reações claras e nenhum pedido, sai da lista principal e vai para o separador **Automáticas** (etiqueta "Tratada automaticamente"), para não ocupar a equipa. Volta à lista principal assim que o cliente escrever um pedido, ou se alguém da equipa a assumir, escrever nela ou mudar o estado para Em atendimento ou A aguardar cliente. Estas pessoas recebem também um agradecimento curto, e quem escreve fora do horário recebe uma mensagem automática. Ver [Respostas automáticas](/apoio/documentacao/respostas-automaticas).

## Mensagens apagadas e nomes
<!-- perguntas: O cliente apagou a mensagem, consigo ver o que escreveu? | Porque é que o cliente do Instagram não tem nome? -->

- Uma mensagem que o cliente anulou aparece como "Mensagem apagada pelo cliente.", sem o conteúdo.
- No Instagram, o cliente aparece muitas vezes só com o nome de utilizador (perfil).
- O nome do perfil não prova quem é a pessoa: antes de falar de encomendas, veja [Confirmar a identidade antes de partilhar dados](/apoio/documentacao/clientes-e-encomendas#confirmar-a-identidade-antes-de-partilhar-dados).
