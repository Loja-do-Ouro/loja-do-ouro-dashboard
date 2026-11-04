import Link from "next/link";
import { Panel } from "@/components/dashboard/ui";
import { Flash, PageHeading } from "@/components/shell";
import { crCreatorsList, type CrCreatorsFilter, type CrPlatform } from "@/lib/criadores/db";
import { CREATOR_STATUS_LABEL, lisbonDate, lisbonDateTime, PLATFORM_LABEL, PLATFORMS, type CreatorStatus } from "@/lib/criadores-rules";
import { rpc } from "@/lib/supabase";
import { requireCreatorsViewer, type Viewer } from "@/lib/viewer";
import { creatorsError, creatorsMessage } from "../messages";
import { CreatorsShell, num, StatusPill, VerificationTag } from "../ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Criadores · Loja do Ouro" };

const STATUSES = Object.keys(CREATOR_STATUS_LABEL) as CreatorStatus[];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

// Lojas para o filtro. A lista completa só existe para o Super Admin (ldo_list_stores); as outras pessoas veem as
// lojas a que têm acesso no dashboard. Sem nenhuma, o filtro não aparece.
async function storeOptions(viewer: Viewer): Promise<{ id: string; name: string }[]> {
  if (viewer.isSuper) {
    const all = await rpc<{ id: string; name: string; active: boolean }[]>("ldo_list_stores", { p_session: viewer.session }).catch(() => []);
    return all.filter((s) => s.active).map(({ id, name }) => ({ id, name }));
  }
  return viewer.stores.map(({ id, name }) => ({ id, name }));
}

export default async function CreatorsListPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const viewer = await requireCreatorsViewer("view");
  const sp = await searchParams;
  const status = STATUSES.includes(one(sp.estado) as CreatorStatus) ? (one(sp.estado) as CreatorStatus) : undefined;
  const platform = (PLATFORMS as readonly string[]).includes(one(sp.rede)) ? (one(sp.rede) as CrPlatform) : undefined;
  const store = UUID.test(one(sp.loja)) ? one(sp.loja) : undefined;
  const verified = one(sp.verificado) === "sim" ? "true" : one(sp.verificado) === "nao" ? "false" : undefined;
  const changed = one(sp.alterados) === "1";
  const q = one(sp.q).trim().slice(0, 100);
  const order = one(sp.ordem) === "nome" ? "name" : "created";
  const page = /^[0-9]{1,5}$/.test(one(sp.pagina)) ? Math.max(1, Number(one(sp.pagina))) : 1;

  // Ordem por data de registo ou por nome. Nunca por seguidores nem outras métricas (§4.2).
  const filter: CrCreatorsFilter = {
    ...(status ? { status } : {}), ...(platform ? { platform } : {}), ...(store ? { store_id: store } : {}),
    ...(verified ? { verified } : {}), ...(changed ? { changed: "true" } : {}), ...(q ? { q } : {}), order, page,
  };
  const [list, stores] = await Promise.all([crCreatorsList(viewer.session, filter).catch(() => null), storeOptions(viewer)]);
  const pages = list ? Math.max(1, Math.ceil(list.total / (list.page_size || 50))) : 1;

  const params = (over: Record<string, string>) => {
    const p = new URLSearchParams();
    const base: Record<string, string> = {
      estado: status || "", rede: platform || "", loja: store || "", verificado: one(sp.verificado), alterados: changed ? "1" : "", q,
      ordem: order === "name" ? "nome" : "",
    };
    for (const [k, v] of Object.entries({ ...base, ...over })) if (v) p.set(k, v);
    const s = p.toString();
    return `/influenciadores/criadores${s ? `?${s}` : ""}`;
  };

  return (
    <CreatorsShell viewer={viewer} current="influenciadores-criadores" title="Criadores">
      <PageHeading
        eyebrow="INFLUENCIADORES"
        title="Criadores"
        text="Contas registadas na plataforma. Os números das redes são os declarados pelo criador, salvo quando validados pela equipa; a lista nunca se ordena por métricas."
      />
      <Flash ok={creatorsMessage(sp)} error={creatorsError(sp)} />

      <nav className="chips" aria-label="Estado">
        <Link href={params({ estado: "", pagina: "" })} className={`chip${!status ? " active" : ""}`} aria-current={!status ? "page" : undefined}>Todos</Link>
        {(["pending_review", "approved", "draft", "suspended", "rejected", "restricted", "deleted"] as const).map((s) => (
          <Link key={s} href={params({ estado: s, pagina: "" })} className={`chip${status === s ? " active" : ""}`} aria-current={status === s ? "page" : undefined}>
            {CREATOR_STATUS_LABEL[s]}
          </Link>
        ))}
      </nav>

      <Panel
        title={list ? `${num(list.total)} ${list.total === 1 ? "criador" : "criadores"}` : "Criadores"}
        eyebrow="LISTA"
        note="«Verificado» = Instagram ligado (PR 3B); «Dados públicos» = números lidos da Meta (PR 3A); «Não verificado» = só declarado. Seguidores: o último número validado pela equipa ou, sem ele, o último declarado, com a data."
      >
        <form method="get" className="inline-form list-controls">
          {status && <input type="hidden" name="estado" value={status} />}
          <label>
            Procurar
            <input name="q" defaultValue={q} placeholder="Nome, email ou @" maxLength={100} />
          </label>
          <label>
            Rede
            <select name="rede" defaultValue={platform || ""}>
              <option value="">Todas</option>
              {PLATFORMS.map((p) => (
                <option key={p} value={p}>{PLATFORM_LABEL[p]}</option>
              ))}
            </select>
          </label>
          <label>
            Verificação
            <select name="verificado" defaultValue={one(sp.verificado)}>
              <option value="">Todas</option>
              <option value="sim">Verificado ou dados públicos</option>
              <option value="nao">Só declarado</option>
            </select>
          </label>
          {stores.length > 0 && (
            <label>
              Loja
              <select name="loja" defaultValue={store || ""}>
                <option value="">Todas</option>
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </label>
          )}
          <label>
            Ordem
            <select name="ordem" defaultValue={order === "name" ? "nome" : ""}>
              <option value="">Registo mais recente</option>
              <option value="nome">Nome</option>
            </select>
          </label>
          <label className="checkbox-label">
            <input type="checkbox" name="alterados" value="1" defaultChecked={changed} /> Alterados desde a revisão
          </label>
          <button type="submit" className="secondary-button">Filtrar</button>
          {(q || platform || store || verified || changed || order === "name") && (
            <Link href={status ? `/influenciadores/criadores?estado=${status}` : "/influenciadores/criadores"} className="muted">Limpar filtros</Link>
          )}
        </form>

        {!list ? (
          <div className="notice error-notice">Lista indisponível (falta a atualização da base de dados?).</div>
        ) : (
          <>
            <div className="table-scroll" tabIndex={0} aria-label="Criadores">
              <table className="left-table">
                <thead>
                  <tr>
                    <th>Criador</th>
                    <th>Cidade</th>
                    <th>Estado</th>
                    <th>Redes</th>
                    <th>Lojas</th>
                    <th>Mensagens</th>
                    <th>Registo</th>
                  </tr>
                </thead>
                <tbody>
                  {list.items.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <Link href={`/influenciadores/criadores/${c.id}`}>
                          <strong>{c.display_name || c.full_name || "Sem nome"}</strong>
                        </Link>
                        {c.display_name && c.full_name && <small className="muted block">{c.full_name}</small>}
                        <small className="muted block">{c.email}</small>
                      </td>
                      <td>
                        {c.city || "—"}
                        {c.district && c.district !== c.city && <small className="muted block">{c.district}</small>}
                      </td>
                      <td>
                        <StatusPill status={c.status} />
                        {c.changed_since_review && <small className="muted block">Alterado desde a revisão</small>}
                        {c.iban_pending && <small className="muted block">IBAN por confirmar</small>}
                      </td>
                      <td>
                        {c.networks.length ? (
                          c.networks.map((n) => (
                            <div key={n.id} style={{ marginBottom: 4 }}>
                              <span>{PLATFORM_LABEL[n.platform] ?? n.platform} @{n.handle}</span> <VerificationTag v={n.verification} />
                              {n.followers !== null && (
                                <small className="muted block">
                                  {num(n.followers)} seguidores · {n.followers_source === "validated" ? "validado" : "declarado"}
                                  {n.followers_on ? ` em ${lisbonDate(n.followers_on)}` : ""}
                                </small>
                              )}
                            </div>
                          ))
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td>{c.stores_count || "—"}</td>
                      <td>{c.unread_messages ? <span className="pill warn">{c.unread_messages} por ler</span> : <span className="muted">—</span>}</td>
                      <td>
                        {lisbonDate(c.created_at)}
                        {c.submitted_at && <small className="muted block">Submetido {lisbonDate(c.submitted_at)}</small>}
                        <small className="muted block">{c.last_login_at ? `Entrou ${lisbonDateTime(c.last_login_at)}` : "Ainda não entrou"}</small>
                      </td>
                    </tr>
                  ))}
                  {!list.items.length && (
                    <tr>
                      <td colSpan={7} className="muted">
                        {q || platform || store || verified || changed || status ? "Ninguém corresponde aos filtros." : "Ainda não há criadores registados."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {pages > 1 && (
              <nav className="month-nav" aria-label="Páginas" style={{ marginTop: 14 }}>
                {page > 1 ? <Link className="outline-button" href={params({ pagina: String(page - 1) })} rel="prev">← Anterior</Link> : <span />}
                <span className="muted">Página {page} de {pages} · 50 por página</span>
                {page < pages ? <Link className="outline-button" href={params({ pagina: String(page + 1) })} rel="next">Seguinte →</Link> : <span />}
              </nav>
            )}
          </>
        )}
      </Panel>
    </CreatorsShell>
  );
}
