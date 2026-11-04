import Image from "next/image";
import Link from "next/link";
import { crLegalPublic } from "@/lib/criadores/db";
import { creatorsReady, loadCreator, siteBase } from "@/lib/criadores/site";
import { Aviso } from "./ui";

export const dynamic = "force-dynamic";
export const metadata = { title: { absolute: "Criadores · Loja do Ouro" } };

// Entrada pública (§4.3 «/»): quem somos, como funciona em 4 passos concretos, o que combinamos e perguntas.
// Fotografias reais da loja, sempre com legenda (peça e preço), servidas pelo otimizador do próprio site (next/image:
// o browser não fala com a Shopify). Sem números inventados. As campanhas abertas chegam
// com o PR2; até lá, a página diz o que existe hoje.

async function registrationsOpen() {
  if (!creatorsReady()) return false;
  try {
    return (await crLegalPublic(null)).registrations_open;
  } catch {
    return false;
  }
}

const STEPS = [
  { n: "01", title: "Crie a conta", text: "Email e palavra-passe, com confirmação por email. Depois indica o nome, os contactos, a cidade e o tipo de conteúdo que faz.", time: "Cerca de 5 minutos" },
  { n: "02", title: "Indique as suas redes", text: "Instagram, TikTok, YouTube ou outras, com os números que quiser partilhar. Ficam marcados como «não verificado» até a equipa os validar. Não lemos mensagens nem publicamos nada por si.", time: "2 minutos" },
  { n: "03", title: "A equipa revê o perfil", text: "Uma pessoa da equipa lê o perfil, decide e regista o motivo. Não há nota automática nem ranking. A resposta chega por email.", time: "Resposta por email" },
  { n: "04", title: "Candidate-se e publique", text: "Cada campanha diz o que é pedido, o que recebe e até quando. Publica com #PUB ou #OFERTA no início e recebe por transferência para o IBAN que indicar.", time: "Condições escritas em cada campanha" },
];

const QA = [
  { q: "Preciso de muitos seguidores?", a: "Não para criar conta. Algumas campanhas indicam um número de seguidores sugerido, com o motivo; outras, como as de conteúdo para a loja, não dependem disso. Nenhuma candidatura é excluída de forma automática." },
  { q: "Os meus números são verificados?", a: "Os números que indica ficam como «declarado por si, não verificado». A equipa pode validá-los a partir de capturas das estatísticas. Mais tarde vai poder ligar o Instagram pela Meta, só se quiser e com uma autorização própria." },
  { q: "Usam inteligência artificial para decidir?", a: "Não. Cada perfil e cada candidatura é lido por uma pessoa da equipa, que regista o motivo da decisão. A Loja do Ouro não dá notas nem ordena criadores." },
  { q: "Quem vê o meu IBAN e os meus dados fiscais?", a: "Ficam cifrados. Só quem trata dos pagamentos os pode ver por inteiro, com o motivo registado. Um IBAN novo só passa a valer depois de o confirmar por email." },
  { q: "Posso apagar a conta?", a: "Sim, em Definições, com a palavra-passe. Também pode descarregar todos os seus dados num ficheiro. Se tiver uma colaboração a decorrer, explicamos o que fica e até quando." },
];

export default async function CreatorsHome({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [base, ctx, open, q] = await Promise.all([siteBase(), loadCreator().catch(() => null), registrationsOpen(), searchParams]);
  const m = typeof q.m === "string" ? q.m : "";
  return (
    <>
      <section className="cr-env cr-grelha cr-abre cr-heroi">
        <div className="cr-c1-5">
          {m === "apagada" && <Aviso tone="ok" title="Conta apagada">Enviámos a confirmação para o email da conta.</Aviso>}
          <p className="cr-meta">{open ? "Inscrições abertas" : "As inscrições abrem em breve"} · para maiores de 18 anos</p>
          <h1 className="cr-d-xl">Procuramos quem fotografe e filme as nossas joias.</h1>
          <p className="cr-lead" style={{ marginTop: 24 }}>
            Campanhas pagas, permutas e peças para unboxing, com as condições por escrito antes de publicar. Cada perfil e cada candidatura é lido por uma pessoa da equipa.
          </p>
          <div className="cr-acoes" style={{ marginTop: 24 }}>
            {ctx ? (
              <Link className="cr-bt" href={`${base}/painel`}>Abrir o painel</Link>
            ) : (
              <>
                {/* Inscrições fechadas: a ação principal não leva a uma página que só diz «em breve». */}
                {open
                  ? <Link className="cr-bt" href={`${base}/conta/registo`}>Criar conta com email</Link>
                  : <Link className="cr-bt" href={`${base}/como-funciona`}>Ver como funciona</Link>}
                <Link className="cr-lig" href={`${base}/conta/entrar`}>Já tenho conta</Link>
              </>
            )}
          </div>
          <p className="cr-pequeno" style={{ marginTop: 16 }}>
            {open ? "Não há número mínimo de seguidores para criar conta." : "Não há número mínimo de seguidores para criar conta. Avisamos aqui quando as inscrições abrirem."}
          </p>
        </div>
        <figure className="cr-c7-6">
          <Image className="cr-foto cr-r45" width={1400} height={1750} preload sizes="(max-width: 768px) 100vw, 50vw"
            src="https://cdn.shopify.com/s/files/1/0933/8811/2256/files/brincos-coracao-de-viana-em-prata-dourada-com-perola-3702983.jpg?v=1761069695&width=1400"
            alt="Brinco Coração de Viana em prata dourada com pérola suspensa, usado na orelha." />
          <figcaption><b>Brincos Coração de Viana em prata dourada com pérola</b>, 62,50&nbsp;€. Fotografia da Loja do Ouro.</figcaption>
        </figure>
      </section>

      <section id="como" className="cr-env cr-secao">
        <div className="cr-grelha cr-secao-cab">
          <div className="cr-c1-3">
            <h2 className="cr-d-m">Como funciona</h2>
            <p className="cr-pequeno" style={{ marginTop: 12 }}>Do registo à primeira campanha, em quatro passos.</p>
          </div>
          <div className="cr-c4-9">
            <table className="cr-tab cr-tab-pilha">
              <thead><tr><th scope="col">Passo</th><th scope="col">O que acontece</th><th scope="col">Quanto tempo</th></tr></thead>
              <tbody>
                {STEPS.map((s) => (
                  <tr key={s.n}>
                    <td className="cr-passo-n">{s.n}</td>
                    <td className="cr-bloco-td"><h3 className="cr-d-xs">{s.title}</h3><p>{s.text}</p></td>
                    <td data-r="Quanto tempo" className="cr-pequeno">{s.time}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p style={{ marginTop: 16 }}><Link className="cr-lig" href={`${base}/como-funciona`}>Ler a explicação completa</Link></p>
          </div>
        </div>
      </section>

      <figure className="cr-env cr-secao">
        <Image className="cr-foto cr-r219" width={2000} height={762} sizes="100vw"
          src="https://cdn.shopify.com/s/files/1/0933/8811/2256/files/brincos-tradicao-com-coracao-de-viana-em-prata-dourada-e-esmalte-azul-8817181.png?v=1780767027&width=2000"
          alt="Brincos Tradição em prata dourada com esmalte azul, num suporte claro sobre tecido de azulejo." />
        <figcaption><b>Brincos Tradição com Coração de Viana em prata dourada e esmalte azul</b>, 88,90&nbsp;€.</figcaption>
      </figure>

      <section className="cr-env cr-secao">
        <div className="cr-grelha cr-secao-cab">
          <div className="cr-c1-12"><h2 className="cr-d-m">O que combinamos consigo</h2></div>
        </div>
        <div className="cr-grelha cr-acordo" style={{ marginTop: 24 }}>
          <div className="cr-c1-6">
            <h3 className="cr-d-s">O que pedimos</h3>
            <ol>
              <li>Ter 18 anos ou mais.</li>
              <li>Identificar a publicidade com #PUB ou #OFERTA no início da publicação e usar o rótulo de parceria da rede.</li>
              <li>Mostrar o conteúdo à equipa antes de o publicar.</li>
              <li>Não mostrar menores de 18 anos nos conteúdos.</li>
              <li>Dizer a verdade sobre quilates, contrastaria e preços.</li>
            </ol>
          </div>
          <div className="cr-c7-6">
            <h3 className="cr-d-s">O que garantimos</h3>
            <ol>
              <li>Condições por escrito antes de começar: o que entrega, o que recebe e por quanto tempo podemos usar o conteúdo.</li>
              <li>Uma pessoa decide cada candidatura e regista o motivo, aprovada ou não.</li>
              <li>O seu IBAN só é visto por quem trata dos pagamentos.</li>
              <li>Os números que indica nunca servem para notas nem rankings.</li>
              <li>Pode descarregar ou apagar os seus dados quando quiser, na sua conta.</li>
            </ol>
          </div>
        </div>
      </section>

      <section id="perguntas" className="cr-env cr-secao">
        <div className="cr-grelha">
          <div className="cr-c1-3"><h2 className="cr-d-m">Perguntas</h2></div>
          <div className="cr-c4-9 cr-qa">
            {QA.map((x) => (
              <details key={x.q}>
                <summary>{x.q}<span className="cr-qa-sinal" aria-hidden="true" /></summary>
                <div><p>{x.a}</p></div>
              </details>
            ))}
          </div>
        </div>
      </section>

      {!ctx && (
        <section className="cr-env cr-secao">
          <div className="cr-grelha cr-secao-cab" style={{ alignItems: "end" }}>
            <div className="cr-c1-7"><h2 className="cr-d-l">{open ? "Crie a conta e apresente o seu trabalho." : "As inscrições abrem em breve."}</h2></div>
            <div className="cr-c9-4">
              <div className="cr-acoes" style={{ marginTop: 16 }}>
                {open
                  ? <Link className="cr-bt" href={`${base}/conta/registo`}>Criar conta com email</Link>
                  : <Link className="cr-bt" href={`${base}/como-funciona`}>Ver como funciona</Link>}
                <Link className="cr-lig" href={`${base}/conta/entrar`}>Entrar</Link>
              </div>
            </div>
          </div>
        </section>
      )}
    </>
  );
}
