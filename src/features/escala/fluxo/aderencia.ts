// ADERÊNCIA À ESCALA por período — postos PLANEJADOS × realmente EXECUTADOS. Pura.
// O que os dados sustentam: o apontamento é por MÁQUINA/POSTO (produto, operação, status, motivo); `funcionario_id` é só quem LANÇOU. Logo a aderência por PESSOA não é medível — só por posto.
// Estado de produção (boas, WIP, paradas) continua válido mesmo quando a aderência é baixa; a aderência NÃO valida nem invalida a qualidade das decisões do motor.
import type { ApontamentoReal } from "../producaoReal";
import type { AlocacaoEscala, SlotEscala } from "../types";

export type StatusAderenciaPosto =
  | "igual" // a máquina produziu o MESMO produto e a MESMA operação planejados
  | "divergente_produto_operacao" // a máquina produziu, mas outro produto ou outra operação
  | "nao_executado" // só sem_producao (motivo registrado)
  | "sem_apontamento"; // período fechado sem nenhuma linha da máquina

export interface AderenciaPosto {
  slot: number;
  data: string;
  periodoId: string;
  maquinaId: string;
  produtoId: string | null;
  operacaoId: string | null;
  status: StatusAderenciaPosto;
  intervencaoManual: boolean; // a linha planejada tem origem "manual" (troca manual do supervisor)
  motivo: string | null; // motivo do sem_producao
  apontado: { produtoId: string | null; operacaoId: string | null } | null;
}

export interface AderenciaPeriodo {
  slot: number;
  data: string;
  periodoId: string;
  fechado: boolean;
  planejados: number;
  igual: number;
  divergente: number;
  naoExecutado: number;
  semApontamento: number;
  foraDoPlano: number; // máquinas com produção apontada e SEM posto planejado no período
  intervencoesManuais: number;
  /** igual ÷ planejados com apontamento (exclui sem_apontamento). null se nada foi apontado. */
  aderencia: number | null;
  /** igual ÷ planejados (conta sem_apontamento como não aderente). */
  aderenciaBruta: number | null;
  motivos: Record<string, number>;
  /** rótulo da janela: "janela_confiavel" até o instante informado; depois "aderencia_nao_confiavel" (estado de produção segue válido). */
  janela: "janela_confiavel" | "aderencia_nao_confiavel" | "nao_classificada";
  postos: AderenciaPosto[];
}

export interface OpcoesAderencia {
  agoraMs: number;
  fechamentoMinutos?: number; // default 10
  /** fim da janela com aderência conhecida (epoch ms). Ausente ⇒ "nao_classificada". */
  janelaConfiavelAteMs?: number;
  incluirPostos?: boolean; // default false (só contagens)
}

export function aderenciaPorPeriodo(slots: SlotEscala[], planejado: AlocacaoEscala[], apontamentos: ApontamentoReal[], o: OpcoesAderencia): AderenciaPeriodo[] {
  const fech = (o.fechamentoMinutos ?? 10) * 60_000;
  const idx = new Map(slots.map((s) => [`${s.data}|${s.periodoId}`, s.indice]));
  const apt = new Map<string, ApontamentoReal[]>();
  apontamentos.forEach((a) => {
    if (!a.maquinaId || a.lancadoEmMs > o.agoraMs) return;
    const t = idx.get(`${a.data}|${a.periodoId}`);
    if (t === undefined) return;
    const k = `${t}|${a.maquinaId}`;
    (apt.get(k) ?? apt.set(k, []).get(k)!).push(a);
  });
  const out: AderenciaPeriodo[] = [];
  slots.forEach((s) => {
    const fechado = s.fimMs + fech <= o.agoraMs;
    const linhas = planejado.filter((a) => a.maquinaId && a.data === s.data && a.periodoId === s.periodoId);
    // uma máquina planejada conta UMA vez (carga adicional na mesma máquina não duplica)
    const porMaquina = new Map<string, AlocacaoEscala>();
    linhas.forEach((a) => { if (!porMaquina.has(a.maquinaId as string)) porMaquina.set(a.maquinaId as string, a); });
    const p: AderenciaPeriodo = {
      slot: s.indice, data: s.data, periodoId: s.periodoId, fechado, planejados: porMaquina.size, igual: 0, divergente: 0, naoExecutado: 0, semApontamento: 0, foraDoPlano: 0, intervencoesManuais: 0,
      aderencia: null, aderenciaBruta: null, motivos: {}, postos: [],
      janela: o.janelaConfiavelAteMs === undefined ? "nao_classificada" : s.fimMs <= o.janelaConfiavelAteMs ? "janela_confiavel" : "aderencia_nao_confiavel",
    };
    if (fechado) {
      porMaquina.forEach((a, maq) => {
        const as = apt.get(`${s.indice}|${maq}`) ?? [];
        const prod = as.filter((x) => x.status === "produzindo");
        const manual = a.origem === "manual";
        if (manual) p.intervencoesManuais++;
        let status: StatusAderenciaPosto;
        let motivo: string | null = null;
        let apontado: AderenciaPosto["apontado"] = null;
        if (as.length === 0) { status = "sem_apontamento"; p.semApontamento++; }
        else if (prod.length === 0) { status = "nao_executado"; p.naoExecutado++; motivo = as[0].motivo ?? "sem_motivo"; p.motivos[motivo] = (p.motivos[motivo] ?? 0) + 1; }
        else {
          const igual = prod.some((x) => (x.produtoId ?? null) === (a.produtoId ?? null) && (x.operacaoId ?? null) === (a.operacaoId ?? null));
          apontado = { produtoId: prod[0].produtoId ?? null, operacaoId: prod[0].operacaoId ?? null };
          if (igual) { status = "igual"; p.igual++; } else { status = "divergente_produto_operacao"; p.divergente++; }
        }
        if (o.incluirPostos) p.postos.push({ slot: s.indice, data: s.data, periodoId: s.periodoId, maquinaId: maq, produtoId: a.produtoId ?? null, operacaoId: a.operacaoId ?? null, status, intervencaoManual: manual, motivo, apontado });
      });
      apt.forEach((as, k) => {
        const [t, maq] = [Number(k.split("|")[0]), k.split("|")[1]];
        if (t === s.indice && !porMaquina.has(maq) && as.some((x) => x.status === "produzindo")) p.foraDoPlano++;
      });
      const apontados = p.igual + p.divergente + p.naoExecutado;
      p.aderencia = apontados > 0 ? Math.round((p.igual / apontados) * 1000) / 1000 : null;
      p.aderenciaBruta = p.planejados > 0 ? Math.round((p.igual / p.planejados) * 1000) / 1000 : null;
    }
    out.push(p);
  });
  return out;
}
