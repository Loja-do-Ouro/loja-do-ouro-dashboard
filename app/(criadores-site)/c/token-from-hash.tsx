"use client";

import { useEffect, useRef, useState } from "react";

// [rev. S-B11] As ligações dos emails (confirmar o email, nova palavra-passe, confirmar o IBAN) levam o token depois
// de «#», no fragmento, que o browser nunca envia ao servidor: não fica nos registos de pedidos da Vercel nem no
// Referer. Este gancho lê o token do endereço, guarda-o só na memória da página (vai depois num campo escondido do
// formulário POST) e limpa o endereço com history.replaceState. O GET da página nunca chama a BD.

const HASH_TOKEN = /(?:^#|&)t=([0-9a-f]{64})(?:&|$)/;

export type HashToken = { token: string; read: boolean };

export function useHashToken(): HashToken {
  const [state, setState] = useState<HashToken>({ token: "", read: false });
  // Lê o fragmento uma só vez por montagem: em desenvolvimento (StrictMode) o efeito corre duas vezes e a segunda já
  // encontraria o endereço limpo.
  const done = useRef(false);
  useEffect(() => {
    if (!done.current) {
      done.current = true;
      const m = HASH_TOKEN.exec(window.location.hash || "");
      setState({ token: m ? m[1] : "", read: true });
    }
    // Limpa o endereço depois de o router do Next sincronizar o URL inicial (que corre a seguir a este efeito e
    // voltaria a pôr o fragmento). O Next acompanha as chamadas a history.replaceState.
    const clear = () => {
      if (!window.location.hash) return;
      try {
        window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
      } catch {
        // sem history (raro): o fragmento fica no endereço, mas continua a não ir para o servidor
      }
    };
    const timers = [window.setTimeout(clear, 0), window.setTimeout(clear, 400)];
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, []);
  return state;
}

// O que mostrar enquanto o token não foi lido ou se a ligação veio sem ele.
export function HashTokenMissing({ read }: { read: boolean }) {
  if (!read) return <p className="cr-pequeno" role="status">A ler a ligação…</p>;
  return (
    <div className="cr-aviso cr-aviso-erro" role="alert">
      <strong>Ligação incompleta</strong>
      <p>Abra-a de novo a partir do email, sem a copiar à mão. Se continuar a falhar, peça um email novo.</p>
    </div>
  );
}
