// Mensagens de sucesso das ações de Influenciadores (?ok=…). Os endereços de volta só levam a chave e, quando é
// preciso, um número (?n=…), nunca dados pessoais.
const OK: Record<string, string | ((n: number) => string)> = {
  status_approved: "Perfil aprovado. O criador recebe o aviso por email.",
  status_rejected: "Perfil recusado. O criador recebe o aviso por email com o motivo.",
  status_suspended: "Conta suspensa. O criador recebe o aviso por email com o motivo.",
  status_pending_review: "Perfil de volta a «Por rever».",
  status_restricted: "Tratamento limitado: candidaturas, pedidos e sincronização ficam congelados e a limpeza não apaga os dados desta pessoa.",
  note: "Nota interna guardada.",
  message: "Mensagem enviada. O criador recebe um aviso por email (no máximo um a cada 15 minutos).",
  metric: "Números atualizados.",
  deleted: "Conta apagada e anonimizada. O aviso «conta apagada» foi enviado para o email de antes.",
  deleted_no_email: "Conta apagada e anonimizada. O aviso por email não saiu (emails da plataforma parados): avise a pessoa por outro meio.",
  privacy_registered: "Pedido registado. O prazo de resposta é de um mês a contar da receção.",
  privacy_identity: "Identidade marcada no pedido.",
  privacy_extended: "Prazo prorrogado. O titular recebe o aviso por email com o motivo.",
  privacy_closed: "Pedido fechado. O titular recebe a resposta por email (se tiver conta).",
  privacy_saved: "Pedido atualizado.",
  settings: "Definições guardadas.",
  settings_unchanged: "Nada mudou: as definições ficam como estavam.",
  legal_saved: "Rascunho guardado.",
  legal_created: "Rascunho criado. Reveja o texto e publique quando o advogado o aprovar.",
  legal_published: (n) =>
    n > 0 ? `Documento publicado. ${n} ${n === 1 ? "criador vai receber" : "criadores vão receber"} o aviso por email.` : "Documento publicado.",
  lockdown: (n) =>
    `Plataforma parada: ${n} ${n === 1 ? "sessão de criador terminada" : "sessões de criadores terminadas"} e inscrições fechadas. Siga o procedimento de incidentes (README).`,
};

export function creatorsMessage(q: Record<string, string | string[] | undefined>) {
  const key = typeof q.ok === "string" ? q.ok : "";
  const m = OK[key];
  if (!m) return undefined;
  if (typeof m === "string") return m;
  const n = typeof q.n === "string" && /^[0-9]{1,7}$/.test(q.n) ? Number(q.n) : 0;
  return m(n);
}

export function creatorsError(q: Record<string, string | string[] | undefined>) {
  return typeof q.erro === "string" ? q.erro.slice(0, 300) : undefined;
}
