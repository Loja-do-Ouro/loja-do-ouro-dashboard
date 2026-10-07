import { whatsappConfigured } from "@/lib/support/whatsapp";

export const dynamic = "force-dynamic";

// Reservado para a WhatsApp Cloud API (fase seguinte). Enquanto o canal não estiver configurado,
// recusa a verificação e qualquer evento: não há ligação ativa simulada.
function notConfigured() {
  return new Response("WhatsApp por configurar.", { status: 503, headers: { "Cache-Control": "no-store" } });
}

export async function GET() {
  if (!whatsappConfigured()) return notConfigured();
  // Fase seguinte: responder a hub.challenge quando hub.verify_token = WHATSAPP_VERIFY_TOKEN.
  return notConfigured();
}

export async function POST() {
  if (!whatsappConfigured()) return notConfigured();
  // Fase seguinte: validar X-Hub-Signature-256 com WHATSAPP_APP_SECRET antes de ler o corpo.
  return notConfigured();
}
