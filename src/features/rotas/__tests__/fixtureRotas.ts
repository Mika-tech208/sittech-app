// Fixture (não é teste): semana de 02/11/2026 com o Conector 3/4" (Final) [produto de rotas] + Caixa Amarela [linear] sobre os períodos reais.
// Condições de 26/10: AUTO 35.625; CONV 81.000 (Parafusar); E15 97.500; Embalagem 17 142.500; E16 usada pela Caixa Amarela.
import { PERIODOS_REAIS } from "@/features/escala/__tests__/helpers";
import { epochMsNoFuso } from "@/features/escala/tempo";
import type { EstadoBruto, EtapaBruta, ItemPrevistoBruto } from "@/lib/escala/estado";
import type { EstruturaProduto } from "../tipos";

export const SEMANA = "2026-11-02";
export const DIAS = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"];
export const AGORA = epochMsNoFuso(SEMANA, "05:00");
const m = (a: number, b: number) => ({ m1: a, m2: a, m3: a, t1: b, t2: b, t3: b });
export const F = "pF";

export const ETAPAS_F: EtapaBruta[] = [
  { id: "f-rosq", produtoId: F, operacaoId: "opRosq", ordem: 0, metas: m(2000, 1600), maquinasCompativeis: ["R3", "R5", "R6"] },
  { id: "f-para", produtoId: F, operacaoId: "opPara", ordem: 1, metas: m(1500, 1200), maquinasCompativeis: ["P9", "P10", "P11", "P12"] },
  { id: "f-rp", produtoId: F, operacaoId: "opRP", ordem: 2, metas: m(1275, 1100), maquinasCompativeis: ["A8"] },
  { id: "f-etiq", produtoId: F, operacaoId: "opEtiq", ordem: 3, metas: m(3500, 3000), maquinasCompativeis: ["E15", "E16"] },
  { id: "f-emb", produtoId: F, operacaoId: "opEmb", ordem: 4, metas: m(5000, 4500), maquinasCompativeis: ["EMB17"] },
];
export const ESTRUTURA_F: EstruturaProduto = {
  produtoId: F, modelo: "rotas", regraEtapaFinal: "explicita",
  rotas: [
    { id: "r-auto", codigo: "AUTO", nome: "Automática", ativa: true, preferencia: 1, etapas: ["f-rp"] },
    { id: "r-conv", codigo: "CONV", nome: "Convencional", ativa: true, preferencia: 2, etapas: ["f-rosq", "f-para"] },
  ],
  poolComum: { etapas: ["f-etiq", "f-emb"], entradaId: "f-etiq" }, etapaFinalId: "f-emb",
  convergencia: { destinoId: "f-etiq", origens: [{ rotaCodigo: "AUTO", etapaId: "f-rp" }, { rotaCodigo: "CONV", etapaId: "f-para" }] },
};
export const SEL_F = { "f-rosq": ["R3", "R6"], "f-para": ["P9", "P10"], "f-rp": ["A8"], "f-etiq": ["E15"], "f-emb": ["EMB17"] };

export function itemF(demanda: number, selecao: Record<string, string[]> = SEL_F): ItemPrevistoBruto { return { produtoId: F, quantidade: demanda, valorUnitario: 0.1825, maquinasPorEtapa: selecao }; }
export const etapaCaixa = (id = "c-etiq", ordem = 0): EtapaBruta => ({ id, produtoId: "pCaixa", operacaoId: "opEtiq", ordem, metas: m(2500, 2200), maquinasCompativeis: ["E16", "E15"] });

export function estadoF(opcoes: { demanda?: number; selecao?: Record<string, string[]>; pessoas?: number; itensExtras?: ItemPrevistoBruto[]; etapasExtras?: EtapaBruta[]; dias?: string[]; rotas?: Partial<NonNullable<EstadoBruto["rotas"]>> } = {}): EstadoBruto {
  const n = opcoes.pessoas ?? 18;
  return {
    previsaoId: "prev-f", semanaInicio: SEMANA, diasProdutivos: opcoes.dias ?? DIAS, periodosAtuais: PERIODOS_REAIS, diasExistentes: [],
    equipeProdutiva: Array.from({ length: n }, (_, i) => ({ funcionarioId: `f${String(i + 1).padStart(2, "0")}`, ativo: true })),
    itens: [itemF(opcoes.demanda ?? 116625, opcoes.selecao), ...(opcoes.itensExtras ?? [])],
    etapas: [...ETAPAS_F, ...(opcoes.etapasExtras ?? [])],
    maquinasIndisponiveisPrevisao: [], maquinasInativas: [], ausencias: [], indisponibilidades: [], alocacoes: [],
    nomesOperacao: { opRosq: "Rosquear", opPara: "Parafusar", opRP: "Rosquear + Parafusar", opEtiq: "Etiquetar", opEmb: "Embalar" },
    nomesProdutos: { [F]: 'Conector 3/4" (Final)', pCaixa: "Caixa Amarela" },
    parametros: { wipModo: "desligado", wipDiasLimite: 1, revezamentoModo: "duro" } as EstadoBruto["parametros"],
    rotas: { estruturas: { [F]: ESTRUTURA_F }, ...(opcoes.rotas ?? {}) },
  };
}
