import { Panel } from "@/components/dashboard/ui";
import { Flash, PageHeading } from "@/components/shell";
import { crLegalList, crSettingsGet, type CrLegalRow } from "@/lib/criadores/db";
import { creatorsReady } from "@/lib/criadores/site";
import {
  LEGAL_KIND_LABEL, LEGAL_STATUS_LABEL, lisbonDate, lisbonDateTime, RETENTION_KEYS, RETENTION_LABEL, RETENTION_UNIT_LABEL, retentionFloor,
  retentionMax, retentionUnit, type RetentionKey,
} from "@/lib/criadores-rules";
import { requireCreatorsViewer } from "@/lib/viewer";
import { lockdownPlatform, publishLegalDocument, saveCreatorsSettings, saveLegalDocument } from "../actions";
import { creatorsError, creatorsMessage } from "../messages";
import { CreatorsShell, num } from "../ui";
import { LegalPreview } from "./legal-preview";

export const dynamic = "force-dynamic";
export const metadata = { title: "Definições · Influenciadores · Loja do Ouro" };

const KINDS = ["terms", "privacy", "cookies", "meta_data"] as const;
type Kind = (typeof KINDS)[number];

// Versão seguinte sugerida para um rascunho novo: 1.0 → 1.1; sem nenhuma, 1.0.
function nextVersion(docs: CrLegalRow[]) {
  const versions = docs.map((d) => d.version.split(".").map(Number)).filter((v) => v.length === 2 && v.every(Number.isFinite));
  if (!versions.length) return "1.0";
  versions.sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  return `${versions[0][0]}.${versions[0][1] + 1}`;
}

function DraftForm({ d, canPublish }: { d: CrLegalRow; canPublish: boolean }) {
  return (
    <>
      <form action={saveLegalDocument} className="form-grid">
        <input type="hidden" name="id" value={d.id} />
        <label>
          Versão
          <input name="version" required pattern="[0-9]{1,3}\.[0-9]{1,3}" defaultValue={d.version} />
        </label>
        <label>
          Título
          <input name="title" required maxLength={200} defaultValue={d.title} />
        </label>
        <label className="wide">
          Resumo das mudanças (vai no email aos criadores)
          <textarea name="changes_summary" rows={2} maxLength={2000} defaultValue={d.changes_summary || ""} />
        </label>
        <label className="wide">
          Texto (Markdown simples: # títulos, listas com «-», **negrito**, *itálico* e [ligações](https://…))
          <textarea name="body" rows={16} maxLength={200000} defaultValue={d.body} spellCheck />
        </label>
        {d.kind === "terms" && (
          <label className="check wide">
            <input type="checkbox" name="requires_reacceptance" defaultChecked={d.requires_reacceptance} />
            <span>Exige nova aceitação: até aceitarem, os criadores ficam em «Novos termos» e as ações ficam bloqueadas.</span>
          </label>
        )}
        <div className="wide form-actions">
          <button type="submit" className="secondary-button">Guardar rascunho</button>
          <small>Criado {lisbonDateTime(d.created_at)}{d.created_by ? ` por ${d.created_by}` : ""}.</small>
        </div>
      </form>
      <details style={{ marginTop: 12 }}>
        <summary style={{ cursor: "pointer" }}>Pré-visualizar (como aparece no site)</summary>
        <LegalPreview body={d.body} />
      </details>
      {canPublish && (
        <form action={publishLegalDocument} className="danger-zone">
          <input type="hidden" name="id" value={d.id} />
          <label className="check">
            <input type="checkbox" name="confirm" required />
            <span>
              Texto revisto e aprovado pelo advogado.{" "}
              {d.kind === "privacy"
                ? "Todos os criadores recebem um email com o resumo das mudanças (não precisam de aceitar)."
                : d.kind === "terms" && d.requires_reacceptance
                  ? "Todos os criadores recebem um email e têm de aceitar antes de continuar."
                  : "A versão publicada anterior passa a «Retirado»."}
            </span>
          </label>
          <button type="submit">Publicar v{d.version}</button>
        </form>
      )}
    </>
  );
}

export default async function CreatorsSettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const viewer = await requireCreatorsViewer("manage");
  const sp = await searchParams;
  const [s, docs] = await Promise.all([crSettingsGet(viewer.session).catch(() => null), crLegalList(viewer.session).catch(() => null)]);
  const canEdit = Boolean(s?.can_edit && viewer.isSuper);
  const ready = creatorsReady();
  const retentionKeys = s ? [...RETENTION_KEYS.filter((k) => k in s.retention), ...Object.keys(s.retention).filter((k) => !RETENTION_KEYS.includes(k as RetentionKey))] : [];
  const published = (k: Kind) => docs?.find((d) => d.kind === k && d.status === "published");

  return (
    <CreatorsShell viewer={viewer} current="influenciadores-definicoes" title="Definições">
      <PageHeading
        eyebrow="INFLUENCIADORES"
        title="Definições da plataforma"
        text="Identificação legal, documentos, inscrições e prazos de conservação. Só o Super Admin altera as definições e publica documentos; quem gere prepara os rascunhos."
      />
      <Flash ok={creatorsMessage(sp)} error={creatorsError(sp)} />
      {!s ? (
        <div className="notice error-notice">Definições indisponíveis (falta a atualização da base de dados?).</div>
      ) : (
        <>
          {!canEdit && (
            <div className="notice" role="status">
              <span>Pode consultar estas definições e preparar rascunhos dos documentos. Guardar as definições e publicar fica para o Super Admin.</span>
            </div>
          )}

          <div className="two-col">
            <Panel title="Identificação legal" eyebrow="RESPONSÁVEL PELO TRATAMENTO" id="identificacao" note="Aparece no rodapé do site, na Política de Privacidade e nos Termos. Confirme os dados com o advogado.">
              <form action={saveCreatorsSettings}>
                <input type="hidden" name="section" value="company" />
                <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
                  <div className="form-grid">
                    <label className="wide">
                      Denominação social
                      <input name="company_name" maxLength={200} defaultValue={s.company_name} />
                    </label>
                    <label>
                      NIF da empresa
                      <input name="company_nif" inputMode="numeric" maxLength={11} pattern="[0-9 ]{9,11}" defaultValue={s.company_nif} />
                    </label>
                    <label>
                      Registo comercial
                      <input name="company_registry" maxLength={200} defaultValue={s.company_registry} />
                    </label>
                    <label className="wide">
                      Sede
                      <input name="company_address" maxLength={400} defaultValue={s.company_address} />
                    </label>
                    <label>
                      Email de contacto
                      <input name="contact_email" type="email" required maxLength={254} defaultValue={s.contact_email} />
                    </label>
                    <label>
                      Email de privacidade (RGPD)
                      <input name="privacy_email" type="email" required maxLength={254} defaultValue={s.privacy_email} />
                    </label>
                    <div className="wide form-actions">
                      <button type="submit">Guardar identificação</button>
                    </div>
                  </div>
                </fieldset>
              </form>
            </Panel>

            <Panel title="Inscrições e contas" eyebrow="ACESSO" id="inscricoes">
              <form action={saveCreatorsSettings}>
                <input type="hidden" name="section" value="access" />
                <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
                  <div className="form-grid">
                    <label className="check wide">
                      <input type="checkbox" name="registrations_open" defaultChecked={s.registrations_open} />
                      <span>Inscrições abertas (sem esta opção, o site mostra «em breve» e não grava registos)</span>
                    </label>
                    <label>
                      Sessão dos criadores (dias)
                      <input name="session_days" type="number" min={1} max={30} required defaultValue={s.session_days} />
                    </label>
                    <label>
                      Espera de um IBAN novo (horas)
                      <input name="iban_hold_hours" type="number" min={0} max={336} required defaultValue={s.iban_hold_hours} />
                    </label>
                    <p className="field-help wide">
                      Abrir as inscrições exige os Termos e a Política de Privacidade publicados
                      {published("terms") && published("privacy") ? " (já estão)" : " (ainda não estão)"}.
                      {!ready && " Atenção: o site ainda não está pronto (endereço próprio ou chaves por configurar); em produção, as inscrições não abrem e os emails não saem."}{" "}
                      Durante a espera do IBAN, a revelação exige a confirmação por telefone ou outro canal.
                    </p>
                    <div className="wide form-actions">
                      <button type="submit">Guardar</button>
                      <small>
                        Última alteração {lisbonDateTime(s.updated_at)}
                        {s.updated_by ? ` por ${s.updated_by}` : ""}.
                      </small>
                    </div>
                  </div>
                </fieldset>
              </form>
            </Panel>
          </div>

          <Panel
            title="Prazos de conservação"
            eyebrow="RGPD · LIMPEZA DIÁRIA"
            id="prazos"
            note="A limpeza corre todos os dias às 03:41. Nenhum prazo desce abaixo do mínimo indicado ao lado (definido pela lei e pelo advogado; muda só com uma atualização da base de dados). Valores a confirmar com o advogado."
          >
            <form action={saveCreatorsSettings}>
              <input type="hidden" name="section" value="retention" />
              <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
                <div className="form-grid">
                  {retentionKeys.map((k) => {
                    const unit = retentionUnit(k);
                    const limits = s.retention_limits?.[k];
                    const min = limits?.min ?? retentionFloor(k);
                    const max = limits?.max ?? retentionMax(k);
                    return (
                      <label key={k}>
                        {RETENTION_LABEL[k as RetentionKey] ?? k} ({unit ? RETENTION_UNIT_LABEL[unit] : "?"})
                        <input name={`ret_${k}`} type="number" min={min} max={max} step={1} required defaultValue={s.retention[k]} />
                        <small className="muted">
                          Mínimo {num(min)} · máximo {num(max)}
                        </small>
                      </label>
                    );
                  })}
                  <p className="field-help wide">O aviso de inatividade tem de vir antes da anonimização da conta inativa.</p>
                  <div className="wide form-actions">
                    <button type="submit">Guardar prazos</button>
                  </div>
                </div>
              </fieldset>
            </form>
          </Panel>

          <Panel
            title="Documentos legais"
            eyebrow="TERMOS, PRIVACIDADE, COOKIES E DADOS DA META"
            id="documentos"
            note="Um documento publicado não muda: crie uma versão nova. Ao publicar, a versão anterior passa a «Retirado» e os consentimentos antigos ficam ligados à versão que a pessoa viu."
          >
            {!docs ? (
              <div className="notice error-notice">Documentos indisponíveis.</div>
            ) : (
              KINDS.map((k) => {
                const list = docs.filter((d) => d.kind === k);
                const pub = list.find((d) => d.status === "published");
                const drafts = list.filter((d) => d.status === "draft");
                const latest = drafts[0] || pub;
                return (
                  <section key={k} style={{ borderTop: "1px solid var(--line)", paddingTop: 16, marginTop: 16 }}>
                    <h3 style={{ margin: "0 0 6px" }}>
                      {LEGAL_KIND_LABEL[k]}{" "}
                      {pub ? <span className="pill ok">v{pub.version} publicada a {lisbonDate(pub.published_at)}</span> : <span className="pill warn">Por publicar</span>}
                    </h3>
                    {pub && (
                      <details>
                        <summary style={{ cursor: "pointer" }}>
                          Ver a versão publicada ({num(pub.accepted_count)} {pub.accepted_count === 1 ? "pessoa" : "pessoas"}
                          {k === "terms" ? " aceitaram" : k === "privacy" ? " tomaram conhecimento" : ""})
                        </summary>
                        <LegalPreview body={pub.body} />
                      </details>
                    )}
                    {drafts.map((d) => (
                      <div key={d.id} id={`doc-${d.id}`} style={{ marginTop: 14 }}>
                        <h4 style={{ margin: "0 0 4px" }}>
                          Rascunho v{d.version} <span className="pill">{LEGAL_STATUS_LABEL.draft}</span>
                        </h4>
                        <DraftForm d={d} canPublish={canEdit} />
                      </div>
                    ))}
                    {list
                      .filter((d) => d.status === "retired")
                      .slice(0, 5)
                      .map((d) => (
                        <small key={d.id} className="muted block">
                          v{d.version} · retirada (publicada a {lisbonDate(d.published_at)}{d.published_by ? ` por ${d.published_by}` : ""}) · {num(d.accepted_count)} pessoas
                        </small>
                      ))}
                    <details style={{ marginTop: 12 }}>
                      <summary className="secondary-button" style={{ display: "inline-block", cursor: "pointer" }}>+ Nova versão</summary>
                      <form action={saveLegalDocument} className="form-grid">
                        <input type="hidden" name="kind" value={k} />
                        <label>
                          Versão
                          <input name="version" required pattern="[0-9]{1,3}\.[0-9]{1,3}" defaultValue={nextVersion(list)} />
                        </label>
                        <label>
                          Título
                          <input name="title" required maxLength={200} defaultValue={latest?.title.replace(/ — rascunho.*$/i, "") || LEGAL_KIND_LABEL[k]} />
                        </label>
                        <label className="wide">
                          Resumo das mudanças
                          <textarea name="changes_summary" rows={2} maxLength={2000} />
                        </label>
                        <label className="wide">
                          Texto (parte do {latest ? `v${latest.version}` : "zero"})
                          <textarea name="body" rows={12} maxLength={200000} defaultValue={latest?.body || ""} />
                        </label>
                        {k === "terms" && (
                          <label className="check wide">
                            <input type="checkbox" name="requires_reacceptance" />
                            <span>Exige nova aceitação dos criadores</span>
                          </label>
                        )}
                        <div className="wide form-actions">
                          <button type="submit" className="secondary-button">Criar rascunho</button>
                        </div>
                      </form>
                    </details>
                  </section>
                );
              })
            )}
          </Panel>

          <Panel
            title="Parar a plataforma (incidente)"
            eyebrow="SEGURANÇA"
            id="incidente"
            note="Use em caso de suspeita de violação de dados (RGPD, art. 33.º). Depois, siga o procedimento do README (secção «Incidentes»): avaliar em 24 h, notificar a CNPD em 72 h se houver risco, e registar o incidente."
          >
            {viewer.isSuper ? (
              <form action={lockdownPlatform} className="form-grid">
                <label className="wide">
                  Motivo (fica na auditoria)
                  <textarea name="reason" rows={2} required minLength={10} maxLength={500} placeholder="Ex.: suspeita de acesso indevido a contas de criadores" />
                </label>
                <label className="check wide">
                  <input type="checkbox" name="confirm" required />
                  <span>Termina já todas as sessões dos criadores e fecha as inscrições. Para reabrir, volte a abrir as inscrições acima.</span>
                </label>
                <div className="wide form-actions">
                  <button type="submit" className="danger-button">Parar a plataforma</button>
                </div>
              </form>
            ) : (
              <p className="muted">Só o Super Admin pode parar a plataforma.</p>
            )}
          </Panel>
        </>
      )}
    </CreatorsShell>
  );
}
