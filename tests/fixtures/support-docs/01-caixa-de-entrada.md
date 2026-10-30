# Caixa de entrada e estados
<!-- resumo: Como ler a lista de conversas, os filtros, os estados e as mensagens não lidas. -->
<!-- termos: lista, filtros, estados, não lidas, pesquisa de conversas, histórico -->

A lista de conversas fica à esquerda; a conversa aberta ao centro; os dados do cliente à direita.

## Estados de uma conversa
<!-- perguntas: O que quer dizer cada estado? | Quando é que uma conversa volta a Novo? -->

| Estado | Quando |
| --- | --- |
| Novo | Mensagem nova sem responsável |
| Em atendimento | Alguém está a tratar |
| A aguardar cliente | Respondemos e esperamos pelo cliente |
| Resolvido | Assunto encerrado |

Uma mensagem nova do cliente reabre uma conversa **Resolvido**: volta a Novo se não tiver responsável, ou a Em atendimento se tiver.

## Mensagens não lidas
<!-- perguntas: Porque é que uma conversa aparece com um número? | Como marco como lida? -->

O número ao lado da conversa conta as mensagens do cliente que chegaram depois da sua última leitura. A leitura de cada colaborador é independente e não marca nada na plataforma de origem.

## Procurar conversas
<!-- perguntas: Como encontro uma conversa antiga? | Como procuro um ticket pelo número? -->

O campo de pesquisa procura por nome, email, texto da mensagem ou número de ticket. Um ticket antigo do Zendesk abre-se escrevendo o número exato, por exemplo `#1234`.

## Histórico visível
<!-- perguntas: Porque não vejo conversas antigas? | Onde estão as conversas resolvidas há muito tempo? -->

As conversas resolvidas e sem atividade desde a data do histórico visível ficam fora da lista. Nada é apagado: se o cliente voltar a escrever, a conversa reaparece.
