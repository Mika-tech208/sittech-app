import type { ApontamentoBruto, AusenciaBruta, FontesRelatorio, OficialBruto, PeriodoBruto } from "../tipos";

export const PERIODOS: PeriodoBruto[] = [
  { id: "m1", nome: "M1", inicio: "07:12", fim: "08:48" }, { id: "m2", nome: "M2", inicio: "08:48", fim: "10:24" }, { id: "m3", nome: "M3", inicio: "10:24", fim: "11:55" },
  { id: "t1", nome: "T1", inicio: "13:00", fim: "14:20" }, { id: "t2", nome: "T2", inicio: "14:20", fim: "15:40" }, { id: "t3", nome: "T3", inicio: "15:40", fim: "17:00" },
];
export const OP = { rosq: "op-rosq", mont: "op-mont", emb: "op-emb", etiq: "op-etiq" };
export const MAQ: Record<string, string> = { r3: "Rosqueadeira 3", m18: "Montagem 18", e17: "Embalagem 17", t15: "Etiquetadora 15", r6: "Rosqueadeira 6" };
export const PROD: Record<string, string> = { p1: "Conector 3/4\"", p2: "Caixa Amarela 4x2" };
export const OPNOMES: Record<string, string> = { [OP.rosq]: "Rosquear", [OP.mont]: "Montar Presilha", [OP.emb]: "Embalar", [OP.etiq]: "Etiquetar" };
export const SEG = "2026-11-02"; // segunda-feira (semana 2026-11-02 a 2026-11-08)

let n = 0;
export const ap = (func: string, per: string, maq: string, op: string, prod = "p1", extra: Partial<ApontamentoBruto> = {}, data = SEG): ApontamentoBruto => ({
  id: `ap-${String(++n).padStart(4, "0")}`, data, periodoId: per, funcionarioId: func, maquinaId: maq, produtoId: prod, operacaoId: op, produzido: 100, refugo: 0, status: "produzindo", motivo: null, ...extra,
});
export const ofi = (func: string, per: string, maq: string | null, op: string | null, prod: string | null = "p1", extra: Partial<OficialBruto> = {}, data = SEG): OficialBruto => ({
  data, periodoId: per, funcionarioId: func, maquinaId: maq, produtoId: maq ? prod : null, operacaoId: maq ? op : null, pecas: maq ? 100 : 0, origem: "auto", motivoSemPosto: maq ? null : "sem demanda", excecaoRevezamento: false, ...extra,
});
export const aus = (func: string, data = SEG, extra: Partial<AusenciaBruta> = {}): AusenciaBruta => ({ funcionarioId: func, data, tipo: "falta_dia_inteiro", inicio: null, fim: null, emAberto: false, ...extra });

export function fontes(extra: Partial<FontesRelatorio> = {}): FontesRelatorio {
  return {
    agoraBanco: "2026-11-02T20:00:00Z", semanaInicio: SEG, previsaoId: "prev1", diasProdutivos: [SEG], periodosPorDia: { [SEG]: PERIODOS }, periodosPadrao: PERIODOS,
    equipe: ["f1", "f2"], oficial: [], apontamentos: [], ausencias: [], ajustesManuais: [], planoVersao: { id: "plano-1234", hashPlano: "a".repeat(64), validoDesde: "2026-11-02T08:00:00Z" },
    situacaoFuncionarios: [], funcionarios: [{ id: "f1", nome: "Ana", ativo: true }, { id: "f2", nome: "Bia", ativo: true }, { id: "f3", nome: "Clara", ativo: true }],
    maquinas: MAQ, produtos: PROD, operacoes: OPNOMES, ...extra,
  };
}
// instante: dia 2 às HH:MM de São Paulo (UTC-3)
export const em = (hhmm: string, dia = SEG) => Date.parse(`${dia}T${hhmm}:00-03:00`);
export const META = (geradoEmMs: number, extra = {}) => ({ tipo: "executada" as const, codigo: "ESC-EXEC-2026-45-0001", versao: 1, geradoEmMs, geradoPor: { id: "u1", nome: "Admin" }, urlVerificacao: "https://exemplo.test/relatorios/escala/verificar/00000000-0000-0000-0000-000000000001", ...extra });
