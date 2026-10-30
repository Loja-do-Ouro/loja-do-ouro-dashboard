# Caixa de entrada (Conversas)
<!-- resumo: Como está organizado o ecrã Conversas: barra dos canais, pesquisa, separadores, filtros, lidas e não lidas, abrir uma conversa e ver anexos. -->
<!-- termos: conversas, inbox, caixa de entrada, lista, lista de conversas, tickets, pesquisa, procurar, filtro, filtros, separadores, abas, tabs, minhas, sem responsável, não lidas, unread, automáticas, todas, atualizar, refresh, sincronizar, sync, barra, canais, anexos, fotografias, PDF, visualizador, ecrã, telemóvel, mobile, presença, quem está a ver -->
<!-- atualizado: 2026-10-30 -->

O ecrã **Conversas** (menu APOIO AO CLIENTE → Conversas) é onde se faz quase todo o trabalho. Este artigo explica o que se vê e como encontrar o que precisa. Para escrever respostas, veja [Responder](/apoio/documentacao/responder).

## Como o ecrã está organizado
<!-- perguntas: Como está organizado o ecrã das conversas? | Para que servem as três colunas? | Como uso o apoio no telemóvel? -->

Num ecrã largo há três colunas:

1. **Lista de conversas**, à esquerda, com a pesquisa, os separadores e os filtros.
2. **Conversa aberta**, ao centro, com as mensagens e, por baixo, o campo de resposta.
3. **Coluna lateral**, à direita, com dois separadores: **Cliente** (estado, responsável, contactos, encomendas, registo) e **✨ Assistente IA**.

Em ecrãs mais estreitos (até cerca de 1190 píxeis), a coluna lateral passa a abrir por cima da conversa: use os botões **Cliente** e **✨ IA** no cabeçalho da conversa e **← Conversa** para voltar.

No telemóvel vê-se uma área de cada vez. Toque numa conversa para a abrir e em **←** ("Voltar à lista") para regressar à lista.

## A barra dos canais e o botão Atualizar
<!-- perguntas: O que quer dizer Sincronizado? | O que significa Bloqueado ou Erro num canal? | Para que serve o botão Atualizar? | As mensagens não estão a entrar -->

No topo há um indicador por canal com o estado da ligação. Passe o rato por cima para ver o detalhe ou o último erro.

| O indicador diz | Significa |
| --- | --- |
| Sincronizado 10:42 | Canal a funcionar; a última leitura com êxito foi a essa hora |
| Em direto | Chat do site: as mensagens chegam logo, sem sincronização |
| Por configurar | Canal ainda não ligado (por exemplo, o WhatsApp) |
| Desligado (só histórico) | Canal desligado pelo Super Admin; as conversas antigas ficam para consulta |
| A aguardar ligação (ou outro detalhe) | Ligação em curso |
| Bloqueado | A plataforma recusou o acesso; é preciso o Super Admin voltar a ligar |
| Erro | A última leitura falhou; o sistema volta a tentar sozinho |

Os comentários do Facebook e do Instagram partilham um só indicador, **Comentários**, que mostra o pior estado dos dois.

Ao lado aparece "Última sincronização: 10:42 · cada 60 s com o dashboard aberto" e o botão **Atualizar**. Carregue em **Atualizar** quando quiser ver já as mensagens novas: o sistema lê todos os canais, recarrega a lista e a conversa aberta. O resultado aparece por baixo:

- "Atualizado." — correu tudo bem.
- "Falha em Email, Facebook; as restantes fontes foram atualizadas." — um canal falhou, os outros não foram afetados.
- "Não correu: Facebook (em espera depois de erros)." — o canal não foi lido agora porque já estava a sincronizar, sincronizou há instantes ou está à espera depois de erros (a espera dobra a cada falha, até 30 minutos).

Se um canal estiver **Bloqueado** ou em **Erro** durante muito tempo, avise o Super Admin e, entretanto, responda na própria plataforma. Ver [Resolução de problemas](/apoio/documentacao/resolucao-de-problemas#um-canal-esta-em-erro-ou-bloqueado).

## Procurar uma conversa
<!-- perguntas: Como procuro uma conversa? | Como encontro um cliente pelo email? | Posso pesquisar pelo número do ticket? | A pesquisa procura nas notas internas? | Porque é que a pesquisa não encontra o nome? -->

Escreva no campo **Procurar nome, email, texto ou n.º de ticket**. A pesquisa começa sozinha quando para de escrever e procura:

- no nome, email (também o email indicado e não confirmado), nome de perfil e telefone do cliente;
- no assunto da conversa e no número do ticket;
- no texto de todas as mensagens do cliente e da equipa.

Não procura nas **notas internas**.

> **Atenção:** Maiúsculas e minúsculas não contam, mas **os acentos contam**: "Joao" não encontra "João". Se não encontrar, experimente com e sem acentos, ou só uma parte do nome ("Jo").

Ao pesquisar, aparecem também as conversas do separador **Automáticas**. Conversas resolvidas sem atividade há muito tempo podem estar ocultas pelo [Histórico visível](/apoio/documentacao/historico-visivel). Com o Zendesk ligado, pesquisar só o número de um ticket (por exemplo `#1234`) que ainda não esteja no dashboard vai buscá-lo ao Zendesk.

## Separadores da lista
<!-- perguntas: O que aparece em Minhas? | O que é o separador Sem responsável? | Porque é que as resolvidas não aparecem em Minhas? | O que são as Automáticas? -->

| Separador | O que mostra |
| --- | --- |
| Todas | Todas as conversas, exceto as tratadas automaticamente |
| Minhas | As conversas de que é responsável, **sem as resolvidas** |
| Sem responsável | Conversas que ninguém assumiu, **sem as resolvidas** |
| Não lidas | Conversas com mensagens do cliente que ainda não leu (também as resolvidas) |
| Automáticas | Conversas de redes sociais de quem só reagiu (story, gosto, emoji) e nunca fez um pedido. Só recebe conversas enquanto as respostas automáticas do Facebook e do Instagram estiverem ligadas |

O número em cada separador conta as conversas desse separador sem os filtros de canal e de estado e sem a pesquisa. Para ver as suas conversas resolvidas, escolha **Minhas** e, no filtro de estado, **Resolvido**.

O separador **Automáticas** mostra ainda um resumo "Respostas automáticas enviadas" de hoje e dos últimos 7 dias. Saiba mais em [Respostas automáticas](/apoio/documentacao/respostas-automaticas#o-separador-automaticas).

## Filtrar por canal e por estado
<!-- perguntas: Como vejo só as conversas do Instagram? | Como filtro por estado? | Como vejo só os emails? -->

Por baixo dos separadores há duas listas:

- **Todos os canais** — escolha Zendesk, Facebook, Instagram, Comentários Facebook, Comentários Instagram, WhatsApp, Chat do site ou Email.
- **Todos os estados** — escolha Novo, Em atendimento, A aguardar cliente ou Resolvido.

Os filtros juntam-se ao separador escolhido e à pesquisa. Se nada aparecer, surge "Sem conversas com estes filtros.".

## O que cada linha da lista mostra
<!-- perguntas: O que quer dizer o ponto de exclamação vermelho? | O que significa Nós na pré-visualização? | Porque é que a conversa diz Tratada automaticamente? | O que quer dizer Revisão por decidir? -->

A lista está ordenada pela última mensagem, a mais recente primeiro, e mostra no máximo 300 conversas. Cada linha tem:

- o nome do cliente e a hora da última mensagem (só a hora se for hoje; senão a data e a hora, sempre na hora de Lisboa);
- a etiqueta do canal e a do estado;
- o número de mensagens por ler;
- **Tratada automaticamente**, nas conversas do separador Automáticas;
- **A rever com a IA…** ou **Revisão por decidir**, quando uma resposta sua está na [revisão da IA](/apoio/documentacao/revisao-ia-antes-de-enviar);
- um **!** vermelho quando há uma mensagem escrita pela equipa em "Falhou", "Resultado incerto" ou "A enviar" — abra a conversa e veja [Envio e entrega](/apoio/documentacao/envio-e-entrega);
- o início da última mensagem, com "Nós: " à frente quando foi a equipa a escrever (as notas internas não contam);
- nos comentários, "Em:" seguido da publicação comentada;
- "Responsável: Nome" ou "Sem responsável".

## Lidas e não lidas
<!-- perguntas: Porque é que a conversa está não lida para mim e lida para a colega? | Como marco uma conversa como não lida? | Quando é que uma mensagem conta como lida? | Ler no dashboard marca como lido no Gmail? -->

As não lidas são **de cada pessoa**: se uma colega abrir a conversa, para si continua por ler. E ficam só no dashboard: nada é marcado como lido no Gmail, no Zendesk nem no Messenger.

Uma conversa conta como lida quando está aberta **e à vista** (o separador do browser à frente; no telemóvel, na área da conversa). Uma mensagem que chegue enquanto está a ver fica lida quando a conversa recarregar (no máximo 15 segundos depois), se continuar à vista.

Para deixar uma conversa para depois, abra o separador **Cliente** e carregue em **Marcar como não lida**. A última mensagem do cliente volta a ficar por ler e assim fica até voltar a abrir a conversa na lista.

## Abrir uma conversa
<!-- perguntas: O que aparece quando abro uma conversa? | Quem mais está a ver esta conversa? | O que quer dizer tem esta conversa aberta? | Como vejo as mensagens antigas? -->

Ao carregar numa conversa da lista, ao centro aparece:

- **Cabeçalho**: o nome do cliente, o canal e o assunto, e a etiqueta do estado. No chat do site, se o cliente estiver noutro site ou noutra língua, aparece também uma etiqueta como "EN · Gold Store Premium".
- **Quem mais está aqui**: "Ana tem esta conversa aberta" ou "Ana está a escrever nesta conversa", para colegas que a abriram no último minuto. Escrever uma nota interna não conta como "a escrever".
- **As mensagens**, por ordem de hora, com o autor e a hora. As notas internas aparecem como "Nota interna · Nome", com a indicação "Visível só para a equipa · nunca enviada ao cliente".
- **Acontecimentos** entre as mensagens, como "Ana ficou responsável pela conversa", "Ana transferiu a conversa para Rita", "O cliente terminou a conversa no site", respostas automáticas enviadas e passos do pedido de avaliação.

A conversa mostra as últimas 500 mensagens e recarrega sozinha a cada 15 segundos. Se o cliente apagou uma mensagem, aparece "Mensagem apagada pelo cliente." (nos comentários, "Comentário apagado.").

Numa conversa antiga que voltou a ter atividade, as mensagens anteriores à data do histórico visível ficam recolhidas atrás de "Mensagens anteriores a 1 de setembro de 2026 (N) — Mostrar". Carregue em **Mostrar** para as ver. Ver [Histórico visível](/apoio/documentacao/historico-visivel).

## Ver anexos e fotografias
<!-- perguntas: Como abro um anexo do cliente? | Como vejo uma fotografia em tamanho grande? | Porque aparece Imagem indisponível? | Como descarrego um PDF do cliente? -->

As imagens pequenas aparecem em miniatura na mensagem; PDF, vídeos e outros ficheiros aparecem como botão com o nome e o tamanho; os áudios têm um leitor.

Carregue num anexo para o abrir no visualizador, sem sair do dashboard e sem o descarregar:

- imagens (carregue na imagem para a ver em tamanho real), PDF, vídeo e áudio abrem-se ali;
- **‹** e **›** (ou as setas do teclado) passam ao anexo anterior ou seguinte;
- **Abrir noutro separador** (imagens e PDF) e **Descarregar**;
- **✕** ou Esc fecha.

Ficheiros de outros tipos (Word, Excel, SVG, HTML ou desconhecidos) não se pré-visualizam por segurança: aparece "Sem pré-visualização para este tipo de ficheiro." e o botão para descarregar.

> **Atenção:** Só descarregue um anexo quando for mesmo preciso e apague-o do computador quando já não fizer falta. Ver [Boas práticas de privacidade](/apoio/documentacao/boas-praticas-de-privacidade).

"Imagem indisponível" quer dizer que o endereço da imagem na Meta expirou. Os anexos com mais de 4 MB do email e do Facebook ou Instagram não abrem no dashboard: a mensagem diz para os abrir no Gmail ou na Metricool. Os do Zendesk (com o Zendesk ligado) abrem-se na mesma, diretamente a partir do Zendesk.

## Avisos no topo do ecrã
<!-- perguntas: O que é a lista Respostas noutras conversas? | Apareceu um aviso de outra conversa no topo -->

Por cima de tudo podem aparecer avisos sobre **outras** conversas, para que nada se perca quando muda de conversa:

- um envio que falhou ou ficou incerto noutra conversa, com o botão **Abrir conversa**;
- uma revisão da IA à espera da sua escolha: "… a resposta ainda não foi enviada: a IA sugere melhorias e espera a sua escolha." com **Ver a revisão**;
- o resultado de uma revisão da IA (desaparece ao fim de 12 segundos; **✕** fecha).

Com o Zendesk ligado e a sua conta Zendesk por ligar, aparece também a faixa **Ligue a sua conta Zendesk** com o botão **Ligar Zendesk**. Ver [WhatsApp e Zendesk](/apoio/documentacao/whatsapp-zendesk#zendesk-ligado).

## Ligação direta para uma conversa
<!-- perguntas: Como envio o link de uma conversa a uma colega? | Como abro uma conversa pelo endereço? -->

Cada conversa tem um endereço próprio, `/apoio?conversa=` seguido do identificador da conversa. É esta ligação que vai no email de transferência e no botão **Abrir** da página Satisfação e desempenho. Uma ligação direta abre a conversa mesmo que esteja oculta pelo histórico visível.

## Com que frequência tudo se atualiza
<!-- perguntas: De quanto em quanto tempo chegam as mensagens novas? | Tenho de carregar em Atualizar? | Há notificações de mensagens novas? -->

- A **lista** recarrega a cada 20 segundos e a **conversa aberta** a cada 15 segundos, enquanto o separador do browser estiver à vista.
- Os **canais** são lidos com a frequência definida pelo Super Admin (60 segundos por omissão) enquanto alguém tiver as Conversas abertas, e de 5 em 5 minutos mesmo com o dashboard fechado. O email chega quase logo, porque a Google avisa o dashboard.
- O chat do site entra no momento.

Não há som, notificação no browser nem contador no menu para mensagens novas. Mantenha as Conversas abertas e use o separador **Não lidas**. Mais detalhe em [Canais](/apoio/documentacao/canais#quando-as-mensagens-chegam).

## O que a caixa de entrada não faz
<!-- perguntas: Posso iniciar uma conversa nova com um cliente? | Posso apagar uma conversa? | Posso editar uma mensagem já enviada? | Posso apagar uma nota interna? -->

- **Não se iniciam conversas novas** a partir do dashboard: responde-se a conversas que o cliente começou. Para contactar alguém de novo, use o próprio canal (por exemplo, um email novo no Gmail).
- **Não se editam nem apagam** mensagens ou notas internas depois de gravadas. Se uma nota tiver um erro, escreva outra nota a corrigir.
- **Não se apagam conversas** nem clientes no dashboard. Um pedido de apagamento de dados segue o procedimento de [Direitos dos titulares dos dados](/apoio/documentacao/direitos-dos-titulares).
