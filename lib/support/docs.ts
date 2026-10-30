import "server-only";
import { SUPPORT_DOC_SOURCES } from "./docs-content.generated";
import { docVisible, parseSupportDocs, type SupportDoc } from "./docs-format";
import { buildSearchIndex, searchDocs, searchRecords } from "./docs-search";

// Artigos da documentação do apoio (docs/apoio, gerados para lib/support/docs-content.generated.ts). Lidos uma vez por
// instância; o build já os validou, por isso um erro aqui quer dizer que o módulo gerado foi mexido à mão.
let cache: SupportDoc[] | null = null;

export function supportDocs(): SupportDoc[] {
  if (!cache) {
    const { docs, errors } = parseSupportDocs(SUPPORT_DOC_SOURCES);
    if (errors.length) throw new Error(`Documentação do apoio com erros (correr npm run docs:apoio): ${errors[0]}`);
    cache = docs;
  }
  return cache;
}

// Só o que esta pessoa pode ver: os artigos "super-admin" ficam fora da lista, da pesquisa e das ligações dos outros.
export const visibleSupportDocs = (isSuper: boolean) => supportDocs().filter((d) => docVisible(d, isSuper));

// Pesquisas sugeridas na página da documentação: só as que encontram alguma coisa nos artigos que a pessoa pode ver.
// Calculadas aqui uma vez por instância e por público (no browser eram um índice e 9 pesquisas a cada visita).
const SUGGESTIONS = [
  "Como transfiro uma conversa?",
  "Notas internas",
  "Resultado incerto",
  "Pedido de avaliação",
  "Revisão da IA antes de enviar",
  "Chat do site",
  "O cliente pediu para apagar os dados",
  "Livro de reclamações",
  "Devolução de uma compra online",
];
const suggested = new Map<boolean, string[]>();
export function suggestedSearches(isSuper: boolean): string[] {
  let list = suggested.get(isSuper);
  if (!list) {
    const index = buildSearchIndex(searchRecords(visibleSupportDocs(isSuper)));
    list = SUGGESTIONS.filter((s) => searchDocs(index, s).hits.length > 0).slice(0, 6);
    suggested.set(isSuper, list);
  }
  return list;
}
