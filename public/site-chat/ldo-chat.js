/*
 * Chat da Loja do Ouro — botão flutuante para o site (tema Shopify).
 *
 * As conversas entram no Apoio ao Cliente do dashboard (canal "Chat do site") e as respostas da equipa
 * aparecem aqui. Sem bibliotecas; isolado do CSS do tema (Shadow DOM). A configuração vem do bloco
 * <script id="ldo-chat-config" type="application/json"> gerado por snippets/ldo-chat.liquid (ou de
 * window.LDO_CHAT_CONFIG) e muda-se em Loja online → Personalizar tema → Definições do tema → Chat.
 *
 * Privacidade: só guarda no browser o token da conversa (localStorage). Nenhum texto do cliente ou da
 * equipa é interpretado como HTML.
 */
(function () {
  "use strict";
  if (window.__ldoChatLoaded) return;
  window.__ldoChatLoaded = true;

  var cfg = readConfig();
  if (!cfg || cfg.enabled === false) return;
  var path = location.pathname || "/";
  if ((cfg.hideOn || []).some(function (p) { return p && path.indexOf(p) === 0; })) return;
  if (cfg.mobile === false && window.matchMedia("(max-width: 749px)").matches) return;

  var API = String(cfg.api || "").replace(/\/+$/, "");
  var STORE_KEY = "ldo-chat:v1";
  var OPEN_KEY = "ldo-chat:aberto";
  var POLL_OPEN = 3500;
  var POLL_CLOSED = 30000;

  var state = {
    session: load(),        // { token, name, email, seenAt }
    messages: [],           // { id, from, author, body, created_at, inserted_at, pending?, failed?, clientKey? }
    lastInserted: null,
    typing: false,
    open: false,
    busy: false,
    error: "",
    timer: null,
    failures: 0,
  };

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
      privacyText: c.privacyText || "Ao iniciar a conversa aceita a nossa Política de privacidade.",
      offlineMessage: c.offlineMessage || "Neste momento estamos fora do horário de atendimento. Deixe a sua mensagem: respondemos assim que possível e enviamos também a resposta para o seu email.",
      hours: c.hours || {},
      hideOn: Array.isArray(c.hideOn) ? c.hideOn : String(c.hideOn || "").split(/[\n,]/).map(function (s) { return s.trim(); }).filter(Boolean),
      mobile: c.mobile !== false,
      identity: c.identity && c.identity.sig ? c.identity : null,
      customer: c.customer || null,
    };
  }
  function safeColor(v, d) { return typeof v === "string" && /^#[0-9a-fA-F]{3,8}$/.test(v) ? v : d; }
  function clampNum(v, min, max, d) { var n = Number(v); return isFinite(n) && n >= min && n <= max ? n : d; }

  function load() {
    try {
      var s = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
      return s && typeof s.token === "string" ? s : null;
    } catch (e) { return null; }
  }
  function save() {
    try {
      if (state.session) localStorage.setItem(STORE_KEY, JSON.stringify(state.session));
      else localStorage.removeItem(STORE_KEY);
    } catch (e) { /* sem armazenamento: a conversa vale só nesta página */ }
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

  function request(method, url, body) {
    var headers = { "Content-Type": "application/json" };
    if (state.session && state.session.token) headers.Authorization = "Bearer " + state.session.token;
    return fetch(API + url, { method: method, headers: headers, body: body ? JSON.stringify(body) : undefined, cache: "no-store", credentials: "omit" })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (data) {
          if (r.status === 401 && data && data.restart) { restart(data.error); throw new Error(data.error); }
          if (!r.ok) throw new Error((data && data.error) || "O chat está indisponível de momento.");
          return data;
        });
      });
  }

  function restart(message) {
    state.session = null;
    state.messages = [];
    state.lastInserted = null;
    save();
    state.error = message || "";
    render();
  }

  function fetchMessages() {
    if (!state.session) return Promise.resolve();
    var q = "?aberto=" + (state.open && !document.hidden ? "1" : "0") + (state.lastInserted ? "&depois=" + encodeURIComponent(state.lastInserted) : "");
    return request("GET", "/api/chat/messages" + q).then(function (r) {
      state.failures = 0;
      var changed = state.typing !== Boolean(r.typing);
      state.typing = Boolean(r.typing);
      (r.messages || []).forEach(function (m) { if (merge(m)) changed = true; });
      if (state.open && !document.hidden) markSeen();
      if (changed) render();
    });
  }

  function merge(m) {
    if (!state.lastInserted || m.inserted_at > state.lastInserted) state.lastInserted = m.inserted_at;
    for (var i = 0; i < state.messages.length; i++) {
      var x = state.messages[i];
      if (x.id === m.id) return false;
      if (x.serverId === m.id) { state.messages[i] = m; return true; }
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
    if (!state.session || document.hidden) return;
    var wait = (state.open ? POLL_OPEN : POLL_CLOSED) * Math.pow(2, Math.min(state.failures, 4));
    state.timer = setTimeout(function () {
      fetchMessages().catch(function () { state.failures++; }).then(schedule);
    }, Math.min(wait, 60000));
  }

  function start(name, email, message) {
    var key = uuid();
    state.busy = true;
    state.error = "";
    render();
    return request("POST", "/api/chat/start", {
      name: name, email: email, message: message, clientKey: key, page: location.href,
      identity: cfg.identity, website: (root.querySelector("[name=website]") || {}).value || "",
    }).then(function (r) {
      state.session = { token: r.token, name: name, email: email, seenAt: "" };
      state.messages = [];
      state.lastInserted = null;
      save();
      return fetchMessages();
    }).catch(function (e) {
      state.error = e.message;
    }).then(function () {
      state.busy = false;
      render();
      schedule();
      focusInput();
    });
  }

  function send(body, existing) {
    var key = existing ? existing.clientKey : uuid();
    var local = existing || { id: "local:" + key, clientKey: key, from: "visitor", author: null, body: body, created_at: new Date().toISOString(), inserted_at: "", pending: true };
    local.failed = false;
    if (!existing) state.messages.push(local);
    render();
    return request("POST", "/api/chat/messages", { body: local.body, clientKey: key, page: location.href })
      .then(function (r) {
        local.pending = false;
        if (state.messages.some(function (x) { return x.id === r.id; })) state.messages = state.messages.filter(function (x) { return x !== local; });
        else local.serverId = r.id;
        render();
        return fetchMessages();
      })
      .catch(function (e) {
        local.failed = true;
        local.pending = false;
        state.error = e.message;
        render();
      });
  }

  // ------------------------------------------------------------ interface

  var host = document.createElement("div");
  host.id = "ldo-chat";
  host.setAttribute("data-nosnippet", "");
  var root = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;
  document.body.appendChild(host);

  var style = document.createElement("style");
  style.textContent = css();
  root.appendChild(style);

  var launcher = el("button", { class: "launcher", type: "button", "aria-label": cfg.title, "aria-expanded": "false" });
  launcher.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" width="26" height="26"><path fill="currentColor" d="M12 3C6.5 3 2 6.6 2 11c0 2.2 1.1 4.2 3 5.6V21l3.7-2.2c1 .3 2.1.4 3.3.4 5.5 0 10-3.6 10-8.1S17.5 3 12 3zm-4 9.3a1.3 1.3 0 110-2.6 1.3 1.3 0 010 2.6zm4 0a1.3 1.3 0 110-2.6 1.3 1.3 0 010 2.6zm4 0a1.3 1.3 0 110-2.6 1.3 1.3 0 010 2.6z"/></svg>';
  if (cfg.button) launcher.appendChild(el("span", { class: "launcher-label" }, cfg.button));
  var badge = el("span", { class: "badge", hidden: "" });
  launcher.appendChild(badge);
  root.appendChild(launcher);

  var panel = el("section", { class: "panel", role: "dialog", "aria-modal": "false", "aria-label": cfg.title, hidden: "" });
  root.appendChild(panel);

  launcher.addEventListener("click", function () { state.open ? close() : open(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && state.open) close(); });
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden && state.session) fetchMessages().catch(function () {}).then(schedule);
    else clearTimeout(state.timer);
  });
  // Ligações no tema para abrir o chat: <a href="#chat"> ou window.LdoChat.open().
  document.addEventListener("click", function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href="#chat"], [data-ldo-chat]') : null;
    if (a) { e.preventDefault(); open(); }
  });
  window.LdoChat = { open: open, close: close };

  function open() {
    state.open = true;
    try { sessionStorage.setItem(OPEN_KEY, "1"); } catch (e) { /* opcional */ }
    render();
    if (state.session) fetchMessages().catch(function () {}).then(schedule);
    setTimeout(focusInput, 30);
  }
  function close() {
    state.open = false;
    try { sessionStorage.removeItem(OPEN_KEY); } catch (e) { /* opcional */ }
    render();
    schedule();
    launcher.focus();
  }
  function focusInput() {
    var f = root.querySelector(state.session ? "textarea[name=body]" : "input[name=name]");
    if (f && state.open) f.focus();
  }

  function el(tag, attrs, text) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    if (text != null) n.textContent = text;
    return n;
  }

  // Texto com ligações clicáveis (só http/https), sem nunca interpretar HTML.
  function richText(text) {
    var frag = document.createDocumentFragment();
    var re = /https?:\/\/[^\s<>"']+/g;
    var last = 0, m;
    while ((m = re.exec(text))) {
      var url = m[0].replace(/[.,;:!?)]+$/, "");
      frag.appendChild(document.createTextNode(text.slice(last, m.index)));
      var a = el("a", { href: url, target: "_blank", rel: "noopener noreferrer" }, url);
      frag.appendChild(a);
      last = m.index + url.length;
    }
    frag.appendChild(document.createTextNode(text.slice(last)));
    return frag;
  }

  var timeFmt = new Intl.DateTimeFormat("pt-PT", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Lisbon" });
  var dayFmt = new Intl.DateTimeFormat("pt-PT", { day: "numeric", month: "short", timeZone: "Europe/Lisbon" });

  function render() {
    launcher.setAttribute("aria-expanded", String(state.open));
    launcher.classList.toggle("is-open", state.open);
    var n = state.open ? 0 : unread();
    badge.hidden = !n;
    badge.textContent = n > 9 ? "9+" : String(n);
    launcher.setAttribute("aria-label", n ? cfg.title + " (" + n + " mensagens novas)" : cfg.title);
    panel.hidden = !state.open;
    if (!state.open) return;

    // Mantém o texto que está a ser escrito e a posição da conversa entre atualizações.
    var draft = root.querySelector("textarea[name=body]");
    var draftValue = draft ? draft.value : "";
    var hadFocus = draft && root.activeElement === draft;
    var sel = draft ? [draft.selectionStart, draft.selectionEnd] : null;
    var list = root.querySelector(".messages");
    var atBottom = !list || list.scrollHeight - list.scrollTop - list.clientHeight < 40;
    var formValues = {};
    ["name", "email", "message"].forEach(function (k) { var f = root.querySelector("[name=" + k + "]"); if (f) formValues[k] = f.value; });

    panel.textContent = "";
    var online = isOpenNow();
    var head = el("header", { class: "head" });
    if (cfg.logo) head.appendChild(el("img", { class: "logo", src: cfg.logo, alt: "" }));
    var titles = el("div", { class: "titles" });
    titles.appendChild(el("strong", {}, cfg.title));
    var status = el("small", {}, online ? cfg.subtitle : "Fora do horário de atendimento");
    status.insertBefore(el("span", { class: "dot " + (online ? "on" : "off"), "aria-hidden": "true" }), status.firstChild);
    titles.appendChild(status);
    head.appendChild(titles);
    var x = el("button", { class: "close", type: "button", "aria-label": "Fechar o chat" }, "×");
    x.addEventListener("click", close);
    head.appendChild(x);
    panel.appendChild(head);

    if (!online) {
      var off = el("p", { class: "offline" }, cfg.offlineMessage);
      var sched = scheduleText();
      if (sched) off.appendChild(el("span", { class: "hours" }, "Horário: " + sched));
      panel.appendChild(off);
    }

    if (!state.session) panel.appendChild(startForm(formValues));
    else panel.appendChild(conversation(draftValue));

    if (state.error) panel.appendChild(el("p", { class: "error", role: "alert" }, state.error));

    var newList = root.querySelector(".messages");
    if (newList && (atBottom || !list)) newList.scrollTop = newList.scrollHeight;
    else if (newList && list) newList.scrollTop = list.scrollTop;
    if (hadFocus) { var t = root.querySelector("textarea[name=body]"); if (t) { t.focus(); if (sel) t.setSelectionRange(sel[0], sel[1]); } }
  }

  function startForm(values) {
    var form = el("form", { class: "start", novalidate: "" });
    form.appendChild(el("p", { class: "welcome" }, cfg.welcome));
    var known = cfg.identity || cfg.customer || {};
    form.appendChild(field("Nome", "name", "text", values.name != null ? values.name : known.name || "", { autocomplete: "name", maxlength: "80", required: "" }));
    var email = field("Email", "email", "email", values.email != null ? values.email : known.email || "", { autocomplete: "email", maxlength: "254", required: "" });
    if (cfg.identity) email.querySelector("input").setAttribute("readonly", "");
    form.appendChild(email);
    var msg = el("label", { class: "field" });
    msg.appendChild(el("span", {}, "Mensagem"));
    var ta = el("textarea", { name: "message", rows: "3", maxlength: "2000", required: "" });
    ta.value = values.message || "";
    msg.appendChild(ta);
    form.appendChild(msg);
    // Campo escondido contra robôs.
    var trap = el("input", { name: "website", tabindex: "-1", autocomplete: "off", class: "trap", "aria-hidden": "true" });
    form.appendChild(trap);
    var privacy = el("p", { class: "privacy" });
    if (cfg.privacyUrl) {
      privacy.appendChild(document.createTextNode(cfg.privacyText + " "));
      privacy.appendChild(el("a", { href: cfg.privacyUrl, target: "_blank", rel: "noopener" }, "Ler"));
    } else privacy.textContent = cfg.privacyText;
    form.appendChild(privacy);
    var btn = el("button", { type: "submit", class: "primary" }, state.busy ? "A enviar…" : "Iniciar conversa");
    if (state.busy) btn.setAttribute("disabled", "");
    form.appendChild(btn);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var val = function (n) { var f = form.querySelector("[name=" + n + "]"); return f ? f.value.trim() : ""; };
      var name = val("name"), mail = val("email"), text = val("message");
      if (!name) return showError("Indique o seu nome.");
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(mail)) return showError("Indique um email válido (para lhe podermos responder).");
      if (!text) return showError("Escreva a sua mensagem.");
      start(name, mail, text);
    });
    return form;
  }
  function field(label, name, type, value, attrs) {
    var l = el("label", { class: "field" });
    l.appendChild(el("span", {}, label));
    var i = el("input", Object.assign({ name: name, type: type }, attrs));
    i.value = value;
    l.appendChild(i);
    return l;
  }
  function showError(message) {
    state.error = message;
    render();
  }

  function conversation(draftValue) {
    var wrap = el("div", { class: "chat" });
    var list = el("div", { class: "messages", role: "log", "aria-live": "polite", "aria-label": "Mensagens" });
    var lastDay = "";
    state.messages.forEach(function (m) {
      var d = new Date(m.created_at);
      var day = dayFmt.format(d);
      if (day !== lastDay) { list.appendChild(el("div", { class: "day" }, day)); lastDay = day; }
      var bubble = el("div", { class: "msg " + (m.from === "visitor" ? "me" : "team") + (m.failed ? " failed" : "") });
      if (m.from === "team") bubble.appendChild(el("span", { class: "who" }, "Loja do Ouro" + (m.author ? " · " + m.author : "")));
      var p = el("p", {});
      p.appendChild(richText(m.body));
      bubble.appendChild(p);
      var meta = el("span", { class: "meta" }, m.pending ? "A enviar…" : m.failed ? "Não enviada" : timeFmt.format(d));
      if (m.failed) {
        var retry = el("button", { type: "button", class: "retry" }, "Tentar de novo");
        retry.addEventListener("click", function () { state.error = ""; send(m.body, m); });
        meta.appendChild(retry);
      }
      bubble.appendChild(meta);
      list.appendChild(bubble);
    });
    if (state.typing) list.appendChild(el("div", { class: "typing" }, "A equipa está a escrever…"));
    wrap.appendChild(list);

    var form = el("form", { class: "compose" });
    var ta = el("textarea", { name: "body", rows: "1", maxlength: "2000", placeholder: "Escreva a sua mensagem…", "aria-label": "Mensagem" });
    ta.value = draftValue;
    ta.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); }
    });
    form.appendChild(ta);
    var b = el("button", { type: "submit", class: "send", "aria-label": "Enviar" });
    b.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M3 20.5l18-8.5L3 3.5v6.6l12 1.9-12 1.9z"/></svg>';
    form.appendChild(b);
    form.addEventListener("submit", function (e) { e.preventDefault(); submit(); });
    function submit() {
      var text = ta.value.trim();
      if (!text) return;
      ta.value = "";
      state.error = "";
      send(text);
    }
    wrap.appendChild(form);
    return wrap;
  }

  function css() {
    var side = cfg.position === "left" ? "left" : "right";
    return [
      ":host { all: initial; }",
      "* { box-sizing: border-box; font-family: inherit; }",
      ".launcher, .panel { --c: " + cfg.color + "; --ct: " + cfg.textColor + "; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }",
      ".launcher { position: fixed; " + side + ": " + cfg.offsetSide + "px; bottom: " + cfg.offset + "px; z-index: 2147483000; display: inline-flex; align-items: center; gap: 8px; min-width: 56px; height: 56px; padding: 0 16px; border: 0; border-radius: 28px; background: var(--c); color: var(--ct); box-shadow: 0 6px 20px rgba(0,0,0,.22); cursor: pointer; font-size: 15px; font-weight: 600; justify-content: center; transition: transform .15s ease; }",
      ".launcher:hover { transform: translateY(-2px); }",
      ".launcher:focus-visible, button:focus-visible, a:focus-visible, input:focus-visible, textarea:focus-visible { outline: 3px solid rgba(0,0,0,.35); outline-offset: 2px; }",
      ".launcher.is-open .launcher-label { display: none; }",
      ".badge { position: absolute; top: -4px; " + (side === "right" ? "left" : "right") + ": -4px; min-width: 22px; height: 22px; padding: 0 6px; border-radius: 11px; background: #c0392b; color: #fff; font-size: 12px; line-height: 22px; text-align: center; font-weight: 700; }",
      ".badge[hidden] { display: none; }",
      ".panel { position: fixed; " + side + ": " + cfg.offsetSide + "px; bottom: " + (cfg.offset + 68) + "px; z-index: 2147483000; width: 370px; max-width: calc(100vw - 24px); height: 560px; max-height: calc(100vh - " + (cfg.offset + 90) + "px); display: flex; flex-direction: column; background: #fff; color: #253531; border-radius: 14px; box-shadow: 0 12px 40px rgba(0,0,0,.25); overflow: hidden; font-size: 14px; line-height: 1.45; }",
      ".panel[hidden] { display: none; }",
      ".head { display: flex; align-items: center; gap: 10px; padding: 12px 14px; background: var(--c); color: var(--ct); }",
      ".logo { width: 36px; height: 36px; border-radius: 50%; object-fit: contain; background: #fff; }",
      ".titles { flex: 1; min-width: 0; display: flex; flex-direction: column; }",
      ".titles strong { font-size: 15px; }",
      ".titles small { font-size: 12px; opacity: .9; display: flex; align-items: center; gap: 6px; }",
      ".dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; flex-shrink: 0; }",
      ".dot.on { background: #4cd07d; } .dot.off { background: #f0b44c; }",
      ".close { background: none; border: 0; color: var(--ct); font-size: 26px; line-height: 1; cursor: pointer; padding: 0 4px; }",
      ".offline { margin: 0; padding: 10px 14px; background: #fff8e6; color: #7a5f33; font-size: 13px; border-bottom: 1px solid #eee1ca; }",
      ".offline .hours { display: block; margin-top: 4px; font-size: 12px; }",
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
      ".msg.failed { opacity: .75; border: 1px dashed #c0392b; }",
      ".msg p { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }",
      ".msg a { color: inherit; text-decoration: underline; }",
      ".who { display: block; font-size: 11px; color: #8a6428; font-weight: 600; margin-bottom: 2px; }",
      ".meta { display: block; font-size: 10.5px; opacity: .75; margin-top: 3px; text-align: right; }",
      ".retry { margin-left: 6px; background: none; border: 0; color: inherit; text-decoration: underline; cursor: pointer; font-size: 11px; }",
      ".typing { font-size: 12px; color: #78807c; font-style: italic; }",
      ".compose { display: flex; gap: 8px; padding: 10px; border-top: 1px solid #e6e9e3; background: #fff; align-items: flex-end; }",
      ".compose textarea { resize: none; max-height: 120px; min-height: 40px; }",
      ".send { flex-shrink: 0; width: 42px; height: 42px; border: 0; border-radius: 50%; background: var(--c); color: var(--ct); cursor: pointer; display: grid; place-items: center; }",
      ".error { margin: 0; padding: 8px 14px; color: #a44b40; background: #fdf1ef; font-size: 13px; }",
      "@media (max-width: 600px) { .panel { left: 0; right: 0; bottom: 0; top: 0; width: 100%; max-width: none; height: 100%; max-height: none; border-radius: 0; } .launcher.is-open { display: none; } }",
      "@media (prefers-reduced-motion: reduce) { .launcher { transition: none; } }",
    ].join("\n");
  }

  // ------------------------------------------------------------ arranque

  render();
  var wantOpen = /[?&]chat=abrir\b/.test(location.search) || location.hash === "#chat";
  try { wantOpen = wantOpen || sessionStorage.getItem(OPEN_KEY) === "1"; } catch (e) { /* opcional */ }
  if (state.session) fetchMessages().catch(function () {}).then(function () { if (wantOpen) open(); else schedule(); });
  else if (wantOpen) open();
})();
