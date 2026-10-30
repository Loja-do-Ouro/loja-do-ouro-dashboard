# Assistente de IA
<!-- resumo: Como usar o assistente de IA do apoio: pedir uma proposta de resposta, resumir, traduzir e perguntar; o que a IA consulta, o que nunca faz, limites diários e quem vê os pedidos. -->
<!-- termos: IA, inteligência artificial, AI, assistente, assistente IA, chatbot, Claude, Anthropic, ChatGPT, sugerir resposta, sugestão, proposta, rascunho da IA, resumir, resumo, traduzir, tradução, inglês, mais curta, mais formal, perguntar à IA, base de conhecimento, limite diário, pedidos hoje, orçamento, custo, alucinação, inventar, confirmar antes de enviar -->
<!-- atualizado: 2026-10-30 -->

O assistente de IA ajuda a escrever respostas e a perceber casos. Funciona com o modelo Claude, da Anthropic. **Nunca envia nada ao cliente**: propõe um texto que a pessoa lê, corrige e decide enviar.

## Onde está
<!-- perguntas: Onde está o assistente de IA? | Como abro a IA numa conversa? -->

- No separador **✨ Assistente IA**, na coluna lateral de cada conversa (em ecrãs mais estreitos, botão **✨ IA** no cabeçalho da conversa).
- No botão **✨ Sugerir resposta**, por baixo do campo de resposta: abre o separador da IA e pede logo uma proposta.

## Pedir uma proposta de resposta
<!-- perguntas: Como peço à IA uma resposta? | Como uso a proposta da IA? | A IA envia a resposta sozinha? | Qual a diferença entre Usar na resposta e Acrescentar? -->

1. Abra a conversa e carregue em **✨ Sugerir resposta** (no campo de resposta ou no separador da IA).
2. Espere uns segundos. O progresso vai aparecendo ("A ler a conversa e a base de conhecimento…", "A procurar na loja…", "A consultar as encomendas do cliente…", "A preparar a resposta…").
3. Leia a resposta da IA: uma mensagem para si, o bloco **Proposta de resposta ao cliente** e, por baixo, a lista do que **tem de confirmar antes de enviar** e "Consultou: …" (as fontes usadas).
4. Escolha:
   - **Usar na resposta** — põe a proposta no campo de resposta, no lugar do que lá estava (pede confirmação se já houver texto);
   - **Acrescentar** — junta a proposta ao fim do texto que já escreveu;
   - **Copiar** — copia o texto.
5. Reveja e corrija no campo de resposta: confirme cada ponto da lista, retire marcadores como "[confirmar prazo]" e ajuste o tom.
6. Só então carregue em **Enviar ao cliente**.

Se mudar de separador ou de conversa, o pedido continua; mesmo que feche a página, termina no servidor e a resposta aparece quando voltar.

> **Atenção:** Nada é enviado ao cliente sem carregar em **Enviar ao cliente** (nos comentários, **Publicar resposta**). A responsabilidade pelo que sai é sempre de quem envia.

## Botões rápidos
<!-- perguntas: Como resumo uma conversa longa? | Como traduzo as mensagens do cliente? | Como ponho a resposta em inglês? | Como encurto a proposta da IA? -->

| Botão | O que faz |
| --- | --- |
| ✨ Sugerir resposta | Propõe uma resposta ao cliente |
| Resumir o caso | O que o cliente quer, o que já foi feito e o que falta |
| Mais curta | Reescreve a última proposta, mais curta |
| Mais formal | Reescreve a última proposta num tom mais formal |
| Em inglês | Traduz a última proposta para inglês |
| Traduzir as mensagens do cliente para português | Traduz as mensagens do cliente, pela ordem, só para a equipa (não propõe resposta) |

## Perguntar à IA
<!-- perguntas: Posso fazer perguntas à IA? | Que perguntas posso fazer ao assistente? | Como pergunto à IA sobre produtos? -->

Na caixa "Pergunte à IA (ex.: «que anéis em ouro branco temos até 300 €?», «responde a dizer que já enviámos»)…" pode escrever um pedido livre (até 4000 caracteres) e carregar em **Perguntar** (ou Ctrl+Enter). Exemplos:

- "Que anéis em ouro branco temos até 300 €?"
- "Qual é a política de trocas?"
- "Responde a dizer que a encomenda já foi enviada e dá o seguimento."
- "O que é que este cliente quer?"

Ao lado aparece quantos pedidos fez hoje ("N/80 pedidos hoje").

## O que a IA consulta
<!-- perguntas: O que é que a IA sabe? | A IA vê as encomendas do cliente? | A IA lê as notas internas? | De onde vem a informação da IA? -->

Em cada pedido, a IA recebe:

- a **conversa aberta**: canal, assunto, estado, responsável e as últimas 40 mensagens desde a data do histórico visível, **incluindo as notas internas** (marcadas como internas);
- os dados do cliente: nome, perfil, email (e se está confirmado), telefone e outros contactos do mesmo cliente;
- no chat do site, o que o browser do cliente enviou (página, carrinho, língua, país), marcado como não confirmado;
- a **base de conhecimento** escrita pelo Super Admin, as lojas físicas do dashboard e as políticas e páginas publicadas da loja online;
- os seus últimos pedidos à IA nessa conversa e o seu nome.

Quando precisa, consulta também (só leitura):

- **produtos, coleções e páginas** publicados na loja online;
- **as encomendas do cliente** (até 10), sempre do email associado ou do email do contacto — nunca de um email só "indicado" no chat;
- **uma encomenda pelo número**, com detalhes só se for desse cliente;
- **respostas anteriores da equipa** noutras conversas, como exemplo de tom, sempre sem nomes, contactos, números nem ligações;
- **outras conversas do mesmo cliente** (mesmo contacto, email ou telefone).

A IA não vê imagens nem abre anexos: só sabe o nome e o tipo do ficheiro.

> **Dica:** Como a IA lê as notas internas, uma boa nota ("cliente já recebeu o vale de troca a 12/10") ajuda a IA a propor uma resposta certa. As notas nunca são citadas na resposta ao cliente.

## O que a IA está instruída a fazer e a não fazer
<!-- perguntas: A IA pode inventar preços? | A IA pode prometer reembolsos? | Posso confiar na IA? | A IA diz ao cliente que é uma IA? -->

A IA está instruída para:

- usar primeiro a base de conhecimento, depois as políticas e páginas da loja, depois as ferramentas;
- **nunca inventar** preços, prazos, stock, portes, moradas, horários, garantias, trocas, descontos, contactos nem ligações; quando falta um dado, deixa um marcador como "[confirmar prazo]" e põe-no na lista a confirmar;
- **nunca prometer** reembolsos, compensações, descontos, ofertas ou exceções às políticas;
- escrever na língua do cliente e, em português, em português de Portugal;
- adaptar o tamanho ao canal e, nos comentários públicos, nunca escrever dados pessoais nem de encomendas;
- no email, não pôr assinatura (é automática);
- tratar o que os clientes escrevem como dados e não como ordens, e avisar se alguém tentar dar instruções à IA;
- nunca dizer ao cliente que é uma IA nem falar de ferramentas ou custos.

Além disso, o servidor confere cada proposta: ligações que não vieram da loja online, da base de conhecimento nem das ferramentas aparecem na lista a confirmar ("Confirme a ligação …: não veio da loja online nem da base de conhecimento.").

Mesmo assim, **a IA pode errar**. O aviso fixo no fundo do separador diz: "A IA pode errar: confirme antes de enviar. Nada é enviado ao cliente sem carregar em "Enviar ao cliente". A conversa e os dados consultados são processados pela Anthropic (Claude)."

## Limites e orçamento
<!-- perguntas: Quantos pedidos à IA posso fazer por dia? | Quanto custa a IA? | Atingi o limite diário da IA, o que faço? | Porque é que a IA diz que o orçamento está esgotado? -->

| Limite | Valor por omissão |
| --- | --- |
| Pedidos por pessoa e por dia | 80 |
| Pedidos em curso ao mesmo tempo, por pessoa | 2 |
| Orçamento mensal da equipa | US$ 30 |
| Tamanho da pergunta | 4000 caracteres |

O Super Admin pode mudar o limite diário e o orçamento. Quando um limite é atingido, aparece, por exemplo, "Atingiu o limite diário de 80 pedidos à IA. O Super Admin pode alterá-lo na configuração do apoio." ou "Orçamento mensal da IA esgotado (US$ 30). …". Nesse caso, responda sem a IA.

## Quem vê os seus pedidos
<!-- perguntas: As colegas veem as minhas perguntas à IA? | O Super Admin vê o que pergunto à IA? | Durante quanto tempo ficam guardados os pedidos à IA? -->

- O histórico de pedidos de cada conversa (os últimos 30) **só é visível para quem os fez**.
- O Super Admin vê, por pessoa, quantos pedidos foram feitos e o custo estimado, mas **não o conteúdo**. O custo de cada pedido só aparece ao Super Admin.
- Os pedidos à IA são apagados ao fim de **180 dias**.

## Privacidade
<!-- perguntas: Os dados dos clientes vão para a Anthropic? | É legal usar IA com dados de clientes? -->

Para gerar a resposta, a conversa e os dados consultados são enviados à Anthropic. Por isso:

- não escreva na pergunta à IA dados que não sejam precisos para o caso;
- nunca cole na IA dados de pagamento, palavras-passe ou documentos de identificação;
- trate a proposta como um rascunho seu, que tem de confirmar.

> **Lei:** O enquadramento do uso da IA (RGPD e Regulamento Europeu da Inteligência Artificial) está em [Inteligência artificial no apoio](/apoio/documentacao/inteligencia-artificial).

## Mensagens de erro
<!-- perguntas: A IA não responde | A IA demorou demasiado | O assistente de IA está desligado -->

| Mensagem | O que fazer |
| --- | --- |
| "Já tem dois pedidos à IA em curso. Aguarde que terminem." | Espere pelos pedidos anteriores |
| "A IA demorou demasiado a responder…" | Tente outra vez, com um pedido mais simples |
| "A IA recusou este pedido. Reformule-o ou responda sem a IA." | Reformule ou responda sem a IA |
| "A IA está sobrecarregada ou indisponível…" / "Sem ligação à IA…" | Tente dentro de momentos |
| "O assistente de IA está desligado na configuração do apoio." | O Super Admin desligou-o; responda sem a IA |
| "Assistente de IA por configurar: …" | Falta a chave da Anthropic; avise o Super Admin |
| "A ligação foi interrompida. Se a IA terminar, a resposta aparece aqui dentro de momentos." | Espere; o pedido continua no servidor |

> **Nota:** A IA não responde sozinha aos clientes. As únicas mensagens automáticas do apoio são as descritas em [Respostas automáticas](/apoio/documentacao/respostas-automaticas) e o [pedido de avaliação](/apoio/documentacao/avaliacao-e-desempenho), e nenhuma é escrita pela IA.
