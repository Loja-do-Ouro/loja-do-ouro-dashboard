// Documentação do Apoio ao Cliente: lê docs/apoio/*.md, valida cada artigo com o formato de lib/support/docs-format.ts
// e grava os textos em lib/support/docs-content.generated.ts (o módulo que o servidor lê; assim os artigos vão sempre
// dentro do build da Vercel, sem ler ficheiros em produção).
//
//   node scripts/build-support-docs.mjs           valida e grava (npm run docs:apoio; corre antes do next build)
//   node scripts/build-support-docs.mjs --check   valida e falha se o módulo gravado estiver desatualizado (npm test)
//
// Um artigo mal formado (sem título ou resumo, endereço ou secção repetidos, ligação interna para um artigo ou secção que
// não existe, HTML, imagens…) pára tudo com o ficheiro e a linha de cada problema.
import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DOCS_DIR = "docs/apoio";
export const OUTPUT = "lib/support/docs-content.generated.ts";

// O mesmo código do formato que o servidor usa (o ficheiro não tem importações, por isso basta transpilá-lo).
export async function loadFormat(root = ROOT) {
  const src = await readFile(path.join(root, "lib/support/docs-format.ts"), "utf8");
  const { outputText } = ts.transpileModule(src, {
    fileName: "docs-format.ts",
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
}

export async function readSources(dir) {
  if (!existsSync(dir)) return [];
  const names = (await readdir(dir)).filter((f) => f.toLowerCase().endsWith(".md")).sort();
  return Promise.all(names.map(async (file) => ({ file, source: await readFile(path.join(dir, file), "utf8") })));
}

export function moduleText(sources) {
  return [
    "// Gerado por scripts/build-support-docs.mjs a partir de docs/apoio/*.md. Não editar à mão: depois de mudar um artigo,",
    "// correr `npm run docs:apoio` (o npm test falha enquanto este ficheiro estiver desatualizado; o build gera-o de novo).",
    'import type { DocSource } from "./docs-format";',
    "",
    "export const SUPPORT_DOC_SOURCES: DocSource[] = [",
    ...sources.map((s) => `  { file: ${JSON.stringify(s.file)}, source: ${JSON.stringify(s.source)} },`),
    "];",
    "",
  ].join("\n");
}

export async function buildSupportDocs({ root = ROOT, dir = path.join(root, DOCS_DIR) } = {}) {
  const fmt = await loadFormat(root);
  const sources = (await readSources(dir)).map((s) => ({ file: s.file, source: fmt.normalizeSource(s.source) }));
  const { docs, errors } = fmt.parseSupportDocs(sources);
  return { sources, docs, errors, text: moduleText(sources) };
}

// O módulo gravado, com fins de linha LF (no Windows o Git pode pô-los CRLF).
export async function currentModule(root = ROOT) {
  const file = path.join(root, OUTPUT);
  return existsSync(file) ? (await readFile(file, "utf8")).replace(/\r\n/g, "\n") : null;
}

if (/build-support-docs\.mjs$/.test(process.argv[1] || "")) {
  const check = process.argv.includes("--check");
  const r = await buildSupportDocs();
  if (r.errors.length) {
    console.error(`[docs:apoio] ${r.errors.length} problema(s) em ${DOCS_DIR}:`);
    for (const e of r.errors) console.error(`  ${e}`);
    process.exit(1);
  }
  const sections = r.docs.reduce((n, d) => n + d.sections.filter((s) => s.id).length, 0);
  const summary = `${r.docs.length} artigos, ${sections} secções`;
  if (!r.docs.length) console.warn(`[docs:apoio] Nenhum artigo em ${DOCS_DIR}: a área Documentação fica vazia.`);
  if ((await currentModule()) === r.text) console.info(`[docs:apoio] ${summary} (${OUTPUT} em dia).`);
  else if (check) {
    console.error(`[docs:apoio] ${OUTPUT} está desatualizado em relação a ${DOCS_DIR}: corra npm run docs:apoio e junte o ficheiro ao commit.`);
    process.exit(1);
  } else {
    await writeFile(path.join(ROOT, OUTPUT), r.text);
    console.info(`[docs:apoio] ${summary}: ${OUTPUT} gerado.`);
  }
}
