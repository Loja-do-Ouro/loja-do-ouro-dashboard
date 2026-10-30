# Resolução de problemas
<!-- resumo: O que fazer quando algo não funciona no Apoio ao Cliente: sintoma, causa provável e passos para resolver, do acesso aos canais, envios, IA e encomendas. -->
<!-- termos: problema, problemas, erro, erros, não funciona, avaria, bug, falha, troubleshooting, ajuda, suporte técnico, não consigo, não aparece, desapareceu, bloqueado, sessão terminada, lento, não chega, não recebe, resolução de problemas, FAQ técnico -->
<!-- atualizado: 2026-10-30 -->

Cada problema tem a causa mais provável e o que fazer. Se nada resultar, fale com o Super Admin, indicando a conversa (a ligação `/apoio?conversa=…`), a hora e a mensagem de erro exata.

## Acesso e ecrã

### Não vejo o Apoio ao Cliente no menu
<!-- perguntas: Não tenho acesso ao apoio | O menu não aparece | Sem acesso ao Apoio ao Cliente -->

- **Causa:** falta o acesso "Apoio ao Cliente" na sua ficha, ou ainda tem uma palavra-passe temporária (o menu só mostra "A minha conta").
- **O que fazer:** mude a palavra-passe em A minha conta. Se continuar sem ver, peça ao Super Admin o acesso (Administração → Utilizadores ou Configuração do apoio → Quem usa o Apoio ao Cliente).

### Aparece "Sessão terminada. Atualize a página e entre novamente."
<!-- perguntas: A sessão terminou a meio de uma resposta | Fui desligado do dashboard -->

- **Causa:** a sua sessão expirou.
- **O que fazer:** atualize a página (F5) e entre de novo. O rascunho fica guardado se não fechar o separador do browser.

### Aparece "Sem resposta do servidor (HTTP …)"
<!-- perguntas: O dashboard não responde | Erro HTTP 500 -->

- **Causa:** falha momentânea do servidor ou da ligação à internet.
- **O que fazer:** espere uns segundos e tente de novo. Se estava a enviar, o texto ficou no rascunho e pode voltar a carregar em Enviar **sem risco de duplicar**.

## Conversas e lista

### Um canal está em Erro ou Bloqueado
<!-- perguntas: O Facebook está bloqueado na barra | O email diz Erro | Um canal não sincroniza -->

- **Causa:** "Erro" é uma falha na última leitura (o sistema volta a tentar, com esperas cada vez maiores, até 30 minutos). "Bloqueado" quer dizer que a plataforma recusou o acesso e só o Super Admin resolve.
- **O que fazer:**
  1. Passe o rato sobre o indicador para ver o motivo.
  2. Carregue em **Atualizar** e veja o resultado.
  3. Se continuar, avise o Super Admin.
  4. Entretanto, responda na própria plataforma: Gmail, Meta Business Suite ou Zendesk.

### Uma mensagem do cliente não aparece
<!-- perguntas: O cliente diz que mandou mensagem e não aparece | Não chegam mensagens do Instagram | Falta um email -->

- **Causa:** ainda não foi lida (Facebook e Instagram podem demorar até 5 minutos com o dashboard fechado), o email caiu no Spam ou no Lixo, chegou antes de a caixa Gmail ser ligada, ou o canal está em Erro.
- **O que fazer:** carregue em **Atualizar**; veja o indicador do canal; no email, procure no Spam e no Lixo do Gmail; pesquise pelo nome ou email (com e sem acentos).

### Não encontro uma conversa antiga
<!-- perguntas: Uma conversa desapareceu da lista | A conversa resolvida já não aparece -->

- **Causa:** as conversas resolvidas sem atividade desde a data do histórico visível ficam ocultas.
- **O que fazer:** para um ticket Zendesk, pesquise o número exato (`#1234`); use uma ligação direta, se a tiver; ou peça ao Super Admin para recuar a data. Ver [Histórico visível](/apoio/documentacao/historico-visivel).

### A pesquisa não encontra o cliente
<!-- perguntas: Pesquiso o nome e não aparece | A pesquisa não funciona -->

- **Causa:** a pesquisa distingue acentos ("Joao" não encontra "João") e não procura nas notas internas.
- **O que fazer:** experimente com e sem acentos, só parte do nome, o email ou o telefone. Veja também se não tem um filtro de canal ou de estado escolhido.

### Uma conversa desapareceu do separador Minhas
<!-- perguntas: A conversa saiu de Minhas | Onde estão as minhas conversas resolvidas? -->

- **Causa:** foi resolvida (Minhas não mostra resolvidas), foi transferida, ou tem um filtro ativo.
- **O que fazer:** em **Minhas**, escolha o estado **Resolvido**; ou procure-a em **Todas**.

### Uma conversa do Instagram sumiu da lista
<!-- perguntas: Uma conversa do Instagram foi para Automáticas -->

- **Causa:** a pessoa só reagiu (story, gosto, emoji) e, como as respostas automáticas do Facebook e do Instagram estão ligadas, a conversa foi para o separador **Automáticas**. Com elas desligadas, isto não acontece: procure então em **Todas** ou veja se tem um filtro ativo.
- **O que fazer:** veja o separador **Automáticas**. Se precisar de tratar, escreva nela ou assuma-a e ela volta à lista principal.

## Responder e enviar

### Não consigo responder a uma conversa
<!-- perguntas: O campo de resposta não aparece | Não tenho botão de enviar -->

- **Causa:** a explicação aparece no lugar do campo. O mais comum é a conversa ter outro responsável.
- **O que fazer:** leia a mensagem e veja a tabela em [Responder](/apoio/documentacao/responder#quando-nao-consegue-responder).

### O botão Enviar está cinzento
<!-- perguntas: Não consigo carregar em Enviar -->

- **Causa:** o campo está vazio, um anexo ainda está a carregar, ou, num comentário, o texto passa o limite.
- **O que fazer:** escreva o texto, espere pelo anexo ou encurte o comentário (veja o contador).

### A mensagem ficou "Resultado incerto" ou "A enviar"
<!-- perguntas: A mensagem ficou presa | Resultado incerto, reenvio? -->

- **Causa:** a plataforma não respondeu a tempo; a mensagem pode ter chegado.
- **O que fazer:** **não reenvie**. Carregue em **Verificar**; se não encontrar, confirme na plataforma e só depois use **Não foi enviada**. Ver [Envio e entrega](/apoio/documentacao/envio-e-entrega#quando-o-resultado-e-incerto).

### A mensagem falhou
<!-- perguntas: Envio falhado | A mensagem diz Falhou -->

- **Causa:** a plataforma recusou; o motivo aparece ao lado.
- **O que fazer:** corrija conforme o motivo e envie de novo (o texto ficou no rascunho ou use **Copiar para o rascunho**). Ver [Envio e entrega](/apoio/documentacao/envio-e-entrega#quando-a-mensagem-falha).

### Meta #551 no Messenger ou Instagram
<!-- perguntas: Não consigo enviar para este cliente do Instagram -->

- **Causa:** o cliente bloqueou a página, deixou de aceitar mensagens ou desativou a conta.
- **O que fazer:** não reenvie. Use outro contacto que o cliente tenha deixado ou espere que volte a escrever. Ver [Facebook e Instagram](/apoio/documentacao/facebook-instagram#erro-meta-551).

### Não consigo anexar um ficheiro
<!-- perguntas: O anexo não carrega | PDF não é aceite | Só posso enviar uma imagem -->

- **Causa:** o canal não aceita esse tipo ou esse número de anexos (o chat do site e os comentários não aceitam nenhum; Facebook e Instagram, uma imagem; PDF só no email e no Zendesk), o ficheiro é grande demais, ou chegou ao limite diário.
- **O que fazer:** veja a tabela em [Responder](/apoio/documentacao/responder#anexar-imagens-e-pdf). Para PDF no Instagram, por exemplo, envie a informação em texto ou peça o email do cliente.

### Perdi o texto que estava a escrever
<!-- perguntas: O rascunho desapareceu -->

- **Causa:** o rascunho fica só no separador do browser em que escreveu; fechar o separador apaga-o.
- **O que fazer:** se ainda não fechou o separador, volte à conversa: o rascunho está lá. Para textos longos, escreva com calma no próprio campo e evite fechar o separador.

### O cliente diz que não recebeu a resposta
<!-- perguntas: O cliente não recebeu o email | A resposta não chegou ao cliente -->

- **Causa:** "Aceite pela plataforma" não garante a entrega. No email, a resposta pode ter ido para o Spam do cliente; no Zendesk, as notificações podem estar desligadas; no chat do site, o cliente pode já ter saído.
- **O que fazer:** veja o estado e o detalhe da mensagem; no email, confirme nos Enviados do Gmail e peça ao cliente que veja o Spam; no chat do site, veja se a resposta seguiu também por email.

## Responsável e estados

### Não consigo mudar o estado
<!-- perguntas: A lista Estado está bloqueada -->

- **Causa:** a conversa é de outra pessoa ("Só o responsável (ou o Super Admin) muda o estado."), ou, no Zendesk, está a tentar voltar a Novo.
- **O que fazer:** peça ao responsável ou ao Super Admin.

### Não consigo transferir para uma colega
<!-- perguntas: A colega não aparece na lista de transferência -->

- **Causa:** a conversa não é sua; a colega não tem acesso ao Apoio ao Cliente; ou, num ticket Zendesk, a colega não ligou a conta Zendesk.
- **O que fazer:** peça ao responsável ou ao Super Admin; peça à colega que ligue a conta Zendesk.

### A colega não recebeu o email da transferência
<!-- perguntas: O aviso de transferência não chegou -->

- **Causa:** a ficha da colega em Administração → Utilizadores não tem email, ou o email ficou no Spam.
- **O que fazer:** a conversa já está em **Minhas** da colega; avise-a de viva voz e peça ao Super Admin que complete a ficha.

## IA

### A IA não responde ou demora muito
<!-- perguntas: O assistente de IA não funciona | A IA está sempre a pensar -->

- **Causa:** pedido pesado, falha da Anthropic ou dois pedidos seus ainda em curso.
- **O que fazer:** espere; o pedido continua no servidor mesmo que mude de conversa. Se der erro, tente um pedido mais simples. Ver [Assistente de IA](/apoio/documentacao/assistente-ia#mensagens-de-erro).

### Atingi o limite diário da IA
<!-- perguntas: Limite diário da IA atingido -->

- **Causa:** cada pessoa tem um número máximo de pedidos por dia (80 de origem).
- **O que fazer:** responda sem a IA ou peça ao Super Admin que aumente o limite.

### A IA propôs um preço, prazo ou ligação errados
<!-- perguntas: A IA inventou informação | A proposta da IA está errada -->

- **Causa:** a base de conhecimento está incompleta ou desatualizada, ou a IA errou.
- **O que fazer:** corrija antes de enviar e avise o Super Admin para atualizar a base de conhecimento. Confirme sempre a lista "a confirmar antes de enviar".

## Clientes e encomendas

### Não aparecem as encomendas do cliente
<!-- perguntas: O separador Cliente não mostra encomendas | Sem email associado -->

- **Causa:** a conversa não tem email (Instagram, Messenger), o email foi só "indicado" no chat ou no formulário, ou o cliente comprou com outro email.
- **O que fazer:** pergunte ao cliente o email da compra e use **Associar**. Ver [Clientes e encomendas](/apoio/documentacao/clientes-e-encomendas#associar-o-cliente-da-loja-online).

### "Esta encomenda não está no email deste contacto"
<!-- perguntas: A encomenda que o cliente indicou não é dele -->

- **Causa:** o número de encomenda que o cliente escreveu pertence a outro email.
- **O que fazer:** não partilhe dados da encomenda até confirmar a identidade. Ver [Confirmar a identidade antes de partilhar dados](/apoio/documentacao/clientes-e-encomendas#confirmar-a-identidade-antes-de-partilhar-dados).

## Quando chamar o Super Admin
<!-- perguntas: Quando devo falar com o Super Admin? | A quem peço ajuda? -->

- Um canal **Bloqueado** ou em **Erro** há mais de uma hora.
- Um cliente pede para ver, corrigir ou apagar os seus dados ([Direitos dos titulares dos dados](/apoio/documentacao/direitos-dos-titulares#passo-a-passo-quando-um-cliente-pede)).
- Suspeita de que dados de um cliente foram vistos ou enviados a quem não devia (por exemplo, uma resposta enviada ao cliente errado). Avise **logo**: há prazos legais. Ver [Se houver uma fuga ou um erro com dados](/apoio/documentacao/protecao-de-dados#se-houver-uma-fuga-ou-um-erro-com-dados).
- Uma avaliação que considere injusta.
- Precisa de acesso, de mudar uma definição ou de mais pedidos à IA.
