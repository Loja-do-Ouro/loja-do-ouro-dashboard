import { redirect } from "next/navigation";
import { canSupport, homePath } from "@/lib/permissions";
import { sessionRpc } from "@/lib/support/db";
import { isUuid } from "@/lib/support/rules";
import { zendeskConfigured, zendeskOff, zendeskSubdomain } from "@/lib/support/zendesk";
import { requireViewer } from "@/lib/viewer";
import { AppShell } from "@/components/shell";
import { SupportInbox } from "@/components/support/inbox";

export const dynamic = "force-dynamic";
export const metadata = { title: "Apoio ao Cliente · Loja do Ouro" };

const ZENDESK_FLASH: Record<string, { ok?: string; error?: string }> = {
  ligado: { ok: "Conta Zendesk ligada. As suas respostas e notas saem com a sua autoria." },
  recusado: { error: "A ligação ao Zendesk foi cancelada ou recusada." },
  invalido: { error: "Pedido de ligação expirado ou inválido. Tente “Ligar Zendesk” outra vez." },
  "por-configurar": { error: "Zendesk por configurar no servidor (credenciais OAuth ou SUPPORT_ENCRYPTION_KEY em falta)." },
  "sem-acesso": { error: "Sem acesso ao Apoio ao Cliente." },
  endereco: { error: "A ligação ao Zendesk tem de começar neste endereço. Carregue de novo em “Ligar Zendesk”." },
  erro: { error: "A ligação ao Zendesk falhou. Tente outra vez dentro de momentos." },
  desligado: { error: "O Zendesk está desligado do dashboard (Configuração do apoio)." },
  "erro-token": { error: "O Zendesk recusou a troca do código de acesso. Confirme o Redirect URL no cliente OAuth e tente outra vez." },
  "erro-agente": { error: "A conta Zendesk com que entrou não é de agente. Entre no Zendesk com a sua conta de agente e tente outra vez." },
  "erro-light": { error: "A conta Zendesk é light agent: só escreve notas privadas e não pode responder a clientes." },
  "erro-ocupada": { error: "Esta conta Zendesk já está ligada a outro colaborador. Cada pessoa liga a sua própria conta de agente (confirme com quem tem sessão no Zendesk neste browser)." },
};

export default async function SupportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const viewer = await requireViewer();
  if (!canSupport(viewer)) redirect(homePath(viewer) || "/api/auth/logout?error=noaccess");
  const q = await searchParams;
  const [users, off, prefs] = await Promise.all([
    sessionRpc<{ id: string; zendesk: boolean; zendesk_name: string | null; zendesk_status: string | null }[]>(viewer.session, "ldo_support_users"),
    zendeskOff(),
    // Revisão da IA antes de enviar: sem a migração (ou com a BD a falhar) fica desligada.
    sessionRpc<{ ai_review: boolean; review_mode: string }>(viewer.session, "ldo_support_user_prefs").catch(() => null),
  ]);
  const mine = users.find((u) => u.id === viewer.id);
  const key = typeof q.zendesk === "string" ? q.zendesk : "";
  const flash = ZENDESK_FLASH[key] || (key.startsWith("erro") ? ZENDESK_FLASH.erro : {});
  let subdomain = "goldstorepremium";
  try {
    subdomain = zendeskSubdomain();
  } catch {
    // Mantém o subdomínio por omissão; a configuração mostra o erro.
  }

  return (
    <AppShell viewer={viewer} current="apoio" title="Apoio ao Cliente">
      <SupportInbox
        zendeskSubdomain={subdomain}
        zendeskReady={zendeskConfigured() && !off}
        myZendesk={{ connected: Boolean(mine?.zendesk), name: mine?.zendesk_name || null, status: mine?.zendesk_status || null }}
        flash={flash}
        initialConversation={isUuid(q.conversa) ? q.conversa : null}
        review={{ mode: prefs?.review_mode || "desligada", pref: prefs?.ai_review ?? true }}
      />
    </AppShell>
  );
}
