"use client";

import { useEffect } from "react";

// Página de teste do chat do site: recomeçar como um cliente novo e retirar o botão ao sair da página.
export function ChatTestTools() {
  useEffect(() => {
    return () => {
      document.getElementById("ldo-chat")?.remove();
      (window as unknown as { __ldoChatLoaded?: boolean }).__ldoChatLoaded = false;
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
      <button type="button" className="secondary-button" onClick={() => (window as unknown as { LdoChat?: { open: () => void } }).LdoChat?.open()}>Abrir o chat</button>
      <button type="button" className="secondary-button" onClick={restart}>Recomeçar como cliente novo</button>
    </div>
  );
}
