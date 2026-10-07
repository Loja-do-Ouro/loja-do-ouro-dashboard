"use client";

import { useEffect, useRef, useState } from "react";
import type { PreviewKind } from "@/lib/support/rules";

export type ViewerItem = { href: string; name: string; kind: PreviewKind; size: number | null };

const sizeLabel = (n: number | null) => (n == null ? "" : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
export { sizeLabel };

// Pré-visualização dentro do dashboard (abre e fecha sem descarregar). Imagens, PDF (visualizador do
// próprio browser, isolado do nosso site), vídeo e áudio; o resto mostra só nome, tamanho e "Descarregar".
// <dialog> nativo: Esc fecha, o resto da página fica inativo; setas mudam de anexo.
export function AttachmentViewer({ items, index, onIndex, onClose }: { items: ViewerItem[]; index: number; onIndex: (i: number) => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const [failed, setFailed] = useState(false);
  const [zoom, setZoom] = useState(false);
  const item = items[index];

  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) {
      d.showModal();
      closeBtn.current?.focus();
    }
  }, []);
  useEffect(() => {
    setFailed(false);
    setZoom(false);
  }, [index]);

  const go = (step: number) => {
    if (items.length > 1) onIndex((index + step + items.length) % items.length);
  };
  const onKey = (e: React.KeyboardEvent) => {
    // Nas setas de um vídeo/áudio/PDF quem decide é o próprio leitor.
    const tag = (e.target as HTMLElement).tagName;
    if (["VIDEO", "AUDIO", "IFRAME", "INPUT"].includes(tag)) return;
    if (e.key === "ArrowRight") go(1);
    if (e.key === "ArrowLeft") go(-1);
  };
  if (!item) return null;
  const download = `${item.href}${item.href.includes("?") ? "&" : "?"}download=1`;
  const pdfUnsupported = item.kind === "pdf" && typeof navigator !== "undefined" && "pdfViewerEnabled" in navigator && navigator.pdfViewerEnabled === false;

  return (
    <dialog
      ref={dialog}
      className="viewer"
      aria-labelledby="viewer-title"
      onClose={onClose}
      onKeyDown={onKey}
      onClick={(e) => {
        if (e.target === dialog.current) dialog.current?.close();
      }}
    >
      <div className="viewer-bar">
        <strong id="viewer-title" title={item.name}>{item.name}</strong>
        <small>{sizeLabel(item.size)}{items.length > 1 ? ` · ${index + 1} / ${items.length}` : ""}</small>
        <span className="viewer-actions">
          {items.length > 1 && (
            <>
              <button type="button" onClick={() => go(-1)} aria-label="Anexo anterior">‹</button>
              <button type="button" onClick={() => go(1)} aria-label="Anexo seguinte">›</button>
            </>
          )}
          {(item.kind === "image" || item.kind === "pdf") && (
            <a href={item.href} target="_blank" rel="noopener noreferrer">Abrir noutro separador</a>
          )}
          <a href={download}>Descarregar</a>
          <button ref={closeBtn} type="button" onClick={() => dialog.current?.close()} aria-label="Fechar">✕</button>
        </span>
      </div>
      <div className={`viewer-body ${item.kind}`} key={item.href}>
        {failed || item.kind === "file" || pdfUnsupported ? (
          <div className="viewer-file">
            <p>{failed ? "Não foi possível pré-visualizar este ficheiro aqui." : pdfUnsupported ? "Este browser não pré-visualiza PDF." : "Sem pré-visualização para este tipo de ficheiro."}</p>
            <a className="outline-button" href={download}>Descarregar {item.name}</a>
          </div>
        ) : item.kind === "image" ? (
          <img
            src={item.href}
            alt={item.name}
            className={zoom ? "zoomed" : ""}
            onClick={() => setZoom((z) => !z)}
            onError={() => setFailed(true)}
            title={zoom ? "Ajustar ao ecrã" : "Ver em tamanho real"}
          />
        ) : item.kind === "pdf" ? (
          <iframe src={item.href} title={item.name} />
        ) : item.kind === "video" ? (
          <video src={item.href} controls playsInline preload="metadata" onError={() => setFailed(true)} />
        ) : (
          <audio src={item.href} controls preload="metadata" onError={() => setFailed(true)} />
        )}
      </div>
      {item.kind === "pdf" && !failed && !pdfUnsupported && <p className="viewer-hint">Se o PDF não aparecer, use “Abrir noutro separador”.</p>}
    </dialog>
  );
}
