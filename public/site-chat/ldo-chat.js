/*
 * Chat da Loja do Ouro — botão flutuante para o site (tema Shopify).
 *
 * As conversas entram no Apoio ao Cliente do dashboard (canal "Chat do site") e as respostas da equipa
 * aparecem aqui. Sem bibliotecas; isolado do CSS do tema (Shadow DOM). A configuração vem do bloco
 * <script id="ldo-chat-config" type="application/json"> gerado pela secção do tema (sections/lod-chat.liquid na
 * loja; cópia em shopify/sections/ldo-chat.liquid) ou de window.LDO_CHAT_CONFIG, e muda-se em Loja online →
 * Personalizar tema → Rodapé → Chat Loja do Ouro.
 *
 * Línguas: pt, en, es, fr e de (tabela I18N abaixo). Marca: Loja do Ouro em lojadoouro.pt e Gold Store Premium
 * em goldstorepremium.com (a loja fora de Portugal), em qualquer língua.
 *
 * Privacidade: enquanto o cliente não abre o chat, o widget não grava nada no browser (localStorage,
 * sessionStorage ou cookies), em nenhuma página. Ao carregar só lê o que já lá está (o token de uma conversa que o
 * cliente iniciou antes e se o chat estava aberto) e apaga "ldo-chat:visita", o contador que as versões anteriores
 * gravavam em todas as páginas. O que grava, e quando:
 *   - ao abrir o chat: "ldo-chat:aberto" (sessionStorage; apagado ao fechar o chat) e "ldo-chat:visita-chat"
 *     (sessionStorage: a hora a que o cliente abriu o chat e as páginas vistas desde então, neste separador; acaba
 *     ao fechar o separador, ao fechar o chat sem ter iniciado conversa ou após 30 minutos sem páginas novas nem
 *     contacto com o servidor);
 *   - ao iniciar a conversa: "ldo-chat:v1" (localStorage: token da conversa, nome, email confirmado, a última
 *     resposta vista e, enquanto valer, a mesma visita, para os outros separadores; apagado quando a conversa termina
 *     ou recomeça).
 * Depois de o cliente iniciar o chat, envia à equipa a página em que está, o carrinho da loja e, se abriu o chat
 * nesta visita (neste separador ou noutro), há quanto tempo o abriu e quantas páginas viu desde então; enquanto a
 * conversa estiver guardada, também nas visitas seguintes (a página e o carrinho, sem a hora).
 * Nenhum texto do cliente ou da equipa é interpretado como HTML.
 */
(function () {
  "use strict";
  if (window.__ldoChatLoaded) return;
  window.__ldoChatLoaded = true;

  /* I18N:start */
  // Textos do chat nas 5 línguas (testados em tests/site-chat-widget.cjs: as mesmas chaves e marcadores em todas).
  // Marcadores: {brand}, {name}, {email}, {n}, {price}, {status}, {hours}. Francês com espaço inseparável
  // ( ) antes de ? ! : ;. Os erros "err_<código>" correspondem ao "code" das respostas da API.
  var I18N = {
    pt: {
      title: "Fale connosco",
      subtitle: "A equipa da {brand} responde aqui.",
      welcome: "Olá! Em que podemos ajudar?",
      button: "Fale connosco",
      privacyText: "Ao iniciar a conversa aceita a nossa Política de privacidade. Para o podermos ajudar, a equipa vê a página em que está e o seu carrinho.",
      privacyLink: "Ler a política",
      offlineMessage: "Neste momento estamos fora do horário de atendimento. Deixe a sua mensagem: respondemos assim que possível e enviamos também a resposta para o seu email.",
      name: "Nome",
      email: "Email",
      message: "Mensagem",
      start: "Iniciar conversa",
      sending: "A enviar…",
      close: "Fechar o chat",
      messages: "Mensagens",
      typingTeam: "A equipa está a escrever…",
      typingAgent: "{name} está a escrever…",
      placeholder: "Escreva a sua mensagem…",
      send: "Enviar",
      end: "Terminar conversa",
      endDialog: "Terminar a conversa",
      endTitle: "Terminar a conversa?",
      endText: "A conversa fica guardada. Se lhe respondermos depois, enviamos a resposta para o seu email.",
      endCopy: "Enviar-me uma cópia desta conversa por email",
      endCancel: "Continuar a conversar",
      ending: "A terminar…",
      thanks: "Obrigado por falar connosco!",
      emailed: "Enviámos uma cópia da conversa para {email}.",
      emailFailed: "Não foi possível enviar a cópia por email neste momento.",
      anythingElse: "Se precisar de mais alguma coisa, estamos aqui.",
      newChat: "Iniciar nova conversa",
      fromPrice: "desde {price}",
      soldOut: "Esgotado",
      viewProduct: "Ver produto",
      failed: "Não enviada",
      retry: "Tentar de novo",
      unreadOne: "1 mensagem nova",
      unreadMany: "{n} mensagens novas",
      offHours: "Fora do horário de atendimento",
      talkingTo: "A falar com {name}",
      hours: "Horário: {hours}",
      lisbonTime: "(hora de Lisboa)",
      weekdays: "Seg. a sex.",
      saturday: "Sáb.",
      sunday: "Dom.",
      transferred: "A conversa foi transferida para {name}.",
      someoneElse: "outra pessoa da equipa",
      surveyRequest: "Obrigado por falar connosco! Como avalia o atendimento de {name}?",
      surveyRequestNoName: "Obrigado por falar connosco! Como avalia o nosso atendimento?",
      surveyThanks: "Obrigado pela sua avaliação!",
      surveyStar: "{n} de 5",
      err_network: "Sem ligação. Verifique a internet e tente novamente.",
      err_status: "O chat está indisponível de momento (erro {status}). Tente novamente dentro de instantes.",
      err_chat_unavailable: "O chat está indisponível de momento. Tente novamente dentro de instantes.",
      err_origin_not_allowed: "O chat não está disponível neste site.",
      err_invalid_request: "Pedido inválido.",
      err_request_too_large: "Pedido demasiado grande.",
      err_name_required: "Indique o seu nome.",
      err_email_invalid: "Indique um email válido (para lhe podermos responder).",
      err_message_required: "Escreva a sua mensagem.",
      err_message_too_long: "Mensagem demasiado longa (máximo 2000 caracteres).",
      err_session_invalid: "Sessão do chat inválida. Inicie uma nova conversa.",
      err_conversation_unavailable: "Esta conversa já não está disponível. Inicie uma nova.",
      err_too_many_chats: "Demasiadas conversas iniciadas. Tente novamente mais tarde.",
      err_too_many_messages: "Enviou muitas mensagens seguidas. Aguarde um pouco.",
      err_survey_closed: "Esta avaliação já não está disponível.",
      err_rating_invalid: "Escolha de 1 a 5 estrelas.",
    },
    en: {
      title: "Chat with us",
      subtitle: "The {brand} team replies here.",
      welcome: "Hello! How can we help you?",
      button: "Chat with us",
      privacyText: "By starting the chat, you accept our Privacy Policy. To help you, our team can see the page you are on and your cart.",
      privacyLink: "Read the policy",
      offlineMessage: "We are currently outside our opening hours. Please leave us a message: we will reply as soon as possible and also send our reply to your email address.",
      name: "Name",
      email: "Email",
      message: "Message",
      start: "Start chat",
      sending: "Sending…",
      close: "Close chat",
      messages: "Messages",
      typingTeam: "The team is typing…",
      typingAgent: "{name} is typing…",
      placeholder: "Type your message…",
      send: "Send",
      end: "End chat",
      endDialog: "End the chat",
      endTitle: "End the chat?",
      endText: "The conversation will be saved. If we reply later, we will send our reply to your email address.",
      endCopy: "Email me a copy of this conversation",
      endCancel: "Keep chatting",
      ending: "Ending…",
      thanks: "Thank you for chatting with us!",
      emailed: "We have sent a copy of the conversation to {email}.",
      emailFailed: "We couldn’t email you a copy right now.",
      anythingElse: "If you need anything else, we’re here to help.",
      newChat: "Start a new chat",
      fromPrice: "from {price}",
      soldOut: "Sold out",
      viewProduct: "View product",
      failed: "Not sent",
      retry: "Try again",
      unreadOne: "1 new message",
      unreadMany: "{n} new messages",
      offHours: "Outside opening hours",
      talkingTo: "Chatting with {name}",
      hours: "Opening hours: {hours}",
      lisbonTime: "(Lisbon time)",
      weekdays: "Mon–Fri",
      saturday: "Sat",
      sunday: "Sun",
      transferred: "Your conversation has been transferred to {name}.",
      someoneElse: "another member of our team",
      surveyRequest: "Thank you for talking to us! How would you rate {name}’s help?",
      surveyRequestNoName: "Thank you for talking to us! How would you rate our help?",
      surveyThanks: "Thank you for your feedback!",
      surveyStar: "{n} of 5",
      err_network: "No connection. Please check your internet connection and try again.",
      err_status: "The chat is unavailable at the moment (error {status}). Please try again shortly.",
      err_chat_unavailable: "The chat is unavailable at the moment. Please try again shortly.",
      err_origin_not_allowed: "The chat is not available on this site.",
      err_invalid_request: "Invalid request. Please try again.",
      err_request_too_large: "The request is too large.",
      err_name_required: "Please enter your name.",
      err_email_invalid: "Please enter a valid email address so that we can reply to you.",
      err_message_required: "Please write your message.",
      err_message_too_long: "Your message is too long (maximum 2,000 characters).",
      err_session_invalid: "This chat session is no longer valid. Please start a new chat.",
      err_conversation_unavailable: "This conversation is no longer available. Please start a new one.",
      err_too_many_chats: "Too many chats have been started. Please try again later.",
      err_too_many_messages: "You have sent several messages in a row. Please wait a moment.",
      err_survey_closed: "This rating is no longer available.",
      err_rating_invalid: "Please choose 1 to 5 stars.",
    },
    es: {
      title: "Hable con nosotros",
      subtitle: "El equipo de {brand} le responde aquí.",
      welcome: "¡Hola! ¿En qué podemos ayudarle?",
      button: "Hable con nosotros",
      privacyText: "Al iniciar la conversación, acepta nuestra Política de privacidad. Para poder ayudarle, nuestro equipo ve la página en la que se encuentra y su carrito.",
      privacyLink: "Leer la política",
      offlineMessage: "En este momento estamos fuera del horario de atención. Déjenos su mensaje: le responderemos lo antes posible y también le enviaremos la respuesta a su correo electrónico.",
      name: "Nombre",
      email: "Correo electrónico",
      message: "Mensaje",
      start: "Iniciar conversación",
      sending: "Enviando…",
      close: "Cerrar el chat",
      messages: "Mensajes",
      typingTeam: "El equipo está escribiendo…",
      typingAgent: "{name} está escribiendo…",
      placeholder: "Escriba su mensaje…",
      send: "Enviar",
      end: "Finalizar conversación",
      endDialog: "Finalizar la conversación",
      endTitle: "¿Finalizar la conversación?",
      endText: "La conversación quedará guardada. Si le respondemos más tarde, le enviaremos la respuesta a su correo electrónico.",
      endCopy: "Enviarme una copia de esta conversación por correo electrónico",
      endCancel: "Seguir conversando",
      ending: "Finalizando…",
      thanks: "¡Gracias por contactar con nosotros!",
      emailed: "Hemos enviado una copia de la conversación a {email}.",
      emailFailed: "No ha sido posible enviar la copia por correo electrónico en este momento.",
      anythingElse: "Si necesita algo más, aquí estamos.",
      newChat: "Iniciar una nueva conversación",
      fromPrice: "desde {price}",
      soldOut: "Agotado",
      viewProduct: "Ver producto",
      failed: "No enviado",
      retry: "Reintentar",
      unreadOne: "1 mensaje nuevo",
      unreadMany: "{n} mensajes nuevos",
      offHours: "Fuera del horario de atención",
      talkingTo: "Le atiende {name}",
      hours: "Horario: {hours}",
      lisbonTime: "(hora de Lisboa)",
      weekdays: "Lun. a vie.",
      saturday: "Sáb.",
      sunday: "Dom.",
      transferred: "Su conversación se ha transferido a {name}.",
      someoneElse: "otra persona del equipo",
      surveyRequest: "¡Gracias por hablar con nosotros! ¿Cómo valora la atención de {name}?",
      surveyRequestNoName: "¡Gracias por hablar con nosotros! ¿Cómo valora nuestra atención?",
      surveyThanks: "¡Gracias por su valoración!",
      surveyStar: "{n} de 5",
      err_network: "Sin conexión. Compruebe su conexión a internet e inténtelo de nuevo.",
      err_status: "El chat no está disponible en este momento (error {status}). Inténtelo de nuevo en unos instantes.",
      err_chat_unavailable: "El chat no está disponible en este momento. Inténtelo de nuevo en unos instantes.",
      err_origin_not_allowed: "El chat no está disponible en este sitio web.",
      err_invalid_request: "Solicitud no válida. Inténtelo de nuevo.",
      err_request_too_large: "La solicitud es demasiado grande.",
      err_name_required: "Indique su nombre.",
      err_email_invalid: "Indique un correo electrónico válido para que podamos responderle.",
      err_message_required: "Escriba su mensaje.",
      err_message_too_long: "El mensaje es demasiado largo (máximo 2000 caracteres).",
      err_session_invalid: "La sesión del chat ya no es válida. Inicie una nueva conversación.",
      err_conversation_unavailable: "Esta conversación ya no está disponible. Inicie una nueva.",
      err_too_many_chats: "Se han iniciado demasiadas conversaciones. Inténtelo de nuevo más tarde.",
      err_too_many_messages: "Ha enviado muchos mensajes seguidos. Espere un momento, por favor.",
      err_survey_closed: "Esta valoración ya no está disponible.",
      err_rating_invalid: "Elija de 1 a 5 estrellas.",
    },
    fr: {
      title: "Contactez-nous",
      subtitle: "L’équipe {brand} vous répond ici.",
      welcome: "Bonjour ! Comment pouvons-nous vous aider ?",
      button: "Contactez-nous",
      privacyText: "En démarrant la conversation, vous acceptez notre Politique de confidentialité. Pour mieux vous aider, notre équipe voit la page que vous consultez et votre panier.",
      privacyLink: "Lire la politique",
      offlineMessage: "Nous sommes actuellement en dehors de nos horaires d’ouverture. Laissez-nous votre message : nous vous répondrons dès que possible et vous enverrons aussi notre réponse par e-mail.",
      name: "Nom",
      email: "E-mail",
      message: "Message",
      start: "Démarrer la conversation",
      sending: "Envoi en cours…",
      close: "Fermer le chat",
      messages: "Messages",
      typingTeam: "L’équipe est en train d’écrire…",
      typingAgent: "{name} est en train d’écrire…",
      placeholder: "Écrivez votre message…",
      send: "Envoyer",
      end: "Terminer la conversation",
      endDialog: "Terminer la conversation",
      endTitle: "Terminer la conversation ?",
      endText: "La conversation reste enregistrée. Si nous vous répondons plus tard, nous vous enverrons notre réponse par e-mail.",
      endCopy: "M’envoyer une copie de cette conversation par e-mail",
      endCancel: "Continuer la conversation",
      ending: "Fermeture en cours…",
      thanks: "Merci de nous avoir contactés !",
      emailed: "Nous avons envoyé une copie de la conversation à {email}.",
      emailFailed: "Nous n’avons pas pu envoyer la copie par e-mail pour le moment.",
      anythingElse: "Si vous avez besoin d’autre chose, nous sommes là.",
      newChat: "Démarrer une nouvelle conversation",
      fromPrice: "à partir de {price}",
      soldOut: "Épuisé",
      viewProduct: "Voir le produit",
      failed: "Non envoyé",
      retry: "Réessayer",
      unreadOne: "1 nouveau message",
      unreadMany: "{n} nouveaux messages",
      offHours: "En dehors des horaires d’ouverture",
      talkingTo: "En conversation avec {name}",
      hours: "Horaires : {hours}",
      lisbonTime: "(heure de Lisbonne)",
      weekdays: "Lun. au ven.",
      saturday: "Sam.",
      sunday: "Dim.",
      transferred: "Votre conversation a été transférée à {name}.",
      someoneElse: "un autre membre de l’équipe",
      surveyRequest: "Merci d’avoir échangé avec nous ! Comment évaluez-vous l’aide de {name} ?",
      surveyRequestNoName: "Merci d’avoir échangé avec nous ! Comment évaluez-vous notre aide ?",
      surveyThanks: "Merci pour votre avis !",
      surveyStar: "{n} sur 5",
      err_network: "Pas de connexion. Veuillez vérifier votre connexion Internet et réessayer.",
      err_status: "Le chat est momentanément indisponible (erreur {status}). Veuillez réessayer dans quelques instants.",
      err_chat_unavailable: "Le chat est momentanément indisponible. Veuillez réessayer dans quelques instants.",
      err_origin_not_allowed: "Le chat n’est pas disponible sur ce site.",
      err_invalid_request: "Requête non valide. Veuillez réessayer.",
      err_request_too_large: "La requête est trop volumineuse.",
      err_name_required: "Veuillez indiquer votre nom.",
      err_email_invalid: "Veuillez indiquer une adresse e-mail valide afin que nous puissions vous répondre.",
      err_message_required: "Veuillez écrire votre message.",
      err_message_too_long: "Votre message est trop long (2 000 caractères maximum).",
      err_session_invalid: "Cette session de chat n’est plus valide. Veuillez démarrer une nouvelle conversation.",
      err_conversation_unavailable: "Cette conversation n’est plus disponible. Veuillez en démarrer une nouvelle.",
      err_too_many_chats: "Trop de conversations ont été démarrées. Veuillez réessayer plus tard.",
      err_too_many_messages: "Vous avez envoyé plusieurs messages à la suite. Veuillez patienter un instant.",
      err_survey_closed: "Cette évaluation n’est plus disponible.",
      err_rating_invalid: "Choisissez de 1 à 5 étoiles.",
    },
    de: {
      title: "Schreiben Sie uns",
      subtitle: "Das Team von {brand} antwortet Ihnen hier.",
      welcome: "Guten Tag! Wie können wir Ihnen helfen?",
      button: "Schreiben Sie uns",
      privacyText: "Mit dem Start des Chats akzeptieren Sie unsere Datenschutzerklärung. Damit wir Ihnen helfen können, sieht unser Team die Seite, auf der Sie sich befinden, und Ihren Warenkorb.",
      privacyLink: "Datenschutzerklärung lesen",
      offlineMessage: "Wir sind gerade außerhalb unserer Servicezeiten. Hinterlassen Sie uns gerne eine Nachricht: Wir antworten so schnell wie möglich und senden Ihnen die Antwort auch per E-Mail.",
      name: "Name",
      email: "E-Mail",
      message: "Nachricht",
      start: "Chat starten",
      sending: "Wird gesendet…",
      close: "Chat schließen",
      messages: "Nachrichten",
      typingTeam: "Das Team schreibt…",
      typingAgent: "{name} schreibt…",
      placeholder: "Schreiben Sie Ihre Nachricht…",
      send: "Senden",
      end: "Chat beenden",
      endDialog: "Chat beenden",
      endTitle: "Chat beenden?",
      endText: "Der Chat bleibt gespeichert. Wenn wir Ihnen später antworten, senden wir Ihnen die Antwort per E-Mail.",
      endCopy: "Eine Kopie dieses Chats per E-Mail erhalten",
      endCancel: "Weiter chatten",
      ending: "Wird beendet…",
      thanks: "Vielen Dank, dass Sie uns kontaktiert haben!",
      emailed: "Wir haben eine Kopie des Chats an {email} gesendet.",
      emailFailed: "Die Kopie konnte gerade nicht per E-Mail gesendet werden.",
      anythingElse: "Wenn Sie noch etwas brauchen, sind wir gerne für Sie da.",
      newChat: "Neuen Chat starten",
      fromPrice: "ab {price}",
      soldOut: "Ausverkauft",
      viewProduct: "Produkt ansehen",
      failed: "Nicht gesendet",
      retry: "Erneut versuchen",
      unreadOne: "1 neue Nachricht",
      unreadMany: "{n} neue Nachrichten",
      offHours: "Außerhalb der Servicezeiten",
      talkingTo: "Sie chatten mit {name}",
      hours: "Servicezeiten: {hours}",
      lisbonTime: "(Lissabonner Zeit)",
      weekdays: "Mo.–Fr.",
      saturday: "Sa.",
      sunday: "So.",
      transferred: "Ihr Chat wurde an {name} übergeben.",
      someoneElse: "eine andere Person aus unserem Team",
      surveyRequest: "Danke, dass Sie uns geschrieben haben! Wie bewerten Sie die Beratung durch {name}?",
      surveyRequestNoName: "Danke, dass Sie uns geschrieben haben! Wie bewerten Sie unsere Beratung?",
      surveyThanks: "Vielen Dank für Ihre Bewertung!",
      surveyStar: "{n} von 5",
      err_network: "Keine Verbindung. Bitte prüfen Sie Ihre Internetverbindung und versuchen Sie es erneut.",
      err_status: "Der Chat ist im Moment nicht verfügbar (Fehler {status}). Bitte versuchen Sie es gleich noch einmal.",
      err_chat_unavailable: "Der Chat ist im Moment nicht verfügbar. Bitte versuchen Sie es gleich noch einmal.",
      err_origin_not_allowed: "Der Chat ist auf dieser Website nicht verfügbar.",
      err_invalid_request: "Ungültige Anfrage. Bitte versuchen Sie es erneut.",
      err_request_too_large: "Die Anfrage ist zu groß.",
      err_name_required: "Bitte geben Sie Ihren Namen ein.",
      err_email_invalid: "Bitte geben Sie eine gültige E-Mail-Adresse ein, damit wir Ihnen antworten können.",
      err_message_required: "Bitte schreiben Sie Ihre Nachricht.",
      err_message_too_long: "Ihre Nachricht ist zu lang (maximal 2000 Zeichen).",
      err_session_invalid: "Diese Chat-Sitzung ist nicht mehr gültig. Bitte starten Sie einen neuen Chat.",
      err_conversation_unavailable: "Dieser Chat ist nicht mehr verfügbar. Bitte starten Sie einen neuen.",
      err_too_many_chats: "Es wurden zu viele Chats gestartet. Bitte versuchen Sie es später erneut.",
      err_too_many_messages: "Sie haben viele Nachrichten hintereinander gesendet. Bitte warten Sie einen Moment.",
      err_survey_closed: "Diese Bewertung ist nicht mehr verfügbar.",
      err_rating_invalid: "Bitte wählen Sie 1 bis 5 Sterne.",
    },
  };
  var INTL = { pt: "pt-PT", en: "en-GB", es: "es-ES", fr: "fr-FR", de: "de-DE" };
  var BRANDS = { ldo: "Loja do Ouro", gsp: "Gold Store Premium" };
  // Respostas de um servidor sem "code" (versões antigas): o texto em português dá o código.
  var SERVER_ERRORS = {
    "Pedido inválido.": "invalid_request",
    "Pedido demasiado grande.": "request_too_large",
    "Origem não autorizada.": "origin_not_allowed",
    "Indique o seu nome.": "name_required",
    "Indique um email válido.": "email_invalid",
    "Escreva a sua mensagem.": "message_required",
    "Mensagem demasiado longa.": "message_too_long",
    "Mensagem demasiado longa (máximo 2000 caracteres).": "message_too_long",
    "Sessão do chat inválida. Inicie uma nova conversa.": "session_invalid",
    "Esta conversa já não está disponível. Inicie uma nova.": "conversation_unavailable",
    "O chat está indisponível de momento.": "chat_unavailable",
    "O chat está indisponível de momento. Tente novamente dentro de instantes.": "chat_unavailable",
    "Demasiadas conversas iniciadas. Tente novamente mais tarde.": "too_many_chats",
    "Enviou muitas mensagens seguidas. Aguarde um pouco.": "too_many_messages",
  };

  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  // Site: o domínio decide (a Shopify manda cada cliente para o domínio do seu país). lojadoouro.pt é a Loja do
  // Ouro e goldstorepremium.com a Gold Store Premium, em qualquer língua; na pré-visualização do tema (myshopify)
  // e noutros endereços, conta o país do cliente. A configuração (página de teste) pode fixar o site.
  function pickSite(c) {
    c = c || {};
    if (c.site === "ldo" || c.site === "gsp") return c.site;
    if (c.brand === BRANDS.gsp) return "gsp";
    if (c.brand === BRANDS.ldo) return "ldo";
    var h = String(location.hostname || "").toLowerCase();
    if (/(^|\.)goldstorepremium\.com$/.test(h)) return "gsp";
    if (/(^|\.)lojadoouro\.pt$/.test(h)) return "ldo";
    var country = pickCountry(c);
    return country && country !== "PT" ? "gsp" : "ldo";
  }
  function pickBrand(c) { return BRANDS[pickSite(c)]; }
  function pickCountry(c) {
    var list = [window.Shopify && window.Shopify.country, c && c.country];
    for (var i = 0; i < list.length; i++) if (typeof list[i] === "string" && /^[A-Z]{2}$/.test(list[i])) return list[i];
    return null;
  }
  // "pt-PT" → pt, "EN" → en; outra língua → en; vazio ou lixo → null (passa ao sinal seguinte).
  function langOf(v) {
    var m = /^([a-z]{2,3})(?:[-_][a-z0-9]{1,8})*$/.exec(String(v || "").trim().toLowerCase());
    return !m ? null : has(I18N, m[1]) ? m[1] : "en";
  }
  // Língua: a da configuração (página de teste), a da página (<html lang>, que o tema preenche com a língua da
  // loja), a da Shopify, o prefixo do endereço (/en/, /es/, /fr/, /de/, /pt-pt/) e, por fim, a do site.
  function pickLang(c, site) {
    var S = window.Shopify || {};
    var prefix = /^\/([a-z]{2})(?:-[a-z]{2})?(?:\/|$)/i.exec(location.pathname || "");
    var list = [c && c.lang, document.documentElement && document.documentElement.lang, S.locale,
      prefix && has(I18N, prefix[1].toLowerCase()) ? prefix[1] : null];
    for (var i = 0; i < list.length; i++) {
      var lang = langOf(list[i]);
      if (lang) return lang;
    }
    return site === "gsp" ? "en" : "pt";
  }

  // Cartão de produto: abre na loja onde o cliente está (domínio e língua), como o nome e o preço que mostra; as
  // ligações do catálogo da equipa são as da Loja do Ouro, em português. Fora da loja (página de teste), a original.
  function productHref(url, link) {
    var S = window.Shopify;
    if (!S || !location.origin) return url;
    var root = (S.routes && typeof S.routes.root === "string" && /^\/[a-z0-9/-]*$/i.test(S.routes.root) ? S.routes.root : "/").replace(/\/?$/, "/");
    return location.origin + root + "products/" + link.handle + (link.variant ? "?variant=" + link.variant : "");
  }

  function t(key, vars) {
    var table = I18N[LANG] || I18N.en;
    var s = has(table, key) ? table[key] : has(I18N.en, key) ? I18N.en[key] : "";
    return s.replace(/\{(\w+)\}/g, function (all, k) {
      return k === "brand" ? BRAND : vars && vars[k] != null ? String(vars[k]) : "";
    });
  }
  // Textos do tema (escritos em português): só em português, com a marca do site; nas outras línguas, os da tabela.
  function themeText(value, key) {
    return LANG === "pt" && typeof value === "string" && value.trim() ? value.replace(/Loja do Ouro/g, BRAND) : t(key);
  }
  // Erro da API: o "code" (servidor novo), o texto em português conhecido (servidor antigo) ou, noutras línguas,
  // o aviso genérico (o cliente nunca vê português quando a página não está em português).
  function errorText(data, status) {
    var code = data && typeof data.code === "string" && /^[a-z0-9_]{1,40}$/.test(data.code) ? data.code : "";
    var message = data && typeof data.error === "string" ? data.error : "";
    if (!code || !has(I18N.pt, "err_" + code)) code = has(SERVER_ERRORS, message) ? SERVER_ERRORS[message] : "";
    if (code) return t("err_" + code);
    if (message) return LANG === "pt" ? message : t("err_chat_unavailable");
    return status ? t("err_status", { status: status }) : "";
  }
  // Pedido de avaliação: { kind: "survey", agent_first, rated } (primeiro nome de quem atendeu; sem nome, o texto geral).
  function surveyText(m) {
    var name = typeof m.agent_first === "string" && m.agent_first.trim() ? m.agent_first.trim().slice(0, 40) : "";
    return name ? t("surveyRequest", { name: name }) : t("surveyRequestNoName");
  }
  // Aviso de transferência: { kind: "transfer", to_first } ou, num servidor antigo, só o texto em português.
  function noticeText(m) {
    var body = String(m.body || "");
    if (m.kind === "survey") return m.rated ? t("surveyThanks") : surveyText(m);
    if (m.kind === "transfer") {
      return t("transferred", { name: typeof m.to_first === "string" && m.to_first.trim() ? m.to_first.trim().slice(0, 40) : t("someoneElse") });
    }
    var x = /^A conversa foi transferida para (.+)\.$/.exec(body);
    if (x) return t("transferred", { name: x[1] === I18N.pt.someoneElse ? t("someoneElse") : x[1] });
    return body;
  }
  /* I18N:end */

  // Contador de visita das versões anteriores (gravado em todas as páginas, mesmo sem chat): apaga-se ao carregar,
  // antes de tudo (também onde o chat está escondido), sem gravar mais nada.
  dropLegacyVisit();

  var raw = rawConfig();
  var SITE = pickSite(raw);
  var LANG = pickLang(raw, SITE);
  var BRAND = BRANDS[SITE];
  var COUNTRY = pickCountry(raw);
  var cfg = readConfig(raw);
  if (!cfg || cfg.enabled === false) return;
  // Chatbot antigo (Bluedot): a secção do tema impede-o de carregar, mas se o cliente mexer na página antes de
  // o rodapé chegar ao browser ele ainda carrega; nesse caso fica escondido.
  if (cfg.hideOld) hideOldChatbot();
  // Também sem o prefixo da língua (/en/, /pt-pt/…): "/cart" esconde o chat em /cart, /en/cart e /pt-pt/cart.
  var path = location.pathname || "/";
  var barePath = path.replace(/^\/[a-z]{2}(?:-[a-z]{2})?(?=\/|$)/i, "") || "/";
  if (cfg.hideOn.some(function (p) { return p && (path.indexOf(p) === 0 || barePath.indexOf(p) === 0); })) return;
  if (cfg.mobile === false && window.matchMedia("(max-width: 749px)").matches) return;

  var API = String(cfg.api || "").replace(/\/+$/, "");
  var STORE_KEY = "ldo-chat:v1";
  var OPEN_KEY = "ldo-chat:aberto";
  var VISIT_KEY = "ldo-chat:visita-chat";
  var POLL_OPEN = 3500;
  var POLL_CLOSED = 30000;
  var VISIT_GAP = 30 * 60 * 1000;

  var state = {
    session: load(),        // { token, name, verifiedEmail, seenAt, visit? }
    messages: [],           // { id, from, author, key, body, created_at, inserted_at, local?, pending?, failed?, clientKey? }
    lastInserted: null,
    typing: false,
    agent: null,            // primeiro nome de quem está a atender
    ended: null,            // conversa terminada agora: { wanted, emailed, email } para o agradecimento
    open: false,
    busy: false,
    error: "",
    timer: null,
    failures: 0,
    startKey: null,
    cartSig: null,
    destroyed: false,
  };
  // Visita desde que o cliente abriu o chat (null enquanto não o abrir neste separador).
  var visit = null;

  // Conversa confirmada de outro cliente (sessão terminada ou outra pessoa no mesmo browser): recomeça.
  var currentIdentity = cfg.identity ? String(cfg.identity.email || "").toLowerCase() : "";
  if (state.session && state.session.verifiedEmail && state.session.verifiedEmail !== currentIdentity) {
    state.session = null;
    save(); // apaga o token antigo; não grava nada
  }
  // Visita partilhada que já acabou (30 minutos sem atividade): sai de "ldo-chat:v1" (só se apaga).
  if (state.session && state.session.visit !== undefined && !sharedVisit(state.session)) save();
  visit = continueVisit();
  if (visit) saveVisit();

  // ------------------------------------------------------------ configuração e armazenamento

  function rawConfig() {
    var el = document.getElementById("ldo-chat-config");
    var c = window.LDO_CHAT_CONFIG || null;
    if (el) {
      try { c = JSON.parse(el.textContent || "{}"); } catch (e) { c = null; }
    }
    return c && typeof c === "object" ? c : null;
  }
  function readConfig(c) {
    if (!c) return null;
    return {
      enabled: c.enabled !== false,
      api: c.api || "",
      title: themeText(c.title, "title"),
      subtitle: themeText(c.subtitle, "subtitle"),
      welcome: themeText(c.welcome, "welcome"),
      button: c.button ? themeText(c.button, "button") : "",
      color: safeColor(c.color, "#a47a37"),
      textColor: safeColor(c.textColor, "#ffffff"),
      logo: typeof c.logo === "string" && /^(https:)?\/\//.test(c.logo) ? c.logo : "",
      position: c.position === "left" ? "left" : "right",
      offset: clampNum(c.offset, 8, 200, 20),
      offsetSide: clampNum(c.offsetSide, 8, 200, 20),
      privacyUrl: typeof c.privacyUrl === "string" ? c.privacyUrl : "",
      privacyText: themeText(c.privacyText, "privacyText"),
      offlineMessage: themeText(c.offlineMessage, "offlineMessage"),
      hours: c.hours || {},
      hideOn: Array.isArray(c.hideOn) ? c.hideOn : String(c.hideOn || "").split(/[\n,]/).map(function (s) { return s.trim(); }).filter(Boolean),
      mobile: c.mobile !== false,
      identity: c.identity && c.identity.sig ? c.identity : null,
      customer: c.customer || null,
      hideOld: c.hideOld === true,
      // Só a página de teste do dashboard fixa o site; na loja, o servidor vê-o pelo domínio.
      site: c.site === "ldo" || c.site === "gsp" ? c.site : "",
    };
  }
  function hideOldChatbot() {
    if (document.getElementById("ldo-chat-hide-old")) return;
    var style = document.createElement("style");
    style.id = "ldo-chat-hide-old";
    style.textContent = "#aichatbot_ra_div_id { display: none !important; }";
    (document.head || document.documentElement).appendChild(style);
  }
  function safeColor(v, d) { return typeof v === "string" && /^#[0-9a-fA-F]{3,8}$/.test(v) ? v : d; }
  function clampNum(v, min, max, d) { var n = Number(v); return isFinite(n) && n >= min && n <= max ? n : d; }

  // Armazenamento do browser: "local" (localStorage, por omissão) ou "session" (sessionStorage). O acesso fica dentro
  // do try: com o armazenamento bloqueado, até ler window.localStorage dá erro (e tudo vale só nesta página).
  function storageOf(kind) { return kind === "session" ? window.sessionStorage : window.localStorage; }
  function readStore(key, kind) {
    try { return JSON.parse(storageOf(kind).getItem(key) || "null"); } catch (e) { return null; }
  }
  function writeStore(key, value, kind) {
    try {
      if (value == null) storageOf(kind).removeItem(key);
      else storageOf(kind).setItem(key, JSON.stringify(value));
    } catch (e) { /* sem armazenamento: vale só nesta página */ }
  }
  function dropLegacyVisit() {
    try {
      var ls = storageOf("local");
      if (ls.getItem("ldo-chat:visita") !== null) ls.removeItem("ldo-chat:visita");
    } catch (e) { /* sem armazenamento: nada a apagar */ }
  }
  function load() {
    var s = readStore(STORE_KEY);
    return s && typeof s.token === "string" ? s : null;
  }
  // Grava a conversa (sem conversa, apaga-a). A visita partilhada (s.visit) é a deste separador ou, sem ela, a que já
  // está gravada por outro separador (lida agora, não a da memória), enquanto valer.
  function save() {
    var s = null;
    if (state.session) {
      s = {};
      for (var k in state.session) if (k !== "visit" && Object.prototype.hasOwnProperty.call(state.session, k)) s[k] = state.session[k];
      var v = visitToShare(load());
      if (v) s.visit = v;
    }
    writeStore(STORE_KEY, s);
  }

  // Visita: só começa quando o cliente abre o chat (startVisit, nunca antes) e conta as páginas a partir daí. Fica no
  // sessionStorage do separador em que o cliente abriu o chat e continua nas páginas seguintes desse separador. Com uma
  // conversa iniciada, fica também dentro de "ldo-chat:v1" (localStorage, que só existe com a conversa) para os outros
  // separadores: um separador novo (um produto ou uma ligação do chat abertos noutro separador, Ctrl+clique) envia a
  // mesma hora de abertura, sem contar páginas e sem gravar nada; se o cliente abrir o chat lá, a visita continua. Acaba
  // após 30 minutos sem páginas novas nem contacto com o servidor num separador com o chat aberto nesta visita. Sem
  // visita guardada, ao carregar a página não se grava nada.
  function isVisit(v) {
    return !!v && typeof v.start === "number" && typeof v.pages === "number" && typeof v.last === "number";
  }
  // A visita de outro separador guardada com a conversa (s: o que está em "ldo-chat:v1"), se for desta conversa e
  // ainda valer.
  function sharedVisit(s) {
    var v = s && state.session && s.token === state.session.token ? s.visit : null;
    return isVisit(v) && Date.now() - v.last <= VISIT_GAP ? v : null;
  }
  // A visita a guardar em "ldo-chat:v1": a deste separador (com as páginas que outro separador já contou desta mesma
  // visita) ou, sem ela, a que lá está, enquanto valer.
  function visitToShare(stored) {
    var other = sharedVisit(stored);
    if (!visit) return other ? { start: other.start, pages: other.pages, last: other.last } : null;
    if (other && other.start === visit.start) {
      visit.pages = Math.max(visit.pages, other.pages);
      visit.last = Math.max(visit.last, other.last);
    }
    return { start: visit.start, pages: visit.pages, last: visit.last };
  }
  function continueVisit() {
    var v = readStore(VISIT_KEY, "session");
    if (!isVisit(v)) return null;
    var now = Date.now();
    if (now - v.last > VISIT_GAP) { writeStore(VISIT_KEY, null, "session"); return null; }
    // Noutro separador o cliente pode ter visto mais páginas desta visita: conta a partir daí.
    var other = sharedVisit(load());
    if (other && other.start === v.start && other.pages > v.pages) v.pages = other.pages;
    v.pages += 1;
    v.last = now;
    return v;
  }
  // Grava a visita deste separador e, com a conversa guardada neste browser, partilha-a (só o campo "visit" de
  // "ldo-chat:v1": o resto pode ter sido mudado por outro separador).
  function saveVisit() {
    var stored = state.session ? load() : null;
    var shared = visitToShare(stored);
    writeStore(VISIT_KEY, visit, "session");
    if (stored && stored.token === state.session.token) {
      stored.visit = shared;
      writeStore(STORE_KEY, stored);
    }
  }
  // O cliente abriu o chat: a visita começa agora, com esta página, ou continua a que começou noutro separador desta
  // conversa (true se começou ou continuou agora neste separador).
  function startVisit() {
    if (visit) return false;
    var now = Date.now();
    var other = sharedVisit(load());
    visit = other ? { start: other.start, pages: other.pages + 1, last: now } : { start: now, pages: 1, last: now };
    saveVisit();
    return true;
  }
  function touchVisit() {
    if (!visit) return;
    visit.last = Date.now();
    saveVisit();
  }
  // Fechado sem conversa: a visita acaba aqui (se o cliente voltar a abrir o chat, conta desde esse momento).
  function dropVisit() {
    if (!visit) return;
    visit = null;
    writeStore(VISIT_KEY, null, "session");
  }

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    var b = new Uint8Array(16);
    crypto.getRandomValues(b);
    b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    var h = Array.prototype.map.call(b, function (x) { return (x + 256).toString(16).slice(1); }).join("");
    return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
  }

  // ------------------------------------------------------------ horário (hora de Lisboa)

  var DAY_KEYS = ["sunday", "weekdays", "weekdays", "weekdays", "weekdays", "weekdays", "saturday"];
  function lisbonNow() {
    var parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Lisbon", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
    var get = function (t) { var p = parts.find(function (x) { return x.type === t; }); return p ? p.value : ""; };
    var day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
    return { day: day, minutes: (Number(get("hour")) % 24) * 60 + Number(get("minute")) };
  }
  function ranges(text) {
    return String(text || "").split(/[;,]/).map(function (r) {
      var m = /^\s*(\d{1,2})[:h](\d{2})\s*[-–]\s*(\d{1,2})[:h](\d{2})\s*$/.exec(r);
      return m ? [Number(m[1]) * 60 + Number(m[2]), Number(m[3]) * 60 + Number(m[4])] : null;
    }).filter(Boolean);
  }
  function isOpenNow() {
    var h = cfg.hours || {};
    if (!h.weekdays && !h.saturday && !h.sunday) return true; // sem horário definido: sempre disponível
    var now = lisbonNow();
    return ranges(h[DAY_KEYS[now.day]]).some(function (r) { return now.minutes >= r[0] && now.minutes < r[1]; });
  }
  function scheduleText() {
    var h = cfg.hours || {};
    var parts = [];
    if (h.weekdays) parts.push(t("weekdays") + " " + h.weekdays);
    if (h.saturday) parts.push(t("saturday") + " " + h.saturday);
    if (h.sunday) parts.push(t("sunday") + " " + h.sunday);
    // O horário é sempre o de Lisboa: fora da loja portuguesa (ou noutra língua) diz-se qual é o fuso.
    if (parts.length && (SITE === "gsp" || LANG !== "pt")) return parts.join(" · ") + " " + t("lisbonTime");
    return parts.join(" · ");
  }

  // ------------------------------------------------------------ servidor

  function identityHeader() {
    try { return btoa(unescape(encodeURIComponent(JSON.stringify(cfg.identity)))); } catch (e) { return ""; }
  }

  function request(method, url, body) {
    var headers = { "Content-Type": "application/json" };
    if (state.session && state.session.token) headers.Authorization = "Bearer " + state.session.token;
    if (cfg.identity) headers["X-LDO-Identity"] = identityHeader();
    // Cookies só no mesmo site (página de teste no dashboard); na loja, o servidor do chat é outro.
    return fetch(API + url, { method: method, headers: headers, body: body ? JSON.stringify(body) : undefined, cache: "no-store", credentials: "same-origin" })
      .catch(function () { throw new Error(t("err_network")); })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (data) {
          if (r.status === 401 && data && data.restart) { var message = errorText(data, 0); restart(message); throw new Error(message); }
          if (!r.ok) throw new Error(errorText(data, r.status));
          return data;
        });
      });
  }

  function restart(message) {
    state.session = null;
    state.messages = [];
    state.lastInserted = null;
    state.typing = false;
    state.agent = null;
    save();
    setError(message || "");
    showMode();
    renderStatus();
  }

  // Cursor com 5 s de margem (respostas que ficam visíveis ao mesmo tempo); as repetidas ignoram-se pelo id.
  function fetchMessages() {
    if (!state.session) return Promise.resolve();
    var after = state.lastInserted ? new Date(Date.parse(state.lastInserted) - 5000).toISOString() : "";
    var q = "?aberto=" + (state.open && !document.hidden ? "1" : "0") + (after ? "&depois=" + encodeURIComponent(after) : "");
    return request("GET", "/api/chat/messages" + q).then(function (r) {
      state.failures = 0;
      var changed = false;
      (r.messages || []).forEach(function (m) { if (merge(m)) changed = true; });
      // Quem está a atender (só o primeiro nome): aparece no topo e no "a escrever".
      var agent = typeof r.agent === "string" && r.agent ? r.agent.slice(0, 40) : null;
      if (agent !== state.agent) { state.agent = agent; renderStatus(); renderTyping(); }
      if (state.typing !== Boolean(r.typing)) { state.typing = Boolean(r.typing); renderTyping(); }
      if (state.open && !document.hidden) markSeen();
      if (changed) renderMessages();
      renderBadge();
      touchVisit();
    });
  }

  function merge(m) {
    if (!state.lastInserted || m.inserted_at > state.lastInserted) state.lastInserted = m.inserted_at;
    for (var i = 0; i < state.messages.length; i++) {
      var x = state.messages[i];
      // Pedido de avaliação respondido (noutro separador): passa a agradecimento.
      if (x.id === m.id && x.kind === "survey" && m.rated && !x.rated) { x.rated = true; return true; }
      if (x.id === m.id) return false;
      // A mensagem local (a enviar ou falhada) com a mesma chave passa a ser a do servidor.
      if (x.local && m.key && x.clientKey === m.key) { state.messages[i] = m; return true; }
    }
    state.messages.push(m);
    state.messages.sort(function (a, b) { return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0; });
    return true;
  }

  function unread() {
    var seen = (state.session && state.session.seenAt) || "";
    return state.messages.filter(function (m) { return m.from === "team" && m.inserted_at > seen; }).length;
  }
  function markSeen() {
    var last = state.messages.filter(function (m) { return m.from === "team"; }).pop();
    if (last && state.session && last.inserted_at !== state.session.seenAt) {
      state.session.seenAt = last.inserted_at;
      save();
    }
  }

  function schedule() {
    clearTimeout(state.timer);
    if (!state.session || document.hidden || state.destroyed) return;
    var wait = (state.open ? POLL_OPEN : POLL_CLOSED) * Math.pow(2, Math.min(state.failures, 4));
    state.timer = setTimeout(function () {
      fetchMessages().catch(function () { state.failures++; }).then(checkCart).then(schedule);
    }, Math.min(wait, 60000));
  }

  // Página, carrinho (lido da própria loja) e visita para a equipa, só com a conversa iniciada e quando mudam.
  function readCart() {
    if (!window.Shopify && !document.querySelector('link[href*="cdn.shopify.com"], script[src*="cdn.shopify.com"]')) return Promise.resolve(undefined);
    var root = (window.Shopify && window.Shopify.routes && window.Shopify.routes.root) || "/";
    return fetch(root + "cart.js", { credentials: "same-origin", cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : undefined; })
      .then(function (c) {
        if (!c || !Array.isArray(c.items)) return undefined;
        return {
          count: Number(c.item_count) || 0,
          total: (Number(c.total_price) || 0) / 100,
          currency: c.currency || "EUR",
          items: c.items.slice(0, 20).map(function (i) {
            return {
              title: String(i.product_title || i.title || "").slice(0, 120),
              variant: i.variant_title && i.variant_title !== "Default Title" ? String(i.variant_title).slice(0, 80) : null,
              quantity: Number(i.quantity) || 1,
              price: (Number(i.final_line_price != null ? i.final_line_price : i.line_price) || 0) / 100,
              url: typeof i.url === "string" ? i.url.split("#")[0] : null,
            };
          }),
        };
      })
      .catch(function () { return undefined; });
  }
  var lastContextAt = 0;
  function sendContext(force) {
    if (!state.session) return Promise.resolve();
    return readCart().then(function (cart) {
      // Sem visita neste separador, a de outro separador desta conversa em que o cliente abriu o chat.
      var other = visit ? null : sharedVisit(load());
      var sig = JSON.stringify(cart || null) + "|" + location.href + "|" + (visit ? visit.start + ":" + visit.pages : other ? other.start + ":" : "");
      if (!force && sig === state.cartSig) return;
      state.cartSig = sig;
      lastContextAt = Date.now();
      return request("POST", "/api/chat/context", {
        page: location.href, title: document.title, cart: cart,
        // Visita: a hora a que o cliente abriu o chat e as páginas vistas desde então. Com o chat aberto só noutro
        // separador, a mesma hora e nenhum "pages" (o servidor mantém a contagem desse separador). Sem o chat aberto
        // nesta visita (conversa de antes), nenhuma hora e "pages: 0": o painel diz que ainda não o abriu.
        visitStartedAt: visit || other ? new Date((visit || other).start).toISOString() : undefined,
        pages: visit ? visit.pages : other ? undefined : 0,
        locale: LANG, country: COUNTRY || undefined,
      }).catch(function () { state.cartSig = null; });
    });
  }
  // A visita começou agora (o cliente abriu o chat): o servidor ignora um contexto a menos de 5 s do anterior,
  // por isso espera-se o que faltar.
  function sendVisitSoon() {
    setTimeout(function () { if (!state.destroyed) sendContext(true); }, Math.max(0, lastContextAt + 5500 - Date.now()));
  }
  var lastCartCheck = 0;
  function checkCart() {
    if (Date.now() - lastCartCheck < 15000) return;
    lastCartCheck = Date.now();
    return sendContext(false);
  }

  function start(name, email, message) {
    if (!state.startKey) state.startKey = uuid();
    state.busy = true;
    setError("");
    renderForm();
    var website = form.website ? form.website.value : "";
    return request("POST", "/api/chat/start", {
      name: name, email: email, message: message, clientKey: state.startKey, page: location.href,
      identity: cfg.identity, website: website,
      // Língua e país do cliente (no corpo: o CORS da API não aceita cabeçalhos novos).
      locale: LANG, country: COUNTRY || undefined, site: cfg.site || undefined,
    }).then(function (r) {
      state.startKey = null;
      form.querySelector("[name=message]").value = "";
      state.session = { token: r.token, name: name, verifiedEmail: r.verified || null, seenAt: "" };
      state.messages = [];
      state.lastInserted = null;
      save();
      showMode();
      sendContext(true);
      return fetchMessages().catch(function () {});
    }).catch(function (e) {
      setError(e.message);
    }).then(function () {
      state.busy = false;
      renderForm();
      schedule();
      focusInput();
    });
  }

  function send(body, existing) {
    var key = existing ? existing.clientKey : uuid();
    var local = existing || { id: "local:" + key, local: true, clientKey: key, from: "visitor", author: null, key: key, body: body, created_at: new Date().toISOString(), inserted_at: "" };
    local.pending = true;
    local.failed = false;
    if (!existing) state.messages.push(local);
    renderMessages();
    return request("POST", "/api/chat/messages", { body: local.body, clientKey: key, page: location.href })
      .then(function () {
        local.pending = false;
        setError("");
        renderMessages();
        // A confirmação veio do servidor: uma falha ao atualizar a lista não torna a mensagem "não enviada".
        return fetchMessages().catch(function () {});
      }, function (e) {
        local.pending = false;
        local.failed = true;
        setError(e.message);
        renderMessages();
      });
  }

  // Estrelas do pedido de avaliação (1 a 5). Um pedido que já fechou (a equipa voltou a escrever, passaram 72 h) sai da
  // lista; outro erro fica visível e as estrelas voltam.
  function rate(m, score) {
    if (m.busy || m.rated) return;
    m.busy = true;
    setError("");
    renderMessages();
    return request("POST", "/api/chat/rating", { survey: m.id, score: score })
      .then(function () { m.rated = true; }, function (e) {
        if (e.message === t("err_survey_closed")) state.messages = state.messages.filter(function (x) { return x !== m; });
        else setError(e.message);
      })
      .then(function () {
        m.busy = false;
        renderMessages();
      });
  }

  // ------------------------------------------------------------ interface (construída uma vez)

  // Elemento próprio e display forçado: o conteúdo fica no Shadow DOM, por isso para o CSS do tema o elemento
  // está vazio, e o Dawn esconde "div:empty" (base.css).
  var host = document.createElement("ldo-chat-root");
  host.id = "ldo-chat";
  host.setAttribute("data-nosnippet", "");
  host.setAttribute("lang", INTL[LANG]);
  host.style.setProperty("display", "block", "important");
  var root = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;
  document.body.appendChild(host);

  var style = document.createElement("style");
  style.textContent = css();
  root.appendChild(style);

  function el(tag, attrs, text) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    if (text != null) n.textContent = text;
    return n;
  }

  var launcher = el("button", { class: "launcher", type: "button", "aria-expanded": "false" });
  launcher.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" width="26" height="26"><path fill="currentColor" d="M12 3C6.5 3 2 6.6 2 11c0 2.2 1.1 4.2 3 5.6V21l3.7-2.2c1 .3 2.1.4 3.3.4 5.5 0 10-3.6 10-8.1S17.5 3 12 3zm-4 9.3a1.3 1.3 0 110-2.6 1.3 1.3 0 010 2.6zm4 0a1.3 1.3 0 110-2.6 1.3 1.3 0 010 2.6zm4 0a1.3 1.3 0 110-2.6 1.3 1.3 0 010 2.6z"/></svg>';
  if (cfg.button) launcher.appendChild(el("span", { class: "launcher-label" }, cfg.button));
  var badge = el("span", { class: "badge", hidden: "", "aria-hidden": "true" });
  launcher.appendChild(badge);
  root.appendChild(launcher);

  var panel = el("section", { class: "panel", role: "dialog", "aria-modal": "false", "aria-label": cfg.title, hidden: "" });
  var head = el("header", { class: "head" });
  if (cfg.logo) head.appendChild(el("img", { class: "logo", src: cfg.logo, alt: "" }));
  var titles = el("div", { class: "titles" });
  titles.appendChild(el("strong", {}, cfg.title));
  var statusLine = el("small", {});
  var statusDot = el("span", { class: "dot", "aria-hidden": "true" });
  var statusText = el("span", {});
  statusLine.appendChild(statusDot);
  statusLine.appendChild(statusText);
  titles.appendChild(statusLine);
  head.appendChild(titles);
  var closeBtn = el("button", { class: "close", type: "button", "aria-label": t("close") }, "×");
  head.appendChild(closeBtn);
  panel.appendChild(head);
  var offline = el("p", { class: "offline", hidden: "" });
  panel.appendChild(offline);
  var bodyBox = el("div", { class: "body" });
  panel.appendChild(bodyBox);
  var errorBox = el("p", { class: "error", role: "alert", hidden: "" });
  panel.appendChild(errorBox);
  root.appendChild(panel);

  // Formulário inicial.
  var form = el("form", { class: "start", novalidate: "" });
  form.appendChild(el("p", { class: "welcome" }, cfg.welcome));
  var known = cfg.identity || cfg.customer || {};
  form.appendChild(field(t("name"), "name", "text", known.name || "", { autocomplete: "name", maxlength: "80", required: "" }));
  var emailField = field(t("email"), "email", "email", known.email || "", { autocomplete: "email", maxlength: "254", required: "" });
  if (cfg.identity) emailField.querySelector("input").setAttribute("readonly", "");
  form.appendChild(emailField);
  var msgLabel = el("label", { class: "field" });
  msgLabel.appendChild(el("span", {}, t("message")));
  msgLabel.appendChild(el("textarea", { name: "message", rows: "3", maxlength: "2000", required: "" }));
  form.appendChild(msgLabel);
  form.appendChild(el("input", { name: "website", tabindex: "-1", autocomplete: "off", class: "trap", "aria-hidden": "true" }));
  var privacy = el("p", { class: "privacy" });
  if (cfg.privacyUrl) {
    privacy.appendChild(document.createTextNode(cfg.privacyText + " "));
    privacy.appendChild(el("a", { href: cfg.privacyUrl, target: "_blank", rel: "noopener" }, t("privacyLink")));
  } else privacy.textContent = cfg.privacyText;
  form.appendChild(privacy);
  var startBtn = el("button", { type: "submit", class: "primary" }, t("start"));
  form.appendChild(startBtn);
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var val = function (n) { var f = form.querySelector("[name=" + n + "]"); return f ? f.value.trim() : ""; };
    var name = val("name"), mail = val("email"), text = val("message");
    if (!name) return invalid("name", t("err_name_required"));
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(mail)) return invalid("email", t("err_email_invalid"));
    if (!text) return invalid("message", t("err_message_required"));
    start(name, mail, text);
  });
  function field(label, name, type, value, attrs) {
    var l = el("label", { class: "field" });
    l.appendChild(el("span", {}, label));
    var i = el("input", Object.assign({ name: name, type: type }, attrs));
    i.value = value;
    l.appendChild(i);
    return l;
  }
  function invalid(name, message) {
    setError(message);
    var f = form.querySelector("[name=" + name + "]");
    if (f) f.focus();
  }

  // Conversa: lista (atualizada aos poucos), indicador de escrita e caixa de texto que nunca é recriada.
  var chat = el("div", { class: "chat" });
  var list = el("div", { class: "messages", role: "log", "aria-live": "polite", "aria-label": t("messages") });
  var typingEl = el("div", { class: "typing", hidden: "" }, t("typingTeam"));
  chat.appendChild(list);
  chat.appendChild(typingEl);
  var compose = el("form", { class: "compose" });
  var input = el("textarea", { name: "body", rows: "1", maxlength: "2000", placeholder: t("placeholder"), "aria-label": t("message") });
  compose.appendChild(input);
  var sendBtn = el("button", { type: "submit", class: "send", "aria-label": t("send") });
  sendBtn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M3 20.5l18-8.5L3 3.5v6.6l12 1.9-12 1.9z"/></svg>';
  compose.appendChild(sendBtn);
  chat.appendChild(compose);
  var endBtn = el("button", { type: "button", class: "end" }, t("end"));
  chat.appendChild(endBtn);
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); }
  });
  compose.addEventListener("submit", function (e) { e.preventDefault(); submit(); });
  function submit() {
    var text = input.value.trim();
    if (!text) return;
    input.value = "";
    send(text);
  }
  // Terminar a conversa: confirmação dentro do chat (não a janela do browser) e, no fim, um agradecimento.
  var sheet = el("div", { class: "sheet", hidden: "", role: "dialog", "aria-modal": "true", "aria-label": t("endDialog") });
  var sheetBox = el("div", { class: "sheet-box" });
  sheetBox.appendChild(el("strong", { class: "sheet-title" }, t("endTitle")));
  sheetBox.appendChild(el("p", {}, t("endText")));
  var copyLabel = el("label", { class: "sheet-check" });
  var copyBox = el("input", { type: "checkbox" });
  copyLabel.appendChild(copyBox);
  copyLabel.appendChild(el("span", {}, t("endCopy")));
  sheetBox.appendChild(copyLabel);
  var endConfirm = el("button", { type: "button", class: "primary" }, t("end"));
  var endCancel = el("button", { type: "button", class: "secondary" }, t("endCancel"));
  sheetBox.appendChild(endConfirm);
  sheetBox.appendChild(endCancel);
  sheet.appendChild(sheetBox);
  panel.appendChild(sheet);

  var endedView = el("div", { class: "ended" });
  endedView.appendChild(el("strong", { class: "ended-title" }, t("thanks")));
  var endedText = el("p", {});
  endedView.appendChild(endedText);
  var newChatBtn = el("button", { type: "button", class: "primary" }, t("newChat"));
  endedView.appendChild(newChatBtn);
  newChatBtn.addEventListener("click", function () { state.ended = null; showMode(); focusInput(); });

  function closeSheet() { sheet.hidden = true; }
  endBtn.addEventListener("click", function () {
    copyBox.checked = false;
    // A cópia só existe depois de a equipa responder (o servidor confirma a mesma regra).
    copyLabel.hidden = !state.messages.some(function (m) { return m.from === "team"; });
    endConfirm.removeAttribute("disabled");
    endConfirm.textContent = t("end");
    sheet.hidden = false;
    endCancel.focus();
  });
  endCancel.addEventListener("click", function () { closeSheet(); focusInput(); });
  endConfirm.addEventListener("click", function () {
    var wanted = copyBox.checked && !copyLabel.hidden;
    endConfirm.setAttribute("disabled", "");
    endConfirm.textContent = t("ending");
    clearTimeout(state.timer);
    // Mesmo sem resposta do servidor a conversa termina neste dispositivo.
    request("POST", "/api/chat/end", { transcript: wanted }).catch(function () { return null; }).then(function (r) {
      restart("");
      state.ended = { wanted: wanted, emailed: Boolean(r && r.emailed), email: r && typeof r.email === "string" ? r.email : "" };
      endedText.textContent = state.ended.emailed
        ? t("emailed", { email: state.ended.email })
        : wanted ? t("emailFailed") : t("anythingElse");
      closeSheet();
      showMode();
      newChatBtn.focus();
    });
  });

  // ------------------------------------------------------------ atualizações

  // Horas das mensagens na língua e no fuso do cliente (o horário de atendimento é que fica em hora de Lisboa).
  var timeFmt = new Intl.DateTimeFormat(INTL[LANG], { hour: "2-digit", minute: "2-digit" });
  var dayFmt = new Intl.DateTimeFormat(INTL[LANG], { day: "numeric", month: "short" });

  // Ligações: terminam num espaço ou num emoji encostado (senão o emoji entrava no endereço e partia-o).
  // Sem a flag "u", para funcionar também em navegadores antigos: os mesmos emojis que \p{Extended_Pictographic}
  // (pares substitutos, os do plano básico e os símbolos), mais variação, ZWJ e tecla.
  var URL_SRC = "https?:\\/\\/[^\\s<>\"'\\u00A9\\u00AE\\u203C\\u2049\\u3030\\u303D\\u3297\\u3299\\uD800-\\uDFFF\\u2100-\\u2BFF\\uFE0F\\u200D\\u20E3]+";
  function richText(text) {
    var frag = document.createDocumentFragment();
    var re = new RegExp(URL_SRC, "g");
    var last = 0, m;
    while ((m = re.exec(text))) {
      var url = m[0].replace(/[.,;:!?)]+$/, "");
      frag.appendChild(document.createTextNode(text.slice(last, m.index)));
      frag.appendChild(el("a", { href: url, target: "_blank", rel: "noopener noreferrer" }, url));
      last = m.index + url.length;
    }
    frag.appendChild(document.createTextNode(text.slice(last)));
    return frag;
  }

  // Texto da equipa com formatação simples, sempre construída aqui (nunca HTML vindo do servidor):
  // parágrafos (linha em branco), listas ("- ", "• ", "* " ou "1. "), **negrito**, ligações e cartões dos
  // produtos da loja (uma linha só com a ligação do produto; a linha de cima, se houver, é o nome e o preço).
  var LIST_RE = /^\s*(?:[-•*]|(\d{1,2})[.)])\s+(.*)$/;
  function inline(text, into) {
    var parts = String(text).split(/\*\*([^*\n]+)\*\*/);
    parts.forEach(function (part, i) {
      if (!part) return;
      if (i % 2) into.appendChild(el("strong", {}, part));
      else into.appendChild(richText(part));
    });
    return into;
  }
  // Ligação de um produto da loja: { handle, variant } (variant = ?variant=<id>, se vier), ou null.
  function productLink(url) {
    var u;
    try { u = new URL(url); } catch (e) { return null; }
    var host = u.hostname.toLowerCase();
    if (host !== location.hostname.toLowerCase() && !/(^|\.)(lojadoouro\.pt|goldstorepremium\.com)$/.test(host) && !/\.myshopify\.com$/.test(host)) return null;
    var m = /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?products\/([a-z0-9][a-z0-9-]{0,200})\/?$/i.exec(u.pathname);
    if (!m) return null;
    var variant = u.searchParams.get("variant");
    return { handle: m[1].toLowerCase(), variant: variant && /^\d{1,20}$/.test(variant) ? variant : null };
  }
  function formatTeam(text) {
    var box = el("div", { class: "txt" });
    var lines = String(text).replace(/\r\n?/g, "\n").split("\n");
    var para = null, paraLines = 0, lastLine = "", listEl = null;
    function closeAll() { para = null; paraLines = 0; listEl = null; }
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var trimmed = line.trim();
      if (!trimmed) { closeAll(); continue; }
      // Linha só com a ligação de um produto (pode acabar em emojis, ex.: "https://…/products/anel 😍").
      var lead = new RegExp("^(" + URL_SRC + ")(.*)$").exec(trimmed);
      var rest = lead ? lead[2].trim() : "";
      var url = lead ? lead[1].replace(/[.,;:!?)]+$/, "") : "";
      var link = lead && !/[0-9A-Za-z\u00C0-\u024F]/.test(rest) ? productLink(url) : null;
      if (link) {
        // Legenda do cartão: só a linha "Nome — preço" que o botão "Produto" do dashboard põe por cima da
        // ligação (sozinha no parágrafo). Qualquer outro texto fica no chat tal como foi escrito.
        var caption = "";
        if (para && paraLines === 1 && / — [^—]*\d/.test(lastLine) && lastLine.length <= 200) {
          caption = lastLine;
          box.removeChild(para);
        }
        box.appendChild(productCard(url, link, caption));
        closeAll();
        if (rest) {
          para = el("p", {});
          box.appendChild(para);
          para.appendChild(inline(rest, el("span", {})));
          paraLines = 1;
          lastLine = rest;
        }
        continue;
      }
      var li = LIST_RE.exec(line);
      if (li) {
        var ordered = Boolean(li[1]);
        if (!listEl || listEl.nodeName !== (ordered ? "OL" : "UL")) {
          listEl = el(ordered ? "ol" : "ul", {});
          // Mantém a numeração escrita (ex.: passos separados por linhas em branco).
          if (ordered && Number(li[1]) > 1) listEl.setAttribute("start", String(Number(li[1])));
          box.appendChild(listEl);
        }
        listEl.appendChild(inline(li[2], el("li", {})));
        para = null;
        paraLines = 0;
        continue;
      }
      listEl = null;
      if (!para) { para = el("p", {}); box.appendChild(para); }
      else para.appendChild(el("br", {}));
      para.appendChild(inline(trimmed, el("span", {})));
      paraLines++;
      lastLine = trimmed;
    }
    return box;
  }

  // Cartão do produto: foto, nome e preço lidos da própria loja (/products/<handle>.js, só na loja Shopify).
  var products = {};
  var priceFmt = null;
  function money(cents) {
    try {
      var cur = (window.Shopify && window.Shopify.currency && window.Shopify.currency.active) || "EUR";
      priceFmt = priceFmt || new Intl.NumberFormat(INTL[LANG], { style: "currency", currency: cur });
      return priceFmt.format(cents / 100);
    } catch (e) { return ""; }
  }
  function imageUrl(src) {
    var img = typeof src === "string" ? src : src && typeof src.src === "string" ? src.src : "";
    if (img.indexOf("//") === 0) img = "https:" + img;
    return /^https:\/\/[^\s"'<>]+$/.test(img) ? img + (img.indexOf("?") >= 0 ? "&" : "?") + "width=200" : "";
  }
  function loadProduct(handle) {
    if (products[handle] || !window.Shopify) return;
    var root = (window.Shopify.routes && window.Shopify.routes.root) || "/";
    products[handle] = "loading";
    fetch(root + "products/" + encodeURIComponent(handle) + ".js", { credentials: "same-origin" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (p) {
        if (!p || typeof p.title !== "string") { products[handle] = "none"; return; }
        products[handle] = {
          title: p.title.slice(0, 120),
          price: typeof p.price === "number" ? p.price : null,
          priceMin: typeof p.price_min === "number" ? p.price_min : null,
          varies: p.price_varies === true,
          image: imageUrl(p.featured_image),
          available: p.available !== false,
          variants: (Array.isArray(p.variants) ? p.variants : []).slice(0, 250).map(function (v) {
            return { id: String(v.id), price: typeof v.price === "number" ? v.price : null, available: v.available !== false, image: imageUrl(v.featured_image) };
          }),
        };
        renderMessages();
      })
      .catch(function () { products[handle] = "none"; });
  }
  // Preço e disponibilidade da opção indicada na ligação (?variant=), ou "desde" quando o preço varia.
  function productCard(url, link, caption) {
    loadProduct(link.handle);
    var p = typeof products[link.handle] === "object" ? products[link.handle] : null;
    var v = p && link.variant ? p.variants.filter(function (x) { return x.id === link.variant; })[0] : null;
    var card = el("a", { class: "product", href: productHref(url, link), target: "_blank", rel: "noopener" });
    var image = p ? (v && v.image) || p.image : "";
    if (image) card.appendChild(el("img", { src: image, alt: "", loading: "lazy" }));
    var info = el("span", { class: "pinfo" });
    var fallback = caption || link.handle.replace(/-/g, " ");
    info.appendChild(el("strong", {}, p ? p.title : fallback.split(" — ")[0]));
    var price = !p ? (caption.split(" — ")[1] || "")
      : v && v.price != null ? money(v.price)
      : p.varies && p.priceMin != null ? t("fromPrice", { price: money(p.priceMin) })
      : p.price != null ? money(p.price) : "";
    if (price) info.appendChild(el("span", { class: "price" }, price));
    if (p && !(v ? v.available : p.available)) info.appendChild(el("span", { class: "soldout" }, t("soldOut")));
    info.appendChild(el("span", { class: "cta" }, t("viewProduct")));
    card.appendChild(info);
    return card;
  }

  // Pedido de avaliação: a pergunta e 5 estrelas (botões, com "1 de 5"… para leitores de ecrã); depois, o agradecimento.
  function surveyNode(m) {
    if (m.rated) return el("div", { class: "msg notice survey", "data-id": m.id, role: "note" }, t("surveyThanks"));
    var box = el("div", { class: "msg notice survey", "data-id": m.id, role: "group", "aria-label": surveyText(m) });
    box.appendChild(el("p", {}, surveyText(m)));
    var stars = el("div", { class: "stars" });
    for (var n = 1; n <= 5; n++) {
      var star = el("button", { type: "button", class: "star", "aria-label": t("surveyStar", { n: n }) }, "★");
      if (m.busy) star.setAttribute("disabled", "");
      star.addEventListener("click", rate.bind(null, m, n));
      stars.appendChild(star);
    }
    box.appendChild(stars);
    return box;
  }

  function messageNode(m) {
    var d = new Date(m.created_at);
    if (m.from === "notice" && m.kind === "survey") return surveyNode(m);
    // Aviso (ex.: a conversa foi transferida): linha centrada, sem balão.
    if (m.from === "notice") return el("div", { class: "msg notice", "data-id": m.id, role: "note" }, noticeText(m));
    var bubble = el("div", { class: "msg " + (m.from === "visitor" ? "me" : "team") + (m.failed ? " failed" : ""), "data-id": m.id });
    if (m.from === "team") bubble.appendChild(el("span", { class: "who" }, BRAND + (m.author ? " · " + m.author : "")));
    if (m.from === "team") bubble.appendChild(formatTeam(m.body || ""));
    else {
      var p = el("p", {});
      p.appendChild(richText(m.body || ""));
      bubble.appendChild(p);
    }
    var meta = el("span", { class: "meta" }, m.pending ? t("sending") : m.failed ? t("failed") : timeFmt.format(d));
    if (m.failed) {
      var retry = el("button", { type: "button", class: "retry" }, t("retry"));
      retry.addEventListener("click", function () { setError(""); send(m.body, m); });
      meta.appendChild(retry);
    }
    bubble.appendChild(meta);
    return bubble;
  }

  // Redesenha só a lista (a caixa de texto fica intacta) e mantém a posição de leitura.
  function renderMessages() {
    var atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
    var prevTop = list.scrollTop;
    var frag = document.createDocumentFragment();
    var lastDay = "";
    state.messages.forEach(function (m) {
      var day = dayFmt.format(new Date(m.created_at));
      if (day !== lastDay) { frag.appendChild(el("div", { class: "day" }, day)); lastDay = day; }
      frag.appendChild(messageNode(m));
    });
    // Só os nós novos são anunciados pelos leitores de ecrã (aria-live): os existentes reaproveitam-se.
    var old = {};
    Array.prototype.forEach.call(list.querySelectorAll(".msg"), function (n) { old[n.getAttribute("data-id")] = n; });
    Array.prototype.forEach.call(frag.querySelectorAll(".msg"), function (n) {
      var prev = old[n.getAttribute("data-id")];
      if (prev && prev.innerHTML === n.innerHTML && prev.className === n.className) n.parentNode.replaceChild(prev, n);
    });
    list.textContent = "";
    list.appendChild(frag);
    list.scrollTop = atBottom ? list.scrollHeight : prevTop;
  }
  function renderTyping() {
    typingEl.textContent = state.agent ? t("typingAgent", { name: state.agent }) : t("typingTeam");
    typingEl.hidden = !state.typing;
  }
  function renderBadge() {
    var n = state.open ? 0 : unread();
    badge.hidden = !n;
    badge.textContent = n > 9 ? "9+" : String(n);
    launcher.setAttribute("aria-label", n ? cfg.title + " (" + (n === 1 ? t("unreadOne") : t("unreadMany", { n: n })) + ")" : cfg.title);
  }
  function renderStatus() {
    var online = isOpenNow();
    statusDot.className = "dot " + (online ? "on" : "off");
    statusText.textContent = !online ? t("offHours") : state.session && state.agent ? t("talkingTo", { name: state.agent }) : cfg.subtitle;
    offline.hidden = online;
    if (!online) {
      offline.textContent = cfg.offlineMessage;
      var sched = scheduleText();
      if (sched) offline.appendChild(el("span", { class: "hours" }, t("hours", { hours: sched })));
    }
  }
  function renderForm() {
    startBtn.textContent = state.busy ? t("sending") : t("start");
    if (state.busy) startBtn.setAttribute("disabled", ""); else startBtn.removeAttribute("disabled");
  }
  function setError(message) {
    state.error = message || "";
    if (errorBox.textContent !== state.error) errorBox.textContent = state.error;
    errorBox.hidden = !state.error;
  }
  function showMode() {
    var want = state.session ? chat : state.ended ? endedView : form;
    if (bodyBox.firstChild !== want) {
      bodyBox.textContent = "";
      bodyBox.appendChild(want);
    }
    if (state.session) { renderMessages(); renderTyping(); }
    renderBadge();
  }

  // Abrir o chat (botão, ligação #chat, LdoChat.open() ou o chat que estava aberto noutra página): só a partir
  // daqui o widget grava no browser.
  function open() {
    state.open = true;
    writeStore(OPEN_KEY, true, "session");
    if (startVisit() && state.session) sendVisitSoon();
    launcher.setAttribute("aria-expanded", "true");
    launcher.classList.add("is-open");
    panel.hidden = false;
    renderStatus();
    showMode();
    if (state.session) fetchMessages().catch(function () {}).then(schedule);
    setTimeout(focusInput, 30);
  }
  function close() {
    state.open = false;
    writeStore(OPEN_KEY, null, "session");
    if (!state.session) dropVisit();
    launcher.setAttribute("aria-expanded", "false");
    launcher.classList.remove("is-open");
    panel.hidden = true;
    renderBadge();
    schedule();
    launcher.focus();
  }
  function focusInput() {
    var f = state.session ? input : form.querySelector("[name=name]");
    if (f && state.open) {
      if (!state.session && f.value) f = form.querySelector("[name=message]") || f;
      f.focus();
    }
  }

  // ------------------------------------------------------------ eventos

  function onKey(e) {
    if (e.key !== "Escape" || !state.open || e.isComposing) return;
    var inside = e.composedPath ? e.composedPath().indexOf(host) >= 0 : true;
    if (!inside) return;
    if (!sheet.hidden) { closeSheet(); focusInput(); return; }
    close();
  }
  function onVisibility() {
    if (!document.hidden && state.session) fetchMessages().catch(function () {}).then(schedule);
    else clearTimeout(state.timer);
    if (!document.hidden && state.open) renderStatus();
  }
  // Ligações no tema para abrir o chat: <a href="#chat">, [data-ldo-chat] ou window.LdoChat.open().
  function onClick(e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href="#chat"], [data-ldo-chat]') : null;
    if (a) { e.preventDefault(); open(); }
  }
  launcher.addEventListener("click", function () { state.open ? close() : open(); });
  closeBtn.addEventListener("click", close);
  document.addEventListener("keydown", onKey);
  document.addEventListener("visibilitychange", onVisibility);
  document.addEventListener("click", onClick);
  // Tema Dawn: avisa quando o carrinho muda.
  if (typeof window.subscribe === "function" && window.PUB_SUB_EVENTS && window.PUB_SUB_EVENTS.cartUpdate) {
    try { window.subscribe(window.PUB_SUB_EVENTS.cartUpdate, function () { lastCartCheck = 0; setTimeout(checkCart, 500); }); } catch (e) { /* opcional */ }
  }

  function destroy() {
    state.destroyed = true;
    clearTimeout(state.timer);
    document.removeEventListener("keydown", onKey);
    document.removeEventListener("visibilitychange", onVisibility);
    document.removeEventListener("click", onClick);
    if (host.parentNode) host.parentNode.removeChild(host);
    window.__ldoChatLoaded = false;
    delete window.LdoChat;
  }
  window.LdoChat = { open: open, close: close, destroy: destroy };

  function css() {
    var side = cfg.position === "left" ? "left" : "right";
    return [
      ":host { all: initial; }",
      "* { box-sizing: border-box; font-family: inherit; }",
      "[hidden] { display: none !important; }",
      ".launcher, .panel { --c: " + cfg.color + "; --ct: " + cfg.textColor + "; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }",
      ".launcher { position: fixed; " + side + ": " + cfg.offsetSide + "px; bottom: " + cfg.offset + "px; z-index: 9998; display: inline-flex; align-items: center; gap: 8px; min-width: 56px; height: 56px; padding: 0 16px; border: 0; border-radius: 28px; background: var(--c); color: var(--ct); box-shadow: 0 6px 20px rgba(0,0,0,.22); cursor: pointer; font-size: 15px; font-weight: 600; justify-content: center; transition: transform .15s ease; }",
      ".launcher:hover { transform: translateY(-2px); }",
      ".launcher:focus-visible, button:focus-visible, a:focus-visible, input:focus-visible, textarea:focus-visible { outline: 3px solid rgba(0,0,0,.35); outline-offset: 2px; }",
      ".launcher.is-open .launcher-label { display: none; }",
      ".badge { position: absolute; top: -4px; " + (side === "right" ? "left" : "right") + ": -4px; min-width: 22px; height: 22px; padding: 0 6px; border-radius: 11px; background: #c0392b; color: #fff; font-size: 12px; line-height: 22px; text-align: center; font-weight: 700; }",
      ".panel { position: fixed; " + side + ": " + cfg.offsetSide + "px; bottom: " + (cfg.offset + 68) + "px; z-index: 2147483000; width: 370px; max-width: calc(100vw - 24px); height: 560px; max-height: calc(100vh - " + (cfg.offset + 90) + "px); display: flex; flex-direction: column; background: #fff; color: #253531; border-radius: 14px; box-shadow: 0 12px 40px rgba(0,0,0,.25); overflow: hidden; font-size: 14px; line-height: 1.45; }",
      ".head { display: flex; align-items: center; gap: 10px; padding: 12px 14px; background: var(--c); color: var(--ct); flex-shrink: 0; }",
      ".logo { width: 36px; height: 36px; border-radius: 50%; object-fit: contain; background: #fff; }",
      ".titles { flex: 1; min-width: 0; display: flex; flex-direction: column; }",
      ".titles strong { font-size: 15px; }",
      ".titles small { font-size: 12px; opacity: .9; display: flex; align-items: center; gap: 6px; }",
      ".dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; flex-shrink: 0; background: #ccc; }",
      ".dot.on { background: #4cd07d; } .dot.off { background: #f0b44c; }",
      ".close { background: none; border: 0; color: var(--ct); font-size: 26px; line-height: 1; cursor: pointer; padding: 0 4px; }",
      ".offline { margin: 0; padding: 10px 14px; background: #fff8e6; color: #7a5f33; font-size: 13px; border-bottom: 1px solid #eee1ca; flex-shrink: 0; }",
      ".offline .hours { display: block; margin-top: 4px; font-size: 12px; }",
      ".body { flex: 1; min-height: 0; display: flex; flex-direction: column; }",
      ".start { padding: 14px; display: flex; flex-direction: column; gap: 10px; overflow-y: auto; }",
      ".welcome { margin: 0 0 4px; font-size: 15px; }",
      ".field { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: #5d6a62; }",
      ".field input, .field textarea, .compose textarea { width: 100%; border: 1px solid #d7dcd4; border-radius: 8px; padding: 9px 10px; font: inherit; font-size: 14px; color: #253531; background: #fff; }",
      ".field textarea { resize: vertical; min-height: 70px; }",
      ".field input[readonly] { background: #f3f5f0; }",
      ".trap { position: absolute; left: -9999px; width: 1px; height: 1px; opacity: 0; }",
      ".privacy { margin: 0; font-size: 12px; color: #78807c; } .privacy a { color: inherit; }",
      ".primary { border: 0; border-radius: 8px; padding: 11px; background: var(--c); color: var(--ct); font-weight: 600; font-size: 14px; cursor: pointer; }",
      ".primary[disabled] { opacity: .6; cursor: default; }",
      ".chat { flex: 1; min-height: 0; display: flex; flex-direction: column; }",
      ".messages { flex: 1; min-height: 0; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 8px; background: #fafbf8; }",
      ".day { align-self: center; font-size: 11px; color: #78807c; margin: 4px 0; }",
      ".msg { max-width: 82%; padding: 8px 11px; border-radius: 12px; background: #fff; border: 1px solid #e6e9e3; }",
      ".msg.me { align-self: flex-end; background: var(--c); color: var(--ct); border-color: transparent; border-bottom-right-radius: 4px; }",
      ".msg.team { align-self: flex-start; border-bottom-left-radius: 4px; }",
      ".msg.failed { opacity: .8; border: 1px dashed #c0392b; }",
      ".msg p { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }",
      ".msg a { color: inherit; text-decoration: underline; }",
      ".who { display: block; font-size: 11px; color: #8a6428; font-weight: 600; margin-bottom: 2px; }",
      ".msg.notice { align-self: center; max-width: 92%; padding: 4px 12px; border: 0; border-radius: 999px; background: #f2f4ef; color: #4f5c55; font-size: 12px; text-align: center; }",
      ".msg.notice.survey { padding: 10px 14px; border-radius: 12px; font-size: 13px; color: #253531; }",
      ".stars { display: flex; justify-content: center; gap: 2px; margin-top: 6px; }",
      // Estrelas por escolher e escolhidas com contraste de pelo menos 3:1 sobre o fundo do aviso (#f2f4ef).
      ".star { background: none; border: 0; padding: 2px 4px; font-size: 26px; line-height: 1; color: #7a8077; cursor: pointer; }",
      ".stars:hover .star:not([disabled]) { color: #b07f00; } .stars .star:hover ~ .star { color: #7a8077; }",
      ".star[disabled] { cursor: default; opacity: .6; }",
      ".txt p + p, .txt p + ul, .txt p + ol, .txt ul + p, .txt ol + p { margin-top: 7px; }",
      ".txt ul, .txt ol { margin: 4px 0; padding-left: 20px; } .txt li { margin: 2px 0; overflow-wrap: anywhere; }",
      ".msg a.product { display: flex; gap: 10px; align-items: center; margin: 6px 0; padding: 8px; border: 1px solid #e6e9e3; border-radius: 10px; background: #fafbf8; color: #253531; text-decoration: none; }",
      ".product img { width: 64px; height: 64px; object-fit: cover; border-radius: 8px; flex-shrink: 0; background: #fff; }",
      ".pinfo { display: flex; flex-direction: column; gap: 2px; min-width: 0; } .pinfo strong { font-size: 13px; line-height: 1.3; overflow-wrap: anywhere; }",
      ".price { font-size: 13px; color: #8a6428; font-weight: 600; } .soldout { font-size: 11px; color: #a44b40; } .cta { font-size: 12px; color: #8a6428; text-decoration: underline; }",
      ".meta { display: block; font-size: 10.5px; opacity: .75; margin-top: 3px; text-align: right; }",
      ".retry { margin-left: 6px; background: none; border: 0; color: inherit; text-decoration: underline; cursor: pointer; font-size: 11px; }",
      ".typing { font-size: 12px; color: #78807c; font-style: italic; padding: 4px 12px; background: #fafbf8; }",
      ".compose { display: flex; gap: 8px; padding: 10px 10px 4px; border-top: 1px solid #e6e9e3; background: #fff; align-items: flex-end; }",
      ".compose textarea { resize: none; max-height: 120px; min-height: 40px; }",
      ".send { flex-shrink: 0; width: 42px; height: 42px; border: 0; border-radius: 50%; background: var(--c); color: var(--ct); cursor: pointer; display: grid; place-items: center; }",
      ".panel { isolation: isolate; }",
      ".sheet { position: absolute; inset: 0; z-index: 3; display: flex; align-items: flex-end; background: rgba(20,30,28,.45); }",
      ".sheet-box { width: 100%; display: flex; flex-direction: column; gap: 10px; padding: 18px 16px 16px; background: #fff; border-radius: 14px 14px 0 0; box-shadow: 0 -8px 24px rgba(0,0,0,.15); }",
      ".sheet-title { font-size: 16px; }",
      ".sheet-box p { margin: 0; font-size: 13.5px; color: #4f5c55; }",
      ".sheet-check { display: flex; gap: 8px; align-items: flex-start; font-size: 13.5px; cursor: pointer; }",
      ".sheet-check input { margin: 2px 0 0; width: 16px; height: 16px; accent-color: var(--c); flex-shrink: 0; }",
      ".secondary { border: 1px solid #d7dcd4; border-radius: 8px; padding: 10px; background: #fff; color: #253531; font-size: 14px; cursor: pointer; }",
      ".ended { padding: 28px 18px; display: flex; flex-direction: column; gap: 12px; text-align: center; }",
      ".ended-title { font-size: 17px; }",
      ".ended p { margin: 0; color: #4f5c55; }",
      ".end { align-self: center; margin: 0 0 6px; background: none; border: 0; color: #78807c; font-size: 11.5px; text-decoration: underline; cursor: pointer; }",
      ".error { margin: 0; padding: 8px 14px; color: #a44b40; background: #fdf1ef; font-size: 13px; flex-shrink: 0; }",
      // Telemóvel (e telemóvel na horizontal): ecrã inteiro; letra de 16 px para o iPhone não ampliar a página.
      "@media (max-width: 600px), (max-height: 500px) { .panel { left: 0; right: 0; bottom: 0; top: 0; width: 100%; max-width: none; height: 100%; max-height: none; border-radius: 0; } .launcher.is-open { display: none; } }",
      "@media (max-width: 749px) { .field input, .field textarea, .compose textarea { font-size: 16px; } }",
      "@media (prefers-reduced-motion: reduce) { .launcher { transition: none; } }",
    ].join("\n");
  }

  // ------------------------------------------------------------ arranque

  // Até aqui, a quem ainda não abriu o chat neste separador, o widget só leu o armazenamento (e apagou o contador
  // antigo, um token que já não serve ou uma visita partilhada que já acabou): se o chat não abrir, nada fica gravado.
  renderBadge();
  var wantOpen = /[?&]chat=abrir\b/.test(location.search) || location.hash === "#chat";
  wantOpen = wantOpen || readStore(OPEN_KEY, "session") === true;
  if (state.session) {
    // O chat abre já nesta página: a visita conta a partir de agora, antes de o contexto seguir.
    if (wantOpen) startVisit();
    sendContext(true);
    fetchMessages().catch(function () {}).then(function () { if (wantOpen) open(); else schedule(); });
  } else if (wantOpen) open();
})();
