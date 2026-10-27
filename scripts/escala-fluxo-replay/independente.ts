// VERIFICADOR INDEPENDENTE (critérios A, B, C, D) — escrito do zero a partir dos DADOS (slots, ausências, causas de indisponibilidade, pools, plano),
// sem usar gerarEscala, maquinaDisponivelNoSlot, rotacao.ts nem verificarRestricoesDuras. Replica apenas as invariantes documentadas:
//  - máquina: inativa | fora da Previsão (semana) | causa [desde, liberada) que INTERSECTA [início, fim) do período (revalidarDisponibilidade.ts / disponibilidade.ts);
//  - funcionário: na equipe produtiva e sem janela de ausência [inicioMin, fimMin) que sobreponha o período (null/null = dia inteiro);
//  - posto: máquina ∈ seleção da Previsão do pool (produto|etapa), operação da linha = operação do pool;
//  - revezamento duro (rotacao.ts): mesma operacao_id em períodos consecutivos do MESMO dia ⇒ violação; primeiro período do dia zera; M3→T1 conta.
import type { AlocacaoEscala, EntradaEscala, SlotEscala } from "@/features/escala/types";
import type { Parada } from "./dados";

export interface ViolacaoInd { criterio: "A" | "B" | "C" | "D"; tipo: string; slot: number; data: string; periodoId: string; funcionarioId?: string; maquinaId?: string; detalhe: string; aviso?: boolean }

const chaveSlot = (a: { data: string; periodoId: string }) => `${a.data}|${a.periodoId}`;

export interface OpcoesIndep {
  /** paradas reais (ocorrencias_maquina) a conferir ALÉM das causas que o motor conhecia. Marcadas como `aviso` quando não estavam na entrada. */
  paradasReais?: Parada[];
  /** plano vigente (para B). */
  planoVigente: AlocacaoEscala[];
}

function linhasPorSlot(slots: SlotEscala[], rows: AlocacaoEscala[]) {
  const m = new Map<number, AlocacaoEscala[]>();
  const idx = new Map(slots.map((s) => [chaveSlot(s), s.indice]));
  rows.forEach((a) => { const i = idx.get(chaveSlot(a)); if (i === undefined) return; (m.get(i) ?? m.set(i, []).get(i)!).push(a); });
  return { m, idx };
}

/** `futuras` = alocações propostas (slots ≥ aPartirDe). O plano completo avaliado = congeladas (< aPartirDe) ∪ futuras. */
export function verificarIndependente(entrada: EntradaEscala, futuras: AlocacaoEscala[], op: OpcoesIndep): ViolacaoInd[] {
  const v: ViolacaoInd[] = [];
  const { slots } = entrada;
  const idx = new Map(slots.map((s) => [chaveSlot(s), s.indice]));
  const ap = entrada.aPartirDe;
  const push = (criterio: ViolacaoInd["criterio"], tipo: string, s: SlotEscala, extra: Partial<ViolacaoInd>, detalhe: string, aviso = false) => v.push({ criterio, tipo, slot: s.indice, data: s.data, periodoId: s.periodoId, detalhe, ...(aviso ? { aviso } : {}), ...extra });
  const equipe = new Set(entrada.funcionarios.map((f) => f.id));
  const poolPorChave = new Map(entrada.pools.map((p) => [`${p.produtoId}|${p.etapaId}`, p]));

  // ---- B: passado alterado (linhas fora do mutável não podem aparecer; se aparecerem devem ser IDÊNTICAS às vigentes) ----
  const vigentePorSlotFunc = new Map(op.planoVigente.map((a) => [`${chaveSlot(a)}|${a.funcionarioId}`, a]));
  const posto = (a: AlocacaoEscala) => `${a.maquinaId ?? ""}|${a.produtoId ?? ""}|${a.etapaId ?? ""}|${a.operacaoId ?? ""}|${Math.round(a.pecas)}`;
  futuras.forEach((a) => {
    const i = idx.get(chaveSlot(a));
    if (i === undefined) { v.push({ criterio: "B", tipo: "slot_inexistente", slot: -1, data: a.data, periodoId: a.periodoId, funcionarioId: a.funcionarioId, detalhe: "linha fora dos slots da semana" }); return; }
    if (i < ap) {
      const vg = vigentePorSlotFunc.get(`${chaveSlot(a)}|${a.funcionarioId}`);
      if (!vg || posto(vg) !== posto(a)) push("B", "passado_alterado", slots[i], { funcionarioId: a.funcionarioId, maquinaId: a.maquinaId ?? undefined }, `linha em slot ${i} < aPartirDe ${ap} difere do vigente`);
    }
  });
  // congeladas da entrada devem ser exatamente as vigentes do passado
  entrada.congeladas.forEach((a) => {
    const vg = vigentePorSlotFunc.get(`${chaveSlot(a)}|${a.funcionarioId}`);
    const i = idx.get(chaveSlot(a));
    if (i !== undefined && i < ap && (!vg || posto(vg) !== posto(a))) push("B", "congelada_diferente_do_vigente", slots[i], { funcionarioId: a.funcionarioId }, "congelada da entrada ≠ plano vigente");
  });

  // plano completo para C/D (congeladas < ap + futuras ≥ ap; linhas das futuras < ap já tratadas como B e ignoradas aqui)
  const completo: AlocacaoEscala[] = [...entrada.congeladas.filter((a) => (idx.get(chaveSlot(a)) ?? 99999) < ap), ...futuras.filter((a) => (idx.get(chaveSlot(a)) ?? -1) >= ap)];
  const { m: porSlot } = linhasPorSlot(slots, completo);

  slots.forEach((s) => {
    if (s.indice < ap) return; // A/C/D só no mutável (o passado é do vigente); D também olha o par (ap-1 → ap) abaixo
    const rows = porSlot.get(s.indice) ?? [];
    // ---- A ----
    rows.forEach((a) => {
      // pessoa
      if (!equipe.has(a.funcionarioId)) push("A", "funcionario_fora_da_equipe", s, { funcionarioId: a.funcionarioId }, "não está na equipe produtiva da semana");
      const aus = entrada.ausencias.some((x) => x.funcionarioId === a.funcionarioId && x.data === s.data && (x.inicioMin === null || x.fimMin === null || (x.inicioMin < s.fimMin && s.inicioMin < x.fimMin)));
      if (aus) push("A", "funcionario_ausente", s, { funcionarioId: a.funcionarioId }, a.maquinaId ? "alocado em posto durante ausência" : "linha de pessoa ausente (sem posto)");
      if (!a.maquinaId) return;
      // máquina
      if ((entrada.maquinasInativas ?? []).includes(a.maquinaId)) push("A", "maquina_inativa", s, { maquinaId: a.maquinaId }, "máquina inativa");
      if (entrada.maquinasIndisponiveisPrevisao.includes(a.maquinaId)) push("A", "maquina_fora_da_previsao", s, { maquinaId: a.maquinaId }, "máquina indisponível na Previsão");
      entrada.indisponibilidades.filter((i) => i.maquinaId === a.maquinaId && i.desdeMs < s.fimMs && (i.liberadaEmMs === null || i.liberadaEmMs > s.inicioMs))
        .forEach(() => push("A", "maquina_indisponivel", s, { maquinaId: a.maquinaId ?? undefined }, "causa de indisponibilidade intersecta o período"));
      (op.paradasReais ?? []).filter((p) => p.maquinaId === a.maquinaId && p.desdeMs < s.fimMs && (p.liberadaEmMs === null || p.liberadaEmMs > s.inicioMs))
        .forEach(() => { if (!entrada.indisponibilidades.some((i) => i.maquinaId === a.maquinaId && i.desdeMs < s.fimMs && (i.liberadaEmMs === null || i.liberadaEmMs > s.inicioMs))) push("A", "parada_real_nao_conhecida_pelo_motor", s, { maquinaId: a.maquinaId ?? undefined }, "Parada real (ocorrencias_maquina) intersecta e NÃO estava na entrada", true); });
      // posto
      if (!a.produtoId || !a.etapaId) { push("A", "posto_sem_produto_etapa", s, { maquinaId: a.maquinaId }, "máquina sem produto/etapa"); return; }
      const pool = poolPorChave.get(`${a.produtoId}|${a.etapaId}`);
      if (!pool) { push("A", "pool_inexistente", s, { maquinaId: a.maquinaId }, "produto|etapa fora da Previsão"); return; }
      if (!pool.maquinasIds.includes(a.maquinaId)) push("A", "maquina_fora_da_selecao", s, { maquinaId: a.maquinaId }, "máquina fora da seleção da Previsão para o pool");
      if (pool.maquinasCompativeisIds && !pool.maquinasCompativeisIds.includes(a.maquinaId)) push("A", "maquina_fora_do_roteiro", s, { maquinaId: a.maquinaId }, "máquina fora das compatíveis do roteiro");
      if (a.operacaoId !== pool.operacaoId) push("A", "operacao_diferente_do_pool", s, { maquinaId: a.maquinaId }, `operação da linha ${a.operacaoId} ≠ do pool ${pool.operacaoId}`);
    });
    // ---- C ----
    const porPessoa = new Map<string, AlocacaoEscala[]>();
    rows.forEach((a) => (porPessoa.get(a.funcionarioId) ?? porPessoa.set(a.funcionarioId, []).get(a.funcionarioId)!).push(a));
    porPessoa.forEach((l, f) => { if (l.length > 1) push("C", "pessoa_com_mais_de_uma_linha", s, { funcionarioId: f }, `${l.length} linhas no mesmo período (${l.filter((x) => x.maquinaId).length} com posto)`); });
    const porMaq = new Map<string, AlocacaoEscala[]>();
    rows.filter((a) => a.maquinaId).forEach((a) => (porMaq.get(a.maquinaId!) ?? porMaq.set(a.maquinaId!, []).get(a.maquinaId!)!).push(a));
    porMaq.forEach((l, m) => {
      if (l.length > 1) {
        const pools = new Set(l.map((x) => `${x.produtoId}|${x.etapaId}`));
        push("C", pools.size > 1 ? "maquina_duplicada_em_pools" : "posto_com_duas_pessoas", s, { maquinaId: m }, `${l.length} pessoas na mesma máquina (${pools.size} pool(s))`);
      }
    });
  });

  // ---- D: revezamento (inclui o par que atravessa a fronteira aPartirDe-1 → aPartirDe, usando as congeladas) ----
  const operacaoDe = (a: AlocacaoEscala) => (a.maquinaId ? (a.operacaoId ?? poolPorChave.get(`${a.produtoId}|${a.etapaId}`)?.operacaoId ?? null) : null);
  const porFuncSlot = new Map<string, AlocacaoEscala>();
  completo.forEach((a) => { const i = idx.get(chaveSlot(a)); if (i !== undefined) porFuncSlot.set(`${i}|${a.funcionarioId}`, a); });
  const pessoas = new Set(completo.map((a) => a.funcionarioId));
  for (const f of pessoas) {
    for (let i = Math.max(1, ap); i < slots.length; i++) {
      const s = slots[i];
      if (s.primeiroDoDia) continue;
      const a0 = porFuncSlot.get(`${i - 1}|${f}`), a1 = porFuncSlot.get(`${i}|${f}`);
      if (!a0 || !a1) continue;
      const o0 = operacaoDe(a0), o1 = operacaoDe(a1);
      if (o0 && o1 && o0 === o1) push("D", "mesma_operacao_consecutiva", s, { funcionarioId: f, maquinaId: a1.maquinaId ?? undefined }, `operação ${o1} repetida do período anterior`);
      if (a1.excecaoRevezamento) push("D", "excecao_revezamento_nova", s, { funcionarioId: f }, "linha marcada excecaoRevezamento (o motor com revezamentoDuro não admite exceção)", true);
    }
  }
  return v;
}

/**
 * Churn medido de forma independente entre duas versões do futuro (`novo` × `ref`), só slots ≥ aPartirDe:
 *  - linhas: pessoa×slot com posto/peças/pessoa diferentes (churn operacional: o que o supervisor teria de comunicar);
 *  - trocasPosto: pessoa×slot cujo POSTO (máquina|produto|etapa) mudou;
 *  - postosNovos: (slot, máquina, produto, etapa) presentes no novo e ausentes na referência (churn de capacidade, ignora QUEM ocupa);
 *  - *Primeiro: o mesmo restrito ao primeiro período mutável.
 */
export function churnIndependente(entrada: EntradaEscala, novo: AlocacaoEscala[], ref: AlocacaoEscala[]) {
  const idx = new Map(entrada.slots.map((s) => [chaveSlot(s), s.indice]));
  const post = (a?: AlocacaoEscala) => (a && a.maquinaId ? `${a.maquinaId}|${a.produtoId}|${a.etapaId}` : "ocioso");
  const rf = new Map(ref.map((a) => [`${idx.get(chaveSlot(a))}|${a.funcionarioId}`, a]));
  const nv = new Map(novo.map((a) => [`${idx.get(chaveSlot(a))}|${a.funcionarioId}`, a]));
  const ap = entrada.aPartirDe;
  let linhas = 0, trocasPosto = 0, linhasPrimeiro = 0, trocasPrimeiro = 0;
  const porOffset = [0, 0, 0, 0, 0]; // linhas alteradas (posto OU peças) no 1º, 2º, 3º, 4º período mutável e nos seguintes
  const porOffsetPosto = [0, 0, 0, 0, 0]; // idem, só mudança de POSTO
  nv.forEach((a, k) => {
    const i = Number(k.split("|")[0]);
    if (i < ap) return;
    const b = rf.get(k);
    const trocou = post(a) !== post(b);
    const diff = trocou || Math.round(a.pecas ?? 0) !== Math.round(b?.pecas ?? 0);
    if (diff) { linhas++; if (i === ap) linhasPrimeiro++; porOffset[Math.min(4, i - ap)]++; }
    if (trocou) { trocasPosto++; if (i === ap) trocasPrimeiro++; porOffsetPosto[Math.min(4, i - ap)]++; }
  });
  const conj = (m: Map<string, AlocacaoEscala>) => { const s = new Set<string>(); m.forEach((a, k) => { const i = Number(k.split("|")[0]); if (i >= ap && a.maquinaId) s.add(`${i}|${post(a)}`); }); return s; };
  const A = conj(nv), B = conj(rf);
  let postosNovos = 0, postosNovosPrimeiro = 0;
  A.forEach((k) => { if (!B.has(k)) { postosNovos++; if (Number(k.split("|")[0]) === ap) postosNovosPrimeiro++; } });
  // `linhas` inclui diferença só de peças (ex.: f embutido nas peças do plano novo); `trocasPosto` = linhas cujo POSTO (máquina|produto|etapa) mudou — o churn operacional
  return { linhas, trocasPosto, linhasSoPecas: linhas - trocasPosto, linhasPrimeiro, trocasPrimeiro, postosNovos, postosNovosPrimeiro, postosTotais: A.size, porOffset, porOffsetPosto };
}
