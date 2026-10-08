/*
 * Chat da Loja do Ouro — botão flutuante para o site (tema Shopify).
 *
 * As conversas entram no Apoio ao Cliente do dashboard (canal "Chat do site") e as respostas da equipa
 * aparecem aqui. Sem bibliotecas; isolado do CSS do tema (Shadow DOM). A configuração vem do bloco
 * <script id="ldo-chat-config" type="application/json"> gerado pela secção sections/ldo-chat.liquid do tema
 * (ou de window.LDO_CHAT_CONFIG) e muda-se em Loja online → Personalizar tema → Rodapé → Chat Loja do Ouro.
 *
 * Privacidade: guarda no browser só o token da conversa e a hora de início da visita (localStorage).
 * Depois de o cliente iniciar o chat, envia à equipa a página em que está e o carrinho da loja.
 * Nenhum texto do cliente ou da equipa é interpretado como HTML.
 */
(function () {
  "use strict";
  if (window.__ldoChatLoaded) return;
  window.__ldoChatLoaded = true;

  var cfg = readConfig();
  if (!cfg || cfg.enabled === false) return;
  // Chatbot antigo (Bluedot): a secção do tema impede-o de carregar, mas se o cliente mexer na página antes de
  // o rodapé chegar ao browser ele ainda carrega; nesse caso fica escondido.
  if (cfg.hideOld) hideOldChatbot();
  var path = location.pathname || "/";
  if (cfg.hideOn.some(function (p) { return p && path.indexOf(p) === 0; })) return;
  if (cfg.mobile === false && window.matchMedia("(max-width: 749px)").matches) return;

  var API = String(cfg.api || "").replace(/\/+$/, "");
  var STORE_KEY = "ldo-chat:v1";
  var OPEN_KEY = "ldo-chat:aberto";
  var VISIT_KEY = "ldo-chat:visita";
  var POLL_OPEN = 3500;
  var POLL_CLOSED = 30000;
  var VISIT_GAP = 30 * 60 * 1000;

  var state = {
    session: load(),        // { token, name, verifiedEmail, seenAt }
    messages: [],           // { id, from, author, key, body, created_at, inserted_at, local?, pending?, failed?, clientKey? }
    lastInserted: null,
    typing: false,
    open: false,
    busy: false,
    error: "",
    timer: null,
    failures: 0,
    startKey: null,
    cartSig: null,
    destroyed: false,
  };
  var visit = trackVisit();

  // Conversa confirmada de outro cliente (sessão terminada ou outra pessoa no mesmo browser): recomeça.
  var currentIdentity = cfg.identity ? String(cfg.identity.email || "").toLowerCase() : "";
  if (state.session && state.session.verifiedEmail && state.session.verifiedEmail !== currentIdentity) {
    state.session = null;
    save();
  }

  // ------------------------------------------------------------ configuração e armazenamento

  function readConfig() {
    var el = document.getElementById("ldo-chat-config");
    var c = window.LDO_CHAT_CONFIG || null;
    if (el) {
      try { c = JSON.parse(el.textContent || "{}"); } catch (e) { c = null; }
    }
    if (!c) return null;
    return {
      enabled: c.enabled !== false,
      api: c.api || "",
      title: c.title || "Fale connosco",
      subtitle: c.subtitle || "A equipa da Loja do Ouro responde aqui.",
      welcome: c.welcome || "Olá! Em que podemos ajudar?",
      button: c.button || "",
      color: safeColor(c.color, "#a47a37"),
      textColor: safeColor(c.textColor, "#ffffff"),
      logo: typeof c.logo === "string" && /^(https:)?\/\//.test(c.logo) ? c.logo : "",
      position: c.position === "left" ? "left" : "right",
      offset: clampNum(c.offset, 8, 200, 20),
      offsetSide: clampNum(c.offsetSide, 8, 200, 20),
      privacyUrl: typeof c.privacyUrl === "string" ? c.privacyUrl : "",
      privacyText: c.privacyText || "Ao iniciar a conversa aceita a nossa Política de privacidade. Para o podermos ajudar, a equipa vê a página em que está e o seu carrinho.",
      offlineMessage: c.offlineMessage || "Neste momento estamos fora do horário de atendimento. Deixe a sua mensagem: respondemos assim que possível e enviamos também a resposta para o seu email.",
      hours: c.hours || {},
      hideOn: Array.isArray(c.hideOn) ? c.hideOn : String(c.hideOn || "").split(/[\n,]/).map(function (s) { return s.trim(); }).filter(Boolean),
      mobile: c.mobile !== false,
      identity: c.identity && c.identity.sig ? c.identity : null,
      customer: c.customer || null,
      hideOld: c.hideOld === true,
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

  function readStore(key, storage) {
    try { return JSON.parse((storage || localStorage).getItem(key) || "null"); } catch (e) { return null; }
  }
  function writeStore(key, value, storage) {
    try {
      if (value == null) (storage || localStorage).removeItem(key);
      else (storage || localStorage).setItem(key, JSON.stringify(value));
    } catch (e) { /* sem armazenamento: vale só nesta página */ }
  }
  function load() {
    var s = readStore(STORE_KEY);
    return s && typeof s.token === "string" ? s : null;
  }
  function save() { writeStore(STORE_KEY, state.session); }

  // Visita: começa quando o cliente chega e acaba após 30 minutos sem páginas novas.
  function trackVisit() {
    var now = Date.now();
    var v = readStore(VISIT_KEY);
    if (!v || typeof v.start !== "number" || now - (v.last || 0) > VISIT_GAP) v = { start: now, pages: 0 };
    v.pages = (v.pages || 0) + 1;
    v.last = now;
    writeStore(VISIT_KEY, v);
    return v;
  }
  function touchVisit() {
    visit.last = Date.now();
    writeStore(VISIT_KEY, visit);
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
    if (h.weekdays) parts.push("Seg. a sex. " + h.weekdays);
    if (h.saturday) parts.push("Sáb. " + h.saturday);
    if (h.sunday) parts.push("Dom. " + h.sunday);
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
      .catch(function () { throw new Error("Sem ligação. Verifique a internet e tente novamente."); })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (data) {
          var message = data && typeof data.error === "string" ? data.error : "";
          if (r.status === 401 && data && data.restart) { restart(message); throw new Error(message); }
          if (!r.ok) throw new Error(message || "O chat está indisponível de momento (erro " + r.status + "). Tente novamente dentro de instantes.");
          return data;
        });
      });
  }

  function restart(message) {
    state.session = null;
    state.messages = [];
    state.lastInserted = null;
    state.typing = false;
    save();
    setError(message || "");
    showMode();
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

  // Página e carrinho (lido da própria loja) para a equipa, só com a conversa iniciada e quando mudam.
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
  function sendContext(force) {
    if (!state.session) return Promise.resolve();
    return readCart().then(function (cart) {
      var sig = JSON.stringify(cart || null) + "|" + location.href;
      if (!force && sig === state.cartSig) return;
      state.cartSig = sig;
      return request("POST", "/api/chat/context", {
        page: location.href, title: document.title, visitStartedAt: new Date(visit.start).toISOString(), pages: visit.pages, cart: cart,
      }).catch(function () { state.cartSig = null; });
    });
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

  // ------------------------------------------------------------ interface (construída uma vez)

  // Elemento próprio e display forçado: o conteúdo fica no Shadow DOM, por isso para o CSS do tema o elemento
  // está vazio, e o Dawn esconde "div:empty" (base.css).
  var host = document.createElement("ldo-chat-root");
  host.id = "ldo-chat";
  host.setAttribute("data-nosnippet", "");
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
  var closeBtn = el("button", { class: "close", type: "button", "aria-label": "Fechar o chat" }, "×");
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
  form.appendChild(field("Nome", "name", "text", known.name || "", { autocomplete: "name", maxlength: "80", required: "" }));
  var emailField = field("Email", "email", "email", known.email || "", { autocomplete: "email", maxlength: "254", required: "" });
  if (cfg.identity) emailField.querySelector("input").setAttribute("readonly", "");
  form.appendChild(emailField);
  var msgLabel = el("label", { class: "field" });
  msgLabel.appendChild(el("span", {}, "Mensagem"));
  msgLabel.appendChild(el("textarea", { name: "message", rows: "3", maxlength: "2000", required: "" }));
  form.appendChild(msgLabel);
  form.appendChild(el("input", { name: "website", tabindex: "-1", autocomplete: "off", class: "trap", "aria-hidden": "true" }));
  var privacy = el("p", { class: "privacy" });
  if (cfg.privacyUrl) {
    privacy.appendChild(document.createTextNode(cfg.privacyText + " "));
    privacy.appendChild(el("a", { href: cfg.privacyUrl, target: "_blank", rel: "noopener" }, "Ler a política"));
  } else privacy.textContent = cfg.privacyText;
  form.appendChild(privacy);
  var startBtn = el("button", { type: "submit", class: "primary" }, "Iniciar conversa");
  form.appendChild(startBtn);
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var val = function (n) { var f = form.querySelector("[name=" + n + "]"); return f ? f.value.trim() : ""; };
    var name = val("name"), mail = val("email"), text = val("message");
    if (!name) return invalid("name", "Indique o seu nome.");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(mail)) return invalid("email", "Indique um email válido (para lhe podermos responder).");
    if (!text) return invalid("message", "Escreva a sua mensagem.");
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
  var list = el("div", { class: "messages", role: "log", "aria-live": "polite", "aria-label": "Mensagens" });
  var typingEl = el("div", { class: "typing", hidden: "" }, "A equipa está a escrever…");
  chat.appendChild(list);
  chat.appendChild(typingEl);
  var compose = el("form", { class: "compose" });
  var input = el("textarea", { name: "body", rows: "1", maxlength: "2000", placeholder: "Escreva a sua mensagem…", "aria-label": "Mensagem" });
  compose.appendChild(input);
  var sendBtn = el("button", { type: "submit", class: "send", "aria-label": "Enviar" });
  sendBtn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M3 20.5l18-8.5L3 3.5v6.6l12 1.9-12 1.9z"/></svg>';
  compose.appendChild(sendBtn);
  chat.appendChild(compose);
  var endBtn = el("button", { type: "button", class: "end" }, "Terminar conversa");
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
  endBtn.addEventListener("click", function () {
    if (!confirm("Terminar esta conversa neste dispositivo? Para voltar a falar connosco terá de iniciar uma nova.")) return;
    clearTimeout(state.timer);
    restart("");
    focusInput();
  });

  // ------------------------------------------------------------ atualizações

  var timeFmt = new Intl.DateTimeFormat("pt-PT", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Lisbon" });
  var dayFmt = new Intl.DateTimeFormat("pt-PT", { day: "numeric", month: "short", timeZone: "Europe/Lisbon" });

  function richText(text) {
    var frag = document.createDocumentFragment();
    var re = /https?:\/\/[^\s<>"']+/g;
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

  function messageNode(m) {
    var d = new Date(m.created_at);
    var bubble = el("div", { class: "msg " + (m.from === "visitor" ? "me" : "team") + (m.failed ? " failed" : ""), "data-id": m.id });
    if (m.from === "team") bubble.appendChild(el("span", { class: "who" }, "Loja do Ouro" + (m.author ? " · " + m.author : "")));
    var p = el("p", {});
    p.appendChild(richText(m.body));
    bubble.appendChild(p);
    var meta = el("span", { class: "meta" }, m.pending ? "A enviar…" : m.failed ? "Não enviada" : timeFmt.format(d));
    if (m.failed) {
      var retry = el("button", { type: "button", class: "retry" }, "Tentar de novo");
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
      if (prev && prev.textContent === n.textContent && prev.className === n.className) n.parentNode.replaceChild(prev, n);
    });
    list.textContent = "";
    list.appendChild(frag);
    list.scrollTop = atBottom ? list.scrollHeight : prevTop;
  }
  function renderTyping() { typingEl.hidden = !state.typing; }
  function renderBadge() {
    var n = state.open ? 0 : unread();
    badge.hidden = !n;
    badge.textContent = n > 9 ? "9+" : String(n);
    launcher.setAttribute("aria-label", n ? cfg.title + " (" + (n === 1 ? "1 mensagem nova" : n + " mensagens novas") + ")" : cfg.title);
  }
  function renderStatus() {
    var online = isOpenNow();
    statusDot.className = "dot " + (online ? "on" : "off");
    statusText.textContent = online ? cfg.subtitle : "Fora do horário de atendimento";
    offline.hidden = online;
    if (!online) {
      offline.textContent = cfg.offlineMessage;
      var sched = scheduleText();
      if (sched) offline.appendChild(el("span", { class: "hours" }, "Horário: " + sched));
    }
  }
  function renderForm() {
    startBtn.textContent = state.busy ? "A enviar…" : "Iniciar conversa";
    if (state.busy) startBtn.setAttribute("disabled", ""); else startBtn.removeAttribute("disabled");
  }
  function setError(message) {
    state.error = message || "";
    if (errorBox.textContent !== state.error) errorBox.textContent = state.error;
    errorBox.hidden = !state.error;
  }
  function showMode() {
    var want = state.session ? chat : form;
    if (bodyBox.firstChild !== want) {
      bodyBox.textContent = "";
      bodyBox.appendChild(want);
    }
    if (state.session) { renderMessages(); renderTyping(); }
    renderBadge();
  }

  function open() {
    state.open = true;
    writeStore(OPEN_KEY, true, sessionStorage);
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
    writeStore(OPEN_KEY, null, sessionStorage);
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
    if (inside) close();
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
      ".meta { display: block; font-size: 10.5px; opacity: .75; margin-top: 3px; text-align: right; }",
      ".retry { margin-left: 6px; background: none; border: 0; color: inherit; text-decoration: underline; cursor: pointer; font-size: 11px; }",
      ".typing { font-size: 12px; color: #78807c; font-style: italic; padding: 4px 12px; background: #fafbf8; }",
      ".compose { display: flex; gap: 8px; padding: 10px 10px 4px; border-top: 1px solid #e6e9e3; background: #fff; align-items: flex-end; }",
      ".compose textarea { resize: none; max-height: 120px; min-height: 40px; }",
      ".send { flex-shrink: 0; width: 42px; height: 42px; border: 0; border-radius: 50%; background: var(--c); color: var(--ct); cursor: pointer; display: grid; place-items: center; }",
      ".end { align-self: center; margin: 0 0 6px; background: none; border: 0; color: #78807c; font-size: 11.5px; text-decoration: underline; cursor: pointer; }",
      ".error { margin: 0; padding: 8px 14px; color: #a44b40; background: #fdf1ef; font-size: 13px; flex-shrink: 0; }",
      // Telemóvel (e telemóvel na horizontal): ecrã inteiro; letra de 16 px para o iPhone não ampliar a página.
      "@media (max-width: 600px), (max-height: 500px) { .panel { left: 0; right: 0; bottom: 0; top: 0; width: 100%; max-width: none; height: 100%; max-height: none; border-radius: 0; } .launcher.is-open { display: none; } }",
      "@media (max-width: 749px) { .field input, .field textarea, .compose textarea { font-size: 16px; } }",
      "@media (prefers-reduced-motion: reduce) { .launcher { transition: none; } }",
    ].join("\n");
  }

  // ------------------------------------------------------------ arranque

  renderBadge();
  var wantOpen = /[?&]chat=abrir\b/.test(location.search) || location.hash === "#chat";
  wantOpen = wantOpen || readStore(OPEN_KEY, sessionStorage) === true;
  if (state.session) {
    sendContext(true);
    fetchMessages().catch(function () {}).then(function () { if (wantOpen) open(); else schedule(); });
  } else if (wantOpen) open();
})();
