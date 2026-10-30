# Chat do site
<!-- resumo: Como funciona o chat "Fale connosco" da Loja do Ouro e da Gold Store Premium: o que o cliente vê, como responder, marcas e línguas, o que acontece quando o cliente sai do site e como testar. -->
<!-- termos: chat, chat do site, live chat, chat ao vivo, widget, botão, Fale connosco, chatbot, Bluedot, site, loja online, lojadoouro.pt, Gold Store Premium, goldstorepremium.com, GSP, inglês, espanhol, francês, alemão, tradução, língua, idioma, no site agora, carrinho, página, visitante, visita, desde que abriu o chat, cookies, browser, terminar conversa, cópia da conversa, fora do horário, a escrever, testar o chat, chat-teste -->
<!-- atualizado: 2026-10-30 -->

O chat do site é o botão **Fale connosco** que aparece em lojadoouro.pt e em goldstorepremium.com. As conversas entram no canal **Chat do site** e chegam no momento: o indicador na barra de cima diz "Em direto". É o único canal em que o dashboard é a própria plataforma, por isso é também o único que mostra se o cliente recebeu e leu a resposta.

## O que o cliente vê
<!-- perguntas: Como é que o cliente inicia uma conversa no chat? | O email no chat é obrigatório? | O que diz o aviso de privacidade do chat? -->

1. O cliente carrega em **Fale connosco**.
2. Escreve **Nome**, **Email** e **Mensagem** (todos obrigatórios; mensagem até 2000 caracteres) e carrega em **Iniciar conversa**.
3. Antes, vê o aviso: "Ao iniciar a conversa aceita a nossa Política de privacidade. Para o podermos ajudar, a equipa vê a página em que está e o seu carrinho.", com a ligação para a política.
4. Durante a conversa vê as respostas em segundos, "A equipa está a escrever…" ou "Ana está a escrever…" enquanto alguém escreve, e "A falar com Ana" (só o primeiro nome de quem o atende).
5. Fora do horário vê "Fora do horário de atendimento" e uma mensagem a dizer que a resposta segue também por email.

Se o cliente tiver sessão iniciada na loja, o email já vem preenchido e fica **confirmado** (quando a ligação entre o tema e o dashboard está configurada); senão, fica "indicado no chat, não confirmado" e não serve para mostrar encomendas. Uma conversa confirmada só continua com a mesma sessão da loja.

## Marcas e línguas
<!-- perguntas: O chat funciona em inglês? | Como sei se o cliente é da Gold Store Premium? | Em que língua respondo no chat? | Como traduzo as mensagens de um cliente estrangeiro? -->

- A marca segue o site: **lojadoouro.pt** é a Loja do Ouro; **goldstorepremium.com** é a Gold Store Premium.
- O chat funciona em português, inglês, espanhol, francês e alemão, conforme a língua do site do cliente.
- Quando não é Loja do Ouro em português, o cabeçalho da conversa mostra uma etiqueta como "EN · Gold Store Premium" (passe o rato para ver o site, a língua e o país), e a linha "Envia por:" diz a marca e a língua.

Responda **na língua do cliente** e fale **só da marca da conversa**. Para perceber mensagens noutra língua, use o botão **Traduzir as mensagens do cliente para português** no separador **✨ Assistente IA** (a tradução é só para si). Para preparar a resposta em inglês, peça uma proposta e use **Em inglês**. Ver [Assistente de IA](/apoio/documentacao/assistente-ia).

## Responder no chat
<!-- perguntas: Como respondo no chat do site? | O cliente do chat recebeu a minha resposta? | Posso enviar imagens no chat do site? | Como envio um produto no chat? -->

1. Confirme a linha "Envia por: Chat do site · marca · em (língua) · para (nome) (se já tiver saído do site, recebe também por email)".
2. Escreva a resposta. Pode usar listas (linhas começadas por "- "), negrito (`**texto**`) e ligações. **Não** se podem enviar anexos.
3. Para mostrar um produto, use **🛍 Produto** → **Inserir link**: o cliente vê um cartão com a foto e o preço, no site e na língua dele.
4. Carregue em **Enviar ao cliente**.

A mensagem passa a **Entregue** quando o chat do cliente a recebe e a **Lida** quando ele a vê com o chat aberto. O chat do cliente procura mensagens novas a cada 3,5 segundos com o chat aberto e a cada 30 segundos fechado.

## Quando o cliente sai do site
<!-- perguntas: O cliente fechou o chat, ainda lhe posso responder? | O cliente saiu do site, recebe a resposta? | A resposta do chat vai por email? -->

Pode responder sempre. Se o cliente já não está no site (sem contacto há mais de 45 segundos), a resposta fica no chat **e segue também por email**, para o email que ele indicou, na língua e com a marca do site dele, com o primeiro nome de quem respondeu. O detalhe da mensagem diz "Cliente fora do site: resposta enviada também por email para …".

Respostas que o cliente ainda não viu são juntadas num só email. Se o envio do email falhar ("aviso por email não enviado … Nova tentativa automática."), o sistema volta a tentar mais tarde, enquanto alguém da equipa tiver as Conversas abertas.

## Quando o cliente termina a conversa
<!-- perguntas: O cliente terminou a conversa no chat, o que acontece? | O que é a cópia da conversa por email? -->

No chat, o cliente pode carregar em **Terminar conversa**. Aparece "Terminar a conversa?", com a opção "Enviar-me uma cópia desta conversa por email" (só para o email que ele indicou) e o botão **Continuar a conversar** para desistir. Depois vê "Obrigado por falar connosco!" e pode **Iniciar nova conversa**.

Na equipa aparece o acontecimento "O cliente terminou a conversa no site" (e "… e pediu uma cópia por email"). Pode continuar a responder: as respostas seguem por email. Numa conversa terminada pelo cliente já não sai pedido de avaliação.

## No site agora
<!-- perguntas: Como sei se o cliente do chat ainda está no site? | Em que página está o cliente? | O que tem o cliente no carrinho? | De onde vem a informação do carrinho? | Há quanto tempo o cliente abriu o chat? | Quantas páginas viu o cliente? | O chat guarda alguma coisa no browser do cliente? -->

No separador **Cliente**, as conversas do chat têm uma secção que se atualiza a cada 15 segundos:

| Campo | O que mostra |
| --- | --- |
| No site agora / Saiu do site · visto há 4 min | Se o browser do cliente contactou o dashboard nos últimos 75 segundos |
| Site / Marca | Loja do Ouro ou Gold Store Premium, com ligação para o site |
| Língua / País | A língua do site e o país |
| Página | A página em que está (ou esteve), com ligação |
| Desde que abriu o chat | "Há 12 min" (ou "12 min até sair do site") e as páginas vistas desde então; "Ainda não abriu o chat nesta visita" quando o cliente volta ao site com uma conversa de antes e ainda não abriu o chat |
| Carrinho | "Sem informação", "Vazio" ou o número de artigos, o total e a lista |

Por baixo: "Enviado pelo browser do cliente (não confirmado)". Esta informação só é enviada depois de o cliente iniciar a conversa (e, enquanto a conversa estiver guardada no browser, também nas visitas seguintes: a página e o carrinho) e serve para o ajudar (por exemplo, saber de que produto fala). Não a use para outros fins nem a comente com o cliente sem necessidade.

O tempo e as páginas só começam a contar quando o cliente **abre o chat**: o tempo que andou pela loja antes disso não é contado nem enviado. Se o cliente abrir outro separador da loja (um produto ou uma ligação que lhe enviou no chat, por exemplo), o painel continua a mostrar a hora a que abriu o chat; as páginas desse separador só contam se o cliente abrir o chat lá.

> **Lei:** Quando abre o chat, antes de o iniciar, o cliente é informado de que a equipa vê a página e o carrinho. A quem só visita a loja e nunca abre o chat, o widget não grava nada no browser (nem cookies). Só depois de o cliente abrir o chat guarda que o chat está aberto (até o cliente o fechar) e há quanto tempo o abriu (até fechar o separador, fechar o chat sem iniciar conversa ou passarem 30 minutos sem atividade); quando inicia a conversa, guarda também o token da conversa, para a continuar noutras páginas, noutros separadores e noutro dia (até a conversa terminar), e com ele a hora a que abriu o chat, para os outros separadores. Ver [Proteção de dados no Apoio ao Cliente](/apoio/documentacao/protecao-de-dados#dever-de-informar-os-clientes).

## Transferências no chat
<!-- perguntas: O cliente do chat vê quando transfiro a conversa? -->

Quando transfere uma conversa do chat, o cliente vê "A conversa foi transferida para Rita." e passa a ver "A falar com Rita". A confirmação da transferência avisa disso. Ver [Responsável e transferências](/apoio/documentacao/responsavel-e-transferencias#transferir-para-uma-colega).

## Avaliação no chat
<!-- perguntas: Como é o pedido de avaliação no chat do site? -->

Com o pedido de avaliação ligado, ao resolver a conversa o cliente vê no próprio chat "Obrigado por falar connosco! Como avalia o atendimento de Ana?" com estrelas de 1 a 5. Só aparece quando ele abre o chat (se não o abrir em 72 horas, não sai) e nunca é enviado por email. Ver [Avaliação e desempenho](/apoio/documentacao/avaliacao-e-desempenho).

## Testar o chat
<!-- perguntas: Como testo o chat do site? | Onde está a página de teste do chat? | Como vejo o chat em inglês? -->

A página **Testar o chat do site** (`/apoio/chat-teste`, ou o botão **Testar o chat** na Configuração do apoio) tem o mesmo chat que está no site, ligado ao dashboard a sério:

1. Carregue em **Abrir o chat** e escreva um nome, **um email seu** e uma mensagem.
2. Noutro separador do browser, abra as Conversas: a conversa aparece no canal Chat do site. Responda.
3. Veja no separador Cliente a secção "No site agora" (nesta página de teste não há carrinho).
4. A resposta aparece no chat em segundos. Se fechar o separador do teste e esperar 1 minuto antes de responder, a resposta segue também por email.
5. **Recomeçar como cliente novo** apaga a sessão do teste para começar outra conversa.

Por baixo há ligações para testar as outras línguas (PT, EN, ES, FR, DE) e a Gold Store Premium.

> **Atenção:** As conversas de teste entram nas Conversas como conversas reais. Use sempre o seu próprio email e resolva a conversa no fim do teste.

## Limites do chat
<!-- perguntas: O cliente pode enviar anexos no chat? | Há limite de mensagens no chat? -->

- Nem a equipa nem o cliente enviam anexos no chat.
- Mensagens do cliente até 2000 caracteres.
- Para travar abusos, há limites de conversas novas por ligação e de mensagens seguidas; quem passa o limite vê uma mensagem a pedir para esperar.
