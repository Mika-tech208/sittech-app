// Modo --fechamento <M1|M2|T1...>: ANTES (plano gravado antes do fechamento) × REAL (apontamentos do período) × NOVO (plano vigente de períodos seguintes).
import { avaliarPlano, estadoDaProducao, verificarRestricoesDuras } from "@/features/escala/fluxo";
import { chavePool, type AlocacaoEscala, type SlotEscala } from "@/features/escala/types";
import type { DadosCarregados } from "./carga";
import type { Nomeador } from "./analise";
import { analisarPlano } from "./analise";
import { montarEstado } from "./estado";
import { faixa, n0, n1, tabela } from "./render";

interface Args { d: DadosCarregados; nm: Nomeador; agoraMs: number; fech: string; data: string; usarVersaoDepois: boolean; slots: SlotEscala[] }

const pecasDe = (a: AlocacaoEscala) => (a.pecas ?? 0) + (a.pecasAdicional ?? 0);
const pct = (v: number, base: number) => (base > 0 ? `${v >= 0 ? "+" : ""}${n1((v / base) * 100)}%` : "—");
const sg = (v: number) => `${v >= 0 ? "+" : ""}${n0(v)}`;

export function relatorioFechamento(a: Args): string {
  const { d, nm, slots } = a;
  const L: string[] = [];
  const periodoId = a.fech.toLowerCase();
  const sM = slots.find((s) => s.data === a.data && s.periodoId === periodoId);
  if (!sM) return `## E) Fechamento\nPeríodo ${a.fech} de ${a.data} não existe na semana.`;
  const M = sM.indice;
  const antes = d.versaoAntes;
  if (!antes) return `## E) Fechamento\nNenhuma versão de plano anterior a ${a.data} (--antes-ate) encontrada em escala_plano_versoes.`;
  const novo = a.usarVersaoDepois ? d.versaoDepois?.linhas ?? d.planoAtual : d.planoAtual;
  const idx = new Map(slots.map((s) => [`${s.data}|${s.periodoId}`, s.indice]));
  const slotDe = (x: { data: string; periodoId: string }) => idx.get(`${x.data}|${x.periodoId}`) ?? -1;
  const rotS = (t: number) => `${slots[t].data.slice(8)}/${slots[t].data.slice(5, 7)} ${slots[t].periodoId.toUpperCase()}`;
  const pool = (p: string | null, e: string | null) => (p && e ? `${nm.produto(p)} · ${nm.etapa(e)}` : "(sem posto)");
  const fechado = a.agoraMs >= sM.fimMs + 10 * 60_000;

  L.push(`## E) ANTES × REAL × NOVO — fechamento de ${rotS(M)} (${new Date(sM.inicioMs - 3 * 3600e3).toISOString().slice(11, 16)}–${new Date(sM.fimMs - 3 * 3600e3).toISOString().slice(11, 16)})`);
  L.push(`ANTES = versão de plano \`${antes.id.slice(0, 8)}\` (${antes.origem}, válida desde ${antes.valido}, ${antes.linhas.length} linhas); NOVO = ${a.usarVersaoDepois ? `versão \`${d.versaoDepois?.id.slice(0, 8)}\` (${d.versaoDepois?.valido})` : "escala_producao_alocacoes atual"}. ${fechado ? "" : "**ATENÇÃO: o período ainda não está fechado na hora informada (--agora): REAL e NOVO são parciais.**"}`);
  L.push("");

  // ---- (1) ANTES: plano de M ----
  const planM = antes.linhas.filter((x) => slotDe(x) === M && x.maquinaId);
  const apM = d.apontamentos.filter((x) => x.data === a.data && x.periodoId === periodoId);
  const porMaq = new Map(apM.map((x) => [x.maquinaId, x]));
  const poolsKeys = new Set<string>([...planM.map((x) => chavePool(x.produtoId as string, x.etapaId as string)), ...apM.filter((x) => x.status === "produzindo").map((x) => chavePool(x.produtoId, x.etapaId))]);
  type Ac = { plan: number; maqPlan: number; boas: number; refugo: number; prod: number; semProd: number; naoConf: number; meta: number; fora: number };
  const ac: Record<string, Ac> = {};
  const get = (k: string) => (ac[k] ??= { plan: 0, maqPlan: 0, boas: 0, refugo: 0, prod: 0, semProd: 0, naoConf: 0, meta: 0, fora: 0 });
  planM.forEach((x) => {
    const k = chavePool(x.produtoId as string, x.etapaId as string);
    const r = get(k);
    r.plan += pecasDe(x); r.maqPlan += 1;
    const ap = porMaq.get(x.maquinaId as string);
    if (!ap) r.naoConf += 1;
    else if (ap.status === "produzindo") { r.prod += 1; r.boas += ap.boas; r.refugo += ap.refugo; r.meta += ap.meta; } else r.semProd += 1;
  });
  const planejadas = new Set(planM.map((x) => x.maquinaId));
  apM.filter((x) => !planejadas.has(x.maquinaId) && x.status === "produzindo").forEach((x) => { const r = get(chavePool(x.produtoId, x.etapaId)); r.boas += x.boas; r.refugo += x.refugo; r.fora += 1; });
  const linhasPool = [...poolsKeys].sort().map((k) => {
    const r = get(k);
    const [p, e] = k.split("|");
    return { k, r, rot: pool(p, e) };
  });
  const totPlan = linhasPool.reduce((s, x) => s + x.r.plan, 0);
  const totBoas = linhasPool.reduce((s, x) => s + x.r.boas, 0);
  L.push(`### (1) ANTES e (2) REAL do período, por produto/etapa`);
  L.push(`Planejado = Σ peças (previsto+adicional) das linhas do plano ANTES; real = boas apontadas (quantidade produzida − refugo). "Não conf." = máquina planejada sem apontamento (não confirmado).`);
  L.push(tabela(["Produto · etapa", "Máq. plan.", "Produzindo", "Sem prod.", "Não conf.", "Fora do plano", "Plano (pç)", "Real boas (pç)", "Δ pç", "Δ %", "Refugo"],
    linhasPool.map(({ r, rot }) => [rot, String(r.maqPlan), String(r.prod), String(r.semProd), String(r.naoConf), String(r.fora), n0(r.plan), n0(r.boas), sg(r.boas - r.plan), pct(r.boas - r.plan, r.plan), n0(r.refugo)])
      .concat([["**Total**", "", "", "", "", "", n0(totPlan), n0(totBoas), sg(totBoas - totPlan), pct(totBoas - totPlan, totPlan), n0(linhasPool.reduce((s, x) => s + x.r.refugo, 0))]])));
  L.push("");
  L.push("Por máquina planejada (desvios primeiro):");
  const maqLin = planM.map((x) => {
    const ap = porMaq.get(x.maquinaId as string);
    const real = ap && ap.status === "produzindo" ? ap.boas : 0;
    return { x, ap, dev: real - pecasDe(x), real };
  }).sort((p, q) => p.dev - q.dev);
  L.push(tabela(["Máquina", "Produto · etapa", "Plano", "Status real", "Real boas", "Δ", "Motivo/obs"],
    maqLin.map(({ x, ap, real, dev }) => [nm.maquina(x.maquinaId as string), pool(x.produtoId, x.etapaId), n0(pecasDe(x)), !ap ? "não confirmado" : ap.status === "produzindo" ? "produzindo" : "sem produção", ap ? n0(real) : "—", ap ? sg(dev) : "—", ap?.motivo ?? ""])));
  L.push("");

  // ---- (3) NOVO PLANO: diff por pessoa-período ----
  const chaveL = (x: AlocacaoEscala) => `${x.data}|${x.periodoId}|${x.funcionarioId}`;
  const post = (x?: AlocacaoEscala) => (x && x.maquinaId ? `${x.maquinaId}|${x.produtoId}|${x.etapaId}` : "");
  const mapA = new Map(antes.linhas.filter((x) => slotDe(x) > M).map((x) => [chaveL(x), x]));
  const mapN = new Map(novo.filter((x) => slotDe(x) > M).map((x) => [chaveL(x), x]));
  type Troca = { de: string; para: string; n: number; slots: Set<number>; pessoas: Set<string> };
  const trocas = new Map<string, Troca>();
  let alteradas = 0, soPecas = 0, trocasPosto = 0;
  const postosAlt = new Set<string>();
  let altPrimeiro = 0;
  const primeiroSlot = M + 1;
  new Set([...mapA.keys(), ...mapN.keys()]).forEach((k) => {
    const x = mapA.get(k), y = mapN.get(k);
    if (post(x) === post(y)) { if (x && y && Math.abs(pecasDe(x) - pecasDe(y)) > 0.5 && post(x)) soPecas += 1; return; }
    alteradas += 1;
    const ref = (x ?? y) as AlocacaoEscala;
    const t = slotDe(ref);
    if (t === primeiroSlot) altPrimeiro += 1;
    if (x?.maquinaId && y?.maquinaId) trocasPosto += 1;
    [x, y].forEach((z) => z?.maquinaId && postosAlt.add(`${t}|${z.maquinaId}`));
    const de = x ? pool(x.produtoId, x.etapaId) + (x.maquinaId ? ` @${nm.maquina(x.maquinaId)}` : "") : "(sem linha)";
    const para = y ? pool(y.produtoId, y.etapaId) + (y.maquinaId ? ` @${nm.maquina(y.maquinaId)}` : "") : "(sem linha)";
    const kk = `${de}→${para}`;
    const tr = trocas.get(kk) ?? { de, para, n: 0, slots: new Set<number>(), pessoas: new Set<string>() };
    tr.n += 1; tr.slots.add(t); tr.pessoas.add(ref.funcionarioId);
    trocas.set(kk, tr);
  });
  L.push(`### (3) NOVO PLANO (${rotS(Math.min(slots.length - 1, M + 1))} em diante) × plano ANTES`);
  L.push(`Churn: **${alteradas} pessoa-período(s) com posto alterado** (${trocasPosto} trocas máquina→máquina; ${altPrimeiro} no primeiro período aberto ${rotS(Math.min(slots.length - 1, primeiroSlot))}; ${postosAlt.size} postos (slot,máquina) distintos), mais ${soPecas} linha(s) só com peças diferentes (mesmo posto).`);
  const lista = [...trocas.values()].sort((p, q) => q.n - p.n);
  L.push(lista.length ? tabela(["De", "Para", "Pessoa-períodos", "Períodos", "Pessoas"], lista.slice(0, 40).map((t) => [t.de, t.para, String(t.n), [...t.slots].sort((x, y) => x - y).map(rotS).join(", ").slice(0, 120), String(t.pessoas.size)])) : "_Nenhuma pessoa-período alterada._");
  if (lista.length > 40) L.push(`… +${lista.length - 40} grupos de troca.`);
  L.push("");
  // motivo/ganho: último diagnóstico de fluxo APLICADO com corte >= M
  const diag = d.fluxo.find((f) => f.aplicado && f.resultado === "ok" && (f.corte_c ?? -1) >= M && (!a.usarVersaoDepois || Number(f.criado_ms) <= (d.versaoDepois?.validoMs ?? Infinity) + 60_000));
  if (diag) {
    const dec: any[] = diag.diff?.decisoes ?? [];
    L.push(`Motivo/ganho (escala_fluxo_diagnosticos \`${String(diag.id).slice(0, 8)}\`, ${diag.criado}, gatilho ${diag.gatilho}, corte c=${diag.corte_c}, plano escolhido ${diag.plano_escolhido}; ${diag.diff?.totalDecisoes ?? dec.length} decisão(ões), ganho total reconciliado ${n0(diag.diff?.reconciliacao?.diferenca ?? 0)} pç finais):`);
    L.push(dec.length ? tabela(["Período", "De", "Para", "Qtd", "Ganho final (pç)", "WIP consumido", "Motivo"],
      dec.slice(0, 40).map((x) => [`${x.data.slice(8)}/${x.data.slice(5, 7)} ${String(x.periodoId).toUpperCase()}`, pool(x.de.produtoId, x.de.etapaId) + (x.de.maquinaId ? ` @${nm.maquina(x.de.maquinaId)}` : ""), pool(x.para.produtoId, x.para.etapaId) + (x.para.maquinaId ? ` @${nm.maquina(x.para.maquinaId)}` : ""), String(x.quantidade), n0(x.motivo.ganhoProdutoFinal), n0(x.motivo.wipConsumido), String(x.motivo.texto).slice(0, 160)])) : "_Sem decisões listadas._");
  } else L.push("_Nenhum escala_fluxo_diagnosticos aplicado com corte neste período ou depois (o motor ainda não replanejou após o fechamento)._");
  L.push("");

  // ---- (4) demanda, WIP, gargalos, violações ----
  const iniA = sM.inicioMs + 60_000;
  const agoraB = Math.max(a.agoraMs, fechado ? a.agoraMs : sM.fimMs + 10 * 60_000);
  const eA = montarEstado(d, iniA, antes.linhas);
  const eB = montarEstado(d, agoraB, novo);
  const estA = estadoDaProducao(eA.entrada, eA.dados, eA.opcoes);
  const estB = estadoDaProducao(eB.entrada, eB.dados, eB.opcoes);
  const prodsA = new Map(estA.produtos.map((p) => [p.produtoId, p]));
  L.push(`### (4) Demanda final restante, WIP, gargalos, violações`);
  L.push(`Estado ANTES = apontamentos visíveis até o início do período (último fechado ${rotS(eA.ufech)}); estado DEPOIS = agora=${new Date(agoraB - 3 * 3600e3).toISOString().slice(0, 16).replace("T", " ")} (último fechado ${eB.ufech >= 0 ? rotS(eB.ufech) : "—"}).`);
  L.push(tabela(["Produto", "Q previsto", "Boas finais antes", "Boas finais depois", "Demanda restante antes", "Demanda restante depois", "Δ"],
    estB.produtos.map((p) => { const q = prodsA.get(p.produtoId); return [nm.produto(p.produtoId), n0(p.quantidadeFinal), q ? faixa(q.boasFinais.lo, q.boasFinais.hi) : "—", faixa(p.boasFinais.lo, p.boasFinais.hi), q ? n0(q.demandaFinalRestante) : "—", n0(p.demandaFinalRestante), q ? sg(p.demandaFinalRestante - q.demandaFinalRestante) : "—"]; })));
  L.push("");
  const optA = { ...eA.opcoes, incluirTrajetoria: false };
  const optB = { ...eB.opcoes, incluirTrajetoria: false };
  const avAntesNoA = avaliarPlano(eA.entrada, eA.dados, antes.linhas, optA);
  const avAntesNoB = avaliarPlano(eB.entrada, eB.dados, antes.linhas, optB);
  const avNovoNoB = avaliarPlano(eB.entrada, eB.dados, novo, optB);
  const t = (x: typeof avNovoNoB) => [n0(x.totais.faltaFinalLo), n0(x.totais.finalEntregueLo), n0(x.totais.wipFinalHi), n0(x.totais.excessoWip)];
  L.push("Falta final prevista até sexta (cenário pessimista) por plano e estado:");
  L.push(tabela(["Plano × estado", "Falta final", "Final entregue", "WIP final (hi)", "Excesso WIP"], [
    ["ANTES (plano antigo no estado de antes)", ...t(avAntesNoA)],
    ["Plano antigo no estado de DEPOIS (sem corrigir)", ...t(avAntesNoB)],
    ["**NOVO plano no estado de DEPOIS**", ...t(avNovoNoB)],
  ]));
  const ganho = avAntesNoB.totais.faltaFinalLo - avNovoNoB.totais.faltaFinalLo;
  L.push(`\nO replanejamento ${ganho >= 0 ? "reduziu" : "AUMENTOU"} a falta final prevista em **${n0(Math.abs(ganho))} pç** em relação a manter o plano antigo sabendo do real (${n0(avAntesNoB.totais.faltaFinalLo)} → ${n0(avNovoNoB.totais.faltaFinalLo)}). Variação do estado por causa do real do período (plano antigo): ${sg(avAntesNoB.totais.faltaFinalLo - avAntesNoA.totais.faltaFinalLo)} pç de falta.`);
  L.push("");
  const garg = (x: typeof avNovoNoB) => [...new Map(x.produtos.map((p) => [p.gargaloFluxo ? `${p.gargaloFluxo.produtoId}|${p.gargaloFluxo.etapaId}` : "", p.gargaloFluxo])).values()].filter(Boolean).map((g) => `${nm.produto(g!.produtoId)} · ${nm.etapa(g!.etapaId)} (folga ${sg(g!.folga)})`);
  L.push(`Gargalos de fluxo — antes: ${garg(avAntesNoA).join("; ") || "—"}\n\nGargalos de fluxo — depois (novo plano): ${garg(avNovoNoB).join("; ") || "—"}`);
  L.push("");
  const pA = analisarPlano(eA, antes.linhas, nm);
  const pB = analisarPlano(eB, novo, nm);
  const bA = new Map(pA.map((p) => [p.id, p]));
  L.push("WIP por par — antes × depois (início do primeiro período aberto; pico até sexta sob cada plano):");
  L.push(tabela(["Par", "WIP início antes", "WIP início depois", "Pico sexta antes", "Pico sexta depois", "Δ pico"], pB.filter((p) => p.picoSemana.hi > 1 || (bA.get(p.id)?.picoSemana.hi ?? 0) > 1).map((p) => {
    const q = bA.get(p.id);
    return [p.rotulo, q ? faixa(q.w0.lo, q.w0.hi) : "—", faixa(p.w0.lo, p.w0.hi), q ? n0(q.picoSemana.hi) : "—", n0(p.picoSemana.hi), q ? sg(p.picoSemana.hi - q.picoSemana.hi) : "—"];
  })));
  L.push("");
  const futuras = novo.filter((x) => slotDe(x) >= eB.aPartirDe);
  const viol = verificarRestricoesDuras(eB.entrada, futuras);
  const porTipo: Record<string, number> = {};
  viol.forEach((v) => (porTipo[v.tipo] = (porTipo[v.tipo] ?? 0) + 1));
  L.push(`Violações de restrição dura no NOVO plano (de ${rotS(eB.aPartirDe)} em diante): **${viol.length}**${viol.length ? " — " + Object.entries(porTipo).map(([k, v]) => `${k}: ${v}`).join(", ") : ""}.`);
  L.push("");
  L.push(`### Leitura (o motor está se corrigindo?)`);
  const dev = totBoas - totPlan;
  L.push(`- Produção do período: ${n0(totBoas)} pç boas contra ${n0(totPlan)} planejadas (${sg(dev)}, ${pct(dev, totPlan)}); ${linhasPool.reduce((s, x) => s + x.r.naoConf, 0)} máquina(s) sem apontamento, ${linhasPool.reduce((s, x) => s + x.r.semProd, 0)} sem produção declarada.`);
  L.push(`- ${alteradas} pessoa-períodos alterados no novo plano; falta final ${ganho >= 0 ? "menor" : "MAIOR"} em ${n0(Math.abs(ganho))} pç que manter o plano antigo.`);
  return L.join("\n");
}
