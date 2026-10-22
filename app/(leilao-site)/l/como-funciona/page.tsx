import Link from "next/link";
import { eur } from "@/lib/leilao-rules";
import { pubSettings, siteBase } from "@/lib/leilao/site";

export const dynamic = "force-dynamic";
export const metadata = { title: "Como funciona" };

export default async function HowItWorks() {
  const [base, s] = await Promise.all([siteBase(), pubSettings()]);
  const ext = s?.extend_minutes ?? 10;
  const win = Math.max(1, Math.round((s?.extend_window_seconds ?? 120) / 60));
  return (
    <div className="lx-narrow lx-prose">
      <span className="lx-eyebrow">Guia</span>
      <h1>Como funciona o leilão</h1>
      <p className="lx-muted">Tudo o que precisa de saber antes da primeira licitação, explicado sem letras pequenas.</p>

      <h2>1. Crie a conta e confirme o email</h2>
      <p>
        O registo é gratuito. Pedimos o nome, o email e uma palavra-passe; o telemóvel é opcional. Confirme o email pela ligação que enviamos e já pode
        licitar. Nos leilões aparece só um pseudónimo (por exemplo, «Licitante 7KQ2M»), nunca o seu nome.
      </p>
      {s && (
        <p>
          Para licitar a partir de {eur(s.verified_threshold)} pedimos a verificação da identidade (documento de identificação), como manda a lei de
          prevenção do branqueamento de capitais. Fazemo-lo uma vez e fica válido para os leilões seguintes.
        </p>
      )}

      <h2>2. Indique o seu máximo</h2>
      <p>
        Em cada lote escreve o valor máximo que está disposto a pagar. Esse valor é secreto. Licitamos por si, automaticamente, só o necessário para
        continuar à frente: se a próxima licitação mínima for {eur(110)} e o seu máximo for {eur(300)}, o preço fica em {eur(110)} até alguém licitar
        contra si.
      </p>
      <p>Se dois licitantes indicarem o mesmo máximo, ganha quem o indicou primeiro.</p>
      {s && (
        <>
          <h3>Incrementos</h3>
          <table>
            <thead><tr><th>Preço atual a partir de</th><th>Cada licitação sobe pelo menos</th></tr></thead>
            <tbody>
              {s.increments.map(([from, inc]) => (
                <tr key={from}><td>{eur(from)}</td><td>{eur(inc)}</td></tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <h2>3. Fim justo, sem licitações de última hora</h2>
      <p>
        Cada lote tem a sua hora de fecho (hora de Lisboa), e os lotes fecham um a um. Uma licitação nos últimos {win} minutos prolonga o lote: o fecho
        passa para {ext} minutos depois dessa licitação, e avisamos por email todos os que licitaram no lote. Assim ninguém perde uma peça por segundos.
      </p>
      <p>Também o avisamos se for ultrapassado e quando um lote dos seus favoritos estiver a terminar.</p>

      <h2>4. Preço de reserva</h2>
      <p>
        Alguns lotes têm um preço de reserva confidencial: o valor mínimo pelo qual aceitamos vender. A página do lote mostra se a reserva já foi atingida.
        Se o lote fechar abaixo da reserva, não é vendido.
      </p>

      <h2>5. Caução nos lotes de valor elevado</h2>
      <p>
        {s
          ? `Nos lotes com base a partir de ${eur(s.deposit_threshold)} pedimos uma caução de ${String(s.deposit_percent).replace(".", ",")}% da base (mínimo ${eur(s.deposit_min)}). `
          : "Nos lotes de valor elevado pedimos uma caução. "}
        A caução é apenas cativa (reservada) no cartão ou no MB WAY quando faz a primeira licitação nesse lote: não é cobrada. Se não ganhar, é libertada
        logo após o fecho; se ganhar, é libertada quando o pagamento do lote for confirmado (<Link href={`${base}/pagamentos`}>porque pedimos caução</Link>).
      </p>

      <h2>6. Ganhou? Pague e receba</h2>
      <p>
        Não há comissão do comprador: paga o preço final do lote e, se escolher envio, os portes indicados. Enviamos as instruções por email e tem
        {` ${s?.payment_hours ?? 48} `}horas para pagar. Enviamos com seguro ou pode levantar numa das nossas lojas.
      </p>
      <p>
        Todas as peças têm garantia ({s ? `${Math.round(s.new_warranty_months / 12)} anos nas novas, ${s.used_warranty_months} meses nas usadas` : "garantia legal"}) e
        pode desistir da compra nos 14 dias seguintes à entrega, sem indicar motivo (<Link href={`${base}/livre-resolucao`}>livre resolução</Link>).
      </p>

      <h2>Quem não pode licitar</h2>
      <p>Menores de 18 anos e colaboradores da Loja do Ouro e familiares diretos. Uma licitação é sempre vinculativa: licite só o que está disposto a pagar.</p>

      <p style={{ marginTop: 32 }}>
        <Link className="lx-btn" href={`${base}/conta/registo`}>Criar conta</Link>{" "}
        <Link className="lx-btn lx-btn-ghost" href={`${base}/regulamento`}>Ler o regulamento</Link>
      </p>
    </div>
  );
}
