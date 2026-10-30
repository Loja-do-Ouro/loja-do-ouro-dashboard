# Responsável e transferências
<!-- resumo: Quem responde a cada conversa: assumir uma conversa, transferi-la a uma colega, deixá-la sem responsável, avisos por email e o que cada papel pode fazer. -->
<!-- termos: responsável, dono, owner, atribuir, atribuição, assign, assignee, assumir, ficar com a conversa, pegar na conversa, transferir, transferência, passar a conversa, passar a uma colega, reencaminhar, handover, devolver, deixar sem responsável, libertar, Super Admin, permissões, papéis, presença, a escrever, colega, férias, ausência -->
<!-- atualizado: 2026-10-30 -->

Cada conversa pode ter uma pessoa **responsável**. Só ela responde ao cliente; as outras ajudam com notas internas. Assim o cliente não recebe duas respostas diferentes e fica claro quem trata de quê.

## A regra do responsável
<!-- perguntas: O que é o responsável de uma conversa? | Quem pode responder a uma conversa? | Duas pessoas podem responder à mesma conversa? -->

- **Só o responsável responde ao cliente.** A base de dados confirma-o em cada envio: mesmo que alguém tente, a resposta é recusada ("Esta conversa está com Nome. Só essa pessoa pode responder ao cliente; peça-lhe que a transfira.").
- **Numa conversa sem responsável, quem responde primeiro fica responsável.** O campo de resposta avisa: "Ao responder fica responsável por esta conversa.".
- **Notas internas: toda a equipa**, em qualquer conversa.
- O responsável vê-se na lista ("Responsável: Nome" ou "Sem responsável") e no separador **Cliente → Atendimento**, onde aparece "Nome (eu)" quando é seu.

## O que cada papel pode fazer
<!-- perguntas: O que pode fazer o Super Admin que eu não posso? | Posso ver as conversas das colegas? | Posso transferir uma conversa que não é minha? | Quem vê as notas das avaliações? -->

| Ação | Colaborador(a) do apoio | Super Admin |
| --- | --- | --- |
| Ver todas as conversas, pesquisar e abrir | Sim | Sim |
| Escrever notas internas em qualquer conversa | Sim | Sim |
| Responder ao cliente | Se for o responsável ou se não houver responsável | Igual (para responder a uma conversa de outra pessoa, transfere-a primeiro para si) |
| Mudar o estado | Se for o responsável ou se não houver responsável | Sempre |
| Assumir uma conversa sem responsável | Sim, para si | Sim, para si |
| Transferir | Só as suas conversas | Qualquer conversa com responsável, também para si |
| Deixar sem responsável | Não | Sim |
| Ver a nota de uma avaliação | Só as que lhe dizem respeito | Todas |
| Cancelar um pedido de avaliação | Não | Sim, com motivo |
| Satisfação e desempenho | A sua linha | Toda a equipa |
| Configuração do apoio | Não | Sim |

## Ficar com uma conversa
<!-- perguntas: Como fico com uma conversa? | Como assumo uma conversa? | Como atribuo uma conversa a mim? -->

Há duas formas:

- **Responder** a uma conversa sem responsável: fica logo responsável (e, se estava em Novo, passa a Em atendimento).
- **Assumir sem responder**: no separador **Cliente → Atendimento**, carregue em **Assumir conversa**. Útil quando vai tratar do assunto mas ainda não tem a resposta.

O botão **Assumir conversa** só aparece em conversas sem responsável e atribui-a sempre a quem carrega. Ninguém atribui diretamente uma conversa sem responsável a outra pessoa: assume-se e depois transfere-se ("Só se pode atribuir a si próprio uma conversa sem responsável. Assuma-a e depois transfira-a.").

Fica no Registo e na conversa: "Ana ficou responsável pela conversa".

## Transferir para uma colega
<!-- perguntas: Como passo uma conversa a uma colega? | Como transfiro uma conversa? | A colega é avisada quando lhe transfiro uma conversa? | Vou de férias, o que faço às minhas conversas? -->

1. Abra a conversa (tem de ser sua, ou ser Super Admin).
2. Separador **Cliente → Atendimento** → lista **Transferir para** → **Escolher colega…** e escolha a pessoa.
3. Carregue em **Transferir** e confirme "Transferir a conversa para Nome?". No chat do site, a pergunta acrescenta "O cliente vê no chat que passou a falar com outra pessoa.".
4. Deixe uma nota interna a explicar o ponto da situação, para a colega não ter de ler tudo de novo.

O que acontece:

- A colega passa a ser a responsável e a única que pode responder.
- Recebe um email "Conversa transferida para si: (cliente)" com o botão **Abrir a conversa**. O email só sai se a ficha dela em Administração → Utilizadores tiver email; sem email, a conversa aparece na mesma em **Minhas**.
- Na conversa fica "Ana transferiu a conversa para Rita" (no chat do site, com "(o cliente viu o aviso no chat)").
- No chat do site, o cliente vê "A conversa foi transferida para Rita." e passa a ver "A falar com Rita" (só o primeiro nome).

A lista de colegas mostra as pessoas com acesso ao Apoio ao Cliente. Com o Zendesk ligado, num ticket Zendesk só aparecem as que ligaram a conta Zendesk ("Nome ainda não ligou a conta Zendesk; não pode receber tickets Zendesk.").

> **Dica:** Antes de faltar ou ir de férias, veja **Minhas** e transfira o que estiver por resolver, ou peça ao Super Admin que o faça.

## Deixar sem responsável
<!-- perguntas: Posso devolver uma conversa à lista Sem responsável? | Como tiro o responsável de uma conversa? -->

Só o Super Admin pode, com **Deixar sem responsável** no separador **Cliente → Atendimento**. Confirma "Deixar esta conversa sem responsável? Volta para a lista "Sem responsável" e a próxima pessoa a responder fica com ela.".

Quem não é Super Admin e quer largar uma conversa transfere-a a uma colega. Se tentar de outra forma, aparece "Só o Super Admin pode deixar uma conversa sem responsável. Para a passar a um colega, use Transferir.".

## Quando a conversa é de outra pessoa
<!-- perguntas: A conversa está com uma colega e o cliente está à espera, o que faço? | Posso ajudar numa conversa que não é minha? -->

No lugar do campo de resposta aparece "Esta conversa está com Nome: só essa pessoa responde ao cliente. Se precisar de a assumir, peça-lhe que a transfira. Pode deixar uma nota interna.", e no separador Cliente "Só Nome (ou o Super Admin) pode responder ao cliente e transferir esta conversa. Pode deixar notas internas.".

1. Deixe uma **nota interna** com o que sabe (separador **Nota interna** → **Guardar nota**).
2. Se for urgente e a colega não estiver, peça ao Super Admin que lhe transfira a conversa.

O Super Admin vê "Para responder, transfira-a para si (Cliente → Atendimento).": transfere para si e responde.

## Quem está a ver a conversa
<!-- perguntas: Como sei se uma colega está a responder ao mesmo cliente? | O que quer dizer está a escrever nesta conversa? -->

No topo da conversa aparece "Ana tem esta conversa aberta" ou "Ana está a escrever nesta conversa" para colegas que a tiveram aberta no último minuto. "A escrever" quer dizer que escreveu na resposta ao cliente nos últimos 30 segundos; as notas internas não contam (no chat do site, o cliente vê "A equipa está a escrever…" ou "Nome está a escrever…" enquanto alguém escreve a resposta).

Se vir que uma colega está a escrever, não comece outra resposta: combine com ela ou deixe uma nota.

## Avisos por email à equipa
<!-- perguntas: Recebo email quando chega uma mensagem nova? | Que emails o sistema me envia? -->

O único aviso por email à equipa é o da **transferência**. Não há email nem notificação quando assume uma conversa, quando ela fica sem responsável ou quando chega uma mensagem nova do cliente. Mantenha as Conversas abertas e use os separadores **Minhas** e **Não lidas**.

## Responsável nos tickets do Zendesk
<!-- perguntas: Quem é o responsável de um ticket Zendesk? | O que quer dizer conta por ligar no responsável? -->

Com o Zendesk ligado, o responsável é gravado no Zendesk (o agente do ticket) e assumir ou transferir exige ter a conta Zendesk ligada. Se o ticket estiver atribuído no Zendesk a alguém que não ligou a conta, aparece "Nome (Zendesk, conta por ligar)". Com o Zendesk desligado, aparece "Nome (no Zendesk)" e o responsável passa a ser só do dashboard. Ver [WhatsApp e Zendesk](/apoio/documentacao/whatsapp-zendesk).

## Mensagens que podem aparecer
<!-- perguntas: Este colaborador não tem acesso ao Apoio ao Cliente, o que quer dizer? -->

| Mensagem | Porquê |
| --- | --- |
| "Esta conversa está com Nome. Só essa pessoa (ou o Super Admin) a pode transferir." | Tentou transferir uma conversa que não é sua |
| "Só o Super Admin pode deixar uma conversa sem responsável. Para a passar a um colega, use Transferir." | Só o Super Admin tira o responsável |
| "Só se pode atribuir a si próprio uma conversa sem responsável. Assuma-a e depois transfira-a." | Conversas sem responsável assumem-se primeiro |
| "Este colaborador não tem acesso ao Apoio ao Cliente." | A pessoa escolhida perdeu o acesso entretanto |
| "Nome ainda não ligou a conta Zendesk; não pode receber tickets Zendesk." | Ticket Zendesk só para quem ligou a conta |
