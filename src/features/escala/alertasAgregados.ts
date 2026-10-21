// AGREGAÇÃO DE ALERTAS (Fase 4d, refinamento) — PURA. O snapshot técnico guarda os alertas de CADA corte (nada se apaga); esta camada separa
//   EVENTO NOVO   de   ESTADO QUE CONTINUA, para a futura interface gerencial (a tela é da 4e):
//   • alerta de ESTADO (o mesmo problema visto corte após corte, ex.: "não recuperável", "gargalo sem operador em 22/10 T2") vira UM item:
//     iniciou_em, continua_ativo, resolveu_em / expirou_em, cortes em que persistiu, pior valor observado;
//   • alerta de EVENTO (compromisso: conflito de rotação, inviável, não reparável, contingência) NUNCA é agrupado entre cortes;
//   • MUDANÇA DE ESTADO é sempre evento: situação (OK → B→C → B→D …) e o caminho do compromisso (válido → conflito → reparado).
// Reaparecer depois de sumir abre um item novo (não esconde a recorrência).

import type { AlertaSnapshot } from "./snapshotSombra";

export interface Marco { slot: number; data: string; periodoId: string; corteMs: number }

export interface DecisaoParaAgregar {
  marco: Marco; // o corte (período fechado)
  situacao: string;
  compromissoOriginal: string; // statusOriginal do snapshot
  compromissoApos: string; // statusApos do snapshot
  alertas: AlertaSnapshot[];
}

export const ALERTAS_DE_EVENTO = new Set(["conflito_rotacao_comprometido", "compromisso_nao_reparavel", "compromisso_inviavel_reparavel", "compromisso_inviavel_nao_reparavel", "contingencia_possivel"]);

export interface AlertaAgregado {
  chave: string;
  tipo: string;
  natureza: "estado" | "evento";
  data?: string;
  periodoId?: string;
  produtoId?: string;
  etapaId?: string;
  iniciouEm: Marco;
  ultimoVistoEm: Marco;
  continuaAtivo: boolean;
  resolvidoEm: Marco | null; // sumiu e o período a que se refere AINDA não passou: o problema deixou de existir
  expiradoEm: Marco | null; // sumiu porque o período a que se refere já passou
  cortesPersistiu: number;
  primeiroValor: number | null;
  piorValor: number | null;
  reaparicao: number; // 0 = 1ª ocorrência; 1+ = voltou depois de resolvido/expirado
}

export interface MudancaEstado { dimensao: "situacao" | "compromisso"; de: string | null; para: string; marco: Marco }

export interface ResultadoAgregacao {
  alertas: AlertaAgregado[];
  mudancas: MudancaEstado[];
  resumo: { alertasBrutos: number; itensEstado: number; itensEvento: number; itensTotal: number; ativos: number; resolvidos: number; expirados: number; mudancasSituacao: number; mudancasCompromisso: number; reducao: number };
}

const valor = (a: AlertaSnapshot) => (a.pecas !== undefined && a.pecas > 0 ? a.pecas : a.quantidade ?? null);
const chaveDe = (a: AlertaSnapshot) => [a.tipo, a.data ?? "", a.periodoId ?? "", a.produtoId ?? "", a.etapaId ?? ""].join("|");

export function agregarAlertas(decisoes: DecisaoParaAgregar[], opcoes: { ordemPeriodos?: string[] } = {}): ResultadoAgregacao {
  const ordem = opcoes.ordemPeriodos ?? ["m1", "m2", "m3", "t1", "t2", "t3"];
  const pos = (data: string, periodoId: string) => `${data}|${String(ordem.indexOf(periodoId)).padStart(3, "0")}`;
  const cortes = [...decisoes].sort((x, y) => x.marco.slot - y.marco.slot);
  const itens: AlertaAgregado[] = [];
  const abertos = new Map<string, AlertaAgregado>();
  const reaparicoes = new Map<string, number>();
  let brutos = 0;

  cortes.forEach((d) => {
    const vistos = new Set<string>();
    d.alertas.forEach((a) => {
      brutos++;
      const chave = chaveDe(a);
      const natureza = ALERTAS_DE_EVENTO.has(a.tipo) ? "evento" : "estado";
      if (natureza === "evento") {
        itens.push({ chave: `${chave}@${d.marco.slot}`, tipo: a.tipo, natureza, data: a.data, periodoId: a.periodoId, iniciouEm: d.marco, ultimoVistoEm: d.marco, continuaAtivo: false, resolvidoEm: null, expiradoEm: null, cortesPersistiu: 1, primeiroValor: valor(a), piorValor: valor(a), reaparicao: 0 });
        return;
      }
      vistos.add(chave);
      const aberto = abertos.get(chave);
      if (aberto) {
        aberto.ultimoVistoEm = d.marco;
        aberto.cortesPersistiu++;
        const v = valor(a);
        if (v !== null && (aberto.piorValor === null || v > aberto.piorValor)) aberto.piorValor = v;
        return;
      }
      const n = reaparicoes.get(chave);
      reaparicoes.set(chave, (n ?? -1) + 1);
      const novo: AlertaAgregado = { chave, tipo: a.tipo, natureza, data: a.data, periodoId: a.periodoId, produtoId: a.produtoId, etapaId: a.etapaId, iniciouEm: d.marco, ultimoVistoEm: d.marco, continuaAtivo: false, resolvidoEm: null, expiradoEm: null, cortesPersistiu: 1, primeiroValor: valor(a), piorValor: valor(a), reaparicao: (n ?? -1) + 1 };
      abertos.set(chave, novo);
      itens.push(novo);
    });
    // o que estava aberto e não veio neste corte: resolveu (período ainda no futuro) ou expirou (o período já passou)
    [...abertos.entries()].forEach(([chave, item]) => {
      if (vistos.has(chave)) return;
      const jaPassou = item.data !== undefined && item.periodoId !== undefined && pos(item.data, item.periodoId) <= pos(d.marco.data, d.marco.periodoId);
      if (jaPassou) item.expiradoEm = d.marco; else item.resolvidoEm = d.marco;
      abertos.delete(chave);
    });
  });
  abertos.forEach((item) => (item.continuaAtivo = true));

  // mudanças de estado (sempre são eventos)
  const mudancas: MudancaEstado[] = [];
  let sitAnt: string | null = null;
  let compAnt: string | null = null;
  cortes.forEach((d) => {
    if (d.situacao !== sitAnt) { mudancas.push({ dimensao: "situacao", de: sitAnt, para: d.situacao, marco: d.marco }); sitAnt = d.situacao; }
    const comp = d.compromissoOriginal === "compromisso_valido" ? "compromisso_valido" : `${d.compromissoOriginal}→${d.compromissoApos}`;
    if (comp !== compAnt) { mudancas.push({ dimensao: "compromisso", de: compAnt, para: comp, marco: d.marco }); compAnt = comp; }
  });

  const estado = itens.filter((i) => i.natureza === "estado");
  const evento = itens.filter((i) => i.natureza === "evento");
  return {
    alertas: itens, mudancas,
    resumo: {
      alertasBrutos: brutos, itensEstado: estado.length, itensEvento: evento.length, itensTotal: itens.length, ativos: estado.filter((i) => i.continuaAtivo).length,
      resolvidos: estado.filter((i) => i.resolvidoEm).length, expirados: estado.filter((i) => i.expiradoEm).length,
      mudancasSituacao: mudancas.filter((m) => m.dimensao === "situacao").length, mudancasCompromisso: mudancas.filter((m) => m.dimensao === "compromisso").length,
      reducao: brutos === 0 ? 0 : Math.round((1000 * (brutos - itens.length)) / brutos) / 10,
    },
  };
}

// Atalho: monta a entrada da agregação a partir dos snapshots gravados (ordem de corte)
export function decisaoDeSnapshot(s: { identificacao: { slot: number; data: string; periodoId: string; corteMs: number }; diagnostico: { situacao: string; alertas: AlertaSnapshot[] }; compromisso: { statusOriginal: string; statusApos: string } }): DecisaoParaAgregar {
  return { marco: { slot: s.identificacao.slot, data: s.identificacao.data, periodoId: s.identificacao.periodoId, corteMs: s.identificacao.corteMs }, situacao: s.diagnostico.situacao, compromissoOriginal: s.compromisso.statusOriginal, compromissoApos: s.compromisso.statusApos, alertas: s.diagnostico.alertas };
}
