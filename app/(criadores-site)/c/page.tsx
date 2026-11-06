import Image, { type StaticImageData } from "next/image";
import Link from "next/link";
import fotoAberturaAneis from "./fotos/abertura-aneis.jpg";
import fotoAberturaEspelho from "./fotos/abertura-espelho.jpg";
import fotoFechoCoracao from "./fotos/fecho-coracao-viana.jpg";
import fotoPassosAneis from "./fotos/passos-aneis.jpg";
import fotoTiraAnelCoracao from "./fotos/tira-anel-coracao.jpg";
import fotoTiraFlamma from "./fotos/tira-brincos-flamma.jpg";
import fotoTiraMarilyn from "./fotos/tira-brincos-marilyn.jpg";
import fotoTiraRainha from "./fotos/tira-brincos-rainha.jpg";
import { crLegalPublic } from "@/lib/criadores/db";
import { creatorsReady, loadCreator, siteBase } from "@/lib/criadores/site";
import { Aviso } from "./ui";

export const dynamic = "force-dynamic";
export const metadata = { title: { absolute: "Criadores · Loja do Ouro" } };

// Entrada pública (§4.3 «/»): quem somos, como funciona em 4 passos concretos, o olhar do criador sobre as peças,
// o que combinamos e perguntas. Fotografias lifestyle reais da loja, sempre com legenda (peça e preço), servidas pelo
// otimizador do próprio site (next/image: o browser não fala com a Shopify). Sem números inventados. As campanhas
// abertas chegam com o PR2; até lá, a página diz o que existe hoje.

type Foto = { src: StaticImageData; alt: string; peca: string; preco: string; nota?: string };

// Fotografias lifestyle das fichas de produto da loja, copiadas para o próprio site (c/fotos, até 1400 px): metade
// das peças tem uma só unidade e, vendida e apagada, a fotografia sairia do CDN da Shopify. Escolhidas a 05-11-2026
// entre os produtos mais recentes: ativos e publicados, fora da Private Selection e das coleções de criança, sem
// menores nem texto sobreposto. Nome e preço como na loja nesse dia; ao trocar uma fotografia, confirmar os dois.
const ABERTURA: Foto = {
  src: fotoAberturaAneis, peca: "Anel Solitário em Ouro 19kl com Diamante (T11)", preco: "210,00 €", nota: "com outros anéis da loja",
  alt: "Mulher de blazer preto, a sorrir, com as mãos cruzadas junto ao peito e vários anéis finos em ouro, um deles um solitário com diamante.",
};
const ABERTURA_2: Foto = {
  src: fotoAberturaEspelho, peca: "Brincos Flor em Ouro Amarelo e Ouro Branco de 19kl com Diamantes", preco: "1927,50 €",
  alt: "Mão a segurar um espelho dourado trabalhado onde se reflete a orelha com um brinco em forma de flor, em ouro com diamantes.",
};
const PASSOS: Foto = {
  src: fotoPassosAneis, peca: "Anel em Ouro 19kl com Zircónias (T19)", preco: "732,00 €", nota: "na mão de baixo",
  alt: "Mulher com a mão junto ao queixo a mostrar vários anéis em ouro com zircónias e, na outra mão, um anel de três fiadas em V.",
};
const TIRA: Foto[] = [
  {
    src: fotoTiraRainha, peca: "Brincos Rainha em Prata Dourada (5.3cm)", preco: "138,50 €",
    alt: "Mulher de cabelo escuro e blazer claro, a sorrir, com um brinco Rainha em filigrana dourada na orelha e o outro na mão.",
  },
  {
    src: fotoTiraAnelCoracao, peca: "Anel Coração Viana em Prata Dourada", preco: "98,00 €", nota: "entre outros anéis em filigrana",
    alt: "Mãos sobrepostas de duas mulheres de fato claro, com anéis grandes em filigrana dourada, entre eles um Coração de Viana.",
  },
  {
    src: fotoTiraMarilyn, peca: "Brincos Marilyn em Ouro 19kl (3,18cm)", preco: "1324,00 €",
    alt: "Mulher afasta o cabelo para mostrar um brinco em ouro de malha em losango, com anéis finos em ouro nos dedos.",
  },
  {
    src: fotoTiraFlamma, peca: "Brincos Flamma em Prata Dourada", preco: "59,50 €",
    alt: "Retrato ao sol de uma mulher de cabelo escuro e blazer claro, junto a uma parede de pedra, com um brinco em prata dourada com motivos vazados.",
  },
];
const FECHO: Foto = {
  src: fotoFechoCoracao, peca: "Brincos Coração de Viana em Prata Dourada com Pérola", preco: "79,50 €",
  alt: "Mulher de perfil, de blazer preto, com um brinco e um colar Coração de Viana em filigrana dourada com pérola.",
};

function Legenda({ f }: { f: Foto }) {
  return <><b>{f.peca}</b>, {f.preco}{f.nota ? ` (${f.nota})` : ""}</>;
}

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
  { q: "Os meus números são verificados?", a: "Os números que indica ficam como «declarado por si, não verificado». A equipa pode validá-los a partir de capturas das estatísticas. Quando a opção estiver disponível em Redes, também pode autorizar a leitura dos números públicos da sua conta profissional do Instagram: é opcional e pode parar quando quiser." },
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
          <h1 className="cr-d-xl">Procuramos quem valorize as nossas joias.</h1>
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
        <figure className="cr-c7-6 cr-comp">
          <div className="cr-comp-a">
            <Image className="cr-foto cr-r45" src={ABERTURA.src} alt={ABERTURA.alt} preload
              sizes="(max-width: 760px) 84vw, (max-width: 1100px) 42vw, 540px" />
          </div>
          <div className="cr-comp-b">
            <Image className="cr-foto cr-r45" src={ABERTURA_2.src} alt={ABERTURA_2.alt}
              sizes="(max-width: 760px) 50vw, (max-width: 1100px) 25vw, 330px" />
          </div>
          <figcaption>
            Na fotografia maior: <Legenda f={ABERTURA} />. Na menor: <Legenda f={ABERTURA_2} />. Fotografias da Loja do Ouro.
          </figcaption>
        </figure>
      </section>

      <section id="como" className="cr-env cr-secao">
        <div className="cr-grelha cr-secao-cab">
          <div className="cr-c1-3 cr-como-lado">
            <h2 className="cr-d-m">Como funciona</h2>
            <p className="cr-pequeno" style={{ marginTop: 12 }}>Do registo à primeira campanha, em quatro passos.</p>
            <figure>
              <Image className="cr-foto cr-r45" src={PASSOS.src} alt={PASSOS.alt}
                sizes="(max-width: 760px) 100vw, (max-width: 1100px) 25vw, 300px" />
              <figcaption><Legenda f={PASSOS} />.</figcaption>
            </figure>
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

      <section className="cr-env cr-secao" aria-labelledby="cr-olhar">
        <div className="cr-grelha cr-secao-cab">
          <div className="cr-c1-6">
            <p className="cr-chapeu">Fotografias da Loja do Ouro</p>
            <h2 id="cr-olhar" className="cr-d-l" style={{ marginTop: 8 }}>Mostre as nossas peças à sua maneira.</h2>
          </div>
          <div className="cr-c8-5">
            <p className="cr-lead">
              Fotografia, vídeo ou unboxing: cada campanha diz o que pedimos, o que recebe e até quando. As fotografias desta página são da loja; o que procuramos é o seu olhar.
            </p>
          </div>
        </div>
        <ul className="cr-tira">
          {TIRA.map((f) => (
            <li key={f.peca}>
              <figure>
                <Image className="cr-foto cr-r45" src={f.src} alt={f.alt} sizes="(max-width: 1100px) 50vw, 310px" />
                <figcaption><Legenda f={f} /></figcaption>
              </figure>
            </li>
          ))}
        </ul>
      </section>

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
          <div className="cr-grelha cr-secao-cab cr-fecho">
            <figure className="cr-c1-5">
              <Image className="cr-foto cr-r45" src={FECHO.src} alt={FECHO.alt}
                sizes="(max-width: 760px) 100vw, (max-width: 1100px) 42vw, 520px" />
              <figcaption><Legenda f={FECHO} />.</figcaption>
            </figure>
            <div className="cr-c7-6">
              <h2 className="cr-d-l">{open ? "Crie a conta e apresente o seu trabalho." : "As inscrições abrem em breve."}</h2>
              <div className="cr-acoes" style={{ marginTop: 24 }}>
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
