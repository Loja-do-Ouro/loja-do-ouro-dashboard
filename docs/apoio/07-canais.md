# Canais
<!-- resumo: Comparação de todos os canais do apoio (email, Facebook, Instagram, comentários, chat do site, Zendesk, WhatsApp): o que se pode enviar, o que se confirma e quando as mensagens chegam. -->
<!-- termos: canais, canal, plataformas, fontes, integrações, email, Gmail, Facebook, Messenger, Instagram, Direct, DM, mensagens privadas, comentários, chat do site, live chat, chatbot, widget, Zendesk, WhatsApp, Metricool, Meta, sincronização, sync, quando chegam as mensagens, atraso, demora, comparação -->
<!-- atualizado: 2026-10-30 -->

O Apoio ao Cliente junta vários canais numa só caixa de entrada, mas cada canal tem as suas regras. Este artigo compara-os; cada um tem também um artigo próprio.

## Resumo dos canais
<!-- perguntas: Que diferenças há entre os canais? | Em que canais posso enviar anexos? | Em que canais há pedido de avaliação? | Em que canais há respostas automáticas? -->

| Canal | Entra por | Anexos na resposta | Até onde se confirma a entrega | Pedido de avaliação | Respostas automáticas |
| --- | --- | --- | --- | --- | --- |
| [Email](/apoio/documentacao/email) | Gmail (apoiocliente@lojadoouro.pt) | Até 5 imagens ou PDF | Aceite pela plataforma | Sim | "Recebemos o seu email" (se ligada) |
| [Facebook](/apoio/documentacao/facebook-instagram) | Metricool → Messenger | 1 imagem | Aceite pela plataforma | Sim | Pedido de apoio e agradecimento a reações (se ligadas) |
| [Instagram](/apoio/documentacao/facebook-instagram) | Metricool → Instagram Direct | 1 imagem | Aceite pela plataforma | Sim | Pedido de apoio e agradecimento a reações (se ligadas) |
| [Comentários Facebook e Instagram](/apoio/documentacao/comentarios-publicos) | Metricool → publicações | Não (só texto, público) | Aceite pela plataforma | Não | Não |
| [Chat do site](/apoio/documentacao/chat-do-site) | Botão "Fale connosco" no site | Não | Entregue e Lida | Sim (estrelas no chat) | Não (mensagem fora de horas no próprio chat) |
| [Zendesk](/apoio/documentacao/whatsapp-zendesk#zendesk-ligado) | Zendesk (se ligado) | Até 5 imagens ou PDF | Aceite pela plataforma | Não | Não |
| [WhatsApp](/apoio/documentacao/whatsapp-zendesk#whatsapp) | Por configurar | — | — | Não | Não |

Em todos os canais a equipa pode escrever notas internas, que nunca saem para o cliente (com o Zendesk ligado, nos tickets Zendesk é preciso ter a conta Zendesk ligada).

## Quem é o cliente em cada canal
<!-- perguntas: Como é identificado o cliente em cada canal? | Porque é que o mesmo cliente aparece em duas conversas? -->

Cada canal identifica o cliente à sua maneira: pelo endereço de email (Email e Zendesk), pelo perfil do Facebook ou do Instagram (mensagens e comentários) ou pelo nome e email escritos no chat do site. Por isso a mesma pessoa pode aparecer em várias conversas, uma por canal. O sistema **não junta** essas conversas: mostra-as como sugestões no separador Cliente quando o email ou o telefone coincidem. Ver [Clientes e encomendas](/apoio/documentacao/clientes-e-encomendas#outras-conversas-do-mesmo-cliente).

## Quando as mensagens chegam
<!-- perguntas: Quanto tempo demora uma mensagem a aparecer? | As mensagens chegam com o dashboard fechado? | Porque é que uma mensagem do Instagram demorou a aparecer? | De quanto em quanto tempo o sistema lê as mensagens? -->

Não há nenhum processo sempre ligado: o sistema vai buscar as mensagens novas nestes momentos:

| Quando | O que é lido |
| --- | --- |
| Com as Conversas abertas e à vista, a cada 60 segundos (frequência definida pelo Super Admin, entre 30 segundos e 1 hora) | Todos os canais |
| Ao carregar em **Atualizar** | Todos os canais, exceto os que foram lidos há instantes ou estão em espera depois de erros |
| De 5 em 5 minutos, mesmo com o dashboard fechado | Facebook e Instagram; o email, o Zendesk e os comentários quando já passou o tempo da frequência |
| Logo que a Google avisa (segundos) | Email |
| No momento | Chat do site |
| Todos os dias às 06:00 UTC | Passagem de segurança a todos os canais |

Na prática: o chat do site e o email aparecem em segundos; o Facebook e o Instagram até 5 minutos depois com o dashboard fechado, ou cerca de 1 minuto com alguém nas Conversas.

Cada canal é lido à parte: uma falha numa plataforma não impede as outras. Depois de um erro, o sistema espera antes de tentar outra vez, e a espera dobra a cada falha seguida, até 30 minutos.

## Estado de cada canal
<!-- perguntas: Como sei se um canal está a funcionar? -->

A barra no topo das Conversas mostra o estado de cada canal ("Sincronizado", "Em direto", "Erro", "Bloqueado"…). O significado de cada um está em [Caixa de entrada](/apoio/documentacao/caixa-de-entrada#a-barra-dos-canais-e-o-botao-atualizar) e o que fazer quando algo falha em [Resolução de problemas](/apoio/documentacao/resolucao-de-problemas#um-canal-esta-em-erro-ou-bloqueado).

## Marcas e línguas
<!-- perguntas: O apoio serve a Gold Store Premium? | Em que línguas respondemos? -->

O apoio serve a **Loja do Ouro** (lojadoouro.pt) e a **Gold Store Premium** (goldstorepremium.com). No chat do site, a marca e a língua do cliente aparecem no cabeçalho da conversa e no separador Cliente; responda sempre na língua do cliente e só com a marca da conversa. Ver [Chat do site](/apoio/documentacao/chat-do-site#marcas-e-linguas).
