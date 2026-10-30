# Responder e notas internas
<!-- resumo: Como escrever e enviar uma resposta ao cliente ou uma nota interna: destino, rascunhos, anexos, emojis, produtos da loja, formatação e limites de cada canal. -->
<!-- termos: responder, resposta, enviar, mandar, escrever, reply, nota interna, nota, comentário privado, internal note, rascunho, draft, anexar, anexo, anexos, imagem, fotografia, foto, PDF, ficheiro, colar imagem, emoji, emojis, produto, link do produto, ligação, catálogo, formatação, negrito, lista, limite de caracteres, Ctrl+Enter, campo de resposta, composer, não consigo responder -->
<!-- atualizado: 2026-10-30 -->

Por baixo das mensagens de cada conversa está o campo de resposta, com dois separadores: **Responder ao cliente** e **Nota interna**. Este artigo explica como escrever. O que acontece depois de carregar em Enviar (estados de entrega, falhas) está em [Envio e entrega](/apoio/documentacao/envio-e-entrega).

## Resposta ao cliente ou nota interna
<!-- perguntas: Qual a diferença entre responder ao cliente e nota interna? | O cliente vê as notas internas? | Quem pode escrever notas internas? | Para que servem as notas internas? -->

| O quê | Responder ao cliente | Nota interna |
| --- | --- | --- |
| Quem vê | O cliente e a equipa | Só a equipa (nunca é enviada ao cliente) |
| Quem pode escrever | O responsável da conversa, ou qualquer pessoa se a conversa não tiver responsável | Toda a equipa, em qualquer conversa |
| Botão | **Enviar ao cliente** (nos comentários, **Publicar resposta**) | **Guardar nota** |
| No Zendesk ligado | Resposta pública no ticket | Comentário privado no ticket |

Use a nota interna para passar informação à equipa: o que já foi feito, o que falta, uma combinação com a loja. Nos comentários públicos, o separador de resposta chama-se **Resposta pública**.

> **Atenção:** A nota interna não sai para o cliente, mas fica guardada na conversa, é vista por toda a equipa e é lida pelo assistente de IA. Escreva só factos necessários ao atendimento, sem juízos sobre o cliente, e nunca dados de pagamento. Um cliente pode pedir acesso aos seus dados, e as notas fazem parte deles. Ver [Boas práticas de privacidade](/apoio/documentacao/boas-praticas-de-privacidade).

## Para onde vai a resposta
<!-- perguntas: Para onde vai a minha resposta? | Por onde sai a resposta ao cliente? | O que quer dizer Envia por? -->

Por cima do campo, a linha **Envia por:** diz exatamente por onde vai sair a resposta. Por exemplo:

| Canal | O que diz "Envia por:" |
| --- | --- |
| Email | Email para o cliente, de apoiocliente@lojadoouro.pt — na mesma conversa, com a assinatura automática |
| Facebook | Facebook Messenger · para (nome do cliente) |
| Instagram | Instagram Direct · para (perfil do cliente) |
| Comentários | Comentário público no Instagram (ou Facebook) · resposta a (perfil) (todos veem) |
| Chat do site | Chat do site · marca · em (língua) · para (nome) (se já tiver saído do site, recebe também por email) |
| Zendesk ligado | Resposta pública no ticket #N — Zendesk notifica (email do cliente) |
| Zendesk desligado | nada sai para o cliente por aqui (Zendesk desligado) |

Numa conversa sem responsável aparece ainda "Ao responder fica responsável por esta conversa.".

## Escrever e enviar, passo a passo
<!-- perguntas: Como respondo a um cliente? | Como envio uma resposta? | Como guardo uma nota interna? | Há atalho para enviar? -->

1. Abra a conversa e leia-a até ao fim, incluindo as notas internas e o separador **Cliente**.
2. Escolha o separador **Responder ao cliente** ou **Nota interna**.
3. Confirme a linha **Envia por:**.
4. Escreva o texto. Se quiser ajuda, carregue em **✨ Sugerir resposta** (a IA propõe um texto no separador do assistente; não envia nada). Ver [Assistente de IA](/apoio/documentacao/assistente-ia).
5. Junte, se precisar, um anexo (**📎 Anexar**), um emoji (**😊**) ou um produto da loja (**🛍 Produto**).
6. Carregue em **Enviar ao cliente** (ou **Guardar nota**). Atalho: Ctrl+Enter (Cmd+Enter no Mac).
7. Se a [revisão da IA](/apoio/documentacao/revisao-ia-antes-de-enviar) estiver ligada, a resposta pode ser revista antes de sair.
8. Veja o estado da mensagem na conversa ("Aceite pela plataforma", "Entregue"…) e mude o estado da conversa, se for o caso ([Estados da conversa](/apoio/documentacao/estados-da-conversa)).

O botão de enviar fica cinzento sem texto nem anexo, enquanto um anexo está a carregar e, nos comentários, acima do limite de caracteres.

## Quando não consegue responder
<!-- perguntas: Porque é que não consigo responder a esta conversa? | O campo de resposta desapareceu | Aparece uma mensagem no lugar do campo de resposta | Esta conversa está com outra pessoa -->

Quando não é possível responder, o campo é substituído por uma explicação. As mais comuns:

| Mensagem (início) | Porquê | O que fazer |
| --- | --- | --- |
| "Esta conversa está com Nome: só essa pessoa responde ao cliente." | A conversa tem outro responsável | Deixe uma nota interna ou peça-lhe que lha transfira. O Super Admin transfere-a para si primeiro. |
| "Ligue a sua conta Zendesk para responder com a sua autoria." | Zendesk ligado e a sua conta ainda não | Carregue em **Ligar Zendesk** |
| "O Zendesk foi desligado do dashboard…" | Ticket antigo, só histórico | Responda no próprio Zendesk (separador Cliente → **Abrir no Zendesk**) |
| "A caixa Gmail do apoio precisa de ser ligada de novo…" | A ligação ao Gmail expirou | Avise o Super Admin; entretanto responda no Gmail |
| "A Metricool recusou o acesso a esta caixa de entrada…" | Ligação ao Facebook/Instagram em baixo | Avise o Super Admin; responda no Meta Business Suite |
| "O Messenger (ou Instagram) não aceita mensagens nossas para esta pessoa (Meta #551)…" | O cliente bloqueou a página ou desativou a conta | Só quando o cliente voltar a escrever. Ver [Facebook e Instagram](/apoio/documentacao/facebook-instagram#erro-meta-551) |
| "As respostas públicas aos comentários ainda estão desligadas…" | Respostas a comentários por validar | Responda na própria publicação, se for preciso |
| "WhatsApp por configurar…" | O WhatsApp não está ligado | Nada a fazer pelo dashboard |

Se tinha um rascunho e o canal ficou bloqueado (Zendesk desligado, respostas públicas desligadas, Meta #551), o rascunho aparece só para leitura com **Copiar** e **Passar para nota interna**.

As notas internas quase nunca estão bloqueadas. A exceção: com o Zendesk ligado, é preciso ter a conta Zendesk ligada ("Ligue a sua conta Zendesk para escrever notas internas no ticket.").

## Rascunhos
<!-- perguntas: Os rascunhos ficam guardados? | Perdi o texto que estava a escrever | Se mudar de conversa perco o que escrevi? | A colega vê o meu rascunho? -->

O que escreve fica guardado como rascunho, um por conversa e por separador (resposta e nota). O rascunho:

- mantém-se se mudar de conversa, for a outra página do dashboard ou recarregar a página;
- perde-se se **fechar o separador do browser**;
- fica só no seu browser: as colegas não o veem e não passa para outro computador;
- só se apaga quando o envio é aceite (ou fica incerto), e só se ainda for o texto que enviou.

Os anexos por enviar também ficam guardados com o rascunho (sem a pré-visualização).

## Anexar imagens e PDF
<!-- perguntas: Como envio uma fotografia ao cliente? | Posso enviar um PDF? | Quantos anexos posso enviar? | Posso colar uma imagem? | Porque é que não consigo anexar? | Posso anexar no chat do site? -->

Carregue em **📎 Anexar** e escolha o ficheiro, ou cole uma imagem (Ctrl+V) no campo. Passe o rato sobre o botão para ver as regras do canal.

| Canal | Na resposta | Na nota interna |
| --- | --- | --- |
| Email | Até 5 imagens ou PDF | Sem anexos |
| Zendesk ligado | Até 5 imagens ou PDF | Até 5 imagens ou PDF (comentário privado) |
| Facebook e Instagram | 1 imagem (JPEG ou PNG) por mensagem | Sem anexos |
| Comentários | Sem anexos (só texto) | Sem anexos |
| Chat do site | Sem anexos | Sem anexos |
| WhatsApp e Zendesk desligado | — | Sem anexos |

Antes de enviar:

- As fotografias (JPEG, PNG, WebP, HEIC) são reduzidas no próprio browser para no máximo 2048 píxeis. Isto **retira a localização e os outros dados escondidos (EXIF)** da fotografia.
- Os PDF seguem como estão, até 4 MB, e só no email e no Zendesk.
- Para retirar um anexo antes de enviar, carregue no **✕** ao lado dele.
- Ao colar, se a área de transferência tiver texto e imagem (como acontece no Excel ou no Word), fica só o texto.

Os ficheiros que envia ficam guardados no sistema até 30 dias, ou menos quando o anexo já fica guardado na própria plataforma (os que nunca chegaram a ser enviados, 1 dia). Mensagens de erro comuns: "PDF só no email e nos tickets Zendesk.", "PDF demasiado grande (máximo 4 MB).", "No máximo N anexo(s) nesta mensagem.", "O Facebook e o Instagram aceitam uma imagem por mensagem.", "Limite diário de anexos atingido.".

> **Atenção:** Antes de enviar uma imagem, veja se não mostra dados de outros clientes (por exemplo, uma fotografia de uma etiqueta de envio ou de um ecrã).

## Emojis
<!-- perguntas: Como insiro um emoji? | Onde estão os emojis? -->

Carregue em **😊** para abrir o painel. Pode procurar ("Procurar emoji (ex.: obrigada, coração, anel, entrega)") ou escolher por categoria: Recentes (os seus últimos, neste browser), Caras, Gestos, Corações, Joias e loja, Celebrações, Encomendas e contacto e Símbolos. O emoji entra onde estava o cursor. Enter insere o primeiro resultado da pesquisa; Esc fecha o painel.

## Inserir um produto da loja
<!-- perguntas: Como envio o link de um produto? | Como mando a fotografia de um produto? | Como partilho uma coleção da loja? -->

1. No separador de resposta, carregue em **🛍 Produto**.
2. Escreva pelo menos duas letras em "Procurar produto, coleção ou página da loja online".
3. Na lista (até 8 produtos, 4 coleções e 4 páginas publicadas), veja o tipo, o preço e se está esgotado.
4. Carregue em **Inserir link** para pôr no texto o nome, o preço e a ligação, ou em **Link + foto** para juntar também a fotografia do produto como anexo (só nos canais que aceitam imagens e se ainda houver lugar para mais um anexo).

No chat do site, a ligação passa sozinha para o site e a língua do cliente, e o cliente vê um cartão com a foto e o preço. Na Gold Store Premium vai só a ligação (o cartão mostra o nome e o preço do próprio site).

> **Dica:** Só aparecem produtos publicados na loja online. Se aparecer "Sem resultados publicados na loja online.", o produto não está publicado ou o nome é outro.

## Formatação em cada canal
<!-- perguntas: Posso pôr negrito? | Como faço uma lista na resposta? | O email sai formatado? | As ligações ficam clicáveis? -->

Escreva sempre texto simples. Cada canal trata-o assim:

- **Email**: as linhas em branco separam parágrafos; duas ou mais linhas seguidas a começar por "- " ou "• " viram uma lista; as ligações (http ou https) ficam clicáveis. A assinatura é acrescentada no fim.
- **Chat do site**: parágrafos, listas (linhas a começar por "- ", "• ", "* " ou "1. "), negrito com `**texto**` e ligações clicáveis. Uma linha só com a ligação de um produto da loja aparece como cartão com foto e preço.
- **Facebook, Instagram, comentários e Zendesk**: o texto segue tal como foi escrito, sem formatação.

## Limites de texto
<!-- perguntas: Quantos caracteres posso escrever? | Qual é o limite de um comentário no Instagram? -->

| Onde | Limite |
| --- | --- |
| Resposta ou nota (todos os canais) | 20 000 caracteres |
| Resposta a comentário no Instagram | 2200 caracteres |
| Resposta a comentário no Facebook | 8000 caracteres |

Nos comentários há um contador ("N/2200") e o botão fica bloqueado acima do limite. Colar um texto que passe o limite mostra "Texto demasiado longo para um comentário…".

## Como escrever bem
<!-- perguntas: Que tom devo usar nas respostas? | Devo tratar o cliente por você? | Que cuidados ter na escrita? -->

São os critérios que a [revisão da IA](/apoio/documentacao/revisao-ia-antes-de-enviar) usa por omissão e uma boa regra para todas as respostas:

- Saudação na primeira resposta da conversa ou do dia, com o nome do cliente quando o sabemos.
- Tom caloroso e profissional; frases curtas e claras.
- Responder a todas as perguntas da última mensagem do cliente.
- Dizer qual é o próximo passo (o que vamos fazer ou o que o cliente tem de fazer).
- Na língua do cliente; em português, sempre português de Portugal (sem "você", "estou verificando", "contato", "equipe", "celular").
- Só a marca da conversa (Loja do Ouro ou Gold Store Premium) e o respetivo site.
- Não prometer prazos, preços, descontos ou reembolsos que não estejam confirmados.
- Mensagens curtas no Messenger, Instagram, chat do site e comentários; mais completas no email.

> **Lei:** O que se promete por escrito ao cliente pode ter valor legal (por exemplo, prazos de entrega ou condições de troca). Ver [Direitos do consumidor](/apoio/documentacao/direitos-do-consumidor).
