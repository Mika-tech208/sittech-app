// Metadados PÚBLICOS da verificação (página do QR). Função pura: recebe o registro completo (que contém nomes no conteúdo canônico) e devolve SÓ o que a
// página pública pode mostrar — nunca nomes, CPF, escala detalhada, apontamentos ou ausências.
import { sha256Hex } from "@/features/escala/hashCanonico";

export interface RegistroVerificacao {
  id: string; codigo: string; semanaInicio: string; tipo: "planejada" | "executada"; versao: number; status: "parcial" | "final"; geradoEm: string; consolidadoAte: string;
  hash: string; pdfSha256: string; integridadeBanco: boolean; conteudoCanonico: string; fonteDigest: string; periodosConsiderados: string[];
  versaoMaisRecente: number; existeVersaoPosterior: boolean;
}

export interface MetadadosPublicos {
  valido: boolean; // integridade do snapshot confirmada pelo banco E recalculada pelo servidor
  codigo: string; semanaInicio: string; semanaFim: string; tipo: "planejada" | "executada"; versao: number; versaoMaisRecente: number; status: "parcial" | "final";
  geradoEm: string; hash: string; pdfSha256: string;
  integridade: "INTEGRO" | "INCONSISTENTE";
  existemVersoesPosteriores: boolean;
  alteracoesPosterioresNosDados: boolean | null; // null = não foi possível comparar
}

function fimSemana(inicio: string): string {
  const [y, m, d] = inicio.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 6)).toISOString().slice(0, 10);
}

export function paraPublico(r: RegistroVerificacao, digestAtual: string | null): MetadadosPublicos {
  const integro = r.integridadeBanco && sha256Hex(r.conteudoCanonico) === r.hash;
  return {
    valido: integro, codigo: r.codigo, semanaInicio: r.semanaInicio, semanaFim: fimSemana(r.semanaInicio), tipo: r.tipo, versao: r.versao, versaoMaisRecente: r.versaoMaisRecente, status: r.status,
    geradoEm: r.geradoEm, hash: r.hash, pdfSha256: r.pdfSha256, integridade: integro ? "INTEGRO" : "INCONSISTENTE",
    existemVersoesPosteriores: r.existeVersaoPosterior,
    alteracoesPosterioresNosDados: digestAtual === null ? null : digestAtual !== r.fonteDigest,
  };
}
