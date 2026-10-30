// VERIFICADOR INDEPENDENTE de restrições duras. NÃO usa gerarEscala, disponibilidade.ts nem a seleção de postos do motor: reimplementa as regras
// a partir dos dados brutos da entrada, para que um erro do motor (ou de um hook novo) não se esconda atrás de si mesmo.
//
// Regras: máquina inativa/indisponível (Previsão ou parada/bloqueio que intersecta o período); funcionário ausente ou fora da equipe;
// revezamento (mesma operação em períodos consecutivos do mesmo dia — ou, com `revezamentoEscopo = "bloco"`, mais de uma vez no mesmo bloco manhã/tarde); 1 pessoa por posto; 1 posto por pessoa por período; máquina dentro da
// seleção da Previsão (e do roteiro, quando conhecido); passado (slots < aPartirDe) idêntico ao congelado.

import type { AlocacaoEscala, EntradaEscala } from "../types";
import type { ViolacaoDura } from "./tipos";
import { chaveBloco, ehPeriodoPonte, MemoriaBloco } from "../exposicaoBloco";

const chaveSlot = (a: { data: string; periodoId: string }) => `${a.data}|${a.periodoId}`;

export interface OpcoesVerificacao {
  /** Só confere as linhas NOVAS (slot ≥ aPartirDe): linhas já congeladas — gravadas sob outras condições (funcionário desativado depois, parada registrada depois) —
   *  não são acusadas. O passado alterado (linha < aPartirDe diferente do congelado) continua sendo conferido. Default false (comportamento v1). */
  somenteLinhasNovas?: boolean;
  /** Primeiro slot "novo" no modo somenteLinhasNovas. Default `entrada.aPartirDe`. */
  aPartirDe?: number;
}

export function verificarRestricoesDuras(entrada: EntradaEscala, alocacoesTodas: AlocacaoEscala[], opcoes: OpcoesVerificacao = {}): ViolacaoDura[] {
  const v: ViolacaoDura[] = [];
  const ap = opcoes.aPartirDe ?? entrada.aPartirDe;
  const idxDe = new Map(entrada.slots.map((s) => [chaveSlot(s), s.indice]));
  // modo somenteLinhasNovas: as regras por linha/posto/revezamento valem só para slot ≥ aPartirDe; passado_alterado (abaixo) usa a lista completa
  const alocacoes = opcoes.somenteLinhasNovas ? alocacoesTodas.filter((a) => (idxDe.get(chaveSlot(a)) ?? Number.POSITIVE_INFINITY) >= ap) : alocacoesTodas;
  const slotPor = new Map(entrada.slots.map((s) => [chaveSlot(s), s]));
  const equipe = new Set(entrada.funcionarios.map((f) => f.id));
  const inativas = new Set(entrada.maquinasInativas ?? []);
  const foraPrevisao = new Set(entrada.maquinasIndisponiveisPrevisao);
  const poolPor = new Map(entrada.pools.map((p) => [`${p.produtoId}|${p.etapaId}`, p]));
  const base = (a: AlocacaoEscala) => ({ data: a.data, periodoId: a.periodoId, funcionarioId: a.funcionarioId, ...(a.maquinaId ? { maquinaId: a.maquinaId } : {}), ...(a.produtoId ? { produtoId: a.produtoId } : {}), ...(a.etapaId ? { etapaId: a.etapaId } : {}) });

  // ---- por linha ----
  alocacoes.forEach((a) => {
    const slot = slotPor.get(chaveSlot(a));
    if (!slot) return;
    if (!equipe.has(a.funcionarioId)) v.push({ tipo: "funcionario_fora_da_equipe", ...base(a), detalhe: `funcionário ${a.funcionarioId} não pertence à equipe produtiva` });
    const ausente = entrada.ausencias.some(
      (x) => x.funcionarioId === a.funcionarioId && x.data === a.data && (x.inicioMin === null || x.fimMin === null || (x.inicioMin < slot.fimMin && slot.inicioMin < x.fimMin))
    );
    // ausência só é violação quando a pessoa tem POSTO (linha sem posto de ausente não é gerada, mas se vier não ocupa máquina)
    if (ausente && a.maquinaId) v.push({ tipo: "funcionario_ausente", ...base(a), detalhe: `funcionário ausente em ${a.data} ${a.periodoId} alocado em ${a.maquinaId}` });
    if (!a.maquinaId) return;
    if (inativas.has(a.maquinaId)) v.push({ tipo: "maquina_inativa", ...base(a), detalhe: `máquina ${a.maquinaId} inativa` });
    const parada = foraPrevisao.has(a.maquinaId) || entrada.indisponibilidades.some((i) => i.maquinaId === a.maquinaId && i.desdeMs < slot.fimMs && (i.liberadaEmMs === null || i.liberadaEmMs > slot.inicioMs));
    if (parada) v.push({ tipo: "maquina_indisponivel", ...base(a), detalhe: `máquina ${a.maquinaId} indisponível em ${a.data} ${a.periodoId}` });
    const pool = a.produtoId && a.etapaId ? poolPor.get(`${a.produtoId}|${a.etapaId}`) : undefined;
    if (!pool || !pool.maquinasIds.includes(a.maquinaId)) v.push({ tipo: "maquina_fora_da_selecao", ...base(a), detalhe: `${a.maquinaId} não está selecionada na Previsão para ${a.produtoId}|${a.etapaId}` });
    else if (pool.maquinasCompativeisIds && !pool.maquinasCompativeisIds.includes(a.maquinaId)) v.push({ tipo: "maquina_fora_do_roteiro", ...base(a), detalhe: `${a.maquinaId} não é compatível com a etapa no roteiro atual` });
  });

  // ---- 1 pessoa por posto / 1 posto por pessoa ----
  const porMaquina = new Map<string, AlocacaoEscala[]>();
  const porPessoa = new Map<string, AlocacaoEscala[]>();
  alocacoes.forEach((a) => {
    const kp = `${chaveSlot(a)}|${a.funcionarioId}`;
    porPessoa.set(kp, [...(porPessoa.get(kp) ?? []), a]);
    if (a.maquinaId) {
      const km = `${chaveSlot(a)}|${a.maquinaId}`;
      porMaquina.set(km, [...(porMaquina.get(km) ?? []), a]);
    }
  });
  porMaquina.forEach((l) => {
    if (l.length > 1) v.push({ tipo: "duas_pessoas_no_posto", ...base(l[1]), detalhe: `${l.length} pessoas na máquina ${l[0].maquinaId} em ${l[0].data} ${l[0].periodoId}` });
  });
  porPessoa.forEach((l) => {
    if (l.length > 1) v.push({ tipo: "pessoa_em_dois_postos", ...base(l[1]), detalhe: `${l[0].funcionarioId} aparece ${l.length}x em ${l[0].data} ${l[0].periodoId}` });
  });

  // ---- revezamento: mesma operação em períodos consecutivos do mesmo dia (o passado congelado entra para o 1º slot mutável) ----
  const duro = entrada.revezamentoDuro === true;
  const tudo = new Map<string, AlocacaoEscala>();
  entrada.congeladas.forEach((a) => tudo.set(`${chaveSlot(a)}|${a.funcionarioId}`, a));
  alocacoes.forEach((a) => tudo.set(`${chaveSlot(a)}|${a.funcionarioId}`, a));
  if (duro && entrada.revezamentoEscopo === "bloco") {
    // ESCOPO BLOCO: a mesma operação (ou equivalente) no mesmo bloco (manhã/tarde) é violação. A memória do bloco vem de TUDO o que veio antes na ordem dos slots:
    // congeladas e linhas do plano (a evidência real de execução substitui a congelada daquele (período, pessoa)). Cada linha NOVA conferida é acusada na 2ª execução em diante.
    const eq = entrada.equivalenciaOperacoes;
    const evi = new Map((entrada.exposicaoExecutada ?? []).map((e) => [`${chaveSlot(e)}|${e.funcionarioId}`, e]));
    const porPessoaBloco = new Map<string, AlocacaoEscala[]>();
    tudo.forEach((a) => {
      const slot = slotPor.get(chaveSlot(a));
      if (!slot || !a.maquinaId || !a.operacaoId) return;
      const k = `${a.funcionarioId}|${chaveBloco(slot)}`;
      porPessoaBloco.set(k, [...(porPessoaBloco.get(k) ?? []), a]);
    });
    // pessoas só com evidência (sem linha congelada) também carregam exposição
    evi.forEach((e) => {
      const slot = slotPor.get(chaveSlot(e));
      if (!slot) return;
      const k = `${e.funcionarioId}|${chaveBloco(slot)}`;
      if (!porPessoaBloco.has(k)) porPessoaBloco.set(k, []);
    });
    const novas = new Set(alocacoes.map((a) => `${chaveSlot(a)}|${a.funcionarioId}`));
    porPessoaBloco.forEach((linhas, k) => {
      const mem = new MemoriaBloco(eq);
      const fid = k.split("|")[0];
      const itens: { slot: number; linha: AlocacaoEscala | null; ops: string[] }[] = linhas.map((a) => {
        const e = evi.get(`${chaveSlot(a)}|${a.funcionarioId}`);
        return { slot: (slotPor.get(chaveSlot(a)) as { indice: number }).indice, linha: a, ops: e ? e.operacoes : [a.operacaoId as string] };
      });
      evi.forEach((e) => {
        const slot = slotPor.get(chaveSlot(e));
        if (slot && e.funcionarioId === fid && `${fid}|${chaveBloco(slot)}` === k && !linhas.some((a) => chaveSlot(a) === chaveSlot(e))) itens.push({ slot: slot.indice, linha: null, ops: e.operacoes });
      });
      itens.sort((x, y) => x.slot - y.slot);
      itens.forEach((it) => {
        // uma linha NOVA é conferida pela operação que o PLANO lhe deu (não pela evidência, que só vale para slots < aPartirDe)
        const opsConferir = it.linha && novas.has(`${chaveSlot(it.linha)}|${it.linha.funcionarioId}`) && it.slot >= ap ? [it.linha.operacaoId as string] : it.ops;
        const viola = it.linha && novas.has(`${chaveSlot(it.linha)}|${it.linha.funcionarioId}`) && opsConferir.some((o) => mem.proibido(fid, o));
        if (viola && it.linha) v.push({ tipo: "revezamento", ...base(it.linha), detalhe: `${fid} repete a operação ${it.linha.operacaoId} no mesmo bloco (${chaveBloco(slotPor.get(chaveSlot(it.linha)) as { data: string; periodoId: string })}) em ${it.linha.periodoId}` });
        opsConferir.forEach((o) => mem.registrar(fid, o));
      });
    });
    // PONTE M3 → T1 (flag): linha NOVA em T1 que repete (ou equivale a) a operação que a MESMA pessoa fez em M3 do mesmo dia. M3 = congelada/plano (a evidência real, se houver, a substitui).
    if (entrada.revezamentoPonteM3T1 === true) {
      alocacoes.forEach((a) => {
        const slot = slotPor.get(chaveSlot(a));
        if (!slot || !a.maquinaId || !a.operacaoId || !ehPeriodoPonte(entrada.slots, slot.indice)) return;
        const m3 = entrada.slots[slot.indice - 1];
        const e = evi.get(`${chaveSlot(m3)}|${a.funcionarioId}`);
        const ant = tudo.get(`${chaveSlot(m3)}|${a.funcionarioId}`);
        const opsM3 = e ? e.operacoes : ant && ant.maquinaId && ant.operacaoId ? [ant.operacaoId] : [];
        const mem = new MemoriaBloco(eq);
        opsM3.forEach((o) => mem.registrar(a.funcionarioId, o));
        if (mem.proibido(a.funcionarioId, a.operacaoId)) v.push({ tipo: "revezamento", ...base(a), detalhe: `${a.funcionarioId} repete a operação ${a.operacaoId} de ${m3.periodoId} em ${a.periodoId} (${a.data}): ponte M3 → T1` });
      });
    }
  } else alocacoes.forEach((a) => {
    const slot = slotPor.get(chaveSlot(a));
    if (!slot || !a.maquinaId || !a.operacaoId || slot.primeiroDoDia || slot.indice === 0) return;
    const ant = entrada.slots[slot.indice - 1];
    if (ant.data !== slot.data) return;
    const antA = tudo.get(`${chaveSlot(ant)}|${a.funcionarioId}`);
    if (antA && antA.maquinaId && antA.operacaoId === a.operacaoId && (duro || !a.excecaoRevezamento)) {
      v.push({ tipo: "revezamento", ...base(a), detalhe: `${a.funcionarioId} repete a operação ${a.operacaoId} em ${ant.periodoId} → ${a.periodoId} (${a.data})` });
    }
  });

  // ---- passado alterado ----
  const cong = new Map(entrada.congeladas.map((a) => [`${chaveSlot(a)}|${a.funcionarioId}`, a]));
  alocacoesTodas.forEach((a) => {
    const slot = slotPor.get(chaveSlot(a));
    if (!slot || slot.indice >= entrada.aPartirDe) return;
    const c = cong.get(`${chaveSlot(a)}|${a.funcionarioId}`);
    const igual = c && c.maquinaId === a.maquinaId && c.produtoId === a.produtoId && c.etapaId === a.etapaId && c.operacaoId === a.operacaoId;
    if (!igual) v.push({ tipo: "passado_alterado", ...base(a), detalhe: `linha de ${a.data} ${a.periodoId} (antes de aPartirDe=${entrada.aPartirDe}) difere do congelado` });
  });
  return v;
}
