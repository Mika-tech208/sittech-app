// Página PÚBLICA e SOMENTE LEITURA de verificação (destino do QR do PDF). Mostra só metadados: nunca nomes, CPF, escala detalhada, apontamentos ou ausências.
import type { Metadata } from "next";
import { criarClienteAdmin } from "@/lib/supabase-admin";
import { verificarPublico } from "@/lib/escala-relatorio/servico";
import VerificarArquivo from "./VerificarArquivo";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Verificação de relatório — Sittech", robots: { index: false, follow: false } };

const dataBR = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
function dataHoraSP(iso: string) {
  const d = new Date(Date.parse(iso) - 3 * 3600_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} às ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let meta = null;
  try { meta = await verificarPublico(criarClienteAdmin(), id); } catch { meta = null; }
  const caixa = { maxWidth: 640, margin: "40px auto", padding: "0 16px", fontFamily: "system-ui, sans-serif", color: "#111" } as const;
  if (!meta) {
    return (
      <main style={caixa}>
        <h1 style={{ fontSize: 20 }}>Relatório não encontrado</h1>
        <p>Não existe relatório registrado com este identificador. Confira o QR Code ou o endereço.</p>
      </main>
    );
  }
  const linha = (rot: string, val: string) => (
    <tr><th style={{ textAlign: "left", padding: "6px 12px 6px 0", fontWeight: 600, verticalAlign: "top", whiteSpace: "nowrap" }}>{rot}</th><td style={{ padding: "6px 0", wordBreak: "break-all" }}>{val}</td></tr>
  );
  return (
    <main style={caixa}>
      <p style={{ margin: 0, fontSize: 13, color: "#555" }}>Sittech Soluções Industriais — verificação de relatório (somente leitura)</p>
      <h1 style={{ fontSize: 22, margin: "6px 0 14px" }}>{meta.valido ? "Relatório válido" : "ATENÇÃO: o registro deste relatório está inconsistente"}</h1>
      <table style={{ borderCollapse: "collapse", fontSize: 14 }}>
        <tbody>
          {linha("Código", meta.codigo)}
          {linha("Semana", `${dataBR(meta.semanaInicio)} a ${dataBR(meta.semanaFim)}`)}
          {linha("Tipo", meta.tipo === "executada" ? "Revezamento executado" : "Escala planejada")}
          {linha("Versão", `${meta.versao}${meta.versaoMaisRecente > meta.versao ? ` (a mais recente é a v${meta.versaoMaisRecente})` : " (a mais recente)"}`)}
          {linha("Situação", meta.status === "final" ? "FINAL" : "PARCIAL")}
          {linha("Gerado em", dataHoraSP(meta.geradoEm))}
          {linha("Integridade do conteúdo", meta.integridade === "INTEGRO" ? "ÍNTEGRO — o conteúdo registrado confere com o hash" : "INCONSISTENTE")}
          {linha("Hash SHA-256 do conteúdo", meta.hash)}
          {linha("Hash SHA-256 do arquivo PDF", meta.pdfSha256)}
          {linha("Versões posteriores", meta.existemVersoesPosteriores ? "SIM — existe versão mais recente deste relatório" : "NÃO")}
          {linha("Alterações posteriores nos dados-fonte", meta.alteracoesPosterioresNosDados === null ? "não foi possível comparar" : meta.alteracoesPosterioresNosDados ? "SIM — existem alterações posteriores aos dados utilizados neste relatório" : "NÃO")}
        </tbody>
      </table>
      <p style={{ fontSize: 12, color: "#555", marginTop: 16 }}>Esta página não exibe nomes, CPF, escala detalhada, apontamentos nem ausências; o PDF é o documento completo. O hash comprova que o conteúdo registrado não foi alterado depois de gerado.</p>
      <VerificarArquivo hashPdf={meta.pdfSha256} />
    </main>
  );
}
