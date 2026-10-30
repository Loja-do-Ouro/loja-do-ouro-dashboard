# WhatsApp e Zendesk
<!-- resumo: O estado do WhatsApp (ainda por configurar) e como funcionam os tickets do Zendesk, com o Zendesk ligado ao dashboard ou desligado e só como histórico. -->
<!-- termos: WhatsApp, WhatsApp Business, Zendesk, ticket, tickets, agente, conta de agente, light agent, licença, ligar Zendesk, OAuth, autoria, comentário privado, nota privada, só histórico, desligado, abrir no Zendesk, número do ticket, #1234, tickets antigos -->
<!-- atualizado: 2026-10-30 -->

## WhatsApp
<!-- perguntas: Podemos responder pelo WhatsApp no dashboard? | O WhatsApp está ligado? | Quando vai haver WhatsApp no apoio? -->

O WhatsApp está **por configurar**: nenhuma conversa entra nem sai por este canal. O indicador na barra diz "Por configurar" e, se alguma vez houver uma conversa de WhatsApp, o campo de resposta mostra "WhatsApp por configurar: ainda não é possível responder por este canal.".

O WhatsApp que a equipa usa hoje nos telemóveis não foi alterado nem ligado ao dashboard. Quando o canal for ligado, terá a regra da Meta das 24 horas: fora dessa janela só podem seguir mensagens modelo aprovadas pela Meta.

> **Atenção:** Conversas com clientes no WhatsApp dos telemóveis ficam fora do dashboard. Trate-as com os mesmos cuidados de privacidade, e não reencaminhe dados de clientes para conversas pessoais. Ver [Boas práticas de privacidade](/apoio/documentacao/boas-praticas-de-privacidade).

## Zendesk: como saber em que modo está
<!-- perguntas: O Zendesk ainda está a ser usado? | Como sei se o Zendesk está ligado? -->

O Super Admin decide se o Zendesk está **ligado** ao dashboard ou **desligado (só histórico)**. Veja o indicador **Zendesk** na barra do topo das Conversas:

- "Sincronizado …", "Erro" ou "Bloqueado": o Zendesk está **ligado**.
- "Desligado (só histórico)": o Zendesk está **desligado**; os tickets importados ficam para consulta.

## Zendesk ligado
<!-- perguntas: Como ligo a minha conta Zendesk? | Porque tenho de ligar a minha conta Zendesk? | O que é um light agent? | Como encontro um ticket antigo do Zendesk? -->

Com o Zendesk ligado, o Zendesk é a fonte de verdade dos tickets: mensagens, estado e responsável vêm de lá e são gravados lá.

**Ligar a sua conta (uma vez):**

1. Nas Conversas, na faixa **Ligue a sua conta Zendesk para responder aos tickets com a sua autoria.**, carregue em **Ligar Zendesk**.
2. Entre no Zendesk com **a sua** conta de agente e autorize.
3. Volta às Conversas com "Conta Zendesk ligada. As suas respostas e notas saem com a sua autoria.".

Se a ligação expirar, a faixa volta a aparecer com "A ligação anterior expirou.". Possíveis erros ao ligar:

| Mensagem | O que fazer |
| --- | --- |
| "A conta Zendesk é light agent: só escreve notas privadas e não pode responder a clientes." | Peça ao Super Admin uma licença de agente completa |
| "Esta conta Zendesk já está ligada a outro colaborador…" | Cada pessoa liga a sua própria conta; confirme quem tem sessão no Zendesk neste browser |
| "A conta Zendesk com que entrou não é de agente…" | Entre com a sua conta de agente |
| "A ligação ao Zendesk foi cancelada ou recusada." | Tente outra vez e autorize |

O plano Zendesk Team tem 3 licenças de agente: só quem tem licença consegue ligar a conta.

**No dia a dia:**

- As respostas são públicas no ticket ("Resposta pública no ticket #N — Zendesk notifica (email)") e saem com a sua autoria.
- As notas internas são comentários privados no ticket ("Nota interna gravada no Zendesk (privada).").
- Respostas e notas aceitam até 5 imagens ou PDF.
- Sem a conta ligada não consegue responder, escrever notas nem assumir tickets.
- O estado é gravado no Zendesk com a sua conta, e "Novo" não se pode voltar a escolher. Ver [Estados da conversa](/apoio/documentacao/estados-da-conversa#estados-nas-conversas-do-zendesk).
- Só se transfere para colegas que ligaram a conta Zendesk.
- "Aceite pelo Zendesk não significa entregue": o cliente só recebe se as notificações do Zendesk estiverem ativas para esse canal.
- A primeira importação trouxe os tickets alterados nos últimos 30 dias. Para abrir um ticket mais antigo, pesquise o número exato (por exemplo `#1234`): o sistema vai buscá-lo ao Zendesk.
- **Abrir no Zendesk**, no separador Cliente, abre o ticket no próprio Zendesk.

## Zendesk desligado (só histórico)
<!-- perguntas: O Zendesk foi desligado, como respondo a um ticket antigo? | Posso escrever notas em tickets Zendesk antigos? | O que é o botão Confirmei no Zendesk? -->

Com o Zendesk desligado, não entram tickets novos e ninguém liga a conta Zendesk. Os tickets já importados ficam no dashboard como histórico:

- **Nada sai para o cliente** pelo dashboard: o campo mostra "O Zendesk foi desligado do dashboard: este ticket fica como histórico. Responda no Zendesk (separador Cliente → Abrir no Zendesk). Pode deixar uma nota interna.".
- Notas internas, estado e responsável continuam a funcionar, mas **só no dashboard** (não mudam no Zendesk).
- Os anexos dos tickets abrem-se no próprio Zendesk.
- Num envio que tenha ficado incerto, use **Confirmei no Zendesk** depois de confirmar lá. Ver [Envio e entrega](/apoio/documentacao/envio-e-entrega#zendesk-desligado-confirmei-no-zendesk).

Os emails dos clientes chegam pelo canal [Email](/apoio/documentacao/email).
