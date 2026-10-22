// Mensagens de sucesso das ações do leilão (?ok=…).
const OK: Record<string, string> = {
  event_created: "Leilão criado em rascunho. Junte os lotes e publique quando estiver pronto.",
  event_saved: "Leilão guardado. Os lotes sem licitações acompanham as novas datas.",
  lot_imported: "Lote criado a partir do produto da loja, em rascunho. Confirme o metal, o toque, o peso e os preços antes de o abrir.",
  lot_saved: "Lote guardado.",
  lot_ready: "Lote pronto: fica aberto a licitações quando o leilão estiver publicado e aberto.",
  lot_draft: "Lote de volta a rascunho.",
  lot_withdrawn: "Lote retirado. Quem licitou vai receber um aviso.",
  settings: "Regras guardadas. Aplicam-se às próximas licitações.",
  legal: "Identificação legal guardada. Aparece no rodapé e nas páginas legais do site do leilão.",
  customer: "Cliente atualizado.",
};

export function auctionMessage(key: string | string[] | undefined) {
  return typeof key === "string" ? OK[key] : undefined;
}
