# Email
<!-- resumo: Como funciona o canal Email (caixa apoiocliente@lojadoouro.pt no Gmail): que emails entram, quem é o cliente, como responder, assinatura automática, anexos e resposta automática. -->
<!-- termos: email, e-mail, mail, Gmail, correio, caixa partilhada, apoiocliente, apoiocliente@lojadoouro.pt, responder email, assinatura, assinatura automática, Re:, thread, fio, conversa do Gmail, formulário de contacto, contact form, Shopify form, spam, lixo, promoções, newsletter, cópia, CC, anexos, PDF, recebemos o seu email, autoresposta, auto reply, abrir no Gmail -->
<!-- atualizado: 2026-10-30 -->

O canal **Email** é a caixa partilhada **apoiocliente@lojadoouro.pt**, no Gmail, ligada ao dashboard pelo Super Admin. Cada fio de email (thread) do Gmail é uma conversa.

## Que emails entram
<!-- perguntas: Que emails aparecem no dashboard? | Os emails do spam entram? | Um email que o cliente diz ter enviado não aparece | Os emails antigos estão no dashboard? -->

- Entram os emails que chegam à caixa **depois** de ela ter sido ligada ao dashboard; os anteriores não são importados.
- Entram também os que o Gmail põe em Promoções, Redes sociais, Atualizações ou Fóruns.
- Ficam de fora o **Spam**, o **Lixo** e os **Rascunhos**.
- Os emails chegam em poucos segundos, porque a Google avisa o dashboard logo que chega um email novo (mesmo com o dashboard fechado). Por segurança, a caixa é também lida a cada 5 minutos e no botão **Atualizar**.

Se um cliente diz que enviou um email e ele não aparece, veja no Gmail se caiu no Spam ou no Lixo, carregue em **Atualizar** e veja o indicador **Email** na barra de cima.

## Quem é o cliente
<!-- perguntas: Quem é o cliente numa conversa de email? | Como funcionam os pedidos do formulário de contacto da loja? | Porque é que o email do formulário diz não confirmado? -->

O cliente é quem enviou o primeiro email da conversa (o remetente).

Os pedidos do **formulário de contacto da loja online** chegam enviados pela Shopify. Nesses, o sistema usa como cliente o email que a pessoa escreveu no formulário, num contacto à parte, marcado como "(indicado no formulário de contacto, não confirmado)". As encomendas só aparecem depois de a equipa associar o cliente pelo email. Ver [Clientes e encomendas](/apoio/documentacao/clientes-e-encomendas#associar-o-cliente-da-loja-online).

## Responder a um email
<!-- perguntas: Como respondo a um email? | A resposta vai para quem está em cópia? | De que endereço sai a resposta? | A resposta fica nos Enviados do Gmail? -->

1. Abra a conversa e confirme a linha "Envia por: Email para (cliente), de apoiocliente@lojadoouro.pt — na mesma conversa, com a assinatura automática".
2. Escreva a resposta **sem assinatura**: a assinatura, que já traz a despedida e o seu primeiro nome, entra sozinha.
3. Junte anexos, se precisar (até 5 imagens ou PDF).
4. Carregue em **Enviar ao cliente**.

A resposta:

- sai de "Loja do Ouro" apoiocliente@lojadoouro.pt, na mesma conversa do Gmail (com "Re:" no assunto);
- vai **sempre e só para o cliente da conversa**, nunca para outras pessoas que estavam no fio ou em cópia;
- fica nos Enviados do Gmail;
- fica no dashboard como "Aceite pela plataforma" (o email não confirma a entrega nem a leitura).

> **Atenção:** Se precisar de escrever a outra pessoa (por exemplo, a quem estava em cópia), faça-o no Gmail, com o cuidado de não partilhar dados do cliente sem necessidade.

As notas internas de uma conversa de email ficam só no dashboard e não levam anexos.

## Assinatura automática
<!-- perguntas: Tenho de pôr assinatura nos emails? | Qual é a assinatura dos emails? | Como aparece o meu nome no email? -->

Todas as respostas por email levam a assinatura definida pelo Super Admin, com o **seu primeiro nome**. A assinatura de origem é:

> **Nota:** Com os melhores cumprimentos, / (o seu primeiro nome) / Apoio ao Cliente · Loja do Ouro / www.lojadoouro.pt

Não escreva assinatura à mão: ficaria repetida. O texto da assinatura só pode ser mudado pelo Super Admin ([Configuração do apoio](/apoio/documentacao/configuracao#email-gmail)).

## Como o email fica formatado
<!-- perguntas: Posso fazer listas no email? | Os links ficam clicáveis no email? -->

Escreva texto simples. O sistema transforma-o num email formatado:

- uma linha em branco separa parágrafos;
- duas ou mais linhas seguidas começadas por "- " ou "• " ficam uma lista;
- as ligações começadas por http:// ou https:// ficam clicáveis.

## Abrir no Gmail
<!-- perguntas: Como abro esta conversa no Gmail? -->

No separador **Cliente → Atendimento**, **Abrir no Gmail** abre o mesmo fio no Gmail, já na conta da caixa do apoio (é preciso ter acesso a essa conta no browser).

## Resposta automática "recebemos o seu email"
<!-- perguntas: O cliente recebe uma resposta automática quando envia email? | Quando é enviada a resposta recebemos o seu email? -->

Se o Super Admin a ligar (começa desligada), o cliente que inicia uma conversa nova recebe uma resposta automática a confirmar a receção, com um texto para dentro e outro para fora do horário. Na conversa aparece "Resposta automática "recebemos o seu email" enviada para (email)". As regras exatas estão em [Respostas automáticas](/apoio/documentacao/respostas-automaticas#recebemos-o-seu-email).

## Problemas comuns no email
<!-- perguntas: Esta conversa já não existe no Gmail, o que faço? | A caixa Gmail precisa de ser ligada de novo | Esta conversa não tem um email de cliente válido -->

| Mensagem | Porquê | O que fazer |
| --- | --- | --- |
| "A caixa Gmail do apoio precisa de ser ligada de novo…" | A autorização da Google expirou ou foi retirada | Avise o Super Admin; entretanto responda no Gmail |
| "Esta conversa já não existe no Gmail (foi apagada de vez)…" | Alguém apagou o fio no Gmail | Escreva um email novo ao cliente, no Gmail |
| "Esta conversa já não tem mensagens no Gmail (foram apagadas)…" | As mensagens do fio foram apagadas | Escreva um email novo ao cliente, no Gmail |
| "Esta conversa não tem um email de cliente válido." | O remetente não tem um endereço utilizável | Veja o email no Gmail |
| Resposta em "Resultado incerto" | A Google não respondeu a tempo | **Verificar**, nunca reenviar logo. Ver [Envio e entrega](/apoio/documentacao/envio-e-entrega#quando-o-resultado-e-incerto) |

> **Dica:** Evite apagar de vez, no Gmail, fios da caixa do apoio que ainda estejam em curso: o dashboard deixa de conseguir responder nessas conversas.
