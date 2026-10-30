// Pesquisa da documentação do apoio. Corre no browser, a cada tecla, sobre um índice compacto (uma linha por secção dos
// artigos que a pessoa pode ver). Pensada para perguntas escritas como se fala: "como passo uma conversa a um colega?"
// encontra a secção sobre transferir conversas.
//
// 1. Normalizar: minúsculas, sem acentos (ç → c), sem pontuação; palavras vazias fora (como, o, de, posso, quero…).
// 2. Raiz leve do português: plurais (-s, -es, -ões, -ães, -ais, -éis, -is), -mente e formas verbais comuns
//    (transferir, transfiro, transferi, transferência, transferida → "transfer").
// 3. Conceitos do apoio: sinónimos e expressões (apagar = eliminar = esquecimento; RGPD = proteção de dados…).
// 4. Erros de escrita: 1 letra trocada em palavras com 5+ letras, 2 com 8+ ("Quis dizer …?"); a última palavra conta
//    como início de palavra enquanto se escreve.
// 5. Pontos por campo (título > perguntas > título da secção > termos > resumo > texto), raridade da palavra, várias
//    palavras na mesma secção e a frase exata. Resultados por secção, no máximo 3 por artigo e 20 no total.
import { fold, type SupportDoc } from "./docs-format";

export type SearchRecord = {
  slug: string;
  title: string;
  anchor: string; // "" = início do artigo
  heading: string;
  parent: string; // título da secção ## de uma ###
  perguntas: string[];
  // Só na linha do início do artigo (anchor ""): valem para o artigo todo.
  termos: string[];
  resumo: string;
  text: string;
};
export type Segment = { text: string; hit: boolean };
export type SearchHit = {
  slug: string;
  anchor: string;
  href: string;
  title: Segment[];
  heading: Segment[] | null;
  parent: string;
  question: Segment[] | null;
  snippet: Segment[];
  score: number;
};
export type SearchResult = { hits: SearchHit[]; terms: number; suggestion: string | null };

// ------------------------------------------------------------------------------------------------- normalização

const STOPWORDS = `a o as os um uma uns umas de do da dos das dum duma num numa em no na nos nas por pelo pela pelos pelas para pra pro
com sem e ou mas nem se que quem qual quais quanto quanta quantos quantas como onde quando porque porquê pq isto isso aquilo este esta
estes estas esse essa esses essas aquele aquela aqueles aquelas eu tu ele ela eles elas você vocês voce voces me te lhe lhes meu minha
meus minhas teu tua seu sua seus suas nosso nossa nossos nossas ao aos à às já ainda também só muito muita muitos muitas mais menos bem
aqui ali lá sim não é ser sou são era eram foi foram seja sejam estar estou está estão estava ter tem têm tenho temos tinha haver há
fazer faço faz fazem fazemos faça façam feito posso pode podem podemos poder devo deve devem dever quero quer querem queria gostaria
preciso precisa precisam consigo consegue conseguem conseguir saber sei sabe vou vai vão ir existe existem algum alguma
alguns algumas algo cada outro outra outros outras todo toda todos todas tudo nada entre sobre até após desde depois antes agora sempre
então ok etc olá obrigado obrigada significa dizer coisa coisas tipo vez dele dela deles delas nele nela neles nelas deste desta disto
disso nisto nisso daquele daquela naquele naquela`;
const STOP = new Set(fold(STOPWORDS).split(/\s+/).filter(Boolean));

// Marcas, siglas e palavras que a raiz estragaria (livre ≠ livro).
const NO_STEM = new Set(
  `email gmail zendesk whatsapp instagram facebook messenger metricool shopify google claude haiku sonnet opus resend vercel supabase
  anthropic bluedot klaviyo rgpd gdpr cnpd dpo kpi csat nif iva pdf sms url api oauth livre livro pais mais depois status chatbot widget
  site online emoji emojis`.split(/\s+/).filter(Boolean),
);
const IRREGULAR: Record<string, string> = {
  transfiro: "transfer",
  transfira: "transfer",
  transfiram: "transfer",
  prefiro: "prefer",
  prefira: "prefer",
  peco: "ped",
  pecam: "ped",
  leis: "lei",
  emails: "email",
  sigo: "segu",
  siga: "segu",
};
const VERB_S = ["aram", "eram", "iram", "amos", "emos", "imos"];
const SUFFIXES = ["encia", "ancia", "amento", "imento", "adora", "ador", "cao", "ando", "endo", "indo", "ado", "ada", "ido", "ida", "ar", "er", "ir", "ei", "ou", "iu", "eu", "am", "em"];

function singular(s: string): string {
  if (s.length < 4) return s;
  if (/(?:oe|ae)s$/.test(s)) return `${s.slice(0, -3)}ao`; // notificações, alemães
  if (s.endsWith("aos")) return s.slice(0, -1); // mãos
  if (/[aeou]is$/.test(s) && s.length > 4) return `${s.slice(0, -2)}l`; // canais, papéis, lençóis, azuis
  if (s.endsWith("is") && s.length >= 5) return `${s.slice(0, -1)}l`; // fuzis
  if (s.endsWith("ns")) return `${s.slice(0, -2)}m`; // mensagens, itens
  if (/[rz]es$/.test(s) || s.endsWith("eses")) return s.slice(0, -2); // colaboradores, vezes, meses
  if (s.endsWith("s") && !/(?:ss|us)$/.test(s)) return s.slice(0, -1);
  return s;
}

// Raiz leve (o mesmo para o texto dos artigos e para o que se escreve na pesquisa). Recebe uma palavra já normalizada.
const STEMS = new Map<string, string>();
export function stem(word: string): string {
  let s = STEMS.get(word);
  if (s === undefined) {
    if (STEMS.size > 50000) STEMS.clear();
    s = rawStem(word);
    STEMS.set(word, s);
  }
  return s;
}

function rawStem(word: string): string {
  if (word.length < 4 || /\d/.test(word)) return word;
  if (IRREGULAR[word]) return IRREGULAR[word];
  if (NO_STEM.has(word)) return word;
  let s = word;
  let cut = false;
  for (const suf of VERB_S)
    if (s.endsWith(suf) && s.length - suf.length >= 3) {
      s = s.slice(0, -suf.length);
      cut = true;
      break;
    }
  if (!cut) {
    s = singular(s);
    if (IRREGULAR[s]) return IRREGULAR[s];
    if (NO_STEM.has(s)) return s;
    if (s.endsWith("mente") && s.length - 5 >= 4) s = s.slice(0, -5);
    for (const suf of SUFFIXES)
      if (s.endsWith(suf) && s.length - suf.length >= 3) {
        s = s.slice(0, -suf.length);
        break;
      }
  }
  if (s.length >= 6 && /(?:[^aeiou]|u)i$/.test(s)) s = s.slice(0, -1); // transferi, atribui
  if (s.length >= 5 && /[aeo]$/.test(s)) s = s.slice(0, -1); // conversa/conversar, envio/enviar
  if (s.length >= 4) s = s.replace(/gu$/, "g").replace(/qu$/, "c"); // apague/apagar, fique/ficar
  return s;
}

type Token = { norm: string; display: string; start: number; end: number };

// Palavras com a posição no texto original (para destacar no excerto).
function tokens(text: string): Token[] {
  const out: Token[] = [];
  for (const m of text.matchAll(/[\p{L}\p{N}]+/gu)) {
    const display = m[0].toLowerCase();
    const norm = fold(display).replace(/[^a-z0-9]/g, "");
    if (!norm) continue;
    out.push({ norm, display, start: m.index ?? 0, end: (m.index ?? 0) + m[0].length });
  }
  return out;
}

const meaningful = (norm: string) => !STOP.has(norm) && (norm.length >= 2 || /\d/.test(norm));
// "e-mail" conta como "email".
const prepare = (text: string) => text.replace(/(^|[^\p{L}\p{N}])e-mail/giu, "$1email");

// Raízes das palavras com significado, pela ordem do texto.
export function analyze(text: string): string[] {
  return tokens(prepare(text))
    .filter((t) => meaningful(t.norm))
    .map((t) => stem(t.norm));
}

// ------------------------------------------------------------------------------------------------- conceitos

// Palavras e expressões que querem dizer o mesmo no apoio. Uma expressão conta quando as palavras aparecem seguidas
// (sem as palavras vazias). Acrescentar aqui o que a equipa procura e não encontra.
export const CONCEPTS: [string, string[]][] = [
  ["apagar", ["apagar", "apagamento", "eliminar", "eliminação", "esquecimento", "direito ao esquecimento", "direito ao apagamento", "remover", "remoção", "excluir", "limpar", "destruir"]],
  ["rgpd", ["rgpd", "gdpr", "rgdp", "proteção de dados", "privacidade", "dados pessoais", "regulamento geral sobre a proteção de dados", "lei de proteção de dados"]],
  ["avaliacao", ["avaliação", "avaliar", "pedido de avaliação", "kpi", "satisfação", "estrelas", "estrela", "nota", "desempenho", "classificação", "rating", "inquérito", "csat", "pontuação"]],
  ["transferir", ["transferir", "transferência", "passar", "encaminhar", "atribuir", "reatribuir", "delegar", "mudar de responsável", "trocar de responsável"]],
  ["conversa", ["conversa", "ticket", "pedido"]],
  ["ia", ["ia", "chatbot", "assistente", "inteligência artificial", "bot", "robô", "claude", "assistente de ia"]],
  ["reclamacao", ["reclamação", "queixa", "livro de reclamações", "reclamar", "queixar", "livro amarelo"]],
  ["devolucao", ["devolução", "devolver", "troca", "trocar", "livre resolução", "direito de livre resolução", "arrependimento", "desistência", "reembolso", "reembolsar"]],
  ["garantia", ["garantia", "reparação", "reparar", "avaria", "defeito", "defeituoso", "conserto", "assistência técnica", "falta de conformidade"]],
  ["responsavel", ["responsável", "dono", "dona", "dono da conversa", "assumir"]],
  ["colega", ["colega", "colaborador", "colaboradora", "funcionário", "funcionária", "agente", "equipa", "operador"]],
  ["email", ["email", "gmail", "correio eletrónico", "mail", "caixa de correio"]],
  ["facebook", ["facebook", "messenger", "fb"]],
  ["instagram", ["instagram", "insta", "ig", "direct", "dm"]],
  ["redes", ["redes sociais", "metricool", "meta", "facebook", "instagram", "messenger"]],
  ["whatsapp", ["whatsapp", "whats", "wpp", "zap"]],
  ["chat-site", ["chat do site", "widget", "chat", "conversa no site", "chat online", "janela de chat"]],
  ["anexo", ["anexo", "anexar", "ficheiro", "imagem", "foto", "fotografia", "pdf", "attachment"]],
  ["encomenda", ["encomenda", "compra", "order", "pedido de compra"]],
  ["fechar", ["resolver", "resolvida", "fechar", "fechada", "concluir", "encerrar", "arquivar"]],
  ["nota-interna", ["nota interna", "notas internas", "comentário interno", "comentário privado", "nota privada"]],
  ["aviso", ["notificação", "notificar", "aviso", "alerta"]],
  ["acesso", ["acesso", "permissão", "autorização", "perfil"]],
  // O papel, à parte do acesso: "acesso" não deve acender todas as secções que falam do Super Admin.
  ["super-admin", ["super admin", "superadmin", "administrador", "admin"]],
  // "ver" conta ("posso ver", "quem vê"): é a intenção da pergunta.
  ["ver", ["ver", "vejo", "veja", "vê", "veem", "vês"]],
  ["login", ["palavra-passe", "password", "senha", "login", "iniciar sessão", "sessão"]],
  ["consentimento", ["consentimento", "consentir", "autorização", "opt-in"]],
  ["marketing", ["marketing", "newsletter", "publicidade", "promoções", "campanha", "comunicações comerciais"]],
  ["conservacao", ["conservação", "conservar", "retenção", "armazenamento", "prazo de conservação"]],
  ["violacao", ["violação de dados", "fuga de dados", "incidente", "ataque", "data breach", "violação"]],
  ["acesso-dados", ["portabilidade", "exportar", "cópia dos dados", "acesso aos dados", "direito de acesso"]],
  ["retificacao", ["retificação", "retificar", "corrigir", "correção", "atualizar dados"]],
  ["dpo", ["encarregado de proteção de dados", "encarregado", "dpo", "data protection officer"]],
  ["cnpd", ["cnpd", "comissão nacional de proteção de dados", "autoridade de controlo"]],
  ["fatura", ["fatura", "factura", "recibo", "nif", "contribuinte"]],
  ["telefone", ["telefone", "telemóvel", "número de telefone", "contacto telefónico"]],
  ["horario", ["horário", "fora de horas", "fora do horário", "expediente", "hora de lisboa"]],
  ["automatica", ["resposta automática", "respostas automáticas", "mensagem automática", "mensagem de ausência", "autoresposta", "auto-resposta"]],
  ["spam", ["spam", "lixo", "lixo eletrónico"]],
  ["historico", ["histórico", "antigas", "antigo", "histórico visível"]],
  ["sincronizar", ["sincronizar", "sincronização", "atualizar", "refrescar"]],
  ["lingua", ["língua", "idioma", "tradução", "traduzir", "inglês", "espanhol", "francês", "alemão"]],
  ["marca", ["marca", "gold store premium", "gsp"]],
  ["reacao", ["reação", "emoji", "gosto", "like", "story", "stories", "menção"]],
  ["comentario", ["comentário", "publicação", "post", "anúncio"]],
  ["produto", ["produto", "peça", "joia", "catálogo", "link do produto"]],
  ["revisao", ["revisão", "rever", "revisar", "sugestão"]],
  ["resposta", ["resposta", "responder", "réplica"]],
  ["prazo", ["prazo", "demora", "atraso"]],
  ["artigo-lei", ["artigo", "art"]],
  ["consumidor", ["consumidor", "cliente", "comprador"]],
  ["titular", ["titular dos dados", "titular", "interessado"]],
  ["cookies", ["cookie", "cookies", "rastreamento"]],
  ["seguranca", ["segurança", "cifra", "cifrado", "encriptação", "token"]],
  ["eua", ["eua", "estados unidos", "américa", "fora da ue", "fora da união europeia", "fora da europa", "transferência internacional"]],
  // Não juntar "preço": na documentação é o preço dos produtos.
  ["custo", ["custo", "custa", "custar", "orçamento", "gasto", "gastar", "despesa"]],
  ["saude", ["saúde", "doença", "doente", "médico", "medicação", "dados sensíveis", "dados de saúde", "categorias especiais"]],
];

const CONCEPT_BY_STEM = new Map<string, string[]>();
const PHRASES = new Map<string, { seq: string[]; concept: string }[]>(); // primeira raiz → expressões
const CONCEPT_WORDS: { norm: string; display: string; concept: string }[] = [];
for (const [id, members] of CONCEPTS)
  for (const m of members) {
    const seq = analyze(m);
    if (!seq.length) continue;
    if (seq.length === 1) {
      const list = CONCEPT_BY_STEM.get(seq[0]) || [];
      if (!list.includes(id)) list.push(id);
      CONCEPT_BY_STEM.set(seq[0], list);
      const norm = fold(m).replace(/[^a-z0-9]/g, "");
      CONCEPT_WORDS.push({ norm, display: m.toLowerCase(), concept: id });
    } else {
      const list = PHRASES.get(seq[0]) || [];
      list.push({ seq, concept: id });
      PHRASES.set(seq[0], list);
    }
  }

// Conceitos de cada posição de uma sequência de raízes (palavras soltas e expressões).
function conceptsAt(seq: string[]): string[][] {
  const out = seq.map((s) => [...(CONCEPT_BY_STEM.get(s) || [])]);
  seq.forEach((s, i) => {
    for (const p of PHRASES.get(s) || [])
      if (p.seq.every((x, k) => seq[i + k] === x))
        for (let k = 0; k < p.seq.length; k++) if (!out[i + k].includes(p.concept)) out[i + k].push(p.concept);
  });
  return out;
}

// ------------------------------------------------------------------------------------------------- índice

type Field = "title" | "perguntas" | "heading" | "parent" | "termos" | "resumo" | "body";
const FIELDS: Field[] = ["title", "perguntas", "heading", "parent", "termos", "resumo", "body"];
const WEIGHT: Record<Field, number> = { title: 6, perguntas: 5, heading: 4.5, termos: 3.5, resumo: 2.5, parent: 2, body: 1.2 };
// Campos da própria secção (os outros são do artigo e valem para todas as secções dele).
const OWN: Field[] = ["perguntas", "heading", "body"];
type FieldData = { tf: Map<string, number>; seq: string[]; len: number };
type Unit = { rec: SearchRecord; article: number; f: Record<Field, FieldData> };
type VocabEntry = { stem: string; count: number; display: string };
export type SearchIndex = {
  units: Unit[];
  df: Map<string, number>;
  known: Set<string>;
  vocab: Map<string, VocabEntry>;
  avgBody: number;
};

export function buildSearchIndex(records: SearchRecord[]): SearchIndex {
  const vocab = new Map<string, VocabEntry>();
  const known = new Set<string>();
  const field = (text: string): FieldData => {
    const toks = tokens(prepare(text)).filter((t) => meaningful(t.norm));
    const seq = toks.map((t) => stem(t.norm));
    const tf = new Map<string, number>();
    const add = (k: string) => {
      tf.set(k, (tf.get(k) || 0) + 1);
      known.add(k);
    };
    toks.forEach((t, i) => {
      add(seq[i]);
      const v = vocab.get(t.norm);
      if (v) v.count++;
      else vocab.set(t.norm, { stem: seq[i], count: 1, display: t.display });
    });
    conceptsAt(seq).forEach((cs) => cs.forEach((c) => add(`~${c}`)));
    return { tf, seq, len: seq.length };
  };
  const articles = new Map<string, { n: number; title: FieldData; termos: FieldData; resumo: FieldData }>();
  for (const r of records)
    if (!articles.has(r.slug) || r.anchor === "") {
      const prev = articles.get(r.slug);
      articles.set(r.slug, {
        n: prev?.n ?? articles.size,
        title: field(r.title),
        termos: field(r.termos.join(" · ")),
        resumo: field(r.resumo),
      });
    }
  const units: Unit[] = records.map((r) => {
    const a = articles.get(r.slug)!;
    return {
      rec: r,
      article: a.n,
      f: {
        title: a.title,
        termos: a.termos,
        resumo: a.resumo,
        perguntas: field(r.perguntas.join(" · ")),
        heading: field(r.heading),
        parent: field(r.parent),
        body: field(r.text),
      },
    };
  });
  // Raridade: em quantas secções aparece cada palavra (no texto da própria secção).
  const df = new Map<string, number>();
  for (const u of units) {
    const seen = new Set<string>();
    for (const f of OWN) for (const k of u.f[f].tf.keys()) seen.add(k);
    for (const k of seen) df.set(k, (df.get(k) || 0) + 1);
  }
  // Palavras dos conceitos também servem para corrigir erros ("esquecimeto" → esquecimento), se o conceito existir.
  for (const w of CONCEPT_WORDS)
    if (known.has(`~${w.concept}`) && !vocab.has(w.norm)) vocab.set(w.norm, { stem: stem(w.norm), count: 0, display: w.display });
  const avgBody = units.reduce((s, u) => s + u.f.body.len, 0) / Math.max(1, units.length);
  return { units, df, known, vocab, avgBody: avgBody || 1 };
}

// ------------------------------------------------------------------------------------------------- consulta

type Variant = { token: string; q: number };
type Term = { norm: string; display: string; stem: string; variants: Variant[]; tokens: Set<string>; fix: string | null };

// Distância de edição com troca de letras vizinhas (Damerau, versão simples), parando acima do máximo.
export function editDistance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur.push(v);
      if (v < best) best = v;
    }
    if (best > max) return max + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[b.length];
}

const maxTypos = (len: number) => (len >= 8 ? 2 : len >= 5 ? 1 : 0);

function closest(index: SearchIndex, norm: string): VocabEntry & { norm: string } | null {
  const max = maxTypos(norm.length);
  if (!max) return null;
  let best: (VocabEntry & { norm: string; d: number }) | null = null;
  for (const [w, e] of index.vocab) {
    if (Math.abs(w.length - norm.length) > max || w.length < 4) continue;
    const d = editDistance(norm, w, max);
    if (d > max) continue;
    if (!best || d < best.d || (d === best.d && e.count > best.count)) best = { ...e, norm: w, d };
  }
  return best;
}

function addVariant(list: Variant[], token: string, q: number) {
  const v = list.find((x) => x.token === token);
  if (v) v.q = Math.max(v.q, q);
  else list.push({ token, q });
}

function parseQuery(index: SearchIndex, raw: string): Term[] {
  const typing = raw.length > 0 && !/\s$/.test(raw);
  const all = tokens(prepare(raw)).filter((t) => t.norm.length >= 2 || /\d/.test(t.norm));
  if (!all.length) return [];
  const last = all[all.length - 1];
  let words = all.filter((t) => meaningful(t.norm));
  // Só palavras vazias, a meio de escrever ("com"): a última conta como início de palavra ("comentário").
  const prefixOnly = !words.length && typing && last.norm.length >= 2;
  if (prefixOnly) words = [last];
  const terms: Term[] = [];
  for (const w of words) {
    const st = stem(w.norm);
    if (terms.some((t) => t.stem === st)) continue;
    const variants: Variant[] = prefixOnly ? [] : [{ token: st, q: 1 }];
    if (!prefixOnly) for (const c of CONCEPT_BY_STEM.get(st) || []) addVariant(variants, `~${c}`, 0.8);
    // A escrever: a última palavra também conta como início de outras ("transf" → transferir, transferência).
    if (typing && w === last) {
      const found: VocabEntry[] = [];
      for (const [n, e] of index.vocab) if (n !== w.norm && n.startsWith(w.norm) && e.count) found.push(e);
      found.sort((a, b) => b.count - a.count);
      for (const e of found.slice(0, 30)) addVariant(variants, e.stem, w.norm.length >= 4 ? 0.9 : 0.7);
    }
    terms.push({ norm: w.norm, display: w.display, stem: st, variants, tokens: new Set(), fix: null });
  }
  // Expressões ("livro de reclamações", "proteção de dados") dão o conceito a cada palavra.
  conceptsAt(terms.map((t) => t.stem)).forEach((cs, i) => cs.forEach((c) => addVariant(terms[i].variants, `~${c}`, 0.8)));
  for (const t of terms) {
    if (!t.variants.some((v) => index.known.has(v.token))) {
      // Palavra que não existe na documentação: a mais parecida (erro de escrita).
      const c = closest(index, t.norm);
      if (c) {
        addVariant(t.variants, c.stem, 0.7);
        for (const k of CONCEPT_BY_STEM.get(c.stem) || []) addVariant(t.variants, `~${k}`, 0.55);
        t.fix = c.display;
      }
    }
    t.tokens = new Set(t.variants.map((v) => v.token));
  }
  // Uma palavra vazia a meio de escrever que não começa nenhuma outra ("posso"): não há nada para procurar.
  return terms.filter((t) => t.variants.length);
}

const idf = (index: SearchIndex, token: string) => {
  const n = index.units.length;
  const df = index.df.get(token) || 0;
  return 0.25 + Math.log(1 + (n - df + 0.5) / (df + 0.5));
};

function tfWeight(field: Field, tf: number, len: number, avg: number): number {
  if (field !== "body") return 1 + 0.15 * (Math.min(tf, 3) - 1);
  const k = 1.2;
  const b = 0.6;
  return (tf * (k + 1)) / (tf + k * (1 - b + (b * len) / avg));
}

const containsSeq = (seq: string[], q: string[]) => {
  if (q.length < 2 || seq.length < q.length) return false;
  outer: for (let i = 0; i <= seq.length - q.length; i++) {
    for (let k = 0; k < q.length; k++) if (seq[i + k] !== q[k]) continue outer;
    return true;
  }
  return false;
};

type Scored = { unit: Unit; score: number; own: number };

function scoreUnit(index: SearchIndex, terms: Term[], u: Unit, idfs: Map<string, number>): Scored {
  let total = 0;
  let own = 0;
  let matched = 0;
  let ownMatched = 0;
  let inHeading = 0;
  let inQuestions = 0;
  for (const t of terms) {
    const perField: number[] = [];
    let ownBest = 0;
    for (const f of FIELDS) {
      const fd = u.f[f];
      let best = 0;
      for (const v of t.variants) {
        const tf = fd.tf.get(v.token);
        if (!tf) continue;
        const s = WEIGHT[f] * v.q * idfs.get(v.token)! * tfWeight(f, tf, fd.len, index.avgBody);
        if (s > best) best = s;
      }
      if (best) {
        perField.push(best);
        if (OWN.includes(f) && best > ownBest) ownBest = best;
        if (f === "heading") inHeading++;
        if (f === "perguntas") inQuestions++;
      }
    }
    if (!perField.length) continue;
    perField.sort((a, b) => b - a);
    total += perField[0] + 0.3 * perField.slice(1).reduce((s, x) => s + x, 0);
    matched++;
    if (ownBest) {
      own += ownBest;
      ownMatched++;
    }
  }
  if (!matched) return { unit: u, score: 0, own: 0 };
  const coverage = matched / terms.length;
  let score = total * (0.3 + 0.7 * coverage * coverage);
  // Várias palavras na mesma secção.
  if (ownMatched >= 2) score *= 1 + 0.2 * (ownMatched - 1);
  // A frase exata (sem palavras vazias) no título, nas perguntas ou no texto da secção; senão, todas as palavras no
  // título da secção ou nas perguntas, por qualquer ordem.
  const q = terms.map((t) => t.stem);
  // O título da secção é exatamente o que se procura ("o que é o Super Admin?" → a entrada "Super Admin" do glossário).
  const sameHeading = u.f.heading.len > 0 && u.f.heading.seq.length === q.length && q.every((x, i) => u.f.heading.seq[i] === x);
  if (sameHeading) score *= 2;
  else if (containsSeq(u.f.heading.seq, q) || containsSeq(u.f.perguntas.seq, q)) score *= 1.6;
  else if (terms.length >= 2 && (inHeading === terms.length || inQuestions === terms.length)) score *= 1.4;
  else if (containsSeq(u.f.body.seq, q) || containsSeq(u.f.title.seq, q)) score *= 1.25;
  return { unit: u, score, own };
}

// Palavras de um texto com as chaves de cada uma (raiz e conceitos; vazio nas palavras vazias). Guardado por texto: o
// mesmo excerto volta a ser pedido a cada tecla.
type Marked = { toks: Token[]; keys: string[][] };
const MARKED = new Map<string, Marked>();
function marked(text: string): Marked {
  let m = MARKED.get(text);
  if (!m) {
    const toks = tokens(text);
    const seq = toks.map((t) => (meaningful(t.norm) ? stem(t.norm) : ""));
    const concepts = conceptsAt(seq);
    m = { toks, keys: seq.map((s, i) => (s ? [s, ...concepts[i].map((c) => `~${c}`)] : [])) };
    if (MARKED.size > 3000) MARKED.clear();
    MARKED.set(text, m);
  }
  return m;
}

const termsOf = (keys: string[], terms: Term[]) => terms.map((t, k) => (keys.some((x) => t.tokens.has(x)) ? k : -1)).filter((k) => k >= 0);

// Texto em pedaços, com as palavras encontradas marcadas.
function highlight(text: string, terms: Term[], from = 0, to = text.length): Segment[] {
  const out: Segment[] = [];
  let at = from;
  const { toks, keys } = marked(text);
  toks.forEach((t, i) => {
    if (t.start < from || t.end > to || !keys[i].length || !termsOf(keys[i], terms).length) return;
    if (t.start > at) out.push({ text: text.slice(at, t.start), hit: false });
    out.push({ text: text.slice(t.start, t.end), hit: true });
    at = t.end;
  });
  if (at < to) out.push({ text: text.slice(at, to), hit: false });
  return out.filter((s) => s.text);
}

const hasHit = (s: Segment[]) => s.some((x) => x.hit);

// Excerto de ~30 palavras à volta do sítio onde aparecem mais palavras da pesquisa.
function snippet(text: string, terms: Term[]): Segment[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const { toks, keys } = marked(clean);
  const which = keys.map((k) => (k.length ? termsOf(k, terms) : []));
  const SPAN = 30;
  let start = 0;
  let best = -1;
  which.forEach((w, i) => {
    if (!w.length) return;
    const s = Math.max(0, i - 8);
    const found = new Set<number>();
    for (let k = s; k < Math.min(toks.length, s + SPAN); k++) which[k].forEach((x) => found.add(x));
    if (found.size > best) {
      best = found.size;
      start = s;
    }
  });
  const end = Math.min(toks.length, start + SPAN);
  const from = start === 0 ? 0 : toks[start].start;
  const to = end >= toks.length ? clean.length : toks[end - 1].end;
  const segs = highlight(clean, terms, from, to);
  if (from > 0) segs.unshift({ text: "… ", hit: false });
  if (to < clean.length) segs.push({ text: " …", hit: false });
  return segs;
}

export const docHref = (slug: string, anchor = "") => `/apoio/documentacao/${slug}${anchor ? `#${anchor}` : ""}`;

export function searchDocs(index: SearchIndex, raw: string, opts: { limit?: number; perArticle?: number } = {}): SearchResult {
  const limit = opts.limit ?? 20;
  const perArticle = opts.perArticle ?? 3;
  const terms = parseQuery(index, raw.slice(0, 200));
  const fixes = terms.filter((t) => t.fix);
  let suggestion: string | null = null;
  if (fixes.length) {
    const parts = raw.trim().split(/\s+/);
    suggestion = parts
      .map((p) => {
        const n = fold(p).replace(/[^a-z0-9]/g, "");
        return fixes.find((t) => t.norm === n)?.fix ?? p;
      })
      .join(" ");
  }
  if (!terms.length) return { hits: [], terms: 0, suggestion };
  const idfs = new Map<string, number>();
  for (const t of terms) for (const v of t.variants) if (!idfs.has(v.token)) idfs.set(v.token, idf(index, v.token));
  const byArticle = new Map<number, Scored[]>();
  for (const u of index.units) {
    const s = scoreUnit(index, terms, u, idfs);
    if (s.score <= 0) continue;
    const list = byArticle.get(u.article) || [];
    list.push(s);
    byArticle.set(u.article, list);
  }
  const picked: Scored[] = [];
  for (const list of byArticle.values()) {
    const own = list.filter((s) => s.own > 0).sort((a, b) => b.score - a.score);
    if (own.length) own.slice(0, perArticle).forEach((s, i) => picked.push({ ...s, score: s.score * ([1, 0.82, 0.7][i] ?? 0.6) }));
    else {
      // Só o título, os termos ou o resumo do artigo: um resultado, para o início do artigo.
      const top = list.find((s) => s.unit.rec.anchor === "") || list[0];
      picked.push({ ...top, score: top.score * 0.9 });
    }
  }
  picked.sort((a, b) => b.score - a.score);
  const floor = (picked[0]?.score || 0) * 0.12;
  const hits = picked
    .filter((s) => s.score >= floor)
    .slice(0, limit)
    .map(({ unit, score }): SearchHit => {
      const r = unit.rec;
      const questions = r.perguntas.map((p) => highlight(p, terms)).filter(hasHit);
      const body = r.text || (r.anchor === "" ? r.resumo : "");
      return {
        slug: r.slug,
        anchor: r.anchor,
        href: docHref(r.slug, r.anchor),
        title: highlight(r.title, terms),
        heading: r.anchor ? highlight(r.heading, terms) : null,
        parent: r.parent,
        question: questions[0] || null,
        snippet: snippet(body, terms),
        score: Math.round(score * 100) / 100,
      };
    });
  return { hits, terms: terms.length, suggestion };
}

// ------------------------------------------------------------------------------------------------- ajudas

// Linhas do índice (uma por secção) dos artigos que a pessoa pode ver.
export function searchRecords(docs: SupportDoc[]): SearchRecord[] {
  return docs.flatMap((d) =>
    d.sections.map((s) => ({
      slug: d.slug,
      title: d.title,
      anchor: s.id,
      heading: s.heading,
      parent: s.parent ? d.sections.find((x) => x.id === s.parent)?.heading || "" : "",
      perguntas: s.perguntas,
      termos: s.id ? [] : d.termos,
      resumo: s.id ? "" : d.resumo,
      text: s.text,
    })),
  );
}

// Artigos relacionados: os que partilham mais termos (pela raiz das palavras), até 3.
export function relatedDocs<T extends Pick<SupportDoc, "slug" | "termos" | "order">>(doc: T, docs: T[], max = 3): T[] {
  const bag = (d: T) => new Set(d.termos.flatMap((t) => analyze(t)));
  const mine = bag(doc);
  if (!mine.size) return [];
  return docs
    .filter((d) => d.slug !== doc.slug)
    .map((d) => {
      const other = bag(d);
      let shared = 0;
      for (const k of mine) if (other.has(k)) shared++;
      return { d, shared };
    })
    .filter((x) => x.shared > 0)
    .sort((a, b) => b.shared - a.shared || a.d.order - b.d.order)
    .slice(0, max)
    .map((x) => x.d);
}
