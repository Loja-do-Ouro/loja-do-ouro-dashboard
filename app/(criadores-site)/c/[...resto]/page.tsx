import { notFound } from "next/navigation";

// Qualquer endereço do site que não existe (no host criadores.* também /admin, /lojas…, reescritos para /c/…) mostra
// o 404 do próprio site, dentro do seu layout.
export default function Missing(): never {
  notFound();
}
