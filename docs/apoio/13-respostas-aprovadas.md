# Respostas aprovadas (base de conhecimento aprendida)
<!-- resumo: Como a IA aprende com as respostas da equipa sem treinar nenhum modelo: o botão Guardar como resposta aprovada, as propostas automáticas, a revisão, a confirmação e a publicação pelo Super Admin, as regras de dados pessoais, o que fica guardado e quanto custa. -->
<!-- termos: respostas aprovadas, resposta aprovada, base de conhecimento aprendida, cartão, cartões, cartões de conhecimento, guardar como resposta aprovada, guardar resposta, guardar para a IA, ensinar a IA, a IA aprende, aprender, aprendizagem, treinar a IA, propostas automáticas, propostas da IA, aprovar, publicar alterações, arquivar, juntar, avisos, confirmo que li o texto, permitir em respostas automáticas, confirmada em conversas, Claude Sonnet 5.5, orçamento das propostas, custo dos cartões, FAQ interna, knowledge base -->
<!-- atualizado: 2026-10-30 -->

As **respostas aprovadas** são a parte da base de conhecimento que a IA aprende com a própria equipa. Quando uma colega dá uma boa resposta a uma pergunta que outros clientes também fazem (o horário de uma loja, os prazos de envio, como funciona uma troca), a IA pode transformá-la num **cartão**: uma pergunta genérica e a resposta da empresa, sem nada do cliente. O Super Admin lê cada cartão, corrige-o, confirma que não tem dados pessoais, aprova-o e publica-o. Só depois disso o [Assistente de IA](/apoio/documentacao/assistente-ia) o passa a usar nas propostas de resposta.

**Nenhum modelo de IA é treinado com as conversas.** A IA não "decora" nada: lê, em cada pedido, o texto dos cartões publicados, tal como lê a base de conhecimento escrita pelo Super Admin. E **nada é enviado a clientes**: um cartão só ajuda a IA a propor respostas, que continuam a ser lidas e enviadas por uma pessoa.

As secções marcadas "(Super Admin)" descrevem o painel que só o Super Admin vê. O resto interessa a toda a equipa.

## O que são as respostas aprovadas
<!-- perguntas: O que são as respostas aprovadas? | A IA aprende com as nossas respostas? | A IA é treinada com as conversas dos clientes? | O que é a base de conhecimento aprendida? -->

- Por baixo de cada resposta que enviou pelo dashboard há o botão **Guardar como resposta aprovada**. A IA prepara uma proposta de cartão e o Super Admin decide se a aprova.
- Com a opção **Propostas automáticas a partir das conversas** ligada (vem desligada), a IA também lê, uma vez por dia, até 12 conversas já respondidas e propõe cartões.
- As regras do servidor retiram as propostas com dados pessoais claros (emails, telefones, números de encomenda, o nome do cliente…) e assinalam o resto com **avisos**. As regras não apanham tudo: o Super Admin lê e confirma cada cartão.
- A IA só usa os cartões **aprovados e publicados**, e a base de conhecimento escrita pelo Super Admin prevalece sobre eles.
- As propostas são feitas pelo Claude Sonnet 5.5, da Anthropic, com um orçamento mensal próprio (US$ 8 de origem).

## O que é um cartão
<!-- perguntas: O que é um cartão de resposta aprovada? | O que são os cartões da IA? | O que tem um cartão? | Que temas pode ter um cartão? | O que é a data Válida até? | A data de Válida até inclui o próprio dia? -->

| Campo | O que tem | Limite |
| --- | --- | --- |
| Pergunta | A pergunta genérica, como os clientes a fazem ("Qual é o horário da loja de Benfica?") | 5 a 300 caracteres |
| Outras formas da pergunta | Outras maneiras de fazer a mesma pergunta, uma por linha | Até 5, com até 200 caracteres cada |
| Resposta | A resposta da empresa, pronta a usar com qualquer cliente, em português de Portugal | Até 1500 caracteres |
| Tema | Saudação e agradecimentos, Horário das lojas, Moradas das lojas, Contactos, Envios, Pagamentos, Trocas e devoluções, Garantia e reparações, Gravações, Medidas e tamanhos, Materiais e cuidados, Compra de ouro, Encomendas (geral), Produtos e disponibilidade ou Outros | Um |
| Marca | Loja do Ouro, Gold Store Premium ou As duas marcas | Uma |
| Loja | Uma loja física, ou "Sem loja concreta" | — |
| Válida até | O último dia em que a resposta vale, inclusive (uma campanha, um horário de época); no dia seguinte a IA deixa de a usar | Opcional; não pode ser uma data que já passou |

Um cartão nunca tem nomes, emails, telefones, moradas de clientes, números de encomenda, valores pagos nem outros dados de um caso concreto. A IA escreve-o sem saudação com nome e sem assinatura, e só com o que a equipa escreveu nessa conversa: não acrescenta preços, prazos, horários, contactos, ligações, condições nem promessas.

## Como a IA usa as respostas publicadas
<!-- perguntas: Como é que a IA usa as respostas aprovadas? | Quando é que a IA passa a usar uma resposta aprovada? | O que prevalece, a base de conhecimento ou as respostas aprovadas? | A revisão antes de enviar usa as respostas aprovadas? -->

- O Assistente de IA (**✨ Sugerir resposta** e as perguntas no separador **✨ Assistente IA**) lê os cartões publicados em cada pedido, logo a seguir à base de conhecimento, agrupados por tema, com a loja e a marca de cada um («só Loja do Ouro», «só Gold Store Premium»), para a IA não usar como geral, numa conversa de uma marca, uma resposta só da outra.
- A IA está instruída a usá-los como a base de conhecimento; se um cartão contradisser a base de conhecimento escrita pelo Super Admin, **prevalece a base de conhecimento**.
- Uma ligação que está na resposta de um cartão publicado conta como ligação conhecida: não aparece em "Confirmar antes de enviar" por não vir da loja online.
- Só contam os cartões **aprovados**, **publicados** (com **Publicar alterações**) e ainda válidos: a IA usa um cartão até ao dia de "Válida até", inclusive, e deixa de o usar no dia seguinte.
- Uma correção a um cartão aprovado só chega à IA quando o Super Admin volta a publicar. **Arquivar** retira o cartão logo.
- A [revisão da IA antes de enviar](/apoio/documentacao/revisao-ia-antes-de-enviar) não usa os cartões: usa só a base de conhecimento escrita pelo Super Admin e os critérios de qualidade.

No máximo, a IA usa 200 respostas aprovadas, com 80 000 caracteres no total.

> **Nota:** O cartão não é uma resposta pronta a enviar. A IA usa-o como informação e escreve uma proposta para a conversa, que a pessoa lê, corrige e envia com **Enviar ao cliente**.

## Guardar como resposta aprovada
<!-- perguntas: Como guardo uma resposta para a IA? | Quem pode carregar em Guardar como resposta aprovada? | O que acontece quando carrego em Guardar como resposta aprovada? | Quando devo guardar uma resposta como aprovada? -->

O botão **Guardar como resposta aprovada** aparece por baixo de uma resposta ao cliente quando:

- foi enviada pelo dashboard (não aparece nas respostas escritas diretamente no Gmail, na Meta ou no Zendesk, nas respostas automáticas nem nas notas internas);
- é **sua**, ou é o Super Admin a vê-la (o Super Admin pode guardar a resposta de qualquer pessoa);
- tem pelo menos 20 caracteres;
- está **Aceite pela plataforma**, **Entregue** ou **Lida** (não em "A enviar", "Falhou" nem "Resultado incerto");
- é posterior à data do [histórico visível](/apoio/documentacao/historico-visivel).

O que acontece quando carrega:

1. O botão passa a "A preparar a proposta…". Espere: pode levar até cerca de 30 segundos. Os outros botões iguais ficam parados até acabar.
2. A IA lê a conversa até essa resposta (as últimas 30 mensagens desde o histórico visível, sem notas internas nem pedidos de avaliação; sem nomes, marcadas "cliente", "equipa" ou "equipa fora do dashboard", que são as respostas automáticas e as enviadas noutra plataforma), usa a resposta que escolheu como fonte e escreve um cartão.
3. O servidor confere o cartão (ver [Recusas e avisos](/apoio/documentacao/respostas-aprovadas#recusas-e-avisos)).
4. No topo da conversa aparece o resultado (tabela abaixo); se entretanto mudar de conversa, o pedido termina na mesma. Uma proposta nova fica à espera do Super Admin: a equipa não vê a lista dos cartões nem recebe aviso quando a resposta é aprovada ou arquivada.

Guarde respostas a **perguntas gerais** que outros clientes também fazem, com informação certa e em vigor. Não vale a pena guardar respostas que só servem aquele cliente (o estado de uma encomenda, um orçamento, uma reclamação): a IA responde que não encontrou uma pergunta geral.

| Mensagem | O que quer dizer |
| --- | --- |
| "Guardada como proposta na base de conhecimento aprendida: …" | Há uma proposta nova. O Super Admin lê-a, confirma que não tem dados pessoais e aprova-a |
| "Já existe uma resposta (proposta ou aprovada) para esta pergunta: ficou contada como mais uma confirmação." | A pergunta já tinha cartão; a conversa conta para "Confirmada em n conversas" (ver as regras mais abaixo) |
| "A IA não encontrou nesta resposta uma pergunta geral para reutilizar: …" | A resposta só servia este caso. Nada foi guardado |
| "A proposta da IA foi retirada pelas regras de segurança: …" | A proposta tinha dados pessoais, factos que a equipa não escreveu, texto do cliente ou a outra marca, não tinha o formato esperado ou já há 300 propostas por rever. Nada foi guardado (o pedido à IA conta no custo) |
| "Não foi possível preparar a proposta (…). Tente outra vez mais tarde." | Erro ou demora da IA. Pode tentar outra vez |

Cada resposta dá no máximo uma proposta. Depois de um erro, de uma proposta retirada ou de "não encontrou uma pergunta geral" pode carregar outra vez. Cada pessoa pode fazer até **30 pedidos por dia** (contam também os que deram erro ou não deram proposta); quando o Super Admin guarda a resposta de uma colega, o pedido conta para o Super Admin.

## Propostas automáticas (Super Admin)
<!-- perguntas: Como ligo as propostas automáticas? | A IA lê as conversas sozinha para propor respostas? | Quantas conversas a IA lê por dia? | Que conversas entram nas propostas automáticas? -->

Na página **IA do apoio**, painel **Base de conhecimento aprendida** (RESPOSTAS APROVADAS), a caixa **Propostas automáticas a partir das conversas** vem **desligada**. O botão "Guardar como resposta aprovada" funciona sempre, ligada ou desligada.

Com a caixa ligada, na passagem diária (06:00 UTC) a IA lê até **12 conversas** e propõe cartões, sem ninguém carregar no botão. Entram as conversas:

- com respostas da equipa enviadas pelo dashboard desde o histórico visível e nos últimos 170 dias;
- resolvidas, ou sem atividade há 72 horas;
- ainda não lidas, ou com respostas novas da equipa desde a última leitura.

As conversas são lidas por ordem aleatória, uma de cada vez, até 15 segundos cada, e não começa nenhuma leitura nova depois dos 90 segundos. Uma conversa só fica lida quando o pedido acaba bem; com erro, tenta-se no dia seguinte, no máximo duas vezes. A passagem não começa com a caixa desligada, com o orçamento do mês esgotado ou com 300 propostas (ou mais) por rever, e pára a meio se a caixa for desligada ou o orçamento acabar. Se as 300 propostas por rever forem atingidas a meio da passagem, as conversas seguintes ainda são lidas pela IA (e custam), mas as propostas novas são retiradas ("já há 300 propostas por rever").

Só as respostas da equipa enviadas pelo dashboard servem de fonte. As respostas automáticas e as enviadas noutra plataforma dão contexto à IA, mas nunca são a fonte de um cartão.

## Orçamento e custos
<!-- perguntas: Quanto custam as respostas aprovadas? | Qual é o orçamento das propostas? | O que acontece quando o orçamento das propostas acaba? | Onde vejo o custo dos cartões? -->

- Cada proposta, do botão ou da passagem diária, é **um pedido** ao Claude Sonnet 5.5, sem novas tentativas. O custo estimado grava-se logo a seguir. Um pedido interrompido por demora conta por excesso (a Anthropic pode cobrá-lo na mesma); enquanto um pedido corre, reserva US$ 0,05 do orçamento.
- **Orçamento mensal das propostas (US$)**: de origem **US$ 8**, de 0 a 10 000. É separado do orçamento do Assistente de IA (US$ 30) e do da revisão antes de enviar (US$ 5). O mês é o mês de calendário, na hora de Lisboa.
- Quando o orçamento acaba, o botão mostra "Orçamento mensal da base de conhecimento aprendida esgotado: US$ …" e a passagem diária pára, até ao mês seguinte ou até o Super Admin o aumentar. Com 0 não há propostas, nem pelo botão.
- Aprovar, juntar, arquivar e publicar não chamam a IA e não custam nada. Os cartões publicados entram no texto que o Assistente lê em cada pedido (em cache durante 1 hora): um conjunto grande torna os pedidos do Assistente um pouco mais caros, no orçamento do Assistente.

O Super Admin vê o custo do mês no painel ("Este mês": "0,42 US$ de 8,00 US$ · n pedidos à IA") e em Configuração do apoio → **Assistente de IA** → **Base de conhecimento aprendida**. O custo é uma estimativa; a fatura da Anthropic é a referência.

## Os estados de uma resposta (Super Admin)
<!-- perguntas: Qual a diferença entre proposta, aprovada e publicada? | O que quer dizer a etiqueta Por publicar num cartão? | Onde vejo as propostas da IA? -->

O painel **Base de conhecimento aprendida** está na página **IA do apoio** (em Configuração do apoio → Assistente de IA, ligação **Rever as respostas**). Os separadores **Propostas (n)**, **Aprovadas (n)** e **Arquivadas (n)** mostram até 300 cartões cada; **Procurar** encontra-os pelas palavras (por exemplo "horário Benfica"). Ninguém é avisado de propostas novas (do botão ou da passagem diária): o Super Admin vê-as quando abre o painel.

| Estado | O que quer dizer | A IA usa? |
| --- | --- | --- |
| Proposta | Feita pela IA ou escrita pelo Super Admin; à espera de revisão. As que têm mais conversas a confirmá-las aparecem primeiro | Não |
| Aprovada, por publicar | Aprovada, mas a IA ainda usa a versão anterior (ou nenhuma): etiqueta **Por publicar** | Não, ou a versão anterior |
| Aprovada e publicada | "Em uso pela IA" nos totais do painel | Sim, até ao dia de "Válida até" (inclusive) |
| Arquivada | Retirada; pode ser aprovada de novo | Não |

Etiquetas de cada cartão:

| Etiqueta | O que quer dizer |
| --- | --- |
| Proposta, Aprovada, Arquivada | O estado |
| Confirmada em n conversas | Ver [Confirmada em n conversas](/apoio/documentacao/respostas-aprovadas#confirmada-em-n-conversas) |
| Por publicar | Aprovada com alterações que a IA ainda não usa |
| Texto por confirmar / Texto confirmado | Se falta ou não a confirmação do texto atual |
| n avisos / n avisos novos | Avisos do texto; "novos" são os que não estavam na última confirmação |
| Dados pessoais: … | O texto tem uma recusa (por exemplo "um telefone"): corrija-o antes de aprovar ou publicar |
| Português do Brasil: «…» / Menciona … | Expressões do português do Brasil ou a outra marca |
| Expira a … / Expirou a … | A data de "Válida até": "Expira a" até esse dia (inclusive), "Expirou a" a partir do dia seguinte |
| Rever até … | 90 dias depois da última revisão das aprovadas; com "(já passou)" quando o prazo acabou |
| Marcada para respostas automáticas | Ver [Permitir em respostas automáticas](/apoio/documentacao/respostas-aprovadas#permitir-em-respostas-automaticas) |

Por baixo do título, cada cartão diz quem o fez ("Proposta pela IA" ou "Escrita pelo Super Admin"), a última confirmação, quem o aprovou e quando foi publicado.

## Rever uma proposta passo a passo (Super Admin)
<!-- perguntas: Como aprovo uma resposta proposta pela IA? | Como reviso as propostas da IA? | O que devo verificar antes de aprovar um cartão? -->

1. Abra **IA do apoio** → **Base de conhecimento aprendida** → **Propostas** e abra um cartão.
2. Em "Conversas de origem", abra as conversas (**conversa 1**, **conversa 2**…) e confirme que a equipa respondeu mesmo isto e que a resposta serve outros clientes. Estas ligações desaparecem depois de aprovar ou arquivar.
3. Leia o texto inteiro. As palavras citadas nos avisos aparecem assinaladas no texto, e os avisos aparecem por cima da caixa de confirmação.
4. Corrija o que for preciso: tema (se a IA o escolheu mal), marca, loja, "Válida até", pergunta, outras formas e resposta. Retire qualquer dado de um caso concreto.
5. Marque **Confirmo que li o texto: não tem dados pessoais nem contradiz a resposta da equipa**.
6. Carregue em **Guardar e aprovar**: guarda primeiro as correções e só depois aprova.
7. Quando tiver aprovado o que quer, carregue em **Publicar alterações (n)**.

> **Atenção:** Os avisos ajudam a ler, mas não são o filtro. Leia sempre o texto inteiro, também nos cartões sem avisos ("Sem avisos. As regras não apanham tudo: leia o texto inteiro.").

## As ações sobre uma resposta (Super Admin)
<!-- perguntas: Como corrijo uma resposta aprovada? | Que botões tem cada cartão? -->

Todas as ações ficam no registo de auditoria do apoio, com quem e quando.

### Editar um cartão
<!-- perguntas: Como edito um cartão? | Editei um cartão e diz que só pode aprovar depois disto -->

**Guardar correções** grava o que está nos campos, sem alterar o estado. Os problemas que só as regras do servidor apanham (por exemplo, um telefone ou um nome) não impedem a gravação: as correções ficam guardadas e a mensagem diz o que falta ("Atenção, só pode aprovar ou publicar depois disto: …"). Com a caixa de confirmação marcada, regista também a confirmação do texto guardado.

Mas a base de dados recusa logo ao guardar, **e o que escreveu não fica guardado**: um email de fora da empresa, um IBAN ou NIF, números de encomenda, de cliente ou de fatura, textos fora dos limites e uma data de "Válida até" que já passou ("A data de validade já passou."). Num cartão expirado ("Expirou a …") nenhuma correção fica guardada sem mudar também a data: mude primeiro "Válida até" (ou apague-a). O mesmo vale para **Guardar e aprovar** e **Guardar e confirmar que continua certa**.

Numa resposta aprovada, qualquer alteração conta como revista, recomeça os 7 dias das respostas automáticas e tira a marca de resposta automática; a IA só usa a versão nova depois de publicar.

### Guardar e aprovar
<!-- perguntas: Como aprovo uma resposta? | Porque é que não consigo aprovar um cartão? -->

Nas propostas é **Guardar e aprovar**; nas arquivadas, **Guardar e aprovar de novo**. Guarda as correções e aprova, mas só se o texto não tiver dados pessoais (recusas), se a data de "Válida até" não tiver passado e se o texto atual estiver confirmado. Ao aprovar saem as conversas de origem. Depois, publique.

### Guardar e confirmar que continua certa
<!-- perguntas: Como confirmo que uma resposta aprovada continua certa? | O que quer dizer Rever até? | Rever até já passou, o que faço? -->

Nas respostas já aprovadas, o mesmo botão chama-se **Guardar e confirmar que continua certa**: guarda as correções e regista que a resposta foi revista hoje (pede também a confirmação do texto, se o texto atual ainda não estiver confirmado ou tiver avisos novos). Quando "Rever até" já passou, leia a resposta, corrija o que mudou e carregue neste botão. Uma resposta só pode ser usada em respostas automáticas se tiver sido revista nos últimos 90 dias; a etiqueta **Rever até** mostra o prazo.

### Juntar a outra resposta
<!-- perguntas: Como junto duas respostas iguais? | O que acontece quando junto dois cartões? -->

Quando duas respostas respondem à mesma pergunta, escolha em **Juntar a…** a outra (só aparecem as do mesmo tema que não estão arquivadas; corrija o tema primeiro se a IA o escolheu mal) e carregue em **Juntar**:

- a pergunta desta passa a ser uma das "outras formas" da outra (no máximo 5; se não couber, é recusado: "A outra resposta já tem 5 formas da pergunta…");
- as outras formas da pergunta desta também passam para a outra, mas só até completar 5: as que não couberem perdem-se sem aviso (só a pergunta principal tem de caber);
- as confirmações somam-se ("Confirmada em n conversas");
- os avisos da pergunta desta passam para a outra (no máximo 30; a mensagem diz se algum não coube);
- esta fica arquivada: se estava aprovada e publicada e a outra é uma proposta, a IA deixa logo de a usar e nada a substitui até a outra ser aprovada e publicada;
- **a confirmação da outra é apagada** e a marca de resposta automática sai: leia-a e confirme-a de novo antes de a aprovar ou publicar. O painel abre-a logo.

### Arquivar
<!-- perguntas: Como arquivo uma resposta? | Como retiro uma resposta da IA? | Como apago uma resposta aprovada? | Como elimino um cartão? -->

**Arquivar** retira a resposta da IA de imediato ("Resposta arquivada: a IA deixou de a usar."), sem precisar de publicar, e tira a marca de resposta automática. Uma arquivada pode voltar com **Guardar e aprovar de novo** (e tem de ser publicada outra vez).

Não há botão para apagar uma resposta: arquive-a. Uma resposta arquivada é apagada automaticamente 365 dias depois da última alteração (arquivar, corrigir ou juntar): corrigi-la recomeça a contagem.

### Publicar alterações
<!-- perguntas: Como publico as respostas aprovadas? | Porque é que a IA ainda não usa a resposta que aprovei? | Nada foi publicado, porquê? -->

**Publicar alterações (n)** passa todas as respostas aprovadas "Por publicar" para a IA de uma vez ("Publicadas n alteração(ões). A IA usa agora n resposta(s) aprovada(s)."). Não publica nada se uma resposta aprovada tiver dados pessoais ou o texto por confirmar ("Nada foi publicado: …"): o painel abre a primeira a corrigir ou a confirmar. Também recusa mais de 200 respostas em uso ou mais de 80 000 caracteres: arquive ou encurte algumas.

### Criar uma resposta nova
<!-- perguntas: Como escrevo uma resposta aprovada sem a IA? | Posso criar um cartão à mão? -->

No fim do painel, **Nova resposta** tem os mesmos campos. **Criar proposta** cria-a nas Propostas ("Escrita pelo Super Admin"), sem custo de IA, e o painel abre-a logo ("Proposta criada: leia-a, confirme-a e aprove-a para a usar."). A confirmação só se faz com os avisos à vista, por isso é sempre um segundo passo: leia-a, marque a caixa e carregue em **Guardar e aprovar**. Uma resposta que a base de dados recusa (ver [Editar um cartão](/apoio/documentacao/respostas-aprovadas#editar-um-cartao)) não é criada e o texto não fica guardado.

### Permitir em respostas automáticas
<!-- perguntas: O que faz Permitir em respostas automáticas? | A resposta aprovada é enviada sozinha aos clientes? | Porque não consigo permitir em respostas automáticas? -->

**Permitir em respostas automáticas** (nas aprovadas) **só marca** a resposta para umas respostas automáticas futuras, que ainda não existem. **Nada é enviado aos clientes.** As respostas automáticas que existem hoje são as de [Respostas automáticas](/apoio/documentacao/respostas-automaticas), com textos escritos pelo Super Admin, e não usam os cartões. **Deixar de usar em respostas automáticas** tira a marca.

O botão fica parado e o cartão diz porquê enquanto faltar alguma destas condições:

| Mensagem no cartão | O que fazer |
| --- | --- |
| "Publique primeiro as alterações desta resposta." | Publicar alterações |
| "Só pode ser usada em respostas automáticas 7 dias depois de aprovada ou da última correção do texto." | Esperar |
| "Confirme que a resposta continua certa (a última revisão foi há mais de 90 dias)." | Guardar e confirmar que continua certa |
| "Indique a loja: as respostas sobre horários, moradas e contactos só podem ser automáticas para uma loja." | Escolher a loja |
| "Há outra resposta automática sobre esta loja; junte-as primeiro." | Juntar as duas |
| "A base de conhecimento tem outra informação sobre esta loja: …" | Corrigir a que estiver errada |
| "O texto tem dados pessoais: …" | Corrigir o texto |
| "Falta a confirmação «Confirmo que li o texto: …» para o texto atual." | Confirmar o texto |
| "Tem expressões do português do Brasil: …", "Tem ligações que não estão na base de conhecimento: …", "Menciona …, que não é a marca desta resposta." | Corrigir o texto |

Qualquer correção ou junção tira a marca, e a passagem diária tira-a às respostas que expiraram ou que não são revistas há mais de 90 dias.

## A confirmação «Confirmo que li o texto…» (Super Admin)
<!-- perguntas: Porque é que tenho de confirmar cada resposta? | Quando é que a confirmação volta a ser pedida? | Não consigo aprovar, diz para confirmar o texto | O que fica registado quando confirmo um cartão? -->

Em **todos os cartões**, com ou sem avisos, **Guardar e aprovar**, **Publicar alterações** e **Permitir em respostas automáticas** só avançam depois de o Super Admin marcar **Confirmo que li o texto: não tem dados pessoais nem contradiz a resposta da equipa** para o texto atual. O servidor e a base de dados verificam-no.

A confirmação fica registada com quem, quando e a lista dos avisos mostrados nesse momento (pode estar vazia), no cartão e no registo de auditoria. Por cima da caixa aparece "Texto confirmado por … a …. Uma correção do texto volta a pedir a confirmação."

É pedida outra vez quando:

- muda o texto: a pergunta, uma das outras formas ou a resposta (mudar só o tema, a marca, a loja ou a validade não a apaga);
- o cartão recebe outro numa junção (**Juntar**);
- aparece um aviso que não estava na confirmação (por exemplo, depois de uma mudança na base de conhecimento): etiqueta **n avisos novos**;
- o texto que guardou tem avisos que não estavam no ecrã ("O texto que guardou tem n avisos que não estavam no ecrã: leia-os no cartão e confirme de novo.").

Não é possível confirmar:

- um texto com dados pessoais (recusas): corrija-o primeiro;
- um texto com mais de 60 avisos: "O texto tem demasiados avisos (n): encurte-o ou divida-o em várias respostas e volte a guardar."

Se carregar no botão sem marcar a caixa, as correções ficam guardadas e a mensagem pede a confirmação ("Leia o texto e os n avisos no cartão, marque «Confirmo que li o texto: …» e volte a carregar no botão.").

## Recusas e avisos
<!-- perguntas: Porque é que a proposta foi retirada? | Qual a diferença entre recusa e aviso? | Que dados pessoais as regras apanham? | O que quer dizer Possível contradição? | O que são os avisos de um cartão? -->

O servidor confere a pergunta, as outras formas e a resposta de cada cartão.

**Recusas** (dados pessoais sem ambiguidade e factos que a equipa não escreveu). Uma proposta da IA com uma recusa é **retirada** e não fica guardada. Uma correção do Super Admin com uma recusa fica guardada, mas não pode ser aprovada, confirmada nem publicada (etiqueta **Dados pessoais: …**); só um email de fora da empresa, um IBAN ou NIF e números de encomenda, de cliente ou de fatura são recusados logo ao guardar, pela base de dados ("O texto tem um email que não é da empresa."), e aí o que escreveu não fica guardado. O nome do cliente só é verificado nas propostas da IA: nas correções do Super Admin não (o painel não sabe de que conversa veio o cartão).

| Recusa | Exemplos |
| --- | --- |
| Email que não é da empresa (também "joana arroba gmail ponto com") | "Envie para joana.silva@gmail.com" |
| Telefone que não é da empresa, também com espaços, pontos ou por extenso | "Ligue para o 912 345 678", "nove um dois…" |
| IBAN, NIF, números de cartão ou o fim de um cartão | "os últimos 4 dígitos do cartão são 4242" |
| Números de encomenda, de cliente, de fatura ou de reparação | "Encomenda n.º 4471", "Fatura FT 1/2345" |
| Códigos de envio e números longos | Um código de seguimento |
| Ligações com um telefone, um perfil ou um id, e perfis @ | wa.me, instagram.com/…, "@joana.silva" |
| Nas propostas da IA: o nome do cliente da conversa, em qualquer forma | "Obrigado, Rosa" (mas não "ouro rosa") |
| Os nomes da equipa que não são palavras comuns | O nome de quem respondeu |
| Nas propostas da IA: números, ligações, contactos ou compromissos (reembolso, troca, desconto, garantia, prazo…) que a equipa não escreveu nessa conversa nem estão na base de conhecimento | Um prazo de entrega que ninguém deu |
| Nas propostas da IA: 12 palavras seguidas de uma mensagem do cliente, ou a outra marca | Copiar a pergunta do cliente tal e qual |

Os dados da empresa (os que estão na base de conhecimento, as lojas, as caixas de email do apoio e a assinatura) passam. Se faltar um telefone da empresa, acrescente-o primeiro à [base de conhecimento](/apoio/documentacao/configuracao#base-de-conhecimento) (só Super Admin). Uma morada da empresa que não esteja na base de conhecimento só dá aviso ("Possíveis moradas"), mas acrescente-a também.

**Avisos** (o resto, que é heurístico). Não retiram a proposta: aparecem no cartão, agrupados por tipo e com a palavra citada, e a palavra fica assinalada no texto.

| Aviso | Exemplo |
| --- | --- |
| Possíveis nomes | «Fernanda» numa frase, ou uma palavra com maiúscula depois de "Sr.", "Sra.", "Olá" |
| Possíveis moradas, perfis, códigos ou referências, números por extenso, datas pessoais | "o fio tem a referência 4512 no site" (código de um produto) |
| Possíveis instruções para a IA (também em inglês) | "ignora as regras anteriores" |
| Emails da empresa que não estão na base de conhecimento; ligações para outros sites (não o da loja) que não estão na base de conhecimento | Um endereço de outra caixa da empresa; uma ligação para um site de fora |
| Possível contradição | A equipa escreveu "infelizmente já não fazemos gravações" e o cartão não tem a recusa |
| Números trocados | "10% em relógios e 20% em joias" com os números ao contrário |
| Condição em falta | A equipa disse "só com talão" ou "a partir de 100 €" e o cartão deixou cair a condição |
| Palavras da resposta da equipa que o cartão deixou cair | "a estudantes", "relógios suíços" |
| Âmbito alargado | O cartão diz "trocamos qualquer peça" ou "sempre" e a equipa, sobre o mesmo assunto, não |
| Palavras que não estão na resposta da equipa (e compromissos que só estão na base de conhecimento) | Palavras novas da IA |
| Pergunta com um compromisso que a resposta da equipa não tem | A pergunta fala de reembolso e a resposta da equipa não |

Os avisos em relação à resposta da equipa só se calculam quando a IA faz a proposta e ficam guardados no cartão. Não costumam dar avisos as palavras de joalharia, os países e as cidades portuguesas, as marcas e os modelos conhecidos ("Thomas Sabo", "Pandora", "Hamilton Khaki") e os santos das medalhas ("Sagrado Coração de Jesus").

> **Atenção:** As regras não apanham tudo. Um nome raro, uma morada escrita de forma invulgar ou um pormenor de um caso podem passar sem aviso. Quem confirma o cartão é o Super Admin, depois de o ler.

## Confirmada em n conversas
<!-- perguntas: O que quer dizer Confirmada em n conversas? | Porque é que uma resposta não ganha mais confirmações? -->

A etiqueta conta as conversas em que a equipa deu esta resposta: a conversa que deu origem ao cartão e as que a IA reconheceu depois como a mesma pergunta (pelo botão ou pela passagem diária). Ajuda a ver que respostas são mais pedidas e quais rever primeiro.

- Cada conversa conta uma vez, para um só cartão, enquanto está na lista das conversas lidas (180 dias).
- As conversas do chat do site de visitantes anónimos (sem sessão confirmada na loja nem email associado pela equipa) nunca contam.
- Ao juntar dois cartões, as confirmações somam-se.

## O que fica guardado e durante quanto tempo
<!-- perguntas: O que fica guardado das respostas aprovadas? | As mensagens dos clientes ficam nos cartões? | Quanto tempo ficam as propostas guardadas? | Quem vê os cartões? -->

As mensagens e os contactos dos clientes **não são copiados** para os cartões. Só o Super Admin vê o painel dos cartões.

| O quê | Durante quanto tempo |
| --- | --- |
| Texto do cartão (pergunta, outras formas, resposta), tema, marca, loja, quem aprovou e quando | Proposta: até 180 dias sem novas confirmações. Aprovada: até ser arquivada. Arquivada: 365 dias depois da última alteração (corrigi-la recomeça a contagem) |
| Até 3 conversas de origem (só nas propostas) | Até aprovar ou arquivar |
| Avisos do cartão (da resposta da equipa só citam palavras de uma lista fechada e números com a unidade; o resto fica «…») | Com o cartão |
| Confirmação do texto (quem, quando e os avisos mostrados), também no registo de auditoria | Até o cartão ser apagado |
| Registo de pedidos à IA (hora, origem, quem carregou no botão, cartão, modelo, custo, duração e resultado) | 365 dias; a conversa e a mensagem só nos pedidos que não deram cartão, durante 180 dias |
| Conversas lidas (a conversa, até que resposta foi lida e se já contou) | 180 dias depois da última vez |
| Respostas guardadas com o botão (a mensagem e o dia) | 365 dias |
| Registo de auditoria das propostas (quem pediu, quando e o cartão) | 365 dias, ou até o cartão ser apagado |
| Conversa enviada à Anthropic para a proposta | Regra geral, apagada pela Anthropic até 30 dias depois |

Quem tem acesso direto à base de dados ainda consegue deduzir por estes registos de que conversa veio um cartão, enquanto existirem (até 365 dias). O enquadramento legal está em [Proteção de dados no Apoio ao Cliente](/apoio/documentacao/protecao-de-dados#durante-quanto-tempo-guardamos) e em [Inteligência artificial no apoio](/apoio/documentacao/inteligencia-artificial#o-fornecedor-de-ia-e-o-que-recebe).

## Problemas comuns
<!-- perguntas: Não vejo o botão Guardar como resposta aprovada | A resposta que aprovei não aparece nas propostas da IA | A IA não propõe nada há dias | Atingi o limite diário de respostas guardadas | A IA ainda dá o horário antigo da loja | As minhas correções ao cartão desapareceram -->

| Problema | Causa provável | O que fazer |
| --- | --- | --- |
| Não vejo o botão **Guardar como resposta aprovada** | A resposta não é sua, não foi enviada pelo dashboard, tem menos de 20 caracteres, não está aceite ou é anterior ao histórico visível | Peça ao Super Admin, que pode guardar qualquer resposta enviada pelo dashboard |
| "Esta resposta já foi guardada (ou está a ser preparada)." | Já deu uma proposta, ou o pedido ainda corre | Nada: cada resposta dá uma proposta |
| "Atingiu o limite diário de 30 respostas guardadas." | Limite de 30 pedidos por pessoa e por dia (contam também os que deram erro ou não deram proposta) | Continue amanhã |
| "A proposta da IA foi retirada pelas regras de segurança: já há 300 propostas por rever." | A lista de propostas por rever chegou a 300 | Avise o Super Admin (rever ou arquivar propostas) |
| "A proposta da IA foi retirada pelas regras de segurança: não tinha o formato esperado (…)." | A IA devolveu uma pergunta ou uma resposta vazia ou demasiado longa | Carregue outra vez mais tarde |
| "Orçamento mensal da base de conhecimento aprendida esgotado: US$ …" | O orçamento do mês acabou | Avise o Super Admin |
| "Só pode guardar as suas próprias respostas." | A resposta é de uma colega | Peça à colega ou ao Super Admin |
| "Esta resposta é anterior ao histórico visível do apoio." | A resposta é antiga | Não pode ser guardada |
| "IA por configurar no servidor" | Falta a chave da Anthropic | Avise o Super Admin |
| A IA continua a propor a informação antiga (por exemplo, ainda dá o horário antigo da loja) | O cartão corrigido não foi publicado, ou a base de conhecimento diz outra coisa (prevalece) | **Publicar alterações**; corrigir a base de conhecimento |
| O Assistente não usa uma resposta aprovada | Não está publicada, expirou ("Expirou a …") ou é só da outra marca | Publicar; mudar "Válida até"; ver a marca |
| Não há propostas automáticas | A caixa está desligada, o orçamento acabou, há 300 propostas por rever ou não há conversas novas que cumpram as regras | Ligar a caixa, aumentar o orçamento, rever propostas |
| "Confirme primeiro o texto desta resposta…" | Falta a confirmação, ou o texto mudou | Marcar a caixa e carregar outra vez |
| "Nada foi publicado: …" | Uma aprovada tem dados pessoais ou o texto por confirmar | Corrigir ou confirmar a que o painel abriu |
| "A data de validade já passou." e as correções desapareceram | O cartão expirou ("Expirou a …") ou a data escrita já passou: a base de dados recusou e nada foi guardado | Mude primeiro "Válida até" (hoje ou depois) ou apague-a, e volte a escrever as correções |
| "O texto tem um email que não é da empresa.", "O texto tem um IBAN ou um NIF." ou "O texto tem um número de encomenda, de cliente ou de fatura.", e as correções desapareceram | A base de dados recusa estes dados logo ao guardar | Volte a escrever as correções sem esses dados |

> **Dica:** Se a IA erra sempre no mesmo ponto, a correção certa é muitas vezes na [base de conhecimento](/apoio/documentacao/configuracao#base-de-conhecimento), que prevalece sobre os cartões.
