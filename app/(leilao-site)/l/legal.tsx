import type { PubSettings } from "@/lib/leilao/site";

// Peças comuns das páginas legais: aviso de rascunho e identificação da empresa (editável no backoffice).

export function DraftNote({ version }: { version?: string }) {
  return (
    <div className="lx-alert lx-alert-info lx-draft">
      <strong>Versão {version || "em preparação"}</strong>
      Texto em revisão jurídica antes do lançamento do leilão.
    </div>
  );
}

const or = (v: string | undefined, fallback: string) => (v && v.trim() ? v : fallback);

export function Identity({ s }: { s: PubSettings | null }) {
  return (
    <table>
      <tbody>
        <tr><th>Empresa</th><td>{or(s?.company_name, "[denominação social a indicar]")}</td></tr>
        <tr><th>NIF</th><td>{or(s?.company_nif, "[a indicar]")}</td></tr>
        <tr><th>Sede</th><td>{or(s?.company_address, "[morada a indicar]")}</td></tr>
        <tr><th>Registo</th><td>{or(s?.company_registry, "[conservatória e número a indicar]")}</td></tr>
        <tr><th>Título de comércio de artigos com metais preciosos (RJOC)</th><td>{or(s?.rjoc_title, "[número a indicar]")}</td></tr>
        <tr><th>Contacto</th><td>{or(s?.contact_email, "apoiocliente@lojadoouro.pt")}{s?.contact_phone ? ` · ${s.contact_phone}` : ""}</td></tr>
      </tbody>
    </table>
  );
}
