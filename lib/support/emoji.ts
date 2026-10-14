// Emojis do apoio ao cliente: lista curta e escolhida para conversas com clientes de uma joalharia.
// Só emojis até à versão Unicode 12 (2019), para aparecerem bem em Windows 10, Android e iPhone mais antigos.
// Sem bandeiras: o Windows mostra-as como duas letras ("PT").
// Cada emoji: [carácter, nome (lido pelo leitor de ecrã e mostrado ao passar o rato), palavras para a pesquisa].

export type Emoji = { char: string; name: string; words: string };
export type EmojiGroup = { id: string; label: string; icon: string; items: Emoji[] };

const g = (id: string, label: string, icon: string, list: [string, string, string?][]): EmojiGroup => ({
  id, label, icon, items: list.map(([char, name, words = ""]) => ({ char, name, words })),
});

export const EMOJI_GROUPS: EmojiGroup[] = [
  g("caras", "Caras", "😊", [
    ["😊", "sorriso simpático", "feliz corado obrigado obrigada"],
    ["🙂", "sorriso leve", "feliz"],
    ["😀", "sorriso", "feliz contente"],
    ["😃", "sorriso alegre", "feliz contente"],
    ["😄", "sorriso com olhos alegres", "feliz riso"],
    ["😁", "sorriso rasgado", "feliz dentes"],
    ["😆", "riso", "rir gargalhada"],
    ["😅", "riso com alívio", "suor ufa"],
    ["😂", "lágrimas de riso", "rir gargalhada"],
    ["😉", "piscar o olho", "piscadela"],
    ["😇", "anjo", "inocente"],
    ["🥰", "apaixonado", "amor corações adoro"],
    ["😍", "olhos de coração", "adoro amor lindo"],
    ["🤩", "deslumbrado", "estrelas uau incrível"],
    ["😘", "beijinho", "beijo beijos beijinhos amor"],
    ["😋", "delicioso", "gostoso"],
    ["😎", "cara com óculos de sol", "fixe"],
    ["🤗", "abraço", "abraços carinho"],
    ["🤔", "a pensar", "dúvida hmm"],
    ["🤭", "ups", "mão boca"],
    ["🤫", "silêncio", "segredo surpresa"],
    ["😌", "aliviado", "calma tranquilo"],
    ["😐", "neutro", "sem expressão"],
    ["🙄", "revirar os olhos", "aborrecido"],
    ["😏", "sorriso maroto", "malandro"],
    ["😔", "pensativo", "triste desculpa desculpe lamento"],
    ["😕", "confuso", "dúvida"],
    ["😟", "preocupado", "aflito"],
    ["🙁", "triste", "chateado"],
    ["😮", "surpreso", "espanto oh"],
    ["😲", "espantado", "choque surpresa"],
    ["😳", "envergonhado", "corado"],
    ["🥺", "por favor", "suplicar olhos"],
    ["😢", "lágrima", "chorar triste"],
    ["😭", "a chorar", "choro triste"],
    ["😴", "a dormir", "sono"],
    ["🤯", "cabeça a explodir", "surpresa choque"],
    ["🥳", "cara de festa", "celebrar parabéns aniversário"],
    ["🤦", "mão na testa", "facepalm erro"],
    ["🤷", "encolher os ombros", "não sei"],
    ["🙈", "macaco a tapar os olhos", "vergonha ups"],
  ]),
  g("gestos", "Gestos", "👍", [
    ["👍", "polegar para cima", "ok gosto certo combinado"],
    ["👎", "polegar para baixo", "não gosto"],
    ["👌", "mão a fazer ok", "perfeito"],
    ["✌️", "vitória", "paz"],
    ["🤞", "dedos cruzados", "sorte"],
    ["🤙", "liga-me", "telefone"],
    ["👋", "olá", "adeus acenar"],
    ["🙌", "viva", "mãos no ar celebrar"],
    ["👏", "palmas", "parabéns aplausos"],
    ["🙏", "obrigado", "obrigada por favor agradecer mãos desculpa desculpe lamento"],
    ["🤝", "aperto de mão", "acordo combinado"],
    ["💪", "força", "músculo"],
    ["👉", "apontar para a direita", "ver aqui"],
    ["👈", "apontar para a esquerda", ""],
    ["👆", "apontar para cima", ""],
    ["👇", "apontar para baixo", "ver abaixo"],
    ["☝️", "um momento", "atenção dedo"],
    ["✋", "mão levantada", "parar"],
    ["✍️", "a escrever", "assinar"],
    ["👀", "olhos", "ver olhar atenção"],
    ["💅", "unhas", "manicure"],
    ["🤳", "selfie", "fotografia"],
  ]),
  g("coracoes", "Corações", "❤️", [
    ["❤️", "coração vermelho", "amor corações"],
    ["🧡", "coração laranja", "amor"],
    ["💛", "coração amarelo", "amor dourado ouro"],
    ["💚", "coração verde", "amor"],
    ["💙", "coração azul", "amor"],
    ["💜", "coração roxo", "amor"],
    ["🖤", "coração preto", "amor"],
    ["🤍", "coração branco", "amor"],
    ["🤎", "coração castanho", "amor"],
    ["💕", "dois corações", "amor coração"],
    ["💞", "corações a girar", "amor"],
    ["💓", "coração a bater", "amor"],
    ["💗", "coração a crescer", "amor"],
    ["💖", "coração brilhante", "amor brilho"],
    ["💘", "coração com flecha", "cupido amor namorados"],
    ["💝", "coração com laço", "presente amor oferta"],
    ["💌", "carta de amor", "envelope"],
    ["💋", "beijo", "beijos beijinhos lábios batom"],
    ["😻", "gato apaixonado", "amor"],
    ["💔", "coração partido", "triste"],
  ]),
  g("loja", "Joias e loja", "💍", [
    ["💍", "anel", "aliança noivado casamento joia"],
    ["💎", "diamante", "pedra brilhante joia"],
    ["👑", "coroa", "rainha rei"],
    ["⌚", "relógio", "hora"],
    ["📿", "colar de contas", "terço fio"],
    ["✨", "brilho", "novo especial"],
    ["⭐", "estrela", "favorito"],
    ["🌟", "estrela brilhante", "destaque"],
    ["🏆", "troféu", "prémio vencedor"],
    ["🥇", "medalha de ouro", "primeiro ouro"],
    ["🛍️", "sacos de compras", "loja comprar"],
    ["🎁", "presente", "oferta prenda embrulho"],
    ["🏷️", "etiqueta", "preço"],
    ["💰", "saco de dinheiro", "valor"],
    ["💶", "nota de euro", "dinheiro pagamento"],
    ["💳", "cartão", "pagamento multibanco"],
    ["🧾", "recibo", "fatura talão"],
    ["👜", "mala", "bolsa"],
    ["👛", "porta-moedas", "carteira"],
    ["💄", "batom", "maquilhagem"],
    ["🕶️", "óculos de sol", "acessórios"],
    ["🔥", "fogo", "promoção quente novidade"],
    ["💯", "cem", "perfeito"],
    ["🆕", "novo", "novidade"],
    ["🆓", "grátis", "gratuito oferta"],
  ]),
  g("festas", "Celebrações", "🎉", [
    ["🎉", "festa", "parabéns celebrar"],
    ["🎊", "confetes", "festa"],
    ["🥂", "brinde", "celebrar"],
    ["🍾", "champanhe", "celebrar"],
    ["🎂", "bolo de aniversário", "parabéns anos"],
    ["🎈", "balão", "festa aniversário"],
    ["🎀", "laço", "presente"],
    ["💐", "ramo de flores", "flores"],
    ["🌹", "rosa", "flor amor"],
    ["🌸", "flor", "primavera"],
    ["🌷", "tulipa", "flor"],
    ["👰", "noiva", "casamento"],
    ["🤵", "noivo", "casamento"],
    ["💒", "casamento", "igreja"],
    ["👶", "bebé", "nascimento batizado"],
    ["🎓", "formatura", "curso"],
    ["🎄", "árvore de Natal", "natal"],
    ["🎅", "Pai Natal", "natal"],
    ["❄️", "floco de neve", "inverno frio"],
    ["☀️", "sol", "verão"],
    ["🌙", "lua", "noite"],
    ["🌈", "arco-íris", ""],
  ]),
  g("contacto", "Encomendas e contacto", "📦", [
    ["📦", "encomenda", "pacote caixa envio"],
    ["🚚", "entrega", "camião transporte envio"],
    ["✈️", "avião", "envio internacional viagem"],
    ["📬", "caixa de correio", "correio carta"],
    ["✉️", "envelope", "carta correio"],
    ["📧", "email", "e-mail mail correio eletrónico"],
    ["📞", "telefone", "ligar chamada"],
    ["📱", "telemóvel", "telefone mensagem"],
    ["💬", "mensagem", "conversa chat"],
    ["📍", "localização", "morada mapa loja"],
    ["🏬", "loja", "centro comercial"],
    ["🏪", "loja de bairro", "loja"],
    ["📅", "calendário", "data dia"],
    ["⏰", "despertador", "hora horário"],
    ["⏳", "a aguardar", "espera ampulheta tempo"],
    ["🔍", "procurar", "lupa pesquisa"],
    ["📸", "fotografia", "câmara foto"],
    ["🔗", "link", "ligação"],
    ["📝", "nota", "escrever formulário"],
    ["📄", "documento", "papel"],
    ["🔒", "seguro", "cadeado privado"],
    ["🔧", "reparação", "arranjo ferramenta"],
    ["✂️", "tesoura", "ajuste cortar"],
  ]),
  g("simbolos", "Símbolos", "✅", [
    ["✅", "feito", "certo confirmado visto"],
    ["✔️", "visto", "ok certo"],
    ["❌", "não", "errado cancelado"],
    ["⚠️", "aviso", "atenção cuidado"],
    ["❗", "importante", "exclamação atenção"],
    ["❓", "pergunta", "dúvida"],
    ["ℹ️", "informação", "info"],
    ["💡", "ideia", "dica sugestão"],
    ["📢", "anúncio", "novidade aviso"],
    ["🔔", "notificação", "sino aviso"],
    ["➡️", "seta para a direita", "seguinte"],
    ["⬅️", "seta para a esquerda", "anterior"],
    ["⬆️", "seta para cima", ""],
    ["⬇️", "seta para baixo", ""],
    ["🔜", "em breve", "brevemente"],
    ["🆗", "botão OK", "ok combinado"],
    ["🟢", "círculo verde", "disponível"],
    ["🟡", "círculo amarelo", "pendente"],
    ["🔴", "círculo vermelho", "indisponível"],
    ["🔵", "círculo azul", ""],
  ]),
];

const ALL = EMOJI_GROUPS.flatMap((grp) => grp.items);
const BY_CHAR = new Map(ALL.map((e) => [e.char, e]));

export const emojiByChar = (char: string) => BY_CHAR.get(char);

// Sem acentos, em minúsculas e sem pontuação: "coracao" encontra "coração", "arco iris" encontra "arco-íris".
const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ");
const INDEX = ALL.map((e) => ({ e, name: ` ${fold(e.name)}`, text: ` ${fold(`${e.name} ${e.words}`)}` }));

// Plural e feminino: "obrigada" encontra "obrigado", "beijinhos" encontra "beijinho", "flores" encontra "flor".
function variants(t: string) {
  if (t.length < 4) return [t];
  const out = [t];
  if (t.endsWith("es")) out.push(t.slice(0, -2));
  const one = t.endsWith("s") ? t.slice(0, -1) : t;
  out.push(one);
  if (one.length > 3 && /[ao]$/.test(one)) out.push(one.slice(0, -1));
  return out;
}
const has = (hay: string, t: string) => variants(t).some((v) => hay.includes(` ${v}`));

// Pesquisa por início de palavra (todas as palavras escritas têm de aparecer). Primeiro os emojis cujo
// nome começa pela pesquisa ("coração" → ❤️), depois os que a têm no nome e por fim só nas palavras.
export function searchEmoji(query: string, limit = 60): Emoji[] {
  const terms = fold(query).split(" ").filter(Boolean);
  if (!terms.length) return [];
  const rank = (name: string) => (variants(terms[0]).some((v) => name.startsWith(` ${v}`)) ? 0 : terms.every((t) => has(name, t)) ? 1 : 2);
  return INDEX.filter(({ text }) => terms.every((t) => has(text, t)))
    .map((x, i) => ({ x, i, r: rank(x.name) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .slice(0, limit)
    .map(({ x }) => x.e);
}

// Recentes: o último escolhido à frente, sem repetidos, só emojis que existem na lista.
export function pushRecent(recent: string[], char: string, max = 24): string[] {
  return [char, ...recent.filter((c) => c !== char && BY_CHAR.has(c))].slice(0, max);
}

// Um emoji colado ao fim de uma ligação passaria a fazer parte dela (ligação partida e, no chat do site,
// sem o cartão do produto): nesse caso leva um espaço antes.
export function emojiAfter(before: string, char: string) {
  return /https?:\/\/\S+$/i.test(before) ? ` ${char}` : char;
}

// Insere no lugar do cursor (ou substitui a seleção) e devolve a nova posição do cursor.
export function insertAt(text: string, start: number, end: number, insert: string) {
  const a = Math.max(0, Math.min(start, end, text.length));
  const b = Math.max(a, Math.min(Math.max(start, end), text.length));
  return { text: text.slice(0, a) + insert + text.slice(b), caret: a + insert.length };
}
