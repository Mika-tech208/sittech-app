// Conteúdo FICTÍCIO para o botão "TESTAR ENVIO DE RELATÓRIO": serve só para exercitar o e-mail com anexo PDF. Nunca contém dado real, nunca é registrado como relatório
// (sem versão, sem hash oficial, sem fechamento) e o PDF sai marcado "TESTE — DADOS FICTÍCIOS — SEM VALOR DOCUMENTAL" em todas as páginas.
import { montarConteudo, hashDoConteudo, nomeArquivo, somarDias } from "./conteudo";
import { renderizarPdf } from "./pdf";
import type { ApontamentoBruto, FontesRelatorio, PeriodoBruto } from "./tipos";

const SEMANA = "2030-01-07"; // semana fictícia (nunca confundível com uma real)
const PERIODOS: PeriodoBruto[] = [
  { id: "m1", nome: "M1", inicio: "07:12", fim: "08:48" }, { id: "m2", nome: "M2", inicio: "08:48", fim: "10:24" }, { id: "m3", nome: "M3", inicio: "10:24", fim: "11:55" },
  { id: "t1", nome: "T1", inicio: "13:00", fim: "14:20" }, { id: "t2", nome: "T2", inicio: "14:20", fim: "15:40" }, { id: "t3", nome: "T3", inicio: "15:40", fim: "17:00" },
];
const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const aps = (func: string, ops: string[], base: number): ApontamentoBruto[] => PERIODOS.map((p, i) => ({
  id: ID(base + i), data: SEMANA, periodoId: p.id, funcionarioId: func, maquinaId: i % 2 === 0 ? "maq-a" : "maq-b", produtoId: "prod-a", operacaoId: ops[i], produzido: 100, refugo: 0, status: "produzindo", motivo: null,
}));

export function fontesDeTeste(): FontesRelatorio {
  return {
    agoraBanco: "2030-01-07T12:00:00Z", semanaInicio: SEMANA, previsaoId: "prev-teste", diasProdutivos: [SEMANA], periodosPorDia: { [SEMANA]: PERIODOS }, periodosPadrao: PERIODOS,
    equipe: ["f-a", "f-b"], oficial: [], ausencias: [], ajustesManuais: [], planoVersao: null, situacaoFuncionarios: [],
    apontamentos: [...aps("f-a", ["op-1", "op-2", "op-3", "op-4", "op-1", "op-2"], 1), ...aps("f-b", ["op-2", "op-1", "op-4", "op-3", "op-2", "op-1"], 10)],
    funcionarios: [{ id: "f-a", nome: "Funcionário Teste A", ativo: true }, { id: "f-b", nome: "Funcionário Teste B", ativo: true }],
    maquinas: { "maq-a": "Máquina Teste A", "maq-b": "Máquina Teste B" }, produtos: { "prod-a": "Produto Teste" },
    operacoes: { "op-1": "Operação 1", "op-2": "Operação 2", "op-3": "Operação 3", "op-4": "Operação 4" },
  };
}

export async function pdfDeTeste(urlBase: string): Promise<{ bytes: Uint8Array; nomeArquivo: string; paginas: number; semanaInicio: string; codigo: string; fechamentoMs: number }> {
  const geradoEmMs = Date.parse(`${SEMANA}T10:00:00-03:00`); // antes do fechamento: sai PARCIAL, nunca "FINAL"
  const c0 = montarConteudo(fontesDeTeste(), {
    tipo: "executada", codigo: "TESTE-0000", versao: 1, geradoEmMs, geradoPor: { id: "teste", nome: "TESTE" }, urlVerificacao: `${urlBase.replace(/\/$/, "")}/relatorios/escala/verificar/TESTE`,
  });
  const c = { ...c0, titulo: "TESTE — RELATÓRIO SEMANAL DE REVEZAMENTO DE PRODUÇÃO — EXECUTADO (DADOS FICTÍCIOS)" };
  const { hash } = hashDoConteudo(c);
  const pdf = await renderizarPdf(c, hash);
  return { bytes: pdf.bytes, nomeArquivo: `TESTE_${nomeArquivo(c)}`, paginas: pdf.paginas, semanaInicio: SEMANA, codigo: c.codigo, fechamentoMs: Date.parse(`${somarDias(SEMANA, 4)}T18:00:00-03:00`) };
}
