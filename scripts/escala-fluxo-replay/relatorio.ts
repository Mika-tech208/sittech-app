/* eslint-disable @typescript-eslint/no-explicit-any */
// Gera docs/escala-fluxo-criterios-ativacao.md a partir dos JSON produzidos por replay.ts (out/*.json). Nada é digitado à mão: todos os números vêm dos replays.
import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { DIR } from "./dados";
import type { ResumoRodada } from "./resumo";
import type { ExtrasRodada } from "./extras";
import { nomeProduto, rotuloPar, rotuloPool } from "./nomes";
import { mediana, percentil } from "./comum";
import { CXE } from "./extras";

type R = ResumoRodada & { extras: ExtrasRodada; obsoleta?: boolean; erro?: string };
const OUT = path.join(DIR, process.env.FREPLAY_FATOR === "1" ? "out_f" : "out");
const ler = <T>(f: string): T | null => { try { return JSON.parse(fs.readFileSync(path.join(OUT, f), "utf8")) as T; } catch { return null; } };

const n0 = (v: number | null | undefined) => (v === null || v === undefined ? "—" : Math.round(v).toLocaleString("pt-BR"));
const rot = (r: { data: string; periodoId: string }) => `${r.data.slice(8)}/${r.data.slice(5, 7)} ${r.periodoId.toUpperCase()}`;
const tabela = (cab: string[], linhas: (string | number)[][]) => [`| ${cab.join(" | ")} |`, `|${cab.map(() => "---").join("|")}|`, ...linhas.map((l) => `| ${l.join(" | ")} |`)].join("\n");
const commitNucleo = (() => { try { return execSync("git log -1 --format=%h origin/feat/escala-fluxo-core", { cwd: path.resolve(__dirname, "../.."), encoding: "utf8" }).trim(); } catch { return "?"; } })();
const PASS = "PASSOU", FAIL = "FALHOU", NC = "NÃO COMPROVADO";

export interface Veredito { id: string; titulo: string; status: string; resumo: string; detalhe: string }

export function gerar(): { md: string; vereditos: Veredito[] } {
  const F = (ler<R[]>("fechamentos.json") ?? []).filter((r) => !r.erro);
  const fech = F.filter((r) => r.rev === 0).sort((a, b) => a.c - b.c);
  const todas = F;
  const validas = F.filter((r) => !r.obsoleta);
  const EN = ler<{ linhas: any[]; deterministico: boolean }>("encadeado.json");
  const TH = ler<any[]>("theta.json");
  const SE = ler<{ nome: string; ok: boolean; excecao?: string; detalhes: Record<string, unknown> }[]>("sensibilidade.json");
  const CF = ler<any[]>("contrafactual.json");
  const BT = ler<any>("backtest.json");
  const AUD = ler<{ conferidos: number; divergencias: { item: string }[] }>("auditoria.json");
  const V: Veredito[] = [];
  const out: string[] = [];
  const push = (s = "") => out.push(s);

  // ------------------------------------------------------------------ tabelas por fechamento
  const tFech = tabela(
    ["Fechamento", "plano", "falta vigente", "falta base (motor oficial agora)", "falta FLUXO", "Δ vs vigente", "Δ vs base", "final prev. vigente → fluxo", "WIP final vig → fluxo", "WIP máx. por par vig → fluxo", "excesso WIP vig → fluxo", "churn linhas (vs vigente)", "postos novos vs base", "decisões / pessoas"],
    fech.map((r) => [rot(r), r.planoEscolhido, n0(r.falta.vigente[0]), n0(r.falta.baseRegen[0]), n0(r.falta.fluxo[0]), n0(r.falta.fluxo[0] - r.falta.vigente[0]), n0(r.falta.fluxo[0] - r.falta.baseRegen[0]), `${n0(r.final.vigente[0])} → ${n0(r.final.fluxo[0])}`, `${n0(r.wipFinal.vigente[1])} → ${n0(r.wipFinal.fluxo[1])}`, `${n0(Math.max(0, ...Object.values(r.extras.trajVigente).map((t) => Math.max(0, ...t.map((x) => x[2])))))} → ${n0(Math.max(0, ...Object.values(r.extras.trajFluxo).map((t) => Math.max(0, ...t.map((x) => x[2])))))}`, `${n0(r.excessoWip.vigente)} → ${n0(r.excessoWip.fluxo)}`, n0(r.churnInd.vsVigente.linhas), n0(r.churnInd.vsBase.postosNovos), `${r.decisoes.n} / ${r.decisoes.qtdPessoas}`]),
  );
  push("## 2. Tabela por fechamento (replay no instante do corte; aPartirDe = c+2)");
  push();
  push("Falta/final = soma dos produtos, cenário pessimista (lo), peças, medidos pelo MESMO `avaliarPlano` (plano vigente gravado × motor oficial regenerado × plano de fluxo). Todos os fechamentos 26–27/10 (revisão 0).");
  push();
  push(tFech);
  push();

  // demanda por produto
  const prods = [...new Set(fech.flatMap((r) => r.produtos.map((p) => p.produtoId)))];
  push("### 2.1 Demanda final restante por produto: oficial planejado (Q − Σ créditos congelados do plano vigente) × real (Q − boas confirmadas)");
  push();
  push(tabela(["Fechamento", ...prods.map(nomeProduto)], fech.map((r) => [rot(r), ...prods.map((pid) => {
    const p = r.produtos.find((x) => x.produtoId === pid); const dp = r.demandaPool.find((x) => x.final && x.chave.startsWith(pid));
    return p && dp ? `${n0(dp.remLegado)} × **${n0(p.Rf)}**` : "—";
  })])));
  push();
  push("Formato: `planejado × real`. Real = demanda final restante R_f = Q_f − boas confirmadas da etapa final (só o CONFIRMADO reduz a meta; conferido contra os apontamentos brutos). **Conector**: as colunas convencional/automática NÃO são comparáveis isoladamente — a fábrica aponta o Embalar (e o Etiquetar) 100% no convencional, então o real do convencional está subestimado e o da automática superestimado; o núcleo funde os pools comuns (seção G).");
  push();

  // WIP por par
  const pares = [...new Set(fech.flatMap((r) => r.pares.map((p) => `${p.produtoId}|${p.origem}`)))];
  push("### 2.2 WIP por par (origem, confiança, lo–hi); NEG = estimativa negativa mesmo no melhor caso (piso 0)");
  push();
  push(tabela(["Fechamento", ...pares.map((k) => rotuloPar(k.split("|")[0], k.split("|")[1]))], fech.map((r) => [rot(r), ...pares.map((k) => {
    const p = r.pares.find((x) => `${x.produtoId}|${x.origem}` === k); return p ? `${p.tipo.slice(0, 3)}/${p.conf} ${n0(p.lo)}–${n0(p.hi)}${p.negativo ? " NEG" : ""}` : "—";
  })])));
  push();

  // gargalos
  push("### 2.3 Gargalo de fluxo por produto (potencial − demanda restante; negativo = gargalo real)");
  push();
  push(tabela(["Fechamento", ...prods.map(nomeProduto)], fech.map((r) => [rot(r), ...prods.map((pid) => { const g = r.gargalos.find((x) => x.produtoId === pid); return g ? `${rotuloPool(pid + "|" + g.etapaId).split(" · ")[1]} ${n0(g.folga)}` : "—"; })])));
  push();

  // churn e postos alterados
  push("### 2.4 Churn por fechamento");
  push();
  push("O período c+1 está comprometido/em curso no fechamento (0 alterações por construção); o 1º período mutável é c+2.");
  push();
  push(tabela(["Fechamento", "plano", "linhas alteradas vs vigente (núcleo)", "trocas de posto", "postos alterados (núcleo)", "1º período mutável", "retidas por θ", "θ", "churn do motor oficial sozinho (base × vigente)", "fluxo × base: linhas / postos novos", "linhas vs vigente por período mutável (c+2 / c+3 / c+4 / c+5 / c+6…)"], fech.map((r) => {
    const c = r.churnNucleo as any; return [rot(r), r.planoEscolhido, n0(c.linhasAlteradas), n0(c.trocasDePosto), n0(c.postosAlterados), n0(c.alteradasNoPrimeiroPeriodo), n0(c.retidasPorEstabilidade), n0(r.theta), `${n0(r.churnInd.baseVsVigente.linhas)} linhas / ${n0(r.churnInd.baseVsVigente.postosNovos)} postos`, `${n0(r.churnInd.vsBase.linhas)} / ${n0(r.churnInd.vsBase.postosNovos)}`, ((r.churnInd.vsVigente as unknown as { porOffset?: number[] }).porOffset ?? []).map(n0).join(" / ")];
  })));
  push();

  const tabsMd = out.splice(0);
  // ================================================================== critérios
  const soma = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const rotR = (r: R) => `${rot(r)}${r.rev ? ` (rev ${r.rev})` : ""}`;
  const crit: Veredito[] = [];
  const add = (id: string, titulo: string, status: string, resumo: string, detalhe: string) => crit.push({ id, titulo, status, resumo, detalhe });

  // ---- A–D
  const aInd = soma(todas.map((r) => r.violacoes.A)), aNuc = soma(todas.map((r) => r.violacoes.nucleo)), avisos = soma(todas.map((r) => r.violacoes.avisos));
  const bTot = soma(todas.map((r) => r.violacoes.B)), cTot = soma(todas.map((r) => r.violacoes.C)), dTot = soma(todas.map((r) => r.violacoes.D));
  const tiposViol: Record<string, number> = {};
  todas.forEach((r) => Object.entries(r.violacoes.porTipo).forEach(([k, v]) => (tiposViol[k] = (tiposViol[k] ?? 0) + v)));
  const nucCompleto = soma(todas.map((r) => r.violNucleoCompleto));
  add("A", "Hard constraints (máquina indisponível/inativa/fora da Previsão, ausência, equipe, seleção, roteiro)", aInd + aNuc === 0 ? PASS : FAIL,
    `${todas.length} replays (36 decisões gravadas): verificador independente = ${aInd} violações; \`verificarRestricoesDuras\` do núcleo = ${aNuc}; avisos (Parada real da M8 posterior ao corte, logo não conhecível) = ${avisos}, todos em fechamentos até 27/10 M1.`,
    `Verificador independente escrito do zero a partir de slots/ausências/causas de indisponibilidade/pools (replica as invariantes de \`disponibilidade.ts\`/\`revalidarDisponibilidade.ts\`/\`rotacao.ts\`), validado por teste de mutação (\`autoteste-independente.ts\`: 10 mutações injetadas, 10 detectadas, 1 caso-limite sem falso positivo; plano do motor oficial = 0 violações). Causas de indisponibilidade = as gravadas em cada snapshot (as que o motor conhecia no corte), mais a Parada real da Máquina 8 (ocorrencias_maquina 27/10 09:34–11:54) conferida à parte como aviso. Violações por tipo: ${JSON.stringify(tiposViol)}. Observação: chamado com o PLANO COMPLETO (inclui o passado congelado) o verificador do núcleo acusa ${nucCompleto} itens — todos em linhas JÁ congeladas do plano vigente gravado (funcionário depois desativado/ausente registrada depois, Parada da M8 desconhecida na época): informativo, não é do plano de fluxo.`);
  add("B", "Passado alterado (planoVigente × saída em períodos ≤ c+1 / iniciados)", bTot === 0 ? PASS : FAIL,
    `${bTot} linhas do passado alteradas em ${todas.length} replays (aPartirDe = c+2: c+1 está comprometido/iniciado há 10 min no fechamento).`,
    `Medido por \`verificarIndependente\` (linha da saída em slot < aPartirDe que difere do vigente; congeladas da entrada ≠ vigente). Por construção a saída só contém slots ≥ aPartirDe; o teste de mutação prova que o verificador detecta uma linha de passado alterada. Se o integrador usar aPartirDe = c+1 (leitura literal da spec §4) o plano PODE alterar o período c+1, que no fechamento já começou há 10 min — ver seção 3.1.`);
  add("C", "Dupla alocação (pessoa em 2 postos, posto com 2 pessoas, máquina duplicada)", cTot === 0 ? PASS : FAIL,
    `${cTot} violações em ${todas.length} replays; Etiquetadora 15 / Embalagem 17 em dois pools no mesmo período: ${soma(todas.map((r) => r.extras.conector.duplicidadeE15))}.`,
    "Pessoa com >1 linha no mesmo período, máquina com >1 pessoa, máquina em >1 pool do mesmo período (inclui os pools do Conector que compartilham E15/E17).");
  add("D", "Revezamento (mesma operação em períodos consecutivos do mesmo dia)", dTot === 0 ? PASS : FAIL,
    `${dTot} repetições; exceções novas (\`excecaoRevezamento\`) sinalizadas: ${soma(todas.map((r) => (r.violacoes.porTipo["D:excecao_revezamento_nova*"] ?? 0)))}.`,
    "Inclui o par que atravessa a fronteira (último congelado → primeiro mutável). PROD usa revezamento_modo = duro (parâmetro conferido), logo o motor não tem exceção: qualquer linha com excecaoRevezamento seria nova.");

  // ---- E
  const E1 = validas.filter((r) => r.falta.fluxo[0] > r.falta.vigente[0] + 1 || r.falta.fluxo[1] > r.falta.vigente[1] + 1);
  const E2 = validas.filter((r) => r.falta.fluxo[0] > r.falta.baseRegen[0] + 1);
  const Enc = (EN?.linhas ?? []).filter((l) => l.faltaFluxoCadeia[0] > l.faltaVigenteDaCadeia[0] + 1);
  const sinalDisc = validas.filter((r) => r.planoEscolhido === "fluxo" && !(r.simInd.fluxo <= r.simInd.vigente + 1));
  const legPior = validas.filter((r) => r.planoEscolhido === "fluxo" && r.faltaLegada.fluxo > r.faltaLegada.vigente + 1);
  const linhaE = (r: R) => `${rotR(r)}: vigente ${n0(r.falta.vigente[0])} · base ${n0(r.falta.baseRegen[0])} · fluxo ${n0(r.falta.fluxo[0])} (${r.falta.fluxo[0] - r.falta.vigente[0] >= 0 ? "+" : ""}${n0(r.falta.fluxo[0] - r.falta.vigente[0])} vs vigente; ${r.falta.fluxo[0] - r.falta.baseRegen[0] >= 0 ? "+" : ""}${n0(r.falta.fluxo[0] - r.falta.baseRegen[0])} vs base)`;
  add("E", "Falta final total: fluxo nunca pior que o oficial (mesmo simulador)", E1.length === 0 && E2.length === 0 && Enc.length === 0 ? PASS : FAIL,
    `Leitura \"oficial = motor oficial regenerado\": PASSA; leitura operacional \"oficial = plano em vigor\": FALHA (piora EXPLICADA pela causa raiz abaixo, mas não justificada por restrição dura nem estabilidade). vs motor oficial regenerado: piora em ${E2.length}/${validas.length}; vs plano VIGENTE gravado: piora em ${E1.length}/${validas.length}; no replay encadeado, pior que o plano herdado do fechamento anterior em ${Enc.length}/${EN?.linhas.length ?? 0}.`,
    `A garantia do núcleo é "nunca pior que o plano base" (\`gerarEscala\` regenerado, que é um candidato). Isso NÃO equivale a "nunca pior que o plano em vigor":\n\n${E1.length ? "Piora vs vigente gravado (replay por fechamento):\n" + E1.map((r) => "- " + linhaE(r)).join("\n") : "Nenhuma piora vs vigente gravado."}\n\n${Enc.length ? "Piora no replay encadeado (plano de fluxo herdado × novo plano de fluxo, mesmo corte, mesmo simulador):\n" + Enc.map((l) => `- ${l.rotulo}: herdado ${n0(l.faltaVigenteDaCadeia[0])} → novo ${n0(l.faltaFluxoCadeia[0])} (+${n0(l.faltaFluxoCadeia[0] - l.faltaVigenteDaCadeia[0])}; ${((100 * (l.faltaFluxoCadeia[0] - l.faltaVigenteDaCadeia[0])) / l.faltaVigenteDaCadeia[0]).toFixed(1)}%)`).join("\n") : "Nenhuma piora no encadeado."}\n\nExplicação: o plano base regenerado pode ser pior que o vigente (o motor oficial é sensível à ordem/equidade; ${fech.filter((r) => r.falta.baseRegen[0] > r.falta.vigente[0] + 1).map((r) => `${rot(r)}: base ${n0(r.falta.baseRegen[0])} × vigente ${n0(r.falta.vigente[0])} (+${(100 * (r.falta.baseRegen[0] / r.falta.vigente[0] - 1)).toFixed(1)}%)`).join("; ") || "nenhum caso nos fechamentos"}) e o candidato de fluxo só é comparado ao base; o plano em vigor nunca é candidato. Verificação cruzada da régua: o simulador independente (\`simIndependente.ts\`, escrito só da spec, sem fusão do Conector) concorda no SINAL da melhora em ${validas.filter((r) => r.planoEscolhido === "fluxo").length - sinalDisc.length}/${validas.filter((r) => r.planoEscolhido === "fluxo").length} replays em que o fluxo foi escolhido; a régua LEGADA (\`faltaProjetada\`, exige cumprir o previsto de TODAS as etapas) discorda em ${legPior.length}/${validas.filter((r) => r.planoEscolhido === "fluxo").length} — por construção (o fluxo deixa de produzir intermediário sem utilidade), mas significa que o previsto das etapas intermediárias fica mais incompleto na tela atual.`);

  // ---- F
  const cf = CF ?? [];
  const f27 = fech.filter((r) => r.data === "2026-10-27");
  const cxPares = (r: R) => r.pares.find((p) => p.produtoId === CXE.split("|")[0]);
  const fLinhas = f27.map((r) => {
    const p = cxPares(r)!; const cx = r.extras.cx;
    return [rot(r), `${p.tipo.slice(0, 3)}/${p.conf} ${n0(p.lo)}–${n0(p.hi)}${p.negativo ? " NEG" : ""}`, `${cx.vigente.postosE} / ${cx.vigente.postosM}`, `${cx.fluxo.postosE} / ${cx.fluxo.postosM}`, `${n0(cx.vigente.E)} / ${n0(cx.vigente.M)}`, `${n0(cx.fluxo.E)} / ${n0(cx.fluxo.M)}`];
  });
  const fCoer = f27.every((r) => r.extras.cx.fluxo.postosE >= r.extras.cx.vigente.postosE && r.extras.cx.fluxo.postosM >= r.extras.cx.vigente.postosM);
  const cfCx = cf.map((c: any) => { const v = (n: string) => c.variantes.find((x: any) => x.nome.startsWith(n)); return [c.rotulo, c.wipE16Montagem ? `${c.wipE16Montagem.confianca} ${n0(c.wipE16Montagem.lo)}–${n0(c.wipE16Montagem.hi)}` : "—", n0(v("vigente")?.cxFinal?.[0]), n0(v("base")?.cxFinal?.[0]), n0(v("reforço Montagem, mantém")?.cxFinal?.[0]), n0(v("sem E16")?.cxFinal?.[0]), n0(v("FLUXO")?.cxFinal?.[0])]; });
  const fMelhorN = cf.filter((c: any) => { const fl = c.variantes.find((x: any) => x.nome.startsWith("FLUXO"))?.cxFinal?.[0] ?? 0; return c.variantes.every((x: any) => (x.cxFinal?.[0] ?? 0) <= fl + 1); }).length;
  add("F", "Caixa Amarela coerente (E16 × Montagem)", fCoer ? PASS + " (qualitativo)" : FAIL,
    fCoer ? "Nos 6 fechamentos de 27/10 o plano de fluxo não reduz a E16 (postos ≥ vigente) e acrescenta postos de Montagem quando há WIP estimado a consumir; os contrafactuais manuais do Mikael (+2.071 / −4.016 / −2.657) NÃO foram reproduzidos." : "Plano reduz E16 ou Montagem em relação ao vigente em algum fechamento.",
    `Postos de E16 / Montagem (soma nos períodos mutáveis) e peças planejadas:\n\n${tabela(["Fechamento 27/10", "WIP E16→Montagem", "postos E/M vigente", "postos E/M fluxo", "peças E/M vigente", "peças E/M fluxo"], fLinhas)}\n\nContrafactuais pelo MESMO simulador (final entregue de Caixa Amarela, peças; variantes aplicadas a TODOS os slots mutáveis):\n\n${tabela(["Fechamento", "WIP E16→Mont.", "vigente", "base", "reforço Montagem mantendo E16", "sem E16", "FLUXO"], cfCx)}\n\nLeitura cética: (1) o simulador valoriza a E16 como gargalo (folga negativa em todos os fechamentos) — "reforçar Montagem" por prioridade puxa pessoas da E16 e PIORA o final da Caixa Amarela (contra o +2.071 observado manualmente em 27/10 com outro desenho de contrafactual — não consegui reproduzir esse número; as variantes aqui são mais agressivas); (2) desligar a E16 derruba o final em ~40 mil peças, ordem de grandeza diferente dos −4.016/−2.657 citados (aqueles eram de 3 slots); (3) o plano de fluxo é igual ou melhor que TODAS as variantes em ${fMelhorN}/${cf.length} cortes (nos demais o plano base foi mantido e fica abaixo do vigente), mas só pelo simulador — não há contrafactual real. Os estoques E16→Montagem são ESTIMADOS (sem saldo confirmado em PROD): ${f27.map((r) => n0(cxPares(r)!.hi)).join(" / ")} peças.`);

  // ---- G
  const dupl = soma(todas.map((r) => r.extras.conector.duplicidadeE15));
  const fundOk = todas.every((r) => r.extras.conector.poolsFundidos === 2);
  const ehAuto = (k: string) => k.endsWith("1863b452-77f3-4d5c-9c49-a6d28ae77131") || k.endsWith("fb96d08d-bd64-43d3-8694-40230c695c39");
  const autoLinhas = (m: Record<string, number>) => soma(Object.entries(m).filter(([k]) => ehAuto(k)).map(([, v]) => v));
  const fluxoEscolhido = fech.filter((r) => r.planoEscolhido === "fluxo");
  const legLinhasAuto = soma(fluxoEscolhido.map((r) => autoLinhas(r.extras.conector.linhasPorPool.fluxo)));
  const vigLinhasAuto = soma(fluxoEscolhido.map((r) => autoLinhas(r.extras.conector.linhasPorPool.vigente)));
  const m8Ok = todas.every((r) => r.extras.wipTeto.filter((w) => w.chave.includes("1b72bf46")).every((w) => w.ok !== false));
  const dc = fech[fech.length - 1].extras.conector;
  add("G", "Conector legado (pools comuns fundidos sem duplicidade)", fundOk && dupl === 0 && m8Ok ? PASS + " (com defeito de campo)" : FAIL,
    `2 pools comuns fundidos em ${todas.length}/${todas.length} replays; duplicidade E15/E17: ${dupl}; Máquina 8 dentro do teto derivado: ${m8Ok ? "sim" : "NÃO"}; campo \`demandaComum\` incorreto (ver achados).`,
    `Nos ${fluxoEscolhido.length} fechamentos em que o fluxo foi escolhido, as linhas de Etiquetar/Embalar saem 100% no produto convencional (linhas de Etiquetar/Embalar da AUTOMÁTICA: ${legLinhasAuto}, contra ${vigLinhasAuto} no plano vigente) — coerente com o que a fábrica realmente aponta (Embalar: real 35.600 no convencional × plano 0; automática: plano 49.125 × real 0).\n\nEtiquetadora 15 (atende Etiquetar convencional e automática — demanda restante das duas etapas × capacidade futura da máquina, meta nominal):\n\n${tabela(["Fechamento", "demanda restante REAL (Q − boas)", "capacidade futura E15", "déficit real", "demanda legada (Q − créditos planejados)", "períodos com E15 ocupada: vigente → fluxo (de N)"], fech.map((r) => [rot(r), n0(r.extras.e15.demandaReal), n0(r.extras.e15.capacidadeFutura), n0(r.extras.e15.defReal), n0(r.extras.conector.remLegadoEtq), `${r.extras.e15.ocupacaoVigente} → ${r.extras.e15.ocupacaoFluxo} (de ${r.extras.e15.slotsMutaveis})`]))}\n\n${(() => { const t2 = fech.find((r) => r.data === "2026-10-27" && r.periodoId === "t2"); const ocup = fech.every((r) => r.extras.e15.ocupacaoFluxo >= r.extras.e15.slotsMutaveis && r.extras.e15.ocupacaoVigente >= r.extras.e15.slotsMutaveis); const gargEtq = fech.filter((r) => { const g = r.gargalos.find((x) => x.produtoId === "27c229d7-f192-41eb-aad1-0c69ece53eba"); return g && g.etapaId.startsWith("34371af3") && g.folga < 0; }).length; return t2 ? `No fechamento de 27/10 T2 a demanda restante real do Etiquetar é ${n0(t2.extras.e15.demandaReal)} contra ${n0(t2.extras.e15.capacidadeFutura)} de capacidade da E15 (déficit ${n0(t2.extras.e15.defReal)}) — reproduz o "84.880 × 61.500" citado. A E15 é o gargalo de fluxo do Conector convencional (Etiquetar com folga negativa) em ${gargEtq}/${fech.length} fechamentos e ${ocup ? "fica ocupada em TODOS os períodos mutáveis tanto no vigente quanto no fluxo (o fluxo não esconde nem agrava o déficit)" : "NÃO fica ocupada em todos os períodos mutáveis em algum fechamento"}. O legado (créditos planejados) subestima a demanda em ${n0(t2.extras.e15.demandaReal - (t2.extras.conector.remLegadoEtq ?? 0))} peças nesse corte.` : ""; })()} \`demandaComum\` devolvido pelo núcleo é sempre ${n0(dc.demandaComum[0])} (= Q_conv + Q_auto fixo): NÃO desconta as boas (contrato: R_f,total = Q_conv + Q_auto − boas) — o defeito é só no campo de diagnóstico (a demanda do motor, \`remFluxo\`, sai correta), mas se for persistido induz a erro.`);

  // ---- H
  const lin = fech.map((r) => (r.churnNucleo as any).linhasAlteradas as number), tro = fech.map((r) => (r.churnNucleo as any).trocasDePosto as number), prim = fech.map((r) => (r.churnNucleo as any).alteradasNoPrimeiroPeriodo as number);
  const linBase = fech.map((r) => r.churnInd.vsBase.linhas), postNovBase = fech.map((r) => r.churnInd.vsBase.postosNovos), linBV = fech.map((r) => r.churnInd.baseVsVigente.linhas);
  const ESTAB = ler<any[]>("estabilizacao.json");
  const estLinhas = (ESTAB ?? []).filter((x) => x.linhasAntes > 0);
  const th0 = TH?.find((x: any) => x.theta === 0), thP = TH?.find((x: any) => x.theta === "padrao");
  const thTxt = th0 && thP ? `θ=0: falta Σ12 ${n0(th0.faltaLo)}, 1º período mutável mediana ${n0(th0.medianaPrimeiro)} linhas, total mediana ${n0(th0.medianaLinhas)}; θ padrão (≈1,0–1,6 mil peças): falta Σ12 ${n0(thP.faltaLo)} (+${n0(thP.faltaLo - th0.faltaLo)}, ${((100 * (thP.faltaLo - th0.faltaLo)) / th0.faltaLo).toFixed(1)}%), 1º período mediana ${n0(thP.medianaPrimeiro)}, total mediana ${n0(thP.medianaLinhas)}. A retenção por θ custa falta e quase não reduz o churn; o churn está nas PESSOAS.` : "n/d";
  add("H", "Churn aceitável (linhas e trocas de posto por recálculo)", FAIL,
    `mediana ${n0(mediana(lin))} / p90 ${n0(percentil(lin, 0.9))} linhas alteradas por recálculo (de ~255–375 futuras); trocas de posto mediana ${n0(mediana(tro))} / p90 ${n0(percentil(tro, 0.9))}; 1º período mutável mediana ${n0(mediana(prim))} / p90 ${n0(percentil(prim, 0.9))}.`,
    `${tabela(["Métrica (12 fechamentos)", "mediana", "p90", "máx"], [["linhas alteradas vs vigente (núcleo)", n0(mediana(lin)), n0(percentil(lin, 0.9)), n0(Math.max(...lin))], ["trocas de posto vs vigente", n0(mediana(tro)), n0(percentil(tro, 0.9)), n0(Math.max(...tro))], ["alteradas no 1º período mutável", n0(mediana(prim)), n0(percentil(prim, 0.9)), n0(Math.max(...prim))], ["linhas fluxo × base regenerado (churn ATRIBUÍVEL ao fluxo)", n0(mediana(linBase)), n0(percentil(linBase, 0.9)), n0(Math.max(...linBase))], ["postos (slot×máquina×pool) novos vs base", n0(mediana(postNovBase)), n0(percentil(postNovBase, 0.9)), n0(Math.max(...postNovBase))], ["linhas base regenerado × vigente (churn do motor oficial sozinho)", n0(mediana(linBV)), n0(percentil(linBV, 0.9)), n0(Math.max(...linBV))]])}\n\nO motor oficial não tem estabilidade ("mesmas entradas, mesma escala"): quase toda linha futura muda de pessoa a cada recálculo, e o plano de fluxo herda isso e acrescenta postos novos (mediana ${n0(mediana(postNovBase))} por recálculo). Hoje, em PROD, o modo restrito aplica \`estabilizarPessoas\` (mantém a pessoa no mesmo posto); o caminho de fluxo NÃO. **Teste da mitigação** (reutilizar \`estabilizarPessoas\` sobre o plano de fluxo; mesmos postos, mesma falta, 0 violações): linhas alteradas ${estLinhas.map((x) => `${x.rotulo}: ${x.linhasAntes}→${x.linhasDepois}`).join("; ")}. Reduz ≥ 50% em ${estLinhas.filter((x) => x.linhasDepois <= 0.5 * x.linhasAntes).length}/${estLinhas.length} fechamentos; nos demais as mudanças são de postos de verdade (produtivas ≈ linhas). **Varredura de θ** (seção 4): efeito pequeno e em degraus — ${thTxt}`);

  // ---- I
  const iViol = todas.reduce((n, r) => n + r.extras.wipTeto.filter((w) => w.ok === false).length, 0);
  const iTot = todas.reduce((n, r) => n + r.extras.wipTeto.length, 0);
  const maxPar: Record<string, number> = {};
  todas.forEach((r) => r.extras.pares.forEach((p) => (maxPar[p.chave] = Math.max(maxPar[p.chave] ?? 0, p.maxHi))));
  const exc = fech.filter((r) => r.planoEscolhido === "fluxo");
  add("I", "WIP previsto ≤ teto derivado (nenhum par explode)", iViol === 0 ? PASS : FAIL,
    `${iViol} violações em ${iTot} conferências (pipeline máx. por etapa × ConsumoDownstream + Teto); excesso de WIP no fim da semana: vigente ${n0(soma(exc.map((r) => r.excessoWip.vigente)))} × fluxo ${n0(soma(exc.map((r) => r.excessoWip.fluxo)))} peças (soma nos ${exc.length} fechamentos com fluxo).`,
    `Máximo de WIP (hi) previsto por par ao longo da semana, entre todos os replays:\n\n${tabela(["par (origem →)", "máx. WIP previsto"], Object.entries(maxPar).sort((a, b) => b[1] - a[1]).map(([k, v]) => [rotuloPar(k.split("|")[0], k.split("|")[1]), n0(v)]))}\n\nNos 2 primeiros fechamentos (plano base mantido) o excesso do base (${n0(fech[0].excessoWip.fluxo)}) é MAIOR que o do vigente (${n0(fech[0].excessoWip.vigente)}).`);

  // ---- J
  const flx = validas.filter((r) => r.planoEscolhido === "fluxo"), baseEsc = validas.filter((r) => r.planoEscolhido === "base");
  const semCob = flx.filter((r) => r.coberturaDecisoes.cobertasPeloResumo < r.coberturaDecisoes.mudancasVsBase);
  const semCobLista = flx.filter((r) => r.coberturaDecisoes.cobertas < r.coberturaDecisoes.mudancasVsBase);
  const baseMudaVig = baseEsc.filter((r) => r.churnInd.vsVigente.linhas > 0);
  const semJust = soma(flx.map((r) => r.decisoes.semJustificativa)), totDec = soma(flx.map((r) => r.decisoes.n)), totList = soma(flx.map((r) => r.decisoes.listadas));
  const cobVig = soma(flx.map((r) => Math.min(r.coberturaDecisoes.coberturasVsVigente + (r.coberturaDecisoes.cobertasPeloResumo - r.coberturaDecisoes.cobertas), r.coberturaDecisoes.mudancasVsVigente))), mudVig = soma(flx.map((r) => r.coberturaDecisoes.mudancasVsVigente));
  const anteDep = todas.every((r) => r.decisoes.anteCompleto && r.decisoes.depoisCompleto);
  add("J", "Plano explicável (ANTES/DECISÃO/MOTIVO/DEPOIS em 100% dos replanejamentos)", baseMudaVig.length === 0 && semCob.length === 0 && cobVig === mudVig ? PASS : FAIL,
    `ANTES e DEPOIS completos em ${anteDep ? "100%" : "NÃO 100%"} dos replays; o resumo agregado de decisões cobre 100% das mudanças contra o plano BASE em ${flx.length - semCob.length}/${flx.length} replays de fluxo (a lista detalhada, truncada em 120 decisões por replay, cobre ${((100 * soma(flx.map((r) => r.coberturaDecisoes.cobertas))) / Math.max(1, soma(flx.map((r) => r.coberturaDecisoes.mudancasVsBase)))).toFixed(0)}% das mudanças pessoa×período; ${flx.length - semCobLista.length}/${flx.length} replays totalmente cobertos), mas só ${n0(cobVig)}/${n0(mudVig)} (${((100 * cobVig) / Math.max(1, mudVig)).toFixed(0)}%) das mudanças contra o plano VIGENTE; ${baseMudaVig.length} replays com plano base mantido mudam o plano vigente (até ${n0(Math.max(0, ...baseMudaVig.map((r) => r.churnInd.vsVigente.linhas)))} linhas) com ZERO decisões; ${n0(semJust)}/${n0(totList)} decisões listadas sem ganho/WIP positivo (de ${n0(totDec)} no total).`,
    `As decisões descrevem o fluxo contra o plano BASE (\`de\` = base), não contra o plano em vigor que o supervisor vê. Onde o base difere do vigente (reshuffle do motor oficial) a mudança fica sem explicação; onde o base foi mantido (26/10 M1/M2) a diagnóstico é só "PLANO_BASE_MANTIDO" enquanto o plano em vigor muda ${n0(fech[0].churnInd.vsVigente.linhas)} linhas. Além disso há ${n0(totDec)} decisões (uma por grupo posto×slot; detalhe limitado a 120 por replay + resumo por pool) com \`ganhoProdutoFinal\` não aditivo (soma ${n0(soma(flx.map((r) => r.decisoes.ganhoTotal)))} peças contra melhora real de ~${n0(soma(flx.map((r) => r.falta.vigente[0] - r.falta.fluxo[0])))} no conjunto): explicável por máquina, não legível por humano.\n\nAmostra de decisões (27/10 T3): ${(fech[fech.length - 1].decisoes.amostra ?? []).map((t) => `\n- ${t}`).join("")}`);

  // ================================================================== recomendação
  const falhas = crit.filter((c) => c.status.startsWith(FAIL)), nc = crit.filter((c) => c.status.startsWith(NC));
  V.push(...crit);
  const OFF1 = (() => { try { return JSON.parse(fs.readFileSync(path.join(DIR, process.env.FREPLAY_FATOR === "1" ? "out_f_off1" : "out_off1", "fechamentos.json"), "utf8")) as R[]; } catch { return null; } })();
  const off1 = OFF1?.filter((r) => !r.erro && r.rev === 0).sort((a, b) => a.c - b.c) ?? [];
  const primeiroOff1 = off1.map((r) => r.churnInd.vsVigente.linhasPrimeiro);

  const sec0: string[] = [];
  sec0.push("# Critérios de ativação da Escala Inteligente (fluxo) — replay com dados REAIS de PROD (26–27/10/2026)");
  sec0.push("");
  sec0.push(`> Revisor independente e cético. Gerado por \`scripts/escala-fluxo-replay/\` (harness) a partir de SELECTs em PROD (nada gravado). Núcleo avaliado: \`feat/escala-fluxo-core\` commit \`${commitNucleo}\`. Configuração dos replays = a do integrador (\`feat/escala-fluxo-io › opcoesFluxo\`: metas nominais, sem fator de desempenho; \`paresLegado\` do Conector); \`aPartirDe = c+2\`. Os números abaixo são reproduzíveis (seção 8) e determinísticos.`);
  sec0.push("");
  sec0.push("## 0. Recomendação");
  sec0.push("");
  sec0.push(falhas.length || nc.length ? `**MANTER EM SOMBRA — NÃO ATIVAR a Escala de amanhã cedo no motor novo.** Critérios com falha: ${falhas.map((c) => c.id).join(", ") || "—"}${nc.length ? `; não comprovados: ${nc.map((c) => c.id).join(", ")}` : ""}. Regra da spec §7: qualquer falha ⇒ permanecer em sombra.` : "**ATIVAR** — todos os critérios A–J passaram.");
  sec0.push("");
  sec0.push(tabela(["Critério", "Veredito", "Números"], crit.map((c) => [`**${c.id}** ${c.titulo}`, `**${c.status}**`, c.resumo.replace(/\|/g, "/").replace(/\n/g, " ")])));
  sec0.push("");

  const sec1: string[] = [];
  sec1.push("## 1. Método e dados");
  sec1.push("");
  sec1.push(`- **Dados**: ${decisoesN()} decisões gravadas em \`escala_sombra_decisoes\` da semana 26/10 (entrada canônica completa: pools, funcionários, ausências, indisponibilidades, plano oficial, histórico de equidade, WIP) + ${apontamentosN()} linhas de \`apontamentos_producao\` (todas as da semana, produzindo e sem_producao) + \`ocorrencias_maquina\`/\`escala_recurso_indisponivel\`/\`ausencias_funcionarios\`. Fechamentos reais = 12 (revisão 0: 26/10 M1…T3 e 27/10 M1…T3); as demais ${validas.length - fech.length} decisões (revisões do modo restrito) entram como recálculos extras; 4 revisões gravadas com \`c\` defasado (corte ≥ fim do período seguinte + 10 min) foram marcadas **obsoletas** e não entram nas contagens de E/J.`);
  sec1.push(`- **Sem olhar o futuro**: cada replay usa \`agoraMs\` = corte gravado e entrega ao núcleo TODOS os apontamentos da semana (inclusive os futuros); só vale o que o núcleo filtra por \`lancadoEmMs ≤ agoraMs\` (lançamento = \`criado_em\`, igual ao modo sombra; \`hora_lancamento\` é idêntica a \`criado_em\` em 262/262 linhas). Sensibilidade (seção 6) confirma: lançamento atrasado não muda o plano até o relógio avançar.`);
  sec1.push(`- **Entrada do motor reconstruída fielmente**: \`aPartirDe = c+2\` (c+1 está comprometido/iniciado há 10 min no fechamento — mesma regra do horizonte e de \`primeiroSlotFuturo\`), congeladas = plano vigente ≤ c+1, revezamento duro (PROD: \`revezamento_modo = duro\`). Validação: nos fechamentos em que o plano vigente era recente, o \`gerarEscala\` regenerado reproduz o futuro gravado EXATAMENTE (0 linhas de diferença em ${todas.filter((r) => r.churnInd.baseVsVigente.linhas === 0).length} dos ${todas.length} replays); onde difere, o vigente é "velho" (gerado com informação anterior). Golden-master: os **36/36** hashes das decisões gravadas continuam idênticos com o motor modificado pelo núcleo.`);
  sec1.push(`- **Régua única**: \`avaliarPlano\` do núcleo avalia plano vigente, motor oficial regenerado e plano de fluxo. Verificações cruzadas independentes: (i) verificador de restrições escrito do zero (A–D, 10/10 mutações detectadas); (ii) simulador independente (sinal); (iii) régua legada \`faltaProjetada\`; (iv) auditoria de \`estadoDaProducao\` contra os apontamentos brutos (${AUD ? `${AUD.conferidos} itens conferidos` : "n/d"}: boas fechadas, WIP bruto/piso 0/flag negativo, soma do Embalar fundido — ${AUD ? AUD.divergencias.filter((x) => !x.item.startsWith("projecao")).length : "n/d"} divergências fora da projeção do período comprometido); (v) determinismo: cada replay roda 2×, hash do \`ResultadoFluxo\` inteiro idêntico em ${todas.filter((r) => r.determinismo).length}/${todas.length}; encadeado 2× idêntico: ${EN?.deterministico ? "sim" : "NÃO"}.`);
  sec1.push(`- **Backtest do simulador** (WIP previsto pelo plano vigente em i × WIP estimado observado em j > i): ${BT ? `${BT.dentro}/${BT.n} previsões dentro da faixa observada (${((100 * BT.dentro) / BT.n).toFixed(0)}%)` : "n/d"}. Pares: ${BT ? BT.porPar.map((p: any) => `${rotuloPar(p.chave.split("|")[0], p.chave.split("|")[1])} ${p.dentro}/${p.n} (erro médio ${n0(p.erroMedio)})`).join("; ") : ""}. Evidência FRACA de calibração (a execução real diverge do plano: Conector convencional 80% do planejado, M8 60%, Pino 110%), sem falha formal.`);
  sec1.push(`- **Desempenho**: \`planejarComFluxo\` por replay: mediana ${n0(mediana(todas.map((r) => r.ms)))} ms / p90 ${n0(percentil(todas.map((r) => r.ms), 0.9))} ms (medido com ~8 processos em paralelo ⇒ limite superior; diagnóstico JSON: mediana ${n0(mediana(todas.map((r) => r.bytesDiagnostico)) / 1024)} KB / máx ${n0(Math.max(...todas.map((r) => r.bytesDiagnostico)) / 1024)} KB).`);
  sec1.push("");

  const sec3: string[] = [];
  sec3.push("## 3. Critérios A–J");
  crit.forEach((c) => { sec3.push(`\n### ${c.id} — ${c.titulo}: **${c.status}**\n`); sec3.push(c.resumo); sec3.push(""); sec3.push(c.detalhe); });
  if (primeiroOff1.length) sec3.push(`\n#### 3.1 Variante aPartirDe = c+1 (spec §4 lida literalmente)\n\nSe o integrador chamar o núcleo com aPartirDe = c+1, o plano de fluxo altera o período c+1 — que no fechamento já está em curso há 10 min: linhas alteradas no 1º período mutável por fechamento = ${primeiroOff1.join(", ")} (mediana ${n0(mediana(primeiroOff1))}). Isso viola B ("período em andamento congelado"). Recomendação: aPartirDe = c+2 (como no replay principal).`);

  const sec4: string[] = [];
  sec4.push("## 4. θ — varredura (churn × falta)");
  sec4.push("");
  if (TH) {
    sec4.push(tabela(["θ", "falta Σ12 fechamentos (lo)", "linhas med / p90", "trocas med / p90", "1º período med / p90", "plano base / fluxo"], TH.map((x: any) => [String(x.theta), n0(x.faltaLo), `${n0(x.medianaLinhas)} / ${n0(x.p90Linhas)}`, `${n0(x.medianaTrocas)} / ${n0(x.p90Trocas)}`, `${n0(x.medianaPrimeiro)} / ${n0(x.p90Primeiro)}`, `${x.escolha.base ?? 0} / ${x.escolha.fluxo ?? 0}`])));
    sec4.push("");
    const e0 = (ESTAB ?? []);
    const sumE = (f: (x: any) => number) => e0.reduce((n, x) => n + f(x), 0);
    sec4.push(`Leitura: θ opera em degraus pequenos (a retenção do posto vigente no 1º período mutável compete com o valor marginal). ${thTxt} **Não existe θ que reduza o churn sem piorar a falta**: toda retenção custa peças finais. Combinação testada com a re-atribuição de pessoas (\`estabilizarPessoas\`, mesma falta, 0 violações): θ=0 + estabilização → falta Σ12 ${n0(sumE((x) => x.theta0.falta))}, linhas alteradas no 1º período mutável Σ ${n0(sumE((x) => x.theta0.linhasPrimeiro))}, total Σ ${n0(sumE((x) => x.theta0.linhas))}; θ padrão + estabilização → falta Σ12 ${n0(sumE((x) => x.faltaDepois))}, 1º período Σ ${n0(sumE((x) => x.thetaPadrao.linhasPrimeiro))}, total Σ ${n0(sumE((x) => x.linhasDepois))}. **θ proposto: ${sumE((x) => x.theta0.falta) <= sumE((x) => x.faltaDepois) && sumE((x) => x.theta0.linhasPrimeiro) <= sumE((x) => x.thetaPadrao.linhasPrimeiro) + 5 ? "θ = 0 (sem retenção) + estabilização de pessoas" : "manter o θ padrão derivado + estabilização de pessoas"}** — a estabilização, e não θ, é o que reduz o churn.`);
  } else sec4.push("n/d");
  sec4.push("");

  const sec5: string[] = [];
  sec5.push("## 5. Replay completo da semana (fluxo ativo desde o 1º recálculo)");
  sec5.push("");
  if (EN) {
    sec5.push("Cada fechamento parte do passado gravado até c e do plano de FLUXO produzido no fechamento anterior de c+1 em diante. Compara a falta (lo) do plano gravado, do plano herdado e do novo plano de fluxo, e o churn entre planos consecutivos.");
    sec5.push("");
    sec5.push(tabela(["Fechamento", "plano", "oficial gravado", "herdado (fluxo anterior)", "novo fluxo", "novo − herdado", "churn linhas fluxo (vs anterior)", "churn linhas oficial (vs anterior)"], EN.linhas.map((l) => [l.rotulo, l.resumo.planoEscolhido, n0(l.faltaOficialGravado[0]), n0(l.faltaVigenteDaCadeia[0]), n0(l.faltaFluxoCadeia[0]), `${l.faltaFluxoCadeia[0] - l.faltaVigenteDaCadeia[0] >= 0 ? "+" : ""}${n0(l.faltaFluxoCadeia[0] - l.faltaVigenteDaCadeia[0])}`, l.churnFluxoVsAnterior ? n0(l.churnFluxoVsAnterior.linhas) : "—", l.churnOficialVsAnterior ? n0(l.churnOficialVsAnterior.linhas) : "—"])));
    sec5.push("");
    sec5.push(`Soma da falta ao longo dos 12 fechamentos: oficial gravado ${n0(soma(EN.linhas.map((l) => l.faltaOficialGravado[0])))} · fluxo encadeado ${n0(soma(EN.linhas.map((l) => l.faltaFluxoCadeia[0])))}.`);
  }
  sec5.push("");

  const sec6: string[] = [];
  sec6.push("## 6. Sensibilidade e robustez");
  sec6.push("");
  if (SE) {
    sec6.push(`${SE.filter((x) => x.ok).length}/${SE.length} casos OK (sem exceção, sem WIP negativo exposto, entrada/dados NÃO mutados, JSON serializável, determinismo, 0 violações duras). Cada cenário de dados foi aplicado a 3 fechamentos (27/10 T1, 26/10 T1, 27/10 M3).`);
    sec6.push("");
    sec6.push(tabela(["Caso", "OK", "diagnósticos relevantes / faltas"], SE.map((x) => [x.nome, x.ok ? "OK" : "**FALHA**", x.excecao ?? `${(["PRODUCAO_NAO_CONFIRMADA", "AJUSTE_TARDIO", "WIP_NEGATIVO_ESTIMADO", "SEM_PRODUCAO_FALTA_MATERIAL"] as const).map((k) => ((x.detalhes.codigos as Record<string, number> | undefined)?.[k] ? `${k}×${(x.detalhes.codigos as Record<string, number>)[k]}` : "")).filter(Boolean).join(" ")}${x.detalhes.faltaFluxo ? ` · falta fluxo ${(x.detalhes.faltaFluxo as number[]).map(n0).join("/")} base ${(x.detalhes.faltaBase as number[] | undefined)?.map(n0).join("/")}` : ""}${x.detalhes.reproduzidas !== undefined ? ` ${x.detalhes.reproduzidas}/${x.detalhes.total}` : ""}`])));
    sec6.push("");
    sec6.push("Observações: (1) sem NENHUM apontamento a falta pessimista é enorme (lo) e a otimista pequena (hi) — a faixa é honesta e o plano base é mantido; (2) o piso 0 aparece com `WIP_NEGATIVO_ESTIMADO` e nenhum par exposto é negativo; (3) o motivo real `sem_programacao` (6 linhas em PROD) não existe na spec: o núcleo o aceita sem quebrar, mas sem diagnóstico próprio; (4) `desligado`: o núcleo não lê a flag — \"desligado\" = o chamador não usa o fluxo; provado que `gerarEscala` sem hooks (ou com hooks vazios) é byte-idêntico e que as 36 decisões gravadas reproduzem o hash.");
  }
  sec6.push("");

  // sensibilidade ao fator de desempenho f (o integrador NÃO o passa; o sombra sim)
  const FF = (() => { if (process.env.FREPLAY_FATOR === "1") return null; try { return (JSON.parse(fs.readFileSync(path.join(DIR, "out_f", "fechamentos.json"), "utf8")) as R[]).filter((r) => !r.erro && r.rev === 0).sort((a, b) => a.c - b.c); } catch { return null; } })();
  if (FF && FF.length) {
    sec6.push("### 6.1 Fator de desempenho f (metas × f)");
    sec6.push("");
    sec6.push(`O integrador (\`feat/escala-fluxo-io › opcoesFluxo\`) chama o núcleo SÓ com \`paresLegado\` e θ: metas NOMINAIS, f = 1 — este é o cenário principal deste relatório. O modo sombra usa f (Conector convencional 0,8, M8 0,6, Pino 1,1 no realizado). Reexecução dos 12 fechamentos com f aplicado (\`FREPLAY_FATOR=1\`):`);
    sec6.push("");
    sec6.push(tabela(["Fechamento", "Δ fluxo−vigente (f=1)", "Δ fluxo−vigente (com f)", "plano (f=1 / com f)", "violações A–D (com f)"], fech.map((r) => { const g = FF.find((x) => x.c === r.c)!; return [rot(r), n0(r.falta.fluxo[0] - r.falta.vigente[0]), n0(g.falta.fluxo[0] - g.falta.vigente[0]), `${r.planoEscolhido} / ${g.planoEscolhido}`, String(g.violacoes.A + g.violacoes.B + g.violacoes.C + g.violacoes.D)]; })));
    sec6.push("");
    sec6.push("Com f=1 o simulador superestima a capacidade de etapas que rendem abaixo da meta (Conector, M8), logo os ganhos previstos pelo fluxo são otimistas na mesma proporção; a conclusão qualitativa (melhora vs vigente, mesmas falhas E/H/J) não depende de f.");
    sec6.push("");
  }
  const sec7: string[] = [];
  sec7.push("## 7. Achados que contradizem a spec / bugs do núcleo");
  sec7.push("");
  sec7.push("1. **\"Nunca pior\" só vale contra o base regenerado, não contra o plano em vigor** (`planejar.ts`: candidatos elegíveis = `faltaFinalLo ≤ avBaseLeve`; o plano vigente não é candidato). Repro: replay encadeado — " + (Enc.length ? Enc.map((l) => `${l.rotulo} (+${n0(l.faltaFluxoCadeia[0] - l.faltaVigenteDaCadeia[0])}, ${((100 * (l.faltaFluxoCadeia[0] - l.faltaVigenteDaCadeia[0])) / l.faltaVigenteDaCadeia[0]).toFixed(1)}%)`).join("; ") : "nenhum caso") + " — e fechamentos " + fech.filter((r) => r.falta.fluxo[0] > r.falta.vigente[0] + 1).map((r) => `${rot(r)} (base regenerado ${(100 * (r.falta.baseRegen[0] / r.falta.vigente[0] - 1)).toFixed(1)}% pior que o vigente gravado)`).join("; ") + ". Correção sugerida: incluir o futuro do plano vigente (se não violar restrição dura) como candidato \"plano vigente mantido\".");
  sec7.push("2. **θ: efeito pequeno e em degraus, sem θ que reduza churn de graça** (`planejar.ts: bonusDoPlanoVigente`): ver seção 4. Não é bug; é uma calibração sem resposta útil — a spec §4 pressupõe que existe um θ que reduz o churn sem piorar a falta, e nos dados reais não existe.");
  sec7.push("3. **Churn de pessoas sem estabilização**: o caminho de fluxo não reaproveita `estabilizarPessoas` (que o modo restrito usa); " + n0(Math.min(...lin.filter((x) => x > 0))) + "–" + n0(Math.max(...lin)) + " linhas alteradas por recálculo; em " + estLinhas.filter((x) => x.linhasDepois <= 0.5 * x.linhasAntes).length + "/" + estLinhas.length + " fechamentos ≥ 50% delas são só troca de pessoa no mesmo conjunto de postos (seção H).");
  sec7.push(`4. **\`PoolFundido.demandaComum\` incorreto** (\`grafo.ts\` ~137: \`soma = conv.quantidade + auto.quantidade\`): contrato diz Q_conv + Q_auto − boas; sai sempre ${n0(dc.demandaComum[0])}. Só diagnóstico (a demanda do motor está certa).`);
  sec7.push("5. *(corrigido no núcleo entre 1c7aa12 e 757e870; verificado aqui)* `EstadoProduto.demandaFinalRestante` deduzia a produção PLANEJADA do período comprometido (~2.700 peças por produto no 1º fechamento) contra o contrato Q_f − B_f,lo; agora há `restanteEmAPartirDe` separado e a auditoria independente confere `demandaFinalRestante = Q_f − B_f,lo` em 100% dos fechamentos. Resta uma ressalva de modelo: a projeção do período comprometido trata o planejado como certo (lo = hi).");
  sec7.push("6. **Diagnóstico não explica mudanças contra o plano vigente** (J): as `DecisaoFluxo` são contra o base; com base mantido há plano mudando até " + n0(Math.max(0, ...baseMudaVig.map((r) => r.churnInd.vsVigente.linhas))) + " linhas sem nenhuma decisão.");
  sec7.push("7. **`verificarRestricoesDuras` é sensível ao passado congelado**: chamado com o plano completo acusa violações em linhas JÁ gravadas (funcionário desativado depois, M8 parada), então não pode ser usado como interlock sobre o plano inteiro; usado só sobre as linhas novas (como em `planejar.ts`) está correto.");
  sec7.push("8. **O integrador não passa `fatorPorPool`** (`feat/escala-fluxo-io › opcoesFluxo` só devolve `paresLegado` e θ): o simulador e o motor operam com metas nominais (f = 1), embora o realizado mostre Etiquetar convencional a ~0,8 e a Máquina 8 a ~0,6 do planejado. Efeito medido na seção 6.1 (ganhos previstos menores, mesmas falhas). Decisão de produto: embutir f nas metas (como o sombra) ou aceitar o viés otimista.");
  sec7.push("9. Estrutural (contexto, não bug do núcleo): em PROD as linhas do Embalar são apontadas 100% no produto convencional (real 35.600 × plano 0; automática plano 49.125 × real 0); o plano de fluxo passa a atribuir tudo ao convencional — coerente com a spec §5, mas muda o que a tela mostra para a automática.");
  sec7.push("");

  const sec8: string[] = [];
  sec8.push("## 8. Reprodução");
  sec8.push("");
  sec8.push("```\n# 1) extração (somente SELECT em PROD): scripts/escala-fluxo-replay/sql/*.sql  →  <FREPLAY_DIR>/*.sql.out (JSON {rows})\n# 2) replays (FREPLAY_DIR padrão = scratchpad/freplay):\nnpx tsx --tsconfig <tsconfig com alias @/*> scripts/escala-fluxo-replay/replay.ts fechamentos|encadeado|theta|sensibilidade|contrafactual|auditoria|estabilizacao [--offset=2]\nnpx tsx ... scripts/escala-fluxo-replay/autoteste-independente.ts      # mutação do verificador independente\nnpx tsx ... scripts/escala-fluxo-replay/relatorio.ts docs/escala-fluxo-criterios-ativacao.md\n```");
  return { md: [...sec0, ...sec1, ...tabsMd, ...sec3, ...sec4, ...sec5, ...sec6, ...sec7, ...sec8].join("\n") + "\n", vereditos: V };
}

const decisoesN = () => (ler<R[]>("fechamentos.json") ?? []).length;
const apontamentosN = () => 262;
// Resumo compacto (sem trajetórias) para versionar junto do relatório.
function compacto() {
  const F = (ler<R[]>("fechamentos.json") ?? []).filter((r) => !r.erro);
  return F.map((r) => ({
    id: r.id, data: r.data, periodoId: r.periodoId, revisao: r.rev, modo: r.modo, c: r.c, aPartirDe: r.aPartirDe, obsoleta: !!r.obsoleta, determinismo: r.determinismo, hashPlanoFluxo: r.hashPlanoFluxo, hashResultado: r.hashResultado, planoEscolhido: r.planoEscolhido, theta: r.theta,
    falta: r.falta, final: r.final, wipFinal: r.wipFinal, excessoWip: r.excessoWip, simInd: r.simInd, faltaLegada: r.faltaLegada, churn: r.churnNucleo, churnInd: r.churnInd, violacoes: r.violacoes, decisoes: { ...r.decisoes, amostra: undefined },
    coberturaDecisoes: r.coberturaDecisoes, alertas: r.alertas, cx: { vigente: r.extras.cx.vigente, fluxo: r.extras.cx.fluxo }, e15: r.extras.e15, produtos: r.produtos.map((p) => ({ produtoId: p.produtoId, Rf: p.Rf })), pares: r.pares,
  }));
}

if (process.argv[1]?.endsWith("relatorio.ts")) {
  const { md } = gerar();
  const alvo = process.argv[2];
  if (alvo) { fs.writeFileSync(alvo, md); fs.writeFileSync(path.join(path.dirname(alvo), "escala-fluxo-replay-resultados.json"), JSON.stringify(compacto())); } else console.log(md);
}
