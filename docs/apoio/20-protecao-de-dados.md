# Proteção de dados no Apoio ao Cliente
<!-- resumo: Como o RGPD se aplica ao Apoio ao Cliente: que dados guardamos e porquê, com que base legal, durante quanto tempo, com que fornecedores, como os protegemos e o que fazer se algo correr mal. -->
<!-- publico: todos -->
<!-- termos: RGPD, GDPR, proteção de dados, privacidade, dados pessoais, Lei 58/2019, CNPD, base legal, fundamento de licitude, interesse legítimo, consentimento, prazo de conservação, retenção, quanto tempo guardamos, apagar, subcontratante, fornecedor, transferência internacional, EUA, Anthropic, Vercel, Supabase, Metricool, segurança, fuga de dados, violação de dados, data breach, incidente, 72 horas, registo de atividades, responsável pelo tratamento, cookies, localStorage, sessionStorage, armazenamento no browser -->
<!-- atualizado: 2026-10-30 -->

Cada conversa do Apoio ao Cliente tem dados pessoais: o nome e o email do cliente, o telefone, o nome de utilizador no Instagram, o que escreveu, as encomendas e também as notas que a equipa deixa sobre ele. O Regulamento Geral sobre a Proteção de Dados (RGPD) e a lei portuguesa que o executa (Lei n.º 58/2019) aplicam-se a tudo isto.

Este artigo explica, em linguagem simples, as regras que contam para o apoio e como o dashboard as cumpre. Para os pedidos dos clientes sobre os seus dados, veja [Direitos dos clientes sobre os seus dados](/apoio/documentacao/direitos-dos-titulares). Para as regras do dia a dia, veja [Boas práticas de privacidade](/apoio/documentacao/boas-praticas-de-privacidade). Para os dados da própria equipa, veja [Dados dos colaboradores e avaliação do atendimento](/apoio/documentacao/dados-dos-colaboradores).

> **Nota:** Este texto é uma orientação para a equipa, não é aconselhamento jurídico. Os pontos marcados "a confirmar com o jurista" ainda não estão fechados.

## Em resumo
<!-- perguntas: O RGPD aplica-se ao apoio ao cliente? | O que tenho de saber sobre proteção de dados? | O que é um dado pessoal? -->

- **Dado pessoal** é qualquer informação sobre uma pessoa identificada ou identificável: nome, email, telefone, nome de utilizador, fotografia, número de encomenda ligado a alguém, o que a pessoa escreveu e as nossas notas sobre ela (art. 4.º, n.º 1, do RGPD).
- Usamos estes dados para responder e acompanhar os pedidos dos clientes, e para o pouco mais que este artigo explica. Não os usamos para outros fins.
- Peça e escreva só o que é preciso para ajudar.
- Os dados dos clientes ficam dentro do dashboard e das plataformas oficiais da loja. Nada de cópias, capturas de ecrã ou envios para fora.
- Qualquer erro com dados (uma resposta para a pessoa errada, dados de um cliente mostrados a outro, uma conta comprometida) deve ser comunicado **de imediato** ao Super Admin: a empresa pode ter de avisar a CNPD em 72 horas.
- Quando um cliente pede para ver, corrigir ou apagar os seus dados, o pedido segue para o Super Admin no próprio dia: há um prazo de um mês para responder.

## Quem é responsável
<!-- perguntas: Quem é o responsável pelo tratamento dos dados? | Quem decide o que se faz com os dados? | O que é um subcontratante? | Quem fiscaliza a proteção de dados em Portugal? -->

| Papel | Quem é | O que significa |
| --- | --- | --- |
| Responsável pelo tratamento | A empresa titular da Loja do Ouro, identificada nas [Condições de venda](https://www.lojadoouro.pt/pages/condicoes-de-venda) e na página [Livro de Reclamações Eletrónico](https://www.lojadoouro.pt/pages/livro-de-reclamacoes-eletronico) como Pérola do Tempo, S.A. A [política de privacidade](https://www.lojadoouro.pt/policies/privacy-policy) indica outra forma da empresa ("Lda.") e outra morada: a confirmar pelo dono | Decide para que servem os dados e responde perante os clientes e a CNPD (art. 4.º, n.º 7, e art. 24.º do RGPD). |
| Equipa do apoio | Quem tem acesso "Apoio ao Cliente" no dashboard | Trata os dados por conta da empresa e só segundo as instruções dela (art. 29.º do RGPD). |
| Super Admin | Quem administra o dashboard | Configura as ligações, decide os acessos e recebe os pedidos de direitos e os incidentes. |
| Subcontratantes | Fornecedores que tratam dados por nossa conta (base de dados, servidor, IA, email…) | Precisam de contrato com a empresa (art. 28.º do RGPD). Veja [Fornecedores e transferências](/apoio/documentacao/protecao-de-dados#fornecedores-e-transferencias-para-fora-da-ue). |
| CNPD | Comissão Nacional de Proteção de Dados | Autoridade de controlo em Portugal (art. 3.º da Lei n.º 58/2019). Recebe queixas e notificações de violações de dados. |

## Os princípios do RGPD aplicados ao apoio
<!-- perguntas: Quais são os princípios do RGPD? | O que é a minimização de dados? | Posso usar os dados do apoio para marketing? -->

O art. 5.º do RGPD define sete princípios. É por eles que se decide o que é ou não aceitável.

| Princípio | O que quer dizer | Como se aplica no Apoio ao Cliente |
| --- | --- | --- |
| Licitude, lealdade e transparência | Cada uso tem uma base legal e o cliente sabe o que fazemos | Bases legais na secção seguinte; aviso de privacidade no chat do site; política de privacidade da loja |
| Limitação das finalidades | Os dados só servem para o fim com que foram recolhidos | O que o cliente escreve ao apoio serve para o ajudar, não para campanhas de marketing |
| Minimização | Só os dados necessários | O endereço IP do chat só fica em código (hash); as encomendas só aparecem pelo email do contacto, nunca pelo nome |
| Exatidão | Dados corretos e atualizados | A associação ao cliente da loja é manual, por email, com registo de quem associou; corrige-se quando o cliente avisa |
| Limitação da conservação | Não guardar mais tempo do que o necessário | Prazos na secção [Durante quanto tempo guardamos](/apoio/documentacao/protecao-de-dados#durante-quanto-tempo-guardamos) |
| Integridade e confidencialidade | Segurança adequada | Veja a secção [Segurança](/apoio/documentacao/protecao-de-dados#seguranca) |
| Responsabilidade | A empresa tem de conseguir provar que cumpre | Registo de ações em cada conversa; registo das atividades de tratamento (art. 30.º) |

## Que dados o sistema guarda e para quê
<!-- perguntas: Que dados dos clientes guarda o dashboard? | O dashboard guarda as encomendas? | O que se guarda do chat do site? | O chat vê o carrinho do cliente? -->

| Dados | De onde vêm | Para quê |
| --- | --- | --- |
| Contacto: nome, email, telefone, nome de utilizador e foto de perfil do canal | Email (Gmail), Messenger e Instagram (através da Metricool), Zendesk, chat do site | Saber com quem falamos |
| Mensagens e anexos recebidos (uma mensagem anulada pelo cliente fica marcada e sem conteúdo) | Canal da conversa | Responder e manter o histórico do caso |
| Respostas da equipa, com o nome de quem respondeu e o estado de entrega | Dashboard | Responder; saber quem atendeu |
| Notas internas | Equipa | Coordenar o caso (nunca seguem para o cliente) |
| Email associado pela equipa, com quem associou e quando | Equipa | Ver as encomendas do cliente |
| Encomendas | Lidas da loja online (Shopify) quando se abre o separador Cliente; não são copiadas para o Apoio | Resolver pedidos sobre encomendas, envios, trocas e garantias |
| Chat do site: nome e email escritos (o email só é confirmado se o cliente tiver sessão iniciada na loja), página e título da página, carrinho, hora a que o cliente abriu o chat e páginas vistas desde então, língua, país e navegador; IP e rede só em código (hash) | Widget do chat (a hora e as páginas só começam a contar quando o cliente abre o chat e só são enviadas depois de ele iniciar uma conversa) | Ajudar com contexto; travar abusos (limites por IP e por rede) |
| Comentários públicos do Facebook e do Instagram e a publicação comentada | Metricool | Responder em público |
| Pedidos ao Assistente de IA (pergunta e proposta) | Equipa | Ajudar a preparar respostas |
| Revisão da IA antes de enviar: só códigos (hash) da resposta e da sugestão, nunca o texto | Dashboard | Estatísticas da revisão |
| Pedidos de avaliação: nota, comentário, quem foi avaliado, "não quer pedidos" | Cliente e equipa | Medir a satisfação e acompanhar notas baixas |
| Registo de ações (atribuições, estados, transferências, pedidos cancelados) | Dashboard | Saber quem fez o quê |

**Dados sensíveis.** Saúde, religião, origem étnica e outros dados do art. 9.º do RGPD têm proteção reforçada. Não os pedimos. Se o cliente os mencionar por iniciativa própria (por exemplo, uma alergia a um metal), use-os só para responder a esse pedido e não os repita em notas internas sem necessidade.

## Bases legais por finalidade
<!-- perguntas: Com que base legal tratamos os dados do apoio? | Precisamos do consentimento do cliente para responder? | O que é o interesse legítimo? -->

Cada uso de dados pessoais precisa de uma das bases do art. 6.º, n.º 1, do RGPD. No apoio usamos sobretudo três:

- **Contrato** (alínea b): o que é necessário para cumprir uma compra ou para responder a quem quer comprar e nos pergunta algo (encomendas, envios, trocas, devoluções, garantias, reparações).
- **Obrigação legal** (alínea c): o que a lei obriga a empresa a fazer, como responder às reclamações do Livro de Reclamações, responder aos pedidos dos clientes sobre os seus dados e tratar os pedidos de garantia e de livre resolução. Algumas destas leis fixam também durante quanto tempo se guardam os documentos.
- **Interesse legítimo** (alínea f): responder a quem nos contacta sem haver compra, organizar o trabalho da equipa e proteger o serviço. Obriga a ponderar os interesses da empresa com os do cliente e dá ao cliente o direito de se opor (art. 21.º).

| Finalidade | Base legal | Notas |
| --- | --- | --- |
| Responder a pedidos sobre encomendas, trocas, garantias e compras | Contrato (art. 6.º, n.º 1, b)) | — |
| Responder a perguntas gerais, mensagens privadas e comentários públicos | Interesse legítimo (art. 6.º, n.º 1, f)) | Quem nos escreve espera resposta |
| Reclamações formais (Livro de Reclamações), pedidos sobre dados pessoais, pedidos de garantia e de livre resolução | Obrigação legal (art. 6.º, n.º 1, c)) | Decreto-Lei n.º 156/2005 (resposta em 15 dias úteis, art. 5.º-B, n.º 4; livros encerrados e comprovativos do envio eletrónico guardados 3 anos, art. 3.º, n.º 1, d), e art. 5.º-A, n.º 3); art. 12.º do RGPD; Decretos-Leis n.º 84/2021 e n.º 24/2014 |
| Notas internas, responsável, transferências, registo de ações | A mesma base da conversa | Fazem parte do tratamento do pedido |
| Contexto do chat do site (página, carrinho, hora a que o cliente abriu o chat, páginas vistas desde então) | Interesse legítimo | Só é enviado depois de o cliente abrir o chat, ver o aviso e iniciar a conversa e, enquanto a conversa estiver guardada no browser, também nas visitas seguintes (página e carrinho, sem a hora de abertura); o aviso ainda não fala de tudo (ver [Dever de informar os clientes](/apoio/documentacao/protecao-de-dados#dever-de-informar-os-clientes)); a confirmar com o jurista |
| Limites contra abusos (IP e rede em hash) | Interesse legítimo (segurança) | — |
| Assistente de IA e revisão antes de enviar | Interesse legítimo | Usa um fornecedor fora da UE (veja abaixo); a confirmar com o jurista |
| Pedido de avaliação depois de resolver | Interesse legítimo | O cliente pode recusar a qualquer momento; se o pedido por email conta como comunicação comercial é a confirmar com o jurista |
| Respostas automáticas (email, Facebook, Instagram) | Interesse legítimo | — |

O consentimento (alínea a) não é a base do apoio: o cliente não precisa de "aceitar" nada para ser ajudado.

> **Atenção:** O aviso do chat do site diz, por omissão, "Ao iniciar a conversa aceita a nossa Política de privacidade". Ler uma política não é um consentimento, e o consentimento não é a base usada. O texto deve informar ("tratamos os seus dados para…") em vez de pedir aceitação. Está na lista de pontos em aberto.

A ponderação do interesse legítimo (para que serve, porque é necessário, porque não pesa demasiado sobre o cliente) deve ficar escrita para a IA, para o contexto do chat e para o pedido de avaliação. A confirmar com o jurista.

## Dever de informar os clientes
<!-- perguntas: O que temos de dizer ao cliente sobre os dados? | O cliente perguntou o que fazemos com os dados dele | Temos de dizer que usamos inteligência artificial? | O que o chat guarda no localStorage? | O chat do site usa cookies? -->

Quando recolhemos dados, temos de dizer ao cliente quem somos e como nos contactar, para que usamos os dados e com que base, a quem os passamos (incluindo fornecedores fora da UE), durante quanto tempo os guardamos, que direitos tem e que pode apresentar queixa à CNPD (arts. 13.º e 14.º do RGPD).

Como está hoje:

- **Chat do site:** quando o cliente abre o chat, antes de começar, o widget mostra um aviso (a equipa vê a página e o carrinho) e a ligação para a política de privacidade. O aviso não fala do tempo desde que abriu o chat, do número de páginas, da língua, do país, do navegador nem da IA. Antes de o cliente abrir o chat, o widget não grava nada no browser (ver abaixo).
- **Email, Messenger, Instagram e comentários:** não há aviso próprio; vale a política de privacidade da loja.
- **Política de privacidade da loja online** ([ver a política](https://www.lojadoouro.pt/policies/privacy-policy)): fala do formulário de contacto, da newsletter e do recrutamento, e de um prazo máximo de 2 anos. Não fala do apoio por email, chat e redes sociais, do Assistente de IA, dos fornecedores nem de transferências para fora da UE. Está na lista de pontos em aberto.

**O que o chat do site guarda no browser do visitante.** Tal como um cookie, o widget pode guardar informação no próprio browser de quem visita a loja, mas **só depois de o cliente abrir o chat**. A quem só visita a loja e nunca abre o chat, o widget não grava nada: nem cookies, nem outro armazenamento do browser. Em cada página, ao carregar, só verifica se já há uma conversa iniciada antes ou um chat aberto (para os continuar) e apaga o contador de visita que a versão anterior do chat gravava em todas as páginas (e uma visita guardada que já acabou). Enquanto a conversa estiver guardada no browser, o widget envia à equipa a página e o carrinho também nas visitas seguintes, mesmo sem o cliente voltar a abrir o chat (sem a hora de abertura, e sem gravar nada).

| Chave no browser | Quando é gravada | O que guarda | Até quando |
| --- | --- | --- | --- |
| `ldo-chat:aberto` (sessionStorage) | Quando o cliente abre o chat | Que o chat está aberto (para continuar aberto na página seguinte) | Até o cliente fechar o chat ou o separador |
| `ldo-chat:visita-chat` (sessionStorage) | Quando o cliente abre o chat e, depois, em cada página nova desse separador | A hora a que abriu o chat, as páginas vistas desde então e a hora da última atividade | Até fechar o separador; acaba antes ao fechar o chat sem ter iniciado conversa, ou após 30 minutos sem páginas novas nem contacto do chat com o servidor nesse separador (com uma conversa e o separador à vista, o chat contacta o servidor a cada 30 segundos) |
| `ldo-chat:v1` (localStorage) | Quando o cliente inicia uma conversa e, depois, quando a visita muda num separador com o chat aberto | Token da conversa, nome, email confirmado (se tiver sessão na loja), a última resposta vista e a visita (a mesma hora de abertura, páginas e última atividade), para que outro separador da loja, onde o chat ainda não abriu, mostre à equipa a mesma hora sem gravar nada | Até a conversa terminar ou recomeçar; senão, até o visitante limpar os dados do site. A visita sai na primeira página depois de 30 minutos sem atividade |
| `ldo-chat:visita` (localStorage) | Já não é gravada | O contador de visita da versão anterior do chat | Apagado na primeira página da loja que o visitante abrir com a versão atual |

> **Lei:** Guardar informação no equipamento do utilizador, ou ler a que lá está, só é permitido com o seu consentimento prévio, dado com informação clara e completa, salvo o que for estritamente necessário para prestar um serviço que o utilizador pediu expressamente (art. 5.º da [Lei n.º 41/2004](https://diariodarepublica.pt/dr/legislacao-consolidada/lei/2004-106523049)). Por isso o chat só grava no browser depois de o cliente o abrir, que é quando pede o serviço. Manter o chat aberto e a conversa de página para página serve o chat que o cliente pediu. A hora a que abriu o chat e as páginas vistas desde então servem sobretudo a equipa: se também cabem nessa exceção, ou precisam de consentimento como um cookie, é a confirmar com o jurista (está na lista de pontos em aberto). A violação é contraordenação, com coima de 5 000 € a 5 000 000 € para empresas (art. 14.º, n.º 1, e)), aplicada pela CNPD (art. 15.º, n.º 1).

O que fazer quando um cliente pergunta o que fazemos com os seus dados: responda com simplicidade e verdade (usamos os dados para tratar o pedido; só a equipa do apoio os vê; usamos fornecedores de confiança, incluindo um assistente de inteligência artificial que propõe respostas à equipa, e nenhuma resposta sai sem ser revista por uma pessoa). Indique a política de privacidade da loja. Se o cliente quiser mais detalhe ou exercer um direito, siga [Direitos dos clientes sobre os seus dados](/apoio/documentacao/direitos-dos-titulares).

## Durante quanto tempo guardamos
<!-- perguntas: Quanto tempo ficam guardadas as conversas? | O dashboard apaga dados automaticamente? | O histórico visível apaga as conversas antigas? | Quanto tempo a Anthropic guarda os dados? -->

Os dados pessoais só podem ser guardados enquanto forem necessários para a finalidade (art. 5.º, n.º 1, e), do RGPD). Em Portugal, o prazo é o que a lei fixar ou, na falta dela, o necessário para a finalidade; os dados podem ser guardados até à prescrição dos direitos quando sejam precisos para provar o cumprimento de obrigações; depois são destruídos ou anonimizados (art. 21.º da Lei n.º 58/2019).

Prazos que o dashboard aplica hoje (a passagem diária corre às 06:00 UTC):

| Dados | Prazo |
| --- | --- |
| Conversas, mensagens, notas internas, contactos e notas das avaliações | Sem prazo automático: nada é apagado |
| Registo de ações e leituras por colaborador | Sem prazo automático (saem com a conversa) |
| Ficheiros que a equipa anexou às respostas | Bytes apagados até 30 dias depois, ou antes quando o anexo já fica guardado na plataforma (1 dia se nunca chegaram a ser enviados); a mensagem continua a mostrar o nome do anexo |
| Ligação temporária de uma imagem enviada pelo Messenger ou Instagram | 1 hora |
| Registo do visitante do chat do site (token, IP e rede em hash, navegador, página, carrinho) | Apagado 180 dias depois da última visita |
| Pedidos ao Assistente de IA (pergunta e proposta) | Apagados ao fim de 180 dias |
| Revisões da IA (só códigos, nunca o texto) | Apagadas ao fim de 365 dias |
| Comentário escrito numa avaliação | Apagado ao fim de 12 meses (a nota fica) |
| Presença ("a ver" e "a escrever") | 1 dia |
| Dados enviados à Anthropic (IA) | Regra geral, apagados pela Anthropic até 30 dias depois (conteúdo assinalado por violar a política de utilização: até 2 anos) |
| Chat aberto e visita no browser do visitante (só depois de o cliente abrir o chat) | Chat aberto: até o cliente o fechar ou fechar o separador. Visita: até fechar o separador (com uma conversa, também junto do token, até 30 minutos sem atividade); acaba antes ao fechar o chat sem conversa ou após 30 minutos sem atividade |
| Token do chat no browser do visitante (só depois de o cliente iniciar uma conversa) | Até a conversa terminar ou recomeçar; senão, sem prazo: fica no browser até o visitante limpar os dados do site |

Os emails continuam também na caixa do Gmail, e as mensagens do Messenger, do Instagram e do Zendesk continuam nessas plataformas, com os prazos de cada uma.

> **Nota:** O "Histórico visível" (Configuração do apoio) esconde as conversas resolvidas e sem atividade desde uma data, mas não apaga nada. Não é um prazo de conservação.

> **Atenção:** As conversas não têm prazo de conservação definido, e a política de privacidade publicada fala em 2 anos. A empresa tem de decidir um prazo para o apoio e aplicá-lo. Está na lista de pontos em aberto.

## Quem vê o quê
<!-- perguntas: Quem pode ver as conversas? | Os colegas veem as minhas notas internas? | Quem vê as avaliações? | Quem dá acesso ao apoio? -->

| Informação | Quem vê |
| --- | --- |
| Conversas, mensagens, notas internas e encomendas do cliente | Todas as pessoas com acesso "Apoio ao Cliente" e o Super Admin |
| Configuração do apoio (ligações, acessos, diagnóstico, base de conhecimento, IA do apoio) | Só o Super Admin |
| Pedidos que fez ao Assistente de IA | Só quem os fez (o Super Admin vê o número de pedidos e o custo por pessoa) |
| Valor da nota e comentário guardados de uma avaliação, e o relatório por pessoa | O Super Admin e a pessoa avaliada |
| Resposta do cliente ao pedido de avaliação com texto (por exemplo "2. Chegou partida") | Toda a equipa, na conversa (só uma resposta que é apenas a nota fica escondida); uma nota de 1 ou 2 reabre a conversa para acompanhamento |
| Satisfação e desempenho | Cada pessoa vê a sua linha; o Super Admin vê todas |

O acesso dá-se em Administração → Utilizadores ("Apoio ao Cliente") e deve ser retirado logo que alguém deixe de precisar dele, por exemplo quando sai da empresa.

## Fornecedores e transferências para fora da UE
<!-- perguntas: Que empresas tratam os dados do apoio? | Os dados saem da União Europeia? | Os dados vão para os Estados Unidos (EUA)? | A Anthropic usa as conversas para treinar a IA? | Posso usar outro tradutor ou outra IA? -->

Um fornecedor que trata dados por nossa conta é um **subcontratante**: só pode tratar os dados segundo as nossas instruções e tem de ter um contrato com o conteúdo do art. 28.º do RGPD (confidencialidade, segurança, ajuda nos direitos dos clientes, aviso de incidentes, apagamento no fim).

Quando os dados saem do Espaço Económico Europeu, a transferência precisa de uma base do capítulo V do RGPD (arts. 44.º a 49.º):

- uma **decisão de adequação** (art. 45.º): para os EUA existe o Quadro de Privacidade de Dados UE-EUA, que só cobre empresas certificadas nesse quadro;
- **garantias adequadas** (art. 46.º), em regra as cláusulas contratuais-tipo aprovadas pela Comissão Europeia;
- só em casos excecionais, as **derrogações** do art. 49.º.

| Fornecedor | Para quê | Onde | Notas |
| --- | --- | --- | --- |
| Supabase | Base de dados do dashboard | Região eu-central-1 (Frankfurt, Alemanha) | Tabelas sem acesso direto: tudo passa por funções que confirmam quem pede. A região é onde os dados ficam guardados; a Supabase, Inc. é uma empresa sediada nos EUA, com subcontratantes e acesso de suporte que podem implicar transferência: mecanismo de transferência (cláusulas-tipo ou Quadro de Privacidade de Dados) a confirmar no contrato de tratamento |
| Vercel | Servidor onde corre o dashboard; todas as mensagens passam por ele | Por omissão, as funções da Vercel correm em Washington (EUA, região iad1), salvo se outra região for escolhida | O código do dashboard não escolhe região; o Super Admin confirma nas definições do projeto. A Vercel Inc. é uma empresa sediada nos EUA: mecanismo de transferência (cláusulas-tipo ou Quadro de Privacidade de Dados) a confirmar no contrato de tratamento |
| Anthropic | Assistente de IA e revisão antes de enviar | Contrato com a Anthropic Ireland, Limited; o tratamento pode ocorrer fora da UE | Cláusulas contratuais-tipo no acordo de tratamento de dados; não treina modelos com os nossos dados; apaga entradas e saídas da API até 30 dias (regra geral); avisa incidentes em 48 horas |
| Google (Gmail) | Caixa apoiocliente@lojadoouro.pt | — | Os emails ficam também no Gmail |
| Metricool | Mensagens privadas e comentários do Facebook e do Instagram | — | Lê as mensagens e envia as respostas da equipa |
| Meta (Facebook e Instagram) | Canais onde o cliente escreve | — | A Meta também trata estes dados por conta própria; a repartição exata de responsabilidades é a confirmar com o jurista |
| Zendesk | Tickets (pode estar desligado, ficando os tickets importados como histórico) | — | — |
| Resend | Emails do chat do site para quem já saiu do site | — | — |
| Shopify | Loja online: encomendas e tema onde está o chat | — | — |

> **Atenção:** Não use outros serviços com dados de clientes: tradutores online, outras ferramentas de IA, o WhatsApp pessoal, a sua conta pessoal de email ou de armazenamento. Cada fornecedor novo precisa de contrato e de ser avaliado antes de receber dados.

> **Lei:** A decisão de adequação para os EUA (Decisão de Execução (UE) 2023/1795) foi confirmada pelo Tribunal Geral em setembro de 2025, mas o recurso para o Tribunal de Justiça (processo C-703/25 P) ainda está pendente a 30-10-2026. Se a decisão cair, as transferências para os EUA passam a depender de cláusulas-tipo. A confirmar com o jurista.

## Segurança
<!-- perguntas: Como estão protegidos os dados do apoio? | O que tenho de fazer para manter os dados seguros? -->

O RGPD exige medidas técnicas e organizativas adequadas ao risco (art. 32.º). O que o dashboard já faz:

- As credenciais e as chamadas às plataformas ficam só no servidor; as chaves de ligação ao Gmail e ao Zendesk são guardadas cifradas (AES-256-GCM).
- As tabelas do apoio não têm acesso direto: cada ação passa por funções da base de dados que confirmam quem pede e se tem acesso.
- O token de cada visitante do chat e o seu IP só ficam em código (hash); o visitante só acede à sua própria conversa e nunca vê as notas internas.
- O HTML dos emails recebidos é convertido em texto; o tipo real dos anexos é confirmado pelos bytes e os tipos perigosos só se descarregam.
- Os envios têm uma chave única: repetir um pedido nunca envia duas vezes.
- Há limites contra abusos no chat do site (por IP, por rede e no total).
- A resposta sai sempre para o cliente da conversa; as encomendas só aparecem pelo email do contacto, e o dashboard avisa quando uma encomenda pedida não é desse email.
- Nas respostas públicas, o dashboard avisa antes de publicar dados pessoais.

O que cabe a cada pessoa: palavra-passe forte e só sua, sessão bloqueada quando se afasta, nada de partilhar contas, atenção a emails falsos (phishing) e avisar logo qualquer suspeita. Mais regras em [Boas práticas de privacidade](/apoio/documentacao/boas-praticas-de-privacidade).

## Se houver uma fuga ou um erro com dados
<!-- perguntas: O que é uma violação de dados? | Enviei uma mensagem para o cliente errado, o que faço? | Quem avisa a CNPD? | O que é a regra das 72 horas? | Mostrei dados de um cliente a outro -->

Uma **violação de dados pessoais** é qualquer falha de segurança que leve, por acidente ou de propósito, à destruição, perda, alteração, divulgação ou acesso não autorizado a dados pessoais (art. 4.º, n.º 12, do RGPD). No apoio, por exemplo:

- uma resposta, um anexo ou dados de encomenda enviados ao cliente errado;
- associar o email errado a um contacto e mostrar ao cliente encomendas de outra pessoa;
- publicar dados pessoais numa resposta pública a um comentário;
- uma conta do dashboard usada por outra pessoa, uma palavra-passe revelada num email falso, um computador ou telemóvel perdido com sessão aberta;
- capturas de ecrã ou listas de clientes enviadas para fora do sistema.

O que fazer:

1. Pare: não envie mais nada sobre o caso.
2. Avise o Super Admin **de imediato**, de viva voz ou por telefone, mesmo na dúvida e mesmo fora de horas.
3. Deixe uma nota interna na conversa com o que aconteceu (quando, o quê, a quem), sem copiar mais dados do que os necessários.
4. Não apague registos nem tente resolver sozinho com o destinatário errado: o Super Admin decide o passo seguinte.
5. Se o problema for a sua palavra-passe, mude-a logo e termine as sessões abertas.

O que faz a empresa:

- avalia o risco e, se a violação puder trazer riscos para as pessoas, notifica a CNPD sem demora injustificada e, sempre que possível, até **72 horas** depois de ter tido conhecimento dela, pelo [formulário da CNPD](https://www.cnpd.pt/databreach/) (art. 33.º, n.º 1). Uma notificação depois das 72 horas tem de explicar o atraso;
- regista todas as violações, mesmo as que não notifica: factos, efeitos e medidas tomadas (art. 33.º, n.º 5);
- informa os clientes afetados, sem demora injustificada, quando o risco para eles for elevado (art. 34.º).

Os fornecedores também têm de nos avisar dos incidentes deles; no caso da Anthropic, o contrato fixa 48 horas.

> **Lei:** As 72 horas contam a partir do momento em que a empresa tem conhecimento da violação. Por isso cada hora conta: não espere pelo dia seguinte para avisar.

> **Nota:** Há uma proposta europeia (o "Digital Omnibus") para passar este prazo para 96 horas e notificar só as violações de risco elevado. A 30-10-2026 ainda não é lei: o Conselho aprovou a sua posição a 21-10-2026 e faltam a posição do Parlamento Europeu e o acordo final. Vale o prazo de 72 horas.

## Registo das atividades de tratamento
<!-- perguntas: O que é o registo das atividades de tratamento? | Uma empresa pequena precisa de registo de tratamentos? | Precisamos de uma avaliação de impacto? -->

A empresa tem de manter, por escrito, um registo das atividades de tratamento: finalidades, categorias de dados e de pessoas, destinatários, transferências para fora da UE, prazos e medidas de segurança (art. 30.º do RGPD). A dispensa para empresas com menos de 250 trabalhadores não se aplica quando o tratamento não é ocasional, como é o caso do apoio ao cliente (art. 30.º, n.º 5).

O Apoio ao Cliente deve constar do registo e o Super Admin atualiza-o sempre que entra um canal novo, um fornecedor novo ou uma funcionalidade que use dados de outra forma (por exemplo, a IA). Se algum destes tratamentos exige uma avaliação de impacto (art. 35.º) é a confirmar com o jurista.

## A CNPD
<!-- perguntas: O que é a CNPD? | O cliente ameaçou fazer queixa à CNPD | A CNPD contactou-nos -->

A Comissão Nacional de Proteção de Dados é a autoridade de controlo em Portugal (art. 3.º da Lei n.º 58/2019). Recebe as queixas dos clientes (art. 77.º do RGPD), as notificações de violações de dados e pode fiscalizar e aplicar coimas.

Um cliente pode sempre apresentar queixa à CNPD: diga-lhe isso com naturalidade se perguntar. Se chegar ao apoio qualquer contacto da CNPD, ou de um advogado sobre dados pessoais, passe-o ao Super Admin no próprio dia.

## Pontos em aberto
<!-- perguntas: O que falta fazer na proteção de dados do apoio? -->

Pontos que o Super Admin está a tratar ou tem de decidir (a equipa não precisa de fazer nada, mas deve saber que existem):

- atualizar a política de privacidade da loja para cobrir o apoio por email, chat e redes sociais, a IA, os fornecedores, as transferências e os prazos;
- definir e aplicar um prazo de conservação para as conversas, notas, notas das avaliações e registo de ações, respeitando os prazos mínimos fixados por lei (por exemplo, 3 anos para os livros de reclamações encerrados e para os comprovativos do envio eletrónico das folhas, art. 3.º, n.º 1, d), e art. 5.º-A, n.º 3, do Decreto-Lei n.º 156/2005) e a possibilidade de guardar até à prescrição o que seja preciso para provar o cumprimento de obrigações (art. 21.º, n.os 3 e 5, da Lei n.º 58/2019);
- mudar o texto do aviso do chat do site para informar em vez de pedir aceitação, incluindo o tempo desde que o cliente abriu o chat, as páginas vistas, a língua, o país, o navegador e o uso de IA;
- confirmar com o jurista se a hora a que o cliente abriu o chat e as páginas vistas desde então, que o chat guarda no browser depois de o cliente o abrir (com uma conversa, também junto do token, para os outros separadores), cabem na exceção do serviço pedido pelo cliente ou precisam de consentimento (art. 5.º da Lei n.º 41/2004). O contador de visita em todas as páginas, antes de qualquer chat, já não existe;
- esconder também, a quem não pode ver a nota, o número no início de uma resposta com texto ao pedido de avaliação (hoje só fica escondida a resposta que é apenas a nota);
- avaliar e documentar se é obrigatório designar um encarregado de proteção de dados (art. 37.º do RGPD) — a confirmar com o jurista;
- ter uma forma de exportar e de apagar os dados de um cliente (hoje não há botão no dashboard);
- confirmar a região do servidor na Vercel e os contratos de tratamento de dados com cada fornecedor;
- manter o registo das atividades de tratamento e escrever a ponderação do interesse legítimo para a IA, o contexto do chat e o pedido de avaliação.

## Fontes

- [Regulamento (UE) 2016/679 — Regulamento Geral sobre a Proteção de Dados (RGPD)](https://eur-lex.europa.eu/legal-content/PT/TXT/?uri=CELEX:32016R0679): arts. 4.º, 5.º, 6.º, 9.º, 12.º, 13.º, 14.º, 21.º, 24.º, 28.º, 29.º, 30.º, 32.º a 35.º, 37.º, 44.º a 49.º e 77.º.
- [Lei n.º 58/2019, de 8 de agosto — execução do RGPD em Portugal](https://files.dre.pt/1s/2019/08/15100/0000300040.pdf): arts. 3.º e 21.º.
- [Lei n.º 41/2004 — privacidade nas comunicações eletrónicas (versão consolidada)](https://diariodarepublica.pt/dr/legislacao-consolidada/lei/2004-106523049): arts. 5.º, 14.º e 15.º.
- [Decreto-Lei n.º 156/2005 — Livro de Reclamações (versão consolidada)](https://diariodarepublica.pt/dr/legislacao-consolidada/decreto-lei/2005-34431675): arts. 3.º, 5.º-A e 5.º-B; [Decreto-Lei n.º 84/2021](https://diariodarepublica.pt/dr/detalhe/decreto-lei/84-2021-172938301) e [Decreto-Lei n.º 24/2014 (versão consolidada)](https://diariodarepublica.pt/dr/legislacao-consolidada/decreto-lei/2014-73222992) (garantia e livre resolução).
- [Decisão de Execução (UE) 2023/1795 — Quadro de Privacidade de Dados UE-EUA](https://eur-lex.europa.eu/legal-content/PT/TXT/?uri=CELEX:32023D1795).
- [Decisão de Execução (UE) 2021/914 — cláusulas contratuais-tipo](https://eur-lex.europa.eu/legal-content/PT/TXT/?uri=CELEX:32021D0914).
- [CNPD — Violação de dados (data breach)](https://www.cnpd.pt/organizacoes/outras-obrigacoes/violacao-de-dados-ou-data-breach/) e [formulário de notificação](https://www.cnpd.pt/databreach/).
- [CEPD — Orientações 9/2022 sobre a notificação de violações de dados pessoais (versão portuguesa no sítio da CNPD)](https://www.cnpd.pt/media/vfhpxp3p/edpb_guidelines_202209_personal_data_breach_notification_v2-0_pt.pdf).
- [CNPD — Diretriz/2023/1 sobre medidas organizativas e de segurança](https://www.cnpd.pt/umbraco/surface/cnpdDecision/download/122048).
- [Conselho da UE — posição sobre o Digital Omnibus (21-10-2026)](https://www.consilium.europa.eu/en/press/press-releases/2026/10/21/digital-rulebook-council-agrees-position-to-simplify-data-protection-privacy-and-cyber-reporting-rules/).
- Anthropic: [termos comerciais](https://www.anthropic.com/legal/commercial-terms), [acordo de tratamento de dados](https://www.anthropic.com/legal/data-processing-addendum) e [prazos de conservação](https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-personal-data).
- [Vercel — região das funções](https://vercel.com/docs/functions/configuring-functions/region).
- Loja do Ouro: [Condições de venda](https://www.lojadoouro.pt/pages/condicoes-de-venda), [Livro de Reclamações Eletrónico](https://www.lojadoouro.pt/pages/livro-de-reclamacoes-eletronico), [política de privacidade](https://www.lojadoouro.pt/policies/privacy-policy) e [termos e condições](https://www.lojadoouro.pt/policies/terms-of-service).

> **Nota:** Este artigo é uma orientação para a equipa do apoio, não é aconselhamento jurídico. Em caso de dúvida, fale com o Super Admin.
