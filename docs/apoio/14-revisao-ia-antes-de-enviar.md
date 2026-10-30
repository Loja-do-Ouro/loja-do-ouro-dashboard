# Revisão da IA antes de enviar
<!-- resumo: Como funciona a revisão automática das respostas pela IA ao carregar em Enviar: quando corre, o que mostra, as escolhas possíveis, como a ligar ou desligar e o que fica registado. -->
<!-- termos: revisão, revisão IA, revisor, correção, corretor, verificar resposta, qualidade, critérios, sugestão, sugere melhorar, diferenças, enviar a sugestão, enviar a minha versão, editar a sugestão, enviar sem revisão, A rever com a IA, revisão por decidir, 🔎, review, proofreading, spell check, português do Brasil, PT-BR -->
<!-- atualizado: 2026-10-30 -->

Quando a revisão está ligada, ao carregar em **Enviar ao cliente** a IA lê a resposta em poucos segundos antes de ela sair. Se estiver boa, segue logo; se puder melhorar, mostra o que encontrou e uma sugestão, e a pessoa escolhe o que enviar. **A revisão nunca impede o envio.**

## Quando a revisão corre
<!-- perguntas: Como funciona a revisão da IA? | Quando é que a IA revê a minha resposta? | A revisão corre nas notas internas? | Porque é que a minha resposta não foi revista? -->

O Super Admin escolhe um de três modos:

- **Desligada** — nenhuma resposta é revista.
- **Opcional (cada pessoa pode desligar)** — cada pessoa decide se quer a revisão (por omissão, ligada).
- **Para todos** — todas as respostas que cumprem as regras abaixo são revistas.

Mesmo com a revisão ligada, só é revista uma **resposta ao cliente** com **25 a 4000 caracteres**. Não são revistas:

- as notas internas;
- uma nova tentativa do mesmo envio (por exemplo, depois de a rede falhar);
- uma resposta que já foi revista nesta ronda (depois de **Cancelar** ou de editar a sugestão, o envio seguinte segue direto);
- uma proposta do assistente de IA enviada tal e qual, sem alterações.

## Enquanto a IA revê
<!-- perguntas: O que é A rever a resposta com a IA? | Posso enviar sem esperar pela revisão? | Quanto tempo demora a revisão? -->

- O campo de resposta fica só de leitura e aparece "A rever a resposta com a IA…".
- O botão **Enviar sem revisão** envia já, sem esperar.
- Na lista, a conversa mostra "A rever com a IA…".
- Pode mudar de conversa: se a resposta for aprovada, segue sozinha; se houver sugestões, fica à sua espera (ver abaixo).

A IA tem cerca de 10 segundos. Se não responder a tempo, a resposta é enviada na mesma: "A revisão da IA não respondeu a tempo; a resposta foi enviada sem revisão.". Se a revisão falhar ou o orçamento acabar: "Não foi possível rever a resposta (…); foi enviada sem revisão.".

## Resposta aprovada
<!-- perguntas: O que acontece quando a IA aprova a resposta? -->

A resposta sai logo, sem mais nada a fazer, e aparece "Resposta revista pela IA e enviada.".

## Quando a IA sugere melhorias
<!-- perguntas: A IA sugere melhorar a minha resposta, o que faço? | O que quer dizer Enviar a minha versão? | Como vejo as diferenças que a IA propõe? | Como fecho a revisão sem enviar? -->

Aparece o painel **Revisão da IA antes de enviar**, com "A IA sugere melhorar esta resposta:" e a lista dos problemas, cada um com o critério ("Responde a tudo: …", "Português de Portugal: …").

Quando há sugestão:

- **Ver diferenças** mostra o seu texto com as mudanças ("Diferenças: riscado sai, sublinhado entra.");
- **Ver só a sugestão** mostra o texto proposto.

Escolha um botão:

| Botão | O que faz |
| --- | --- |
| Enviar a sugestão | Envia o texto da IA tal como está (só aparece quando a sugestão pode seguir com um clique) |
| Enviar a minha versão | Envia o seu texto original, sem mudanças |
| Editar a sugestão | Põe a sugestão no campo de resposta para a corrigir; o envio seguinte já não é revisto |
| Editar a resposta | Quando não há sugestão: volta ao seu texto para o corrigir |
| Cancelar (ou Esc) | Fecha o painel e volta ao seu texto, sem enviar |

Em alguns casos a sugestão só pode seguir depois de editada, com um aviso:

- "A sugestão muda muito o texto: edite-a antes de enviar."
- "Resposta longa: as diferenças não foram marcadas. Edite a sugestão antes de enviar."
- "A sugestão passa o limite de N caracteres de um comentário: edite-a antes de publicar."

E um alerta que pede atenção redobrada: "A sugestão altera números ou datas: confirme antes de enviar.".

O painel fica guardado: se mudar de conversa, aparece no topo "… a resposta ainda não foi enviada: a IA sugere melhorias e espera a sua escolha." com **Ver a revisão**, e a conversa fica com "Revisão por decidir" na lista. Se tentar fechar a página, o browser pede confirmação. Enquanto o painel estiver aberto, a proposta do assistente e os emojis não alteram o texto ("Termine primeiro a revisão da IA da resposta (enviar, editar ou cancelar).").

## Sugestões retiradas
<!-- perguntas: Porque é que a sugestão da IA foi retirada? | A IA pode acrescentar preços à minha resposta? -->

Para a IA nunca pôr na sua boca algo que não disse, o servidor retira a sugestão (mas mostra os problemas encontrados) quando ela acrescenta:

- uma ligação que não está na sua resposta nem na base de conhecimento;
- números, valores, contactos ou códigos novos;
- um compromisso ou uma data (reembolso, troca, desconto, oferta, "amanhã", "dias úteis"…);
- a outra marca (Loja do Ouro ou Gold Store Premium);
- dados pessoais ou de encomenda;
- expressões do português do Brasil.

Aparece então "A sugestão da IA foi retirada: …" com o motivo. Corrija a sua resposta seguindo os problemas apontados, ou envie a sua versão.

## Os critérios
<!-- perguntas: Que critérios usa a revisão da IA? | Quem define os critérios da revisão? -->

Os critérios são definidos pelo Super Admin. Os de origem são: Saudação, Tom caloroso e profissional, Correção, Responde a tudo, Clareza, Língua do cliente e português de Portugal, Próximo passo, Despedida, Marca certa, Privacidade e Tamanho adequado ao canal. Ver [Responder](/apoio/documentacao/responder#como-escrever-bem).

Além da IA, o próprio dashboard confere duas coisas sem IA: expressões do português do Brasil e, no chat do site, a marca certa.

## Ligar ou desligar a revisão para si
<!-- perguntas: Como desligo a revisão da IA? | Onde ligo a revisão das minhas respostas? -->

Só no modo **Opcional**:

- no campo de resposta, a caixa **🔎 Revisão IA** liga ou desliga a revisão para si; ou
- em **A minha conta**, painel "Revisão da IA antes de enviar", marque ou desmarque "Rever as minhas respostas com a IA antes de enviar" e carregue em **Guardar**.

Nos outros modos, A minha conta diz "A revisão está ligada para toda a equipa (definida pelo Super Admin)." ou "A revisão da IA está desligada na configuração do apoio.".

## As suas estatísticas
<!-- perguntas: Onde vejo as minhas revisões? | A revisão da IA serve para me avaliar? | O Super Admin vê as minhas revisões? -->

Em **A minha conta → As suas revisões este mês** vê quantas respostas foram revistas, quantas sugestões recebeu e o que escolheu. "Só vê as suas revisões. Estes números servem para afinar a IA, não para avaliar pessoas."

O Super Admin vê só os **totais da equipa** (e as suas próprias revisões), nunca as revisões de cada pessoa. Estes números não entram na página Satisfação e desempenho.

## O que fica guardado
<!-- perguntas: A IA guarda as minhas respostas? | Durante quanto tempo ficam as revisões? -->

Para a revisão, a resposta, as últimas 15 mensagens da conversa (sem notas internas nem nomes da equipa) e a base de conhecimento são enviadas à Anthropic. Do texto da resposta e da sugestão fica guardado **só um código (hash)**, nunca o texto. O registo de cada revisão (critérios em falta, escolha, custo) é apagado ao fim de **365 dias**.

> **Lei:** Ver [Inteligência artificial no apoio](/apoio/documentacao/inteligencia-artificial) e [Dados dos colaboradores e avaliação do atendimento](/apoio/documentacao/dados-dos-colaboradores).
