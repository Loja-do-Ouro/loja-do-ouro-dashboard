import { redirect } from "next/navigation";
import { canSupport, homePath } from "@/lib/permissions";
import { requireViewer } from "@/lib/viewer";
import { Panel } from "@/components/dashboard/ui";
import { AppShell, PageHeading } from "@/components/shell";
import { ChatTestTools } from "@/components/support/chat-test-tools";

export const dynamic = "force-dynamic";
export const metadata = { title: "Testar o chat do site · Loja do Ouro" };

// O mesmo botão que vai para o tema Shopify, a falar com este dashboard. Serve para experimentar como
// cliente (noutro separador, responder em Apoio ao Cliente → Chat do site) antes de mexer no site.
const CONFIG = {
  enabled: true,
  api: "",
  title: "Fale connosco",
  subtitle: "Respondemos em poucos minutos.",
  welcome: "Olá! Em que podemos ajudar? Deixe o seu nome, email e a sua mensagem.",
  button: "",
  color: "#a47a37",
  textColor: "#ffffff",
  position: "right",
  offset: 20,
  offsetSide: 20,
  mobile: true,
  hideOn: "",
  privacyText: "Ao iniciar a conversa aceita a nossa Política de privacidade. Para o podermos ajudar, a equipa vê a página em que está e o seu carrinho.",
  privacyUrl: "https://www.lojadoouro.pt/pages/declaracao-de-cookies",
  offlineMessage: "Neste momento estamos fora do horário de atendimento. Deixe a sua mensagem: respondemos assim que possível e enviamos também a resposta para o seu email.",
  hours: { weekdays: "09:30-13:00, 14:00-18:30", saturday: "10:00-13:00", sunday: "" },
  customer: null,
  identity: null,
};

export default async function ChatTestPage() {
  const viewer = await requireViewer();
  if (!canSupport(viewer)) redirect(homePath(viewer) || "/api/auth/logout?error=noaccess");
  return (
    <AppShell viewer={viewer} current="apoio" title="Testar o chat do site">
      <PageHeading eyebrow="APOIO AO CLIENTE" title="Testar o chat do site" text="O botão no canto inferior direito é o mesmo que vai para o site. Fale como se fosse um cliente e responda noutro separador, em Apoio ao Cliente (canal Chat do site)." />
      <Panel title="Como testar" eyebrow="CHAT DO SITE">
        <ol className="panel-note">
          <li>Abra o chat, escreva um nome, um email seu e uma mensagem.</li>
          <li>Noutro separador, abra o Apoio ao Cliente: a conversa aparece no canal “Chat do site”. Responda.</li>
          <li>No Apoio ao Cliente, o separador Cliente mostra “No site agora”: a página em que o cliente está, há quanto tempo navega e o carrinho (nesta página de teste não há carrinho; no site aparece o da loja).</li>
          <li>A resposta aparece aqui em poucos segundos. Se fechar este separador e esperar 1 minuto antes de responder, a resposta segue também por email (quando o envio de emails estiver configurado).</li>
        </ol>
        <ChatTestTools />
        <p className="panel-note">No site, cores, textos, posição e horário mudam-se em Loja online → Personalizar tema → Definições do tema → Chat Loja do Ouro. Esta página usa os valores por omissão.</p>
      </Panel>
      <script id="ldo-chat-config" type="application/json" dangerouslySetInnerHTML={{ __html: JSON.stringify(CONFIG).replace(/</g, "\\u003c") }} />
    </AppShell>
  );
}
