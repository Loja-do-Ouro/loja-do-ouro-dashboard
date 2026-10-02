import { isClosedWithoutPayment, type Row } from "@/lib/bi/model";

export const currency = (v: number | null) =>
  v === null
    ? "—"
    : new Intl.NumberFormat("pt-PT", {
        style: "currency",
        currency: "EUR",
        minimumFractionDigits: 2,
      }).format(v);
export const integer = (v: number | null) =>
  v === null
    ? "—"
    : new Intl.NumberFormat("pt-PT", { maximumFractionDigits: 1 }).format(v);
export const percent = (v: number | null) =>
  v === null
    ? "—"
    : `${new Intl.NumberFormat("pt-PT", { minimumFractionDigits: 1, maximumFractionDigits: 2 }).format(v)}%`;
export const timestamp = (s: string | null) =>
  s
    ? new Intl.DateTimeFormat("pt-PT", {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: "Europe/Lisbon",
      }).format(new Date(s))
    : "Sem recolha";
export const text = (v: unknown) => (typeof v === "string" ? v : "—");
export const statusLabel = (s: unknown) =>
  ({
    PAID: "Paga",
    PARTIALLY_REFUNDED: "Reembolso parcial",
    PENDING: "Pendente",
    AUTHORIZED: "Autorizada",
    PARTIALLY_PAID: "Pagamento parcial",
    VOIDED: "Anulada",
    REFUNDED: "Reembolsada",
    UNFULFILLED: "Por preparar",
    FULFILLED: "Preparada",
    PARTIALLY_FULFILLED: "Preparação parcial",
    UNSHIPPED: "Por expedir",
  })[String(s)] || text(s);
// A cancelled or voided order has nothing to prepare.
export const fulfillmentLabel = (r: Row) =>
  isClosedWithoutPayment(r) ? "—" : statusLabel(r.fulfillment_status);
