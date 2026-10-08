"use client";

import { useEffect } from "react";

type ChatWindow = Window & { __ldoChatLoaded?: boolean; LdoChat?: { open: () => void; destroy: () => void } };

// Página de teste do chat do site: carrega o widget (sempre a versão atual), recomeça como cliente novo
// e desliga o widget ao sair da página (deixa de consultar o servidor).
export function ChatTestTools() {
  useEffect(() => {
    const w = window as ChatWindow;
    w.LdoChat?.destroy();
    w.__ldoChatLoaded = false;
    const script = document.createElement("script");
    script.src = `/site-chat/ldo-chat.js?t=${Date.now()}`;
    script.async = true;
    document.body.appendChild(script);
    return () => {
      (window as ChatWindow).LdoChat?.destroy();
      script.remove();
    };
  }, []);

  function restart() {
    try {
      localStorage.removeItem("ldo-chat:v1");
      sessionStorage.removeItem("ldo-chat:aberto");
    } catch {
      // Sem armazenamento: basta recarregar.
    }
    location.reload();
  }

  return (
    <div className="customer-actions">
      <button type="button" className="secondary-button" onClick={() => (window as ChatWindow).LdoChat?.open()}>Abrir o chat</button>
      <button type="button" className="secondary-button" onClick={restart}>Recomeçar como cliente novo</button>
    </div>
  );
}
