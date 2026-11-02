// PRODUTO ÚNICO COM ROTAS — ADAPTADOR EM MEMÓRIA (puro; sem IO, sem relógio, sem schema novo; DESLIGADO por padrão: só entra com `cfg.produtoUnico` em planoCorte.ts).
//
// Modelo físico (pedido de 02/11): UM produto final (ex.: Conector 3/4) com ROTAS alternativas de fabricação que CONVERGEM antes de um trecho comum:
//   rota convencional:  Rosquear → Parafusar ┐
//                                            ├→ Etiquetar (Etiquetadora 15) → Embalar (Embalagem 17)  ← trecho COMUM: um só estoque, um só recurso, um só produto
//   rota automática:    Máquina 8 ───────────┘
// Hoje o banco tem DOIS produtos (Conv e Automática, `producao_real_pares_legado`). Este módulo transforma a entrada atual (dois produtos) em UM problema de produto único e devolve o plano
// em termos do produto único — sem migração: os ids legados continuam sendo as "rotas" e o produto canônico é só um rótulo em memória.
//
// Tradução para o planejador (planejadorFuturo/postosDespacho, que ficam quase intocados):
//   • cadeia PRINCIPAL = a rota dona do trecho comum (Conv, por padrão) com TODAS as etapas; demanda final = demanda TOTAL única − Embalagem 17 boa (somando as duas rotas);
//   • cada outra rota vira uma cadeia ALIMENTADORA (`ProdutoRev.alimenta`): só as etapas exclusivas (M8), cuja última etapa ENTREGA no MESMO estoque "parafusado → etiquetar" da principal;
//   • o trecho comum existe UMA vez (Etiquetadora 15 / Embalagem 17 como recursos e estoques únicos): não há mais dois produtos disputando a linha ⇒ NÃO há `distribuicao`;
//   • o mix entre rotas NÃO é parâmetro: sai do mesmo despacho + busca que escolhe os postos (capacidade, pessoas, WIP, gargalo, Máquina 8 única, margem por rota);
//   • máquinas da Previsão continuam absolutas: rota sem máquina numa etapa exclusiva não produz (a cadeia é reconstruída com a etapa SEM máquina, nunca "pula" a etapa);
//   • estado real normalizado: apontamentos/linhas/contagens das etapas comuns lançados por produto legado viram UMA contagem do produto único (sem duplicar peças).
import { expandirPorProduto } from "../distribuicao";
import { chavePool, type AlocacaoEscala, type EntradaEscala, type PoolEscala } from "../types";
import { montarEstado, prepararFluxo, type CtxFluxo } from "./estado";
import type { ProdutoRev } from "./planoReverso";
import type { ContagemFisicaPar, DadosProducaoReal, DiagnosticoItem, EstadoFluxo, OpcoesFluxo, ParLegado } from "./tipos";

export interface RotaProdutoUnico { produtoId: string; rotulo: string }
export interface EtapaComumUnico { rotulo: string; /** produtoId (rota) → etapaId dessa rota na etapa comum */ etapaPorRota: Record<string, string> }
export interface ProdutoUnicoConfig {
  /** id canônico EM MEMÓRIA do produto final (ex.: "conector-3-4"); não é gravado em lugar nenhum por este módulo */
  id: string;
  rotulo: string;
  /** a ordem importa só para escolher a cadeia principal (1ª rota com o trecho comum completo); NUNCA define proporção */
  rotas: RotaProdutoUnico[];
  trechoComum: EtapaComumUnico[];
  /** tolerância relativa de compatibilidade das metas do trecho comum entre as rotas (default 0,01) */
  toleranciaMeta?: number;
}

/** O par legado do banco (`producao_real_pares_legado`) já descreve o produto único: dois produtos + as etapas comuns. */
export function produtoUnicoDePar(par: ParLegado, rotulos?: { convencional?: string; automatica?: string; produto?: string }): ProdutoUnicoConfig {
  return {
    id: par.id, rotulo: rotulos?.produto ?? par.id,
    rotas: [{ produtoId: par.produtoConvencionalId, rotulo: rotulos?.convencional ?? "Convencional" }, { produtoId: par.produtoAutomaticaId, rotulo: rotulos?.automatica ?? "Automática" }],
    trechoComum: par.etapasComuns.map((e) => ({ rotulo: e.rotulo, etapaPorRota: { [par.produtoConvencionalId]: e.etapaConvencionalId, [par.produtoAutomaticaId]: e.etapaAutomaticaId } })),
    ...(par.toleranciaMeta !== undefined ? { toleranciaMeta: par.toleranciaMeta } : {}),
  };
}

export interface InfoUnico {
  config: ProdutoUnicoConfig;
  /** cadeia principal (dona do trecho comum) e alimentadoras */
  principal: string;
  alimentadoras: string[];
  /** ligação da principal onde as rotas convergem (etapa `ligacao` → `ligacao`+1 = "entrada da Etiquetadora") */
  ligacao: number;
  /** etapaIds do trecho comum NA PRINCIPAL, na ordem */
  etapasComuns: string[];
  rotuloRota: Record<string, string>;
  /** rota com TODAS as etapas exclusivas com máquina selecionada na Previsão */
  rotaDisponivel: Record<string, boolean>;
  demandaTotal: number;
  /** demanda total − produção boa da última etapa (Embalagem 17) das DUAS rotas, projetada até o 1º período livre */
  restante: number;
  finalBoaAteAgora: number;
}
export interface PreparoUnico {
  ctx: CtxFluxo;
  estado: EstadoFluxo;
  produtos: ProdutoRev[];
  poolPor: Map<string, PoolEscala>;
  info: InfoUnico;
  diagnosticos: DiagnosticoItem[];
  /** entrada/dados normalizados usados no estado (útil em testes) */
  dadosNormalizados: DadosProducaoReal;
}

const ordena = (l: PoolEscala[]) => [...l].sort((a, b) => a.ordemEtapa - b.ordemEtapa || (a.etapaId < b.etapaId ? -1 : a.etapaId > b.etapaId ? 1 : 0));
const mesmoValor = (x: number, y: number, tol: number) => Math.abs(x - y) <= tol * Math.max(x, y, 1e-9);

/** Etapas de uma rota (com e SEM máquina), na ordem do roteiro. */
export function cadeiaDaRota(entrada: EntradaEscala, produtoId: string): PoolEscala[] {
  return ordena([...entrada.pools, ...(entrada.poolsSemMaquina ?? [])].filter((p) => p.produtoId === produtoId));
}

export function prepararProdutoUnico(entrada: EntradaEscala, dados: DadosProducaoReal, opcoes: OpcoesFluxo, u: ProdutoUnicoConfig): PreparoUnico | { motivo: string } {
  const diagnosticos: DiagnosticoItem[] = [];
  const comEMaquina = new Set(entrada.pools.map((p) => chavePool(p.produtoId, p.etapaId)));
  const n = u.trechoComum.length;
  if (n === 0) return { motivo: "produto único sem trecho comum configurado" };
  // 1) cadeias e suas etapas comuns (precisam ser o SUFIXO, na ordem)
  const cadeias = new Map<string, PoolEscala[]>();
  for (const r of u.rotas) {
    const c = cadeiaDaRota(entrada, r.produtoId);
    if (c.length === 0) continue; // rota fora da Previsão desta semana
    if (c.length < n) return { motivo: `rota ${r.rotulo}: cadeia menor que o trecho comum` };
    for (let i = 0; i < n; i++) {
      const esperado = u.trechoComum[i].etapaPorRota[r.produtoId];
      if (c[c.length - n + i].etapaId !== esperado) return { motivo: `rota ${r.rotulo}: etapa comum "${u.trechoComum[i].rotulo}" não é o ${i + 1}º trecho final esperado` };
    }
    cadeias.set(r.produtoId, c);
  }
  if (cadeias.size === 0) return { motivo: "nenhuma rota do produto único na Previsão" };
  // 2) principal = 1ª rota cujo trecho comum inteiro tem máquina selecionada
  const temTrecho = (pid: string) => (cadeias.get(pid) as PoolEscala[]).slice(-n).every((p) => comEMaquina.has(chavePool(p.produtoId, p.etapaId)));
  const principal = u.rotas.map((r) => r.produtoId).find((pid) => cadeias.has(pid) && temTrecho(pid));
  if (!principal) return { motivo: "nenhuma rota tem o trecho comum com máquina selecionada" };
  const cadP = cadeias.get(principal) as PoolEscala[];
  const preP = cadP.length - n;
  if (preP < 1) return { motivo: "a cadeia principal não tem etapa exclusiva antes do trecho comum" };
  const alimentadoras = [...cadeias.keys()].filter((pid) => pid !== principal && cadeias.get(pid)!.length - n >= 1);
  const lig = preP - 1;
  // 3) trecho comum: um recurso/estoque; máquinas = UNIÃO da seleção das rotas; metas devem coincidir (mesma máquina física)
  const tol = u.toleranciaMeta ?? 0.01;
  const trechoUnido: PoolEscala[] = [];
  for (let i = 0; i < n; i++) {
    const pp = cadP[preP + i];
    let maq = [...pp.maquinasIds];
    for (const pid of alimentadoras) {
      const po = cadeias.get(pid)![cadeias.get(pid)!.length - n + i];
      if (po.operacaoId !== pp.operacaoId) return { motivo: `etapa comum "${u.trechoComum[i].rotulo}": operações diferentes entre as rotas` };
      if (po.maquinasIds.length > 0) {
        for (const p of new Set([...Object.keys(pp.metas), ...Object.keys(po.metas)])) {
          if (!mesmoValor(pp.metas[p] ?? 0, po.metas[p] ?? 0, tol)) return { motivo: `etapa comum "${u.trechoComum[i].rotulo}": metas diferentes entre as rotas no período ${p} (${pp.metas[p] ?? 0} × ${po.metas[p] ?? 0}) — a Etiquetadora/Embalagem é um recurso único` };
        }
        maq = [...maq, ...po.maquinasIds];
      }
    }
    trechoUnido.push({ ...pp, maquinasIds: [...new Set(maq)].sort() });
  }

  // 4) normalização do estado real: etapas comuns de qualquer rota ⇒ as da principal
  const mapa = new Map<string, { produtoId: string; etapaId: string }>();
  for (const pid of alimentadoras) for (let i = 0; i < n; i++) mapa.set(chavePool(pid, cadeias.get(pid)![cadeias.get(pid)!.length - n + i].etapaId), { produtoId: principal, etapaId: cadP[preP + i].etapaId });
  // rotas fora da lista de alimentadoras mas presentes (sem etapa exclusiva) também apontam para a principal
  for (const [pid, c] of cadeias) if (pid !== principal) for (let i = 0; i < n; i++) mapa.set(chavePool(pid, c[c.length - n + i].etapaId), { produtoId: principal, etapaId: cadP[preP + i].etapaId });
  const rel = <T extends { produtoId: string | null; etapaId: string | null }>(a: T): T => {
    if (!a.produtoId || !a.etapaId) return a;
    const m = mapa.get(chavePool(a.produtoId, a.etapaId));
    return m ? { ...a, produtoId: m.produtoId, etapaId: m.etapaId } : a;
  };
  const relLinhas = (ls: AlocacaoEscala[]) => expandirPorProduto(ls).map((a) => rel(a));
  const relContagens = consolidarContagens(dados.contagensFisicas ?? [], cadeias, principal, cadP, preP, n, diagnosticos);
  const dadosN: DadosProducaoReal = { ...dados, apontamentos: dados.apontamentos.map((a) => rel(a)), planoVigente: relLinhas(dados.planoVigente), contagensFisicas: relContagens };
  const entradaN: EntradaEscala = { ...entrada, congeladas: relLinhas(entrada.congeladas), pools: [...entrada.pools, ...(entrada.poolsSemMaquina ?? [])] };
  const opcoesN: OpcoesFluxo = { ...opcoes };
  delete opcoesN.paresLegado; // o pooling é feito AQUI, por soma de estoques (o grafo fundido reparte o consumo por proporção fixa das quantidades — o que o pedido proíbe)
  const ctx = prepararFluxo(entradaN, dadosN, opcoesN);
  const estado = montarEstado(ctx);

  // 5) estoques iniciais agregados
  const W = (pid: string, etapaId: string) => Math.max(0, estado.projecao.wip[chavePool(pid, etapaId)]?.lo ?? 0);
  const deficit = (pid: string, etapaId: string) => Math.max(0, -(ctx.pares.find((x) => x.produtoId === pid && x.etapaOrigemId === etapaId)?.bruto.lo ?? 0));
  const wipP = cadP.slice(0, -1).map((p) => W(principal, p.etapaId));
  // entrada comum = Σ (última etapa exclusiva → 1ª comum) das rotas; consumo da Etiquetadora lançado só numa rota (déficit) é abatido do total, nunca duplicado nem perdido
  const entradas = [principal, ...alimentadoras].map((pid) => { const c = cadeias.get(pid) as PoolEscala[]; return c[c.length - n - 1]; });
  const somaEntrada = entradas.reduce((s, p) => s + W(p.produtoId, p.etapaId), 0);
  const defTotal = entradas.reduce((s, p) => s + deficit(p.produtoId, p.etapaId), 0);
  if (defTotal > 0) diagnosticos.push({ codigo: "WIP_ENTRADA_COMUM_DEFICIT_CREDITADO", severidade: "info", mensagem: `Consumo da etapa comum lançado numa só rota deixou o estoque dela negativo em ${Math.round(defTotal)}: abatido do estoque de entrada comum (Σ das rotas), sem duplicar`, detalhes: { deficit: Math.round(defTotal) } });
  wipP[lig] = Math.max(0, somaEntrada - defTotal);
  // ligações internas do trecho comum: soma das rotas (as lançadas fora da principal foram relabeladas, então só sobra resíduo)
  for (let i = 0; i + 1 < n; i++) for (const pid of alimentadoras) { const c = cadeias.get(pid) as PoolEscala[]; wipP[lig + 1 + i] += W(pid, c[c.length - n + i].etapaId); }
  // 6) demanda única e restante único
  let demandaTotal = 0, finalBoa = 0;
  for (const [pid, c] of cadeias) {
    const ult = c[c.length - 1];
    demandaTotal += Math.max(0, ult.quantidade);
    finalBoa += Math.max(0, estado.projecao.boas[chavePool(pid, ult.etapaId)]?.lo ?? 0);
  }
  const restante = Math.max(0, Math.round(demandaTotal - finalBoa));
  // 7) produtos do planejador
  const H = entrada.slots.length;
  const alts = (p: PoolEscala, maq: string[]) => maq.map((m) => ({ recursoId: m, pecasPorPosto: entrada.slots.map((s) => p.metas[s.periodoId] ?? 0) }));
  const etapaRev = (p: PoolEscala, maq: string[]) => ({ id: p.etapaId, rotulo: p.operacaoId, alternativas: alts(p, maq) });
  const produtos: ProdutoRev[] = [{
    id: principal, rotulo: principal, demandaFinal: restante, valorUnitario: cadP[0].valorUnitario, recorrentePorPeriodo: demandaTotal / Math.max(1, H), wipInicial: wipP.map((v) => Math.round(v)),
    etapas: [...cadP.slice(0, preP).map((p) => etapaRev(p, p.maquinasIds)), ...trechoUnido.map((p) => etapaRev(p, p.maquinasIds))],
  }];
  const rotaDisponivel: Record<string, boolean> = {};
  for (const [pid, c] of cadeias) rotaDisponivel[pid] = c.slice(0, c.length - n).every((p) => comEMaquina.has(chavePool(p.produtoId, p.etapaId)) && entrada.pools.find((q) => q.produtoId === p.produtoId && q.etapaId === p.etapaId)!.maquinasIds.length > 0);
  for (const pid of alimentadoras) {
    const c = cadeias.get(pid) as PoolEscala[];
    const exclusivas = c.slice(0, c.length - n);
    produtos.push({
      id: pid, rotulo: pid, demandaFinal: 0, valorUnitario: c[0].valorUnitario, recorrentePorPeriodo: 0,
      wipInicial: exclusivas.slice(0, -1).map((p) => Math.round(W(pid, p.etapaId))),
      etapas: exclusivas.map((p) => etapaRev(p, comEMaquina.has(chavePool(p.produtoId, p.etapaId)) ? p.maquinasIds : [])),
      alimenta: { produtoId: principal, ligacao: lig },
    });
  }
  for (const [pid, ok] of Object.entries(rotaDisponivel)) {
    if (!ok) diagnosticos.push({ codigo: "ROTA_INDISPONIVEL", severidade: "aviso", produtoId: pid, mensagem: `Rota ${u.rotas.find((r) => r.produtoId === pid)?.rotulo ?? pid}: etapa exclusiva sem máquina selecionada na Previsão — a rota não produz (só consome o estoque que já existe adiante); as máquinas da Previsão são absolutas` });
  }
  produtos.sort((a, b) => (a.id < b.id ? -1 : 1));
  diagnosticos.push({ codigo: "PRODUTO_UNICO_ATIVO", severidade: "info", mensagem: `${u.rotulo}: produto único com ${cadeias.size} rota(s); demanda total ${Math.round(demandaTotal)}, restante ${restante}; o mix entre rotas é escolhido pelo planejador (sem proporção fixa)`, detalhes: { demandaTotal: Math.round(demandaTotal), restante } });

  // 8) pools por chave (a checagem "máquina fora da Previsão" usa a UNIÃO no trecho comum)
  const poolPor = new Map(entradaN.pools.map((p) => [chavePool(p.produtoId, p.etapaId), p]));
  trechoUnido.forEach((p) => poolPor.set(chavePool(p.produtoId, p.etapaId), p));
  const info: InfoUnico = {
    config: u, principal, alimentadoras, ligacao: lig, etapasComuns: cadP.slice(preP).map((p) => p.etapaId), rotuloRota: Object.fromEntries(u.rotas.map((r) => [r.produtoId, r.rotulo])), rotaDisponivel,
    demandaTotal: Math.round(demandaTotal), restante, finalBoaAteAgora: Math.round(finalBoa),
  };
  return { ctx, estado, produtos, poolPor, info, diagnosticos, dadosNormalizados: dadosN };
}

/**
 * Contagens físicas das etapas COMUNS lançadas por produto legado (Conv/Auto) ⇒ UMA contagem do produto único por ligação comum.
 * Mesmo instante (±60 s): soma (são estoques físicos diferentes contados juntos). Instantes diferentes: vale só a mais recente (conservador; nunca soma estoques contados em momentos distintos).
 */
function consolidarContagens(lista: ContagemFisicaPar[], cadeias: Map<string, PoolEscala[]>, principal: string, cadP: PoolEscala[], preP: number, n: number, diag: DiagnosticoItem[]): ContagemFisicaPar[] {
  const destino = new Map<string, { origem: string; seguinte: string }>(); // chave "pid|etapaOrigem|etapaSeguinte" → par da principal
  for (const [pid, c] of cadeias) {
    for (let i = 0; i + 1 < n; i++) destino.set(`${pid}|${c[c.length - n + i].etapaId}|${c[c.length - n + i + 1].etapaId}`, { origem: cadP[preP + i].etapaId, seguinte: cadP[preP + i + 1].etapaId });
  }
  const passam: ContagemFisicaPar[] = [];
  const grupos = new Map<string, ContagemFisicaPar[]>();
  for (const c of lista) {
    const d = c && typeof c === "object" ? destino.get(`${c.produtoId}|${c.etapaOrigemId}|${c.etapaSeguinteId}`) : undefined;
    if (!d) { passam.push(c); continue; }
    const k = `${d.origem}|${d.seguinte}`;
    (grupos.get(k) ?? grupos.set(k, []).get(k)!).push(c);
  }
  for (const [k, cs] of [...grupos.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const [origem, seguinte] = k.split("|");
    const ultimaPorRota = new Map<string, ContagemFisicaPar>();
    cs.forEach((c) => { const a = ultimaPorRota.get(c.produtoId); if (!a || c.contadoEmMs >= a.contadoEmMs) ultimaPorRota.set(c.produtoId, c); });
    const uls = [...ultimaPorRota.values()].sort((a, b) => b.contadoEmMs - a.contadoEmMs);
    const recente = uls[0];
    const juntas = uls.filter((c) => recente.contadoEmMs - c.contadoEmMs <= 60_000);
    // histórico (contagens mais antigas da MESMA rota) segue como estava, só relabelado: o núcleo já escolhe a mais recente por par
    const antigas = cs.filter((c) => !juntas.includes(c));
    const base = { produtoId: principal, etapaOrigemId: origem, etapaSeguinteId: seguinte };
    if (juntas.length > 1) {
      diag.push({ codigo: "CONTAGEM_COMUM_CONSOLIDADA", severidade: "info", produtoId: principal, etapaId: origem, mensagem: `${juntas.length} contagens da etapa comum lançadas por rota consolidadas numa só (Σ ${juntas.reduce((s, c) => s + c.saldo, 0)})`, detalhes: { saldo: juntas.reduce((s, c) => s + c.saldo, 0) } });
      passam.push({ ...base, saldo: juntas.reduce((s, c) => s + c.saldo, 0), contadoEmMs: recente.contadoEmMs, informadoPor: recente.informadoPor, observacao: `consolidada de ${juntas.length} rotas` });
    } else passam.push({ ...recente, ...base });
    if (uls.length > juntas.length) diag.push({ codigo: "CONTAGEM_COMUM_CONSOLIDADA", severidade: "aviso", produtoId: principal, etapaId: origem, mensagem: "Contagens da etapa comum em instantes diferentes por rota: vale só a mais recente (não se somam estoques contados em momentos distintos)" });
    antigas.forEach((c) => passam.push({ ...c, ...base }));
  }
  return passam;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// SAÍDA em termos do produto único
// ---------------------------------------------------------------------------------------------------------------------------------
export interface ResumoUnico {
  produtoUnicoId: string;
  demandaTotal: number;
  restanteEntrada: number;
  /** peças finais (Embalagem 17) no horizonte planejado; o produto final é contado UMA vez, só na última etapa */
  finalPlanejado: number;
  corte: number;
  /** peças entregues ao estoque comum por cada rota (origem da peça: a máquina/operação da rota) */
  porRota: { produtoId: string; rotulo: string; entregue: number; pctDoTotal: number; disponivel: boolean }[];
  entregueTotal: number;
  /** peças por etapa do trecho comum (Etiquetar, Embalar), um único valor cada */
  trechoComum: { rotulo: string; etapaId: string; pecas: number }[];
  /** estoques unificados no início de cada período: [ligações exclusivas da principal…, ENTRADA COMUM (Σ rotas), ligações do trecho comum…] */
  wipUnificado: { rotulo: string; ligacao: number; inicio: number[] }[];
}

/** Resume a saída do planejador (cadeia principal + alimentadoras) como UM produto com rotas. */
export function resumirUnico(saida: { producao: Record<string, Record<string, number[]>>; wip: Record<string, number[][]> }, info: InfoUnico, produtos: ProdutoRev[]): ResumoUnico {
  const soma = (v: number[] | undefined) => (v ?? []).reduce((a, b) => a + b, 0);
  const prin = produtos.find((p) => p.id === info.principal) as ProdutoRev;
  const ultima = prin.etapas[prin.etapas.length - 1].id;
  const finalPlanejado = Math.round(soma(saida.producao[info.principal]?.[ultima]));
  const porRota = [info.principal, ...info.alimentadoras].map((pid) => {
    const p = produtos.find((x) => x.id === pid) as ProdutoRev;
    const ult = p.etapas[p.etapas.length - (pid === info.principal ? info.etapasComuns.length + 1 : 1)];
    return { produtoId: pid, rotulo: info.rotuloRota[pid] ?? pid, entregue: Math.round(soma(saida.producao[pid]?.[ult.id])), pctDoTotal: 0, disponivel: info.rotaDisponivel[pid] ?? false };
  });
  const entregueTotal = porRota.reduce((s, r) => s + r.entregue, 0);
  porRota.forEach((r) => (r.pctDoTotal = entregueTotal > 0 ? Math.round((1000 * r.entregue) / entregueTotal) / 10 : 0));
  const nome = (i: number) => info.config.trechoComum[i]?.rotulo ?? info.etapasComuns[i];
  const trechoComum = info.etapasComuns.map((id, i) => ({ rotulo: nome(i), etapaId: id, pecas: Math.round(soma(saida.producao[info.principal]?.[id])) }));
  const wipP = saida.wip[info.principal] ?? [];
  const wipUnificado = wipP.map((inicio, k) => ({
    rotulo: k === info.ligacao ? "entrada da etapa comum (Σ rotas)" : k > info.ligacao ? `${nome(k - info.ligacao - 1)} → ${nome(k - info.ligacao)}` : `${prin.etapas[k].rotulo} → ${prin.etapas[k + 1].rotulo}`,
    ligacao: k, inicio: inicio.map((v) => Math.round(v)),
  }));
  return { produtoUnicoId: info.config.id, demandaTotal: info.demandaTotal, restanteEntrada: info.restante, finalPlanejado, corte: Math.max(0, info.restante - finalPlanejado), porRota, entregueTotal, trechoComum, wipUnificado };
}

/** Rótulo da rota de uma linha pessoa→posto: "comum" (trecho comum: produto = o único), a rota (pelo produto/etapa legado) ou null (outros produtos). */
export function rotaDaLinha(info: InfoUnico, l: { produtoId: string | null; etapaId: string | null }): { rota: string | null; comum: boolean } {
  if (!l.produtoId || !l.etapaId) return { rota: null, comum: false };
  if (l.produtoId === info.principal && info.etapasComuns.includes(l.etapaId)) return { rota: null, comum: true };
  if (l.produtoId === info.principal || info.alimentadoras.includes(l.produtoId)) return { rota: info.rotuloRota[l.produtoId] ?? l.produtoId, comum: false };
  return { rota: null, comum: false };
}

/** Margem por peça no formato do planejador: principal = margem dela; alimentadora = DELTA de margem da rota sobre a principal (margem de rota); demais produtos inalterados. */
export function margemParaProdutoUnico(margem: Record<string, number> | undefined, info: InfoUnico): Record<string, number> | undefined {
  if (!margem) return margem;
  const base = margem[info.principal];
  const out = { ...margem };
  if (base !== undefined) info.alimentadoras.forEach((pid) => { out[pid] = (margem[pid] ?? base) - base; });
  return out;
}
