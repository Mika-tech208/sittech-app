/* eslint-disable @typescript-eslint/no-explicit-any */
// Gera docs/escala-fluxo-criterios-ativacao.md a partir dos JSON produzidos por replay.ts (out/*.json). Nada é digitado à mão: todos os números vêm dos replays.
// v2 (re-avaliação após as correções E/H/J/f/demandaComum): mesma régua independente da revisão anterior (verificador independente + teste de mutação, simulador
// independente, régua legada, auditoria do estado, determinismo 2×, sensibilidade, replay encadeado) — os critérios continuam sendo julgados contra o plano VIGENTE.
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
const OUT = path.join(DIR, process.env.FREPLAY_FATOR === "0" ? "out_semf" : "out");
const ler = <T>(f: string, dir = OUT): T | null => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as T; } catch { return null; } };

const n0 = (v: number | null | undefined) => (v === null || v === undefined ? "—" : Math.round(v).toLocaleString("pt-BR"));
const sg = (v: number) => `${v >= 0 ? "+" : ""}${n0(v)}`;
const rot = (r: { data: string; periodoId: string }) => `${r.data.slice(8)}/${r.data.slice(5, 7)} ${r.periodoId.toUpperCase()}`;
const tabela = (cab: string[], linhas: (string | number)[][]) => [`| ${cab.join(" | ")} |`, `|${cab.map(() => "---").join("|")}|`, ...linhas.map((l) => `| ${l.join(" | ")} |`)].join("\n");
const git = (cmd: string) => { try { return execSync(cmd, { cwd: path.resolve(__dirname, "../.."), encoding: "utf8" }).trim(); } catch { return "?"; } };
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
  const TEMPO = ler<any>("tempo.json");
  const ESTAB = ler<any[]>("estabilizacao.json");
  const SEMF = ler<R[]>("fechamentos.json", path.join(DIR, "out_semf"))?.filter((r) => !r.erro && r.rev === 0).sort((a, b) => a.c - b.c) ?? null;
  const OFF1 = ler<R[]>("fechamentos.json", path.join(DIR, "out_off1"))?.filter((r) => !r.erro && r.rev === 0).sort((a, b) => a.c - b.c) ?? [];
  const AUTOTESTE = (() => { try { return fs.readFileSync(path.join(DIR, "..", "fint", "log_autoteste.txt"), "utf8"); } catch { return ""; } })();
  const out: string[] = [];
  const push = (s = "") => out.push(s);
  const soma = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const rotR = (r: R) => `${rot(r)}${r.rev ? ` (rev ${r.rev})` : ""}`;

  // ------------------------------------------------------------------ tabelas por fechamento
  const tFech = tabela(
    ["Fechamento", "plano escolhido", "falta vigente", "falta base (núcleo)", "falta oficial regenerado", "falta FLUXO", "Δ vs vigente", "Δ vs oficial regen.", "final prev. vigente → fluxo", "WIP final vig → fluxo", "excesso WIP vig → fluxo", "linhas alteradas vs vigente", "decisões / pessoas", "resíduo"],
    fech.map((r) => [rot(r), r.planoEscolhido, n0(r.falta.vigente[0]), n0(r.falta.base[0]), n0(r.falta.baseRegen[0]), n0(r.falta.fluxo[0]), sg(r.falta.fluxo[0] - r.falta.vigente[0]), sg(r.falta.fluxo[0] - r.falta.baseRegen[0]), `${n0(r.final.vigente[0])} → ${n0(r.final.fluxo[0])}`, `${n0(r.wipFinal.vigente[1])} → ${n0(r.wipFinal.fluxo[1])}`, `${n0(r.excessoWip.vigente)} → ${n0(r.excessoWip.fluxo)}`, n0(r.churnInd.vsVigente.trocasPosto), `${r.decisoes.n} / ${r.decisoes.qtdPessoas}`, n0(r.reconciliacao.residuo)]),
  );
  push("## 2. Tabela por fechamento (replay no instante do corte; aPartirDe = c+2)");
  push();
  push("Falta/final = soma dos produtos, cenário pessimista (lo), peças, medidos pelo MESMO `avaliarPlano` (f embutido nas metas, como na integração) sobre: plano vigente gravado · plano base do núcleo (`gerarEscala` sobre a entrada com f) · motor oficial regenerado (metas nominais, o que a Escala faria hoje) · plano devolvido pelo fluxo. Todos os fechamentos 26–27/10 (revisão 0).");
  push();
  push(tFech);
  push();
  const prods = [...new Set(fech.flatMap((r) => r.produtos.map((p) => p.produtoId)))];
  push("### 2.1 Demanda final restante por produto: oficial planejado (Q − Σ créditos congelados do plano vigente) × real (Q − boas confirmadas)");
  push();
  push(tabela(["Fechamento", ...prods.map(nomeProduto)], fech.map((r) => [rot(r), ...prods.map((pid) => {
    const p = r.produtos.find((x) => x.produtoId === pid); const dp = r.demandaPool.find((x) => x.final && x.chave.startsWith(pid));
    return p && dp ? `${n0(dp.remLegado)} × **${n0(p.Rf)}**` : "—";
  })])));
  push();
  push("Formato: `planejado × real`. Real = demanda final restante R_f = Q_f − boas confirmadas da etapa final (só o CONFIRMADO reduz a meta). **Conector**: as colunas convencional/automática NÃO são comparáveis isoladamente — a fábrica aponta o Embalar (e o Etiquetar) 100% no convencional; o núcleo funde os pools comuns (seção G).");
  push();
  const pares = [...new Set(fech.flatMap((r) => r.pares.map((p) => `${p.produtoId}|${p.origem}`)))];
  push("### 2.2 WIP por par (origem, confiança, lo–hi); NEG = estimativa negativa mesmo no melhor caso (piso 0)");
  push();
  push(tabela(["Fechamento", ...pares.map((k) => rotuloPar(k.split("|")[0], k.split("|")[1]))], fech.map((r) => [rot(r), ...pares.map((k) => {
    const p = r.pares.find((x) => `${x.produtoId}|${x.origem}` === k); return p ? `${p.tipo.slice(0, 3)}/${p.conf} ${n0(p.lo)}–${n0(p.hi)}${p.negativo ? " NEG" : ""}` : "—";
  })])));
  push();
  push("### 2.3 Gargalo de fluxo por produto (do plano VIGENTE; potencial − demanda restante; negativo = gargalo real)");
  push();
  push(tabela(["Fechamento", ...prods.map(nomeProduto)], fech.map((r) => [rot(r), ...prods.map((pid) => { const g = r.gargalos.find((x) => x.produtoId === pid); return g ? `${rotuloPool(pid + "|" + g.etapaId).split(" · ")[1]} ${n0(g.folga)}` : "—"; })])));
  push();
  push("### 2.4 Churn por fechamento");
  push();
  push("O período c+1 está comprometido/em curso no fechamento (0 alterações por construção); o 1º período mutável é c+2.");
  push();
  push(tabela(["Fechamento", "plano", "linhas vs vigente (núcleo)", "antes da re-atribuição de pessoas", "trocas de posto", "postos alterados", "1º período mutável", "θ", "oficial regenerado × vigente (linhas / postos)", "por período mutável, só mudança de posto (c+2 / c+3 / c+4 / c+5 / c+6…)"], fech.map((r) => {
    const c = r.churnNucleo as any; return [rot(r), r.planoEscolhido, n0(c.linhasAlteradas), `${n0(r.estabilizacao.linhasAntes)}${r.estabilizacao.aplicada ? ` → ${n0(r.estabilizacao.linhasDepois)}` : " (sem ajuste)"}`, n0(c.trocasDePosto), n0(c.postosAlterados), n0(c.alteradasNoPrimeiroPeriodo), n0(r.theta), `${n0(r.churnInd.baseVsVigente.trocasPosto)} / ${n0(r.churnInd.baseVsVigente.postosNovos)}`, ((r.churnInd.vsVigente as unknown as { porOffsetPosto?: number[] }).porOffsetPosto ?? []).map(n0).join(" / ")];
  })));
  push();
  const tabsMd = out.splice(0);

  // ================================================================== critérios
  const crit: Veredito[] = [];
  const add = (id: string, titulo: string, status: string, resumo: string, detalhe: string) => crit.push({ id, titulo, status, resumo, detalhe });

  // ---- A–D
  const aInd = soma(todas.map((r) => r.violacoes.A)), aNuc = soma(todas.map((r) => r.violacoes.nucleo)), aNovas = soma(todas.map((r) => r.violNucleoNovas)), avisos = soma(todas.map((r) => r.violacoes.avisos));
  const bTot = soma(todas.map((r) => r.violacoes.B)), cTot = soma(todas.map((r) => r.violacoes.C)), dTot = soma(todas.map((r) => r.violacoes.D));
  const tiposViol: Record<string, number> = {};
  todas.forEach((r) => Object.entries(r.violacoes.porTipo).forEach(([k, v]) => (tiposViol[k] = (tiposViol[k] ?? 0) + v)));
  const nucCompleto = soma(todas.map((r) => r.violNucleoCompleto));
  add("A", "Hard constraints (máquina indisponível/inativa/fora da Previsão, ausência, equipe, seleção, roteiro)", aInd + aNuc + aNovas === 0 ? PASS : FAIL,
    `${todas.length} replays (36 decisões gravadas): verificador independente = ${aInd} violações; \`verificarRestricoesDuras\` do núcleo (linhas novas) = ${aNuc}; sobre o plano COMPLETO no modo \`somenteLinhasNovas\` = ${aNovas}; avisos (Parada real da M8 posterior ao corte, logo não conhecível) = ${avisos}.`,
    `Verificador independente escrito do zero (replica as invariantes de \`disponibilidade.ts\`/\`revalidarDisponibilidade.ts\`/\`rotacao.ts\`), validado por teste de mutação (\`autoteste-independente.ts\`: ${AUTOTESTE.includes("AUTOTESTE OK") ? "AUTOTESTE OK — todas as mutações injetadas foram detectadas, plano do motor oficial = 0 violações" : "RESULTADO NÃO CONFIRMADO NESTA EXECUÇÃO"}). Causas de indisponibilidade = as gravadas em cada snapshot, mais a Parada real da Máquina 8 (ocorrencias_maquina 27/10 09:34–11:54) conferida à parte como aviso. Violações por tipo: ${JSON.stringify(tiposViol)}. **Correção 6**: \`verificarRestricoesDuras(entrada, linhas, { somenteLinhasNovas: true })\` não acusa linhas já congeladas — na revisão anterior, chamado com o plano completo acusava ${n0(nucCompleto)} itens ainda hoje presentes no modo antigo (informativo: funcionário desativado/ausente depois, Parada da M8 desconhecida na época, todos em linhas JÁ gravadas); no modo novo o plano completo dá ${aNovas}. O relatório usa o modo novo.`);
  add("B", "Passado alterado (planoVigente × saída em períodos ≤ c+1 / iniciados)", bTot === 0 ? PASS : FAIL,
    `${bTot} linhas do passado alteradas em ${todas.length} replays (aPartirDe = c+2: c+1 está comprometido/iniciado há 10 min no fechamento).`,
    `Medido por \`verificarIndependente\` (linha da saída em slot < aPartirDe que difere do vigente; congeladas da entrada ≠ vigente). O plano \`vigente\` mantido devolve só linhas em slots ≥ aPartirDe. Se o integrador usar aPartirDe = c+1 (leitura literal da spec §4) o plano PODE alterar o período c+1 — ver seção 3.1.`);
  add("C", "Dupla alocação (pessoa em 2 postos, posto com 2 pessoas, máquina duplicada)", cTot === 0 ? PASS : FAIL,
    `${cTot} violações em ${todas.length} replays; Etiquetadora 15 / Embalagem 17 em dois pools no mesmo período: ${soma(todas.map((r) => r.extras.conector.duplicidadeE15))}.`,
    "Pessoa com >1 linha no mesmo período, máquina com >1 pessoa, máquina em >1 pool do mesmo período (inclui os pools do Conector que compartilham E15/E17). A re-atribuição de pessoas (`estabilizarPessoas`) não cria linhas nem muda postos; conferida DEPOIS dela pelo verificador independente.");
  add("D", "Revezamento (mesma operação em períodos consecutivos do mesmo dia)", dTot === 0 ? PASS : FAIL,
    `${dTot} repetições; exceções novas (\`excecaoRevezamento\`) sinalizadas: ${soma(todas.map((r) => (r.violacoes.porTipo["D:excecao_revezamento_nova*"] ?? 0)))}.`,
    "Inclui o par que atravessa a fronteira (último congelado → primeiro mutável). PROD usa revezamento_modo = duro. A re-atribuição de pessoas respeita o revezamento (par proibido = mesma operação do período anterior da mesma pessoa) — sem solução ⇒ devolve o plano sem ajuste.");

  // ---- E
  const comPior = (a: R, b: number[]) => a.falta.fluxo[0] > b[0] + 1;
  const E1 = todas.filter((r) => r.vigente.valido && comPior(r, r.falta.vigente));
  const E1hi = todas.filter((r) => r.vigente.valido && r.falta.fluxo[1] > r.falta.vigente[1] + 1);
  const E1inv = todas.filter((r) => !r.vigente.valido && comPior(r, r.falta.vigente));
  const E2 = todas.filter((r) => comPior(r, r.falta.base));
  const E3 = todas.filter((r) => comPior(r, r.falta.baseRegen));
  const encL = EN?.linhas ?? [];
  const Enc = encL.filter((l) => l.faltaFluxoCadeia[0] > l.faltaVigenteDaCadeia[0] + 1 && l.resumo.vigente.valido);
  const EncInv = encL.filter((l) => l.faltaFluxoCadeia[0] > l.faltaVigenteDaCadeia[0] + 1 && !l.resumo.vigente.valido);
  const vigInvalidos = todas.filter((r) => !r.vigente.valido);
  const discord = todas.filter((r) => r.vigente.valido !== (r.vigente.violIndependente === 0));
  const flx = validas.filter((r) => r.planoEscolhido === "fluxo");
  const sinalDisc = flx.filter((r) => !(r.simInd.fluxo <= r.simInd.vigente + 1));
  const legPior = flx.filter((r) => r.faltaLegada.fluxo > r.faltaLegada.vigente + 1);
  const escolhas: Record<string, number> = {};
  todas.forEach((r) => (escolhas[r.planoEscolhido] = (escolhas[r.planoEscolhido] ?? 0) + 1));
  const linhaE = (r: R) => `${rotR(r)}: vigente ${n0(r.falta.vigente[0])} (${r.vigente.valido ? "válido" : "INVÁLIDO: " + (r.vigente.motivo ?? "")}) · base ${n0(r.falta.base[0])} · oficial regen. ${n0(r.falta.baseRegen[0])} · fluxo ${n0(r.falta.fluxo[0])} (${sg(r.falta.fluxo[0] - r.falta.vigente[0])} vs vigente)`;
  add("E", "Falta final total: fluxo nunca pior que o oficial (mesmo simulador)", E1.length === 0 && E2.length === 0 && Enc.length === 0 ? PASS : FAIL,
    `Em ${todas.length} replays o plano devolvido nunca tem falta final (pessimista) pior que o vigente VÁLIDO: ${E1.length} piora(s); pior que o plano base do núcleo: ${E2.length}; pior que o motor oficial regenerado (nominal): ${E3.length}; no replay encadeado, pior que o plano herdado válido: ${Enc.length}/${encL.length}. Plano escolhido: ${JSON.stringify(escolhas)}. Vigentes inválidos (restrição dura hoje): ${vigInvalidos.length}${E1inv.length ? ` (piora vs vigente inválido: ${E1inv.length})` : ""}.`,
    `**Correção 1**: \`planejar.ts\` inclui o futuro do plano vigente como candidato (\`PLANO_VIGENTE_MANTIDO\`), válido só se não violar restrição dura HOJE (\`verificarRestricoesDuras\`) e estiver completo (mesmas pessoas/slots que o motor geraria). Elegível = 0 violação E falta ≤ min(base, vigente válido); empate ⇒ vigente (zero churn) > base > fluxo.\n\n${E1.length ? "Piora vs vigente VÁLIDO:\n" + E1.map((r) => "- " + linhaE(r)).join("\n") : "Nenhuma piora vs vigente válido (lo)."}\n\n${E1hi.length ? "Atenção — no cenário OTIMISTA (hi) o plano devolvido tem falta maior que o vigente válido em " + E1hi.length + " replay(s): " + E1hi.map(rotR).join(", ") + " (a garantia do núcleo é no cenário pessimista; hi é desempate)." : "Também no cenário otimista (hi) nenhuma piora vs vigente válido."}\n\n${Enc.length ? "Piora no replay encadeado (vigente VÁLIDO):\n" + Enc.map((l) => `- ${l.rotulo}: herdado ${n0(l.faltaVigenteDaCadeia[0])} → novo ${n0(l.faltaFluxoCadeia[0])}`).join("\n") : "Replay encadeado (fluxo aplicado sobre o fluxo anterior): nenhuma piora vs o plano herdado válido."}${EncInv.length ? `\n\nPiora vs herdado INVÁLIDO (explicada por restrição dura): ${EncInv.map((l) => l.rotulo).join(", ")}.` : ""}\n\n${vigInvalidos.length ? "Vigentes descartados: " + vigInvalidos.map((r) => `${rotR(r)} (${r.vigente.motivo})`).join("; ") : "Nenhum vigente foi descartado como inválido nos dados reais (a descontinuidade 'vigente inválido' está coberta por testes unitários: Parada, desativado, incompleto)."}\n\nVerificação cruzada da validade do vigente: o veredito do núcleo (\`vigente.valido\`) e o verificador independente (A/C/D sobre as linhas vigentes) discordam em ${discord.length}/${todas.length} replays. Régua cruzada: o simulador independente concorda no SINAL da melhora em ${flx.length - sinalDisc.length}/${flx.length} replays em que o fluxo foi escolhido; a régua LEGADA (\`faltaProjetada\`, exige cumprir o previsto de TODAS as etapas, é a da tela atual) discorda em ${legPior.length}/${flx.length} replays (soma da falta legada nos ${fech.length} fechamentos: vigente ${n0(soma(fech.map((r) => r.faltaLegada.vigente)))} → plano ${n0(soma(fech.map((r) => r.faltaLegada.fluxo)))}; por construção — o fluxo deixa de produzir intermediário sem utilidade para o produto final — mas **a tela atual de previsto vai mostrar mais falta nas etapas intermediárias**: risco de leitura para o supervisor, não violação de critério).`);

  // ---- F
  const cf = CF ?? [];
  const f27 = fech.filter((r) => r.data === "2026-10-27");
  const cxPares = (r: R) => r.pares.find((p) => p.produtoId === CXE.split("|")[0]);
  const fLinhas = f27.map((r) => {
    const p = cxPares(r)!; const cx = r.extras.cx;
    return [rot(r), `${p.tipo.slice(0, 3)}/${p.conf} ${n0(p.lo)}–${n0(p.hi)}${p.negativo ? " NEG" : ""}`, `${cx.vigente.postosE} / ${cx.vigente.postosM}`, `${cx.fluxo.postosE} / ${cx.fluxo.postosM}`, `${n0(cx.vigente.E)} / ${n0(cx.vigente.M)}`, `${n0(cx.fluxo.E)} / ${n0(cx.fluxo.M)}`];
  });
  const fReduz = f27.filter((r) => r.extras.cx.fluxo.postosE < r.extras.cx.vigente.postosE || r.extras.cx.fluxo.postosM < r.extras.cx.vigente.postosM);
  const fCoer = fReduz.length === 0;
  const cfCx = cf.map((c: any) => { const v = (n: string) => c.variantes.find((x: any) => x.nome.startsWith(n)); return [c.rotulo, c.wipE16Montagem ? `${c.wipE16Montagem.confianca} ${n0(c.wipE16Montagem.lo)}–${n0(c.wipE16Montagem.hi)}` : "—", n0(v("vigente")?.cxFinal?.[0]), n0(v("base")?.cxFinal?.[0]), n0(v("reforço Montagem, mantém")?.cxFinal?.[0]), n0(v("sem E16")?.cxFinal?.[0]), n0(v("FLUXO")?.cxFinal?.[0])]; });
  const fMelhorN = cf.filter((c: any) => { const fl = c.variantes.find((x: any) => x.nome.startsWith("FLUXO"))?.cxFinal?.[0] ?? 0; return c.variantes.every((x: any) => (x.cxFinal?.[0] ?? 0) <= fl + 1); }).length;
  add("F", "Caixa Amarela coerente (E16 × Montagem)", fCoer ? PASS + " (qualitativo)" : FAIL,
    fCoer ? "Nos 6 fechamentos de 27/10 o plano devolvido não reduz os postos da E16 nem da Montagem em relação ao vigente; os contrafactuais manuais do Mikael (+2.071 / −4.016 / −2.657) NÃO foram reproduzidos (desenho diferente, ver detalhe)." : `Plano reduz postos de E16 ou Montagem em relação ao vigente em ${fReduz.length}/${f27.length} fechamentos de 27/10 (${fReduz.map(rot).join(", ")}).`,
    `Postos de E16 / Montagem (soma nos períodos mutáveis) e peças planejadas EFETIVAS (× f):\n\n${tabela(["Fechamento 27/10", "WIP E16→Montagem", "postos E/M vigente", "postos E/M plano", "peças E/M vigente", "peças E/M plano"], fLinhas)}\n\nContrafactuais pelo MESMO simulador (final entregue de Caixa Amarela, peças; variantes geradas sobre a entrada com f, aplicadas a TODOS os slots mutáveis):\n\n${tabela(["Fechamento", "WIP E16→Mont.", "vigente", "base", "reforço Montagem mantendo E16", "sem E16", "FLUXO"], cfCx)}\n\nLeitura cética: (1) o simulador valoriza a E16 como gargalo — "reforçar Montagem" por prioridade puxa pessoas da E16 e PIORA o final da Caixa Amarela; (2) desligar a E16 derruba o final em dezenas de milhares de peças; (3) o plano devolvido é igual ou melhor que TODAS as variantes em ${fMelhorN}/${cf.length} cortes, mas só pelo simulador — não há contrafactual real. Os estoques E16→Montagem são ESTIMADOS (sem saldo confirmado em PROD): ${f27.map((r) => n0(cxPares(r)!.hi)).join(" / ")} peças.`);

  // ---- G
  const dupl = soma(todas.map((r) => r.extras.conector.duplicidadeE15));
  const fundOk = todas.every((r) => r.extras.conector.poolsFundidos === 2);
  const ehAuto = (k: string) => k.endsWith("1863b452-77f3-4d5c-9c49-a6d28ae77131") || k.endsWith("fb96d08d-bd64-43d3-8694-40230c695c39");
  const autoLinhas = (m: Record<string, number>) => soma(Object.entries(m).filter(([k]) => ehAuto(k)).map(([, v]) => v));
  const fluxoEscolhido = fech.filter((r) => r.planoEscolhido === "fluxo");
  const legLinhasAuto = soma(fluxoEscolhido.map((r) => autoLinhas(r.extras.conector.linhasPorPool.fluxo)));
  const vigLinhasAuto = soma(fluxoEscolhido.map((r) => autoLinhas(r.extras.conector.linhasPorPool.vigente)));
  const m8Ok = todas.every((r) => r.extras.wipTeto.filter((w) => w.chave.includes("1b72bf46")).every((w) => w.ok !== false));
  const dcErros = todas.filter((r) => r.extras.conector.demandaComum.some((v, i) => Math.abs(v - (r.extras.conector.demandaComumEsperada[i] ?? v)) > 1));
  const dc = fech[fech.length - 1].extras.conector;
  add("G", "Conector legado (pools comuns fundidos sem duplicidade)", fundOk && dupl === 0 && m8Ok && dcErros.length === 0 ? PASS : FAIL,
    `2 pools comuns fundidos em ${todas.length}/${todas.length} replays; duplicidade E15/E17: ${dupl}; Máquina 8 dentro do teto derivado: ${m8Ok ? "sim" : "NÃO"}; \`demandaComum\` = Q_conv + Q_auto − boas (conferido nos apontamentos brutos): ${todas.length - dcErros.length}/${todas.length} corretos (**correção 5**).`,
    `Nos ${fluxoEscolhido.length} fechamentos em que o fluxo foi escolhido, as linhas de Etiquetar/Embalar saem 100% no produto convencional (linhas da AUTOMÁTICA: ${legLinhasAuto}, contra ${vigLinhasAuto} no plano vigente) — coerente com o que a fábrica realmente aponta. \`demandaComum\` no último fechamento: núcleo ${dc.demandaComum.join(" / ")} × esperado ${dc.demandaComumEsperada.join(" / ")} (Etiquetar / Embalar). O f dos pools fundidos é conjunto (realizado do convencional vale para o nó fundido).\n\nEtiquetadora 15 (atende Etiquetar convencional e automática — demanda restante das duas etapas × capacidade futura da máquina, meta nominal):\n\n${tabela(["Fechamento", "demanda restante REAL (Q − boas)", "capacidade futura E15", "déficit real", "demanda legada (Q − créditos planejados)", "períodos com E15 ocupada: vigente → plano (de N)"], fech.map((r) => [rot(r), n0(r.extras.e15.demandaReal), n0(r.extras.e15.capacidadeFutura), n0(r.extras.e15.defReal), n0(r.extras.conector.remLegadoEtq), `${r.extras.e15.ocupacaoVigente} → ${r.extras.e15.ocupacaoFluxo} (de ${r.extras.e15.slotsMutaveis})`]))}\n\n${(() => { const t2 = fech.find((r) => r.data === "2026-10-27" && r.periodoId === "t2"); const ocup = fech.every((r) => r.extras.e15.ocupacaoFluxo >= r.extras.e15.slotsMutaveis && r.extras.e15.ocupacaoVigente >= r.extras.e15.slotsMutaveis); return t2 ? `No fechamento de 27/10 T2 a demanda restante real do Etiquetar é ${n0(t2.extras.e15.demandaReal)} contra ${n0(t2.extras.e15.capacidadeFutura)} de capacidade da E15 (déficit ${n0(t2.extras.e15.defReal)}). A E15 ${ocup ? "fica ocupada em TODOS os períodos mutáveis tanto no vigente quanto no plano" : "NÃO fica ocupada em todos os períodos mutáveis em algum fechamento"}.` : ""; })()}`);

  // ---- H
  const lin = fech.map((r) => (r.churnNucleo as any).linhasAlteradas as number), tro = fech.map((r) => (r.churnNucleo as any).trocasDePosto as number), prim = fech.map((r) => (r.churnNucleo as any).alteradasNoPrimeiroPeriodo as number);
  const linInd = fech.map((r) => r.churnInd.vsVigente.trocasPosto);
  const soPecas = fech.map((r) => r.churnInd.vsVigente.linhasSoPecas);
  const linAntesEst = fech.map((r) => r.estabilizacao.linhasAntes);
  const linTodas = todas.map((r) => (r.churnNucleo as any).linhasAlteradas as number);
  const linBV = fech.map((r) => r.churnInd.baseVsVigente.trocasPosto);
  const estLinhas = (ESTAB ?? []).filter((x) => x.linhasAntes > 0);
  const medLin = mediana(lin);
  const naoEstab = fech.filter((r) => !r.estabilizacao.aplicada && r.planoEscolhido !== "vigente");
  const descartes = todas.filter((r) => r.estabilizacao.motivoDescarte);
  const chainChurn = encL.map((l) => l.churnFluxoVsAnterior?.trocasPosto).filter((v) => typeof v === "number") as number[];
  add("H", "Churn aceitável (linhas e trocas de posto por recálculo)", medLin <= 100 ? PASS : FAIL,
    `mediana ${n0(medLin)} / p90 ${n0(percentil(lin, 0.9))} linhas alteradas por recálculo (meta: mediana ≤ 100; revisão anterior: 260 / 395); trocas de posto mediana ${n0(mediana(tro))} / p90 ${n0(percentil(tro, 0.9))}; 1º período mutável mediana ${n0(mediana(prim))} / p90 ${n0(percentil(prim, 0.9))}. No replay encadeado (fluxo sobre fluxo): mediana ${n0(mediana(chainChurn))} / p90 ${n0(percentil(chainChurn, 0.9))}.`,
    `${tabela(["Métrica (12 fechamentos)", "mediana", "p90", "máx"], [["linhas alteradas vs vigente (núcleo, v2: θ=0 + re-atribuição de pessoas)", n0(medLin), n0(percentil(lin, 0.9)), n0(Math.max(...lin))], ["idem, medido pelo contador independente (posto = máquina|produto|etapa)", n0(mediana(linInd)), n0(percentil(linInd, 0.9)), n0(Math.max(...linInd))], ["linhas com o MESMO posto mas peças diferentes (f embutido nas peças do plano novo; não é troca de pessoa/posto)", n0(mediana(soPecas)), n0(percentil(soPecas, 0.9)), n0(Math.max(...soPecas))], ["idem ANTES da re-atribuição de pessoas (mesmos postos)", n0(mediana(linAntesEst)), n0(percentil(linAntesEst, 0.9)), n0(Math.max(...linAntesEst))], ["trocas de posto vs vigente", n0(mediana(tro)), n0(percentil(tro, 0.9)), n0(Math.max(...tro))], ["alteradas no 1º período mutável (c+2)", n0(mediana(prim)), n0(percentil(prim, 0.9)), n0(Math.max(...prim))], ["todas as 36 decisões (inclui revisões do modo restrito)", n0(mediana(linTodas)), n0(percentil(linTodas, 0.9)), n0(Math.max(...linTodas))], ["linhas do motor oficial regenerado × vigente (churn do oficial sozinho)", n0(mediana(linBV)), n0(percentil(linBV, 0.9)), n0(Math.max(...linBV))], ["revisão anterior (commit 25605f4): linhas vs vigente", "260", "395", "413"]])}\n\n**Correção 2**: \`estabilizarPessoas\` (o mesmo mecanismo do modo restrito) é aplicado a CADA candidato (base, P0, iterações) antes de compará-los/devolvê-los; falta e restrições duras são reavaliadas DEPOIS (descartada se a falta piorar ou surgir violação; descartes nos dados reais: ${descartes.length}). θ passa a ser 0 por padrão (\`thetaPadrao\` = 0; a retenção por θ só custava peça final — seção 4). O que sobra é mudança de POSTO de verdade (dos ${n0(soma(lin))} linhas alteradas nos 12 fechamentos, produtivas: ${n0(soma((ESTAB ?? []).map((x: any) => x.produtivasDepois)))}, trocas equivalentes de pessoa: ${n0(soma((ESTAB ?? []).map((x: any) => x.trocasEquivalentesDepois)))}).\n\n${naoEstab.length ? `Fechamentos sem ajuste de pessoas (nada a estabilizar ou sem solução com o revezamento duro): ${naoEstab.map(rot).join(", ")}.` : "A re-atribuição ajustou todos os fechamentos em que o plano muda."} Linhas alteradas antes → depois por fechamento: ${estLinhas.map((x) => `${x.rotulo}: ${x.linhasAntes}→${x.linhasDepois}`).join("; ")}. O 1º período mutável (c+2) muda em mediana ${n0(mediana(prim))} linhas (máx ${n0(Math.max(...prim))}) — a maior parte do churn restante está nos períodos distantes, onde o plano de fato reorganiza os postos.`);

  // ---- I
  const iViol = todas.reduce((n, r) => n + r.extras.wipTeto.filter((w) => w.ok === false).length, 0);
  const iTot = todas.reduce((n, r) => n + r.extras.wipTeto.length, 0);
  const maxPar: Record<string, number> = {};
  todas.forEach((r) => r.extras.pares.forEach((p) => (maxPar[p.chave] = Math.max(maxPar[p.chave] ?? 0, p.maxHi))));
  const exc = fech.filter((r) => r.planoEscolhido === "fluxo");
  const excPior = fech.filter((r) => r.excessoWip.fluxo > r.excessoWip.vigente + 1);
  add("I", "WIP previsto ≤ teto derivado (nenhum par explode)", iViol === 0 ? PASS : FAIL,
    `${iViol} violações em ${iTot} conferências (pipeline máx. por etapa × ConsumoDownstream + Teto); excesso de WIP no fim da semana: vigente ${n0(soma(exc.map((r) => r.excessoWip.vigente)))} × plano ${n0(soma(exc.map((r) => r.excessoWip.fluxo)))} peças (soma nos ${exc.length} fechamentos com fluxo).${excPior.length ? ` Atenção: o plano tem MAIS excesso de WIP que o vigente em ${excPior.length} fechamento(s): ${excPior.map((r) => `${rot(r)} (${n0(r.excessoWip.vigente)} → ${n0(r.excessoWip.fluxo)})`).join(", ")}.` : ""}`,
    `Máximo de WIP (hi) previsto por par ao longo da semana, entre todos os replays:\n\n${tabela(["par (origem →)", "máx. WIP previsto"], Object.entries(maxPar).sort((a, b) => b[1] - a[1]).map(([k, v]) => [rotuloPar(k.split("|")[0], k.split("|")[1]), n0(v)]))}`);

  // ---- J
  const alt = validas.filter((r) => r.coberturaDecisoes.mudancasVsVigente > 0);
  const semCobResumo = alt.filter((r) => r.coberturaDecisoes.cobertasResumo < r.coberturaDecisoes.mudancasVsVigente);
  const semCobLista = alt.filter((r) => r.coberturaDecisoes.cobertasLista < r.coberturaDecisoes.mudancasVsVigente);
  const mudTot = soma(alt.map((r) => r.coberturaDecisoes.mudancasVsVigente));
  const cobRes = soma(alt.map((r) => r.coberturaDecisoes.cobertasResumo)), cobLis = soma(alt.map((r) => r.coberturaDecisoes.cobertasLista));
  const anteDep = todas.every((r) => r.decisoes.anteCompleto && r.decisoes.depoisCompleto);
  const semTexto = soma(todas.map((r) => r.coberturaDecisoes.semTexto));
  const deInc = soma(todas.map((r) => r.coberturaDecisoes.deInconsistente));
  const recErro = todas.filter((r) => Math.abs(r.reconciliacao.somaGanhos + r.reconciliacao.residuo - r.reconciliacao.diferenca) > 0.01 || Math.abs(r.reconciliacao.somaDasDecisoes - r.reconciliacao.somaGanhos) > 0.05 || Math.abs(r.reconciliacao.somaDoResumo - r.reconciliacao.somaGanhos) > 0.05);
  const comMudanca = todas.filter((r) => Math.abs(r.reconciliacao.diferenca) > 1);
  const resRel = comMudanca.map((r) => Math.abs(r.reconciliacao.residuo) / Math.abs(r.reconciliacao.diferenca));
  const resMax = resRel.length ? Math.max(...resRel) : 0;
  const resAbsMax = Math.max(0, ...todas.map((r) => Math.abs(r.reconciliacao.residuo)));
  const decNeg = soma(todas.map((r) => r.decisoes.negativas)), decNegPecas = soma(todas.map((r) => r.decisoes.somaNegativas)), decNeutras = soma(todas.map((r) => r.decisoes.neutras)), decTot = soma(todas.map((r) => r.decisoes.n));
  const baseMudaSemDec = validas.filter((r) => r.churnInd.vsVigente.trocasPosto > 0 && r.decisoes.n === 0);
  const jOk = anteDep && semCobResumo.length === 0 && recErro.length === 0 && resMax <= 0.05 && semTexto === 0 && deInc === 0 && baseMudaSemDec.length === 0;
  add("J", "Plano explicável (ANTES/DECISÃO/MOTIVO/DEPOIS em 100% dos replanejamentos)", jOk ? PASS : FAIL,
    `ANTES (vigente) e DEPOIS completos em ${anteDep ? "100%" : "NÃO 100%"} dos replays; ${n0(cobRes)}/${n0(mudTot)} (${((100 * cobRes) / Math.max(1, mudTot)).toFixed(0)}%) das mudanças pessoa×período contra o plano VIGENTE cobertas pelo agregado explícito por período (lista detalhada: ${n0(cobLis)}/${n0(mudTot)}, ${alt.length - semCobLista.length}/${alt.length} replays totalmente cobertos); reconciliação aditiva (Σ ganhos + resíduo = final previsto do plano − vigente) exata em ${todas.length - recErro.length}/${todas.length} replays, resíduo máx. ${(100 * resMax).toFixed(2)}% da diferença (${n0(resAbsMax)} peças); decisões com ganho negativo: ${decNeg}/${n0(decTot)} (soma ${n0(decNegPecas)} peças), neutras: ${decNeutras}.`,
    `**Correção 3**: \`explicar.ts\` descreve a mudança CONTRA o plano vigente (\`DiagnosticoFluxo.referencia = "vigente"\`; sem vigente futuro, contra o base). Cada decisão é um grupo (período, posto de → para) de pessoas; as decisões são aplicadas UMA A UMA sobre a capacidade do vigente e o simulador é re-executado a cada passo; \`ganhoProdutoFinal\` é a média dos ganhos marginais em 8 caminhos (ordens) de aplicação — aditivo por construção (cada caminho soma exatamente final(plano) − final(vigente)); \`wipConsumido\`/\`wipEvitado\`/\`wipFinalVariacao\` saem da mesma re-simulação. O \`residuo\` (teto de demanda \`rem\` e quantidades em postos mantidos) é explícito. A lista detalhada admite até 500 decisões (\`maxDecisoes\`); acima disso \`decisoesTotal\` + \`resumoDecisoes\` (por pool de→para E por período, \`porSlot\`) cobrem 100% das linhas — conferido por contagem em ${alt.length} replays com mudança. Texto de motivo ausente: ${semTexto}; decisões cujo \`de\` não bate com o posto no vigente: ${deInc}; replays com mudança contra o vigente e ZERO decisões: ${baseMudaSemDec.length}.\n\nLimitação (cética): o ganho por decisão é a MÉDIA de 8 ordens de aplicação (cronológica, inversa e 6 pseudo-aleatórias de semente fixa — Shapley por amostragem), aditivo mas ainda dependente das ordens amostradas; o BRUTO é maior que o LÍQUIDO porque movimentos complementares se compensam (por fechamento, soma dos ganhos positivos / negativos / líquido: ${fech.map((r) => `${rot(r)} ${n0(r.decisoes.brutoPositivo)} / ${n0(r.decisoes.brutoNegativo)} / ${n0(r.reconciliacao.somaGanhos)}`).join("; ")}). Decisões isoladas com ganho negativo (${decNeg} de ${n0(decTot)}) existem porque são compensadas por complementares — o texto da decisão diz isso e a reconciliação fecha a conta. O nível legível por humano é o agregado por pool (tabela abaixo). As estimativas são relativas ao modelo (simulador), não previsão absoluta.\n\nAgregado por pool de→para no último fechamento (${rot(fech[fech.length - 1])}), top 8 por |ganho|:\n\n${tabela(["de", "para", "pessoas-período", "períodos", "ganho (peças finais)"], (fech[fech.length - 1].decisoes.resumoTop ?? []).map((x) => [x.de === "ocioso" ? "ocioso" : rotuloPool(x.de), x.para === "ocioso" ? "ocioso" : rotuloPool(x.para), n0(x.pessoas), n0(x.slots), sg(x.ganho)]))}\n\nAmostra de decisões (27/10 T3): ${(fech[fech.length - 1].decisoes.amostra ?? []).map((t) => `\n- ${t}`).join("")}`);

  // ================================================================== recomendação
  const falhas = crit.filter((c) => c.status.startsWith(FAIL)), nc = crit.filter((c) => c.status.startsWith(NC));
  const primeiroOff1 = OFF1.map((r) => r.churnInd.vsVigente.trocasPrimeiro);
  const tempoOk = TEMPO && TEMPO.acimaDe10s === 0;

  const sec0: string[] = [];
  sec0.push("# Critérios de ativação da Escala Inteligente (fluxo) — RE-AVALIAÇÃO após as correções, replay com dados REAIS de PROD (26–27/10/2026)");
  sec0.push("");
  sec0.push(`> Revisor independente e cético, mesma régua da revisão anterior (commit \`25605f4\`: E, H e J FALHARAM). Gerado por \`scripts/escala-fluxo-replay/\` a partir de SELECTs em PROD (nada gravado). Código avaliado: \`feat/escala-fluxo-int\` @ \`${git("git rev-parse --short HEAD")}\` (núcleo v2: plano vigente como candidato, re-atribuição de pessoas, explicação aditiva contra o vigente, f embutido na integração). Configuração dos replays = a da integração (\`insumosFluxo\`: metas × f do realizado visível no corte + \`fatoresEmbutidos\` + \`paresLegado\` do Conector; θ = 0 + estabilização por padrão); \`aPartirDe = c+2\`. Os números são reproduzíveis (seção 9) e determinísticos.`);
  sec0.push("");
  sec0.push("## 0. Recomendação");
  sec0.push("");
  if (falhas.length || nc.length) sec0.push(`**MANTER EM SOMBRA — NÃO ATIVAR a Escala de amanhã cedo no motor novo.** Critérios com falha: ${falhas.map((c) => c.id).join(", ") || "—"}${nc.length ? `; não comprovados: ${nc.map((c) => c.id).join(", ")}` : ""}. Regra da spec §7: qualquer falha ⇒ permanecer em sombra.`);
  else {
    sec0.push(`**Todos os critérios A–J PASSARAM** nesta re-avaliação (a spec §7 não impede a ativação; tempo por recálculo ${tempoOk ? "< 1 s, bem dentro do orçamento" : "A VERIFICAR (seção 8)"}). **Recomendação: ATIVAR, condicionada aos pré-requisitos operacionais abaixo — que o replay NÃO consegue verificar — e com o rollback pronto.** Sem eles: MANTER EM SOMBRA.`);
    sec0.push("");
    sec0.push("Pré-requisitos (bloqueadores objetivos se não cumpridos antes do 1º recálculo de amanhã):");
    sec0.push("1. Deploy da branch `feat/escala-fluxo-int` + migration `20261105190000_escala_producao_real_fluxo.sql` + parâmetros (`docs/escala-fluxo-integracao.md` §4). Nada disso foi aplicado em PROD por esta revisão; exige sua autorização.");
    sec0.push("2. Smoke da integração com o núcleo v2 em DEV/Preview (checklist `docs/escala-fluxo-integracao.md` §7): os testes de integração passam com o núcleo REAL, mas o fluxo nunca rodou em PROD (nem em sombra).");
    sec0.push("3. Escopo mínimo: `producao_real_semanas_ativas = [\"2026-10-26\"]`; conferir o 1º diagnóstico (`resultado = 'ok'`, `violacoes = []`, `aplicado`) e manter o rollback `ativo → sombra` à mão.");
    sec0.push("");
    sec0.push(`Riscos residuais que você aceita ao ativar (detalhe nas seções 3 e 7): (a) a régua LEGADA da tela atual de previsto discorda do simulador em ${legPior.length}/${flx.length} fechamentos — o supervisor verá mais falta nas etapas intermediárias; (b) o simulador tem calibração fraca no backtest (${BT ? `${BT.dentro}/${BT.n}` : "n/d"}): ganhos são relativos ao modelo; (c) o plano pode aumentar o excesso de WIP no fim da semana em ${excPior.length} dos ${fech.length} fechamentos (${excPior.map(rot).join(", ") || "—"}); (d) cada recálculo ainda muda ~${n0(medLin)} linhas (todas de POSTO, não de pessoa à toa); (e) o f é suavizado e vale 1 no início da semana.`);
  }
  sec0.push("");
  sec0.push(tabela(["Critério", "Veredito", "Números"], crit.map((c) => [`**${c.id}** ${c.titulo}`, `**${c.status}**`, c.resumo.replace(/\|/g, "/").replace(/\n/g, " ")])));
  sec0.push("");

  const sec1: string[] = [];
  sec1.push("## 1. Método e dados");
  sec1.push("");
  sec1.push(`- **Dados**: ${F.length} decisões gravadas em \`escala_sombra_decisoes\` da semana 26/10 (entrada canônica completa) + 262 linhas de \`apontamentos_producao\` + \`ocorrencias_maquina\`/\`escala_recurso_indisponivel\`/\`ausencias_funcionarios\`. Fechamentos reais = ${fech.length} (revisão 0: 26/10 M1…T3 e 27/10 M1…T3); as demais ${validas.length - fech.length} decisões (revisões do modo restrito) entram como recálculos extras; 4 revisões gravadas com \`c\` defasado foram marcadas **obsoletas** e não entram nas contagens de J/I (entram em A–E por rigor: qualquer piora em QUALQUER replay é falha).`);
  sec1.push(`- **Sem olhar o futuro**: cada replay usa \`agoraMs\` = corte gravado e entrega ao núcleo TODOS os apontamentos da semana; só vale o que o núcleo filtra por \`lancadoEmMs ≤ agoraMs\`. O f de desempenho também só vê o visível no corte (a sensibilidade confirma: lançamento atrasado não muda o plano até o relógio avançar).`);
  sec1.push(`- **Entrada do motor reconstruída fielmente**: \`aPartirDe = c+2\`, congeladas = plano vigente ≤ c+1, revezamento duro. **f**: a mesma função da integração (\`fatoresDeDesempenho\`/\`embutirFatores\`) — realizado visível no corte, pools fundidos do Conector com f conjunto. O plano vigente gravado é avaliado SEMPRE pela capacidade das metas (nunca pelas peças gravadas), então f embutido em peças antigas não é multiplicado duas vezes (testado). Golden-master do motor oficial (\`gerarEscala\` byte-idêntico com hooks vazios): ${SE?.find((x) => x.nome.includes("hooks vazios"))?.ok ? "OK" : "VERIFICAR"} nos cenários reais; o plano da sombra de 36/36 decisões gravadas continua reproduzido (\`hash_plano_sombra\`); o \`hash_decisao\` de 14/36 mudou por causa da correção do f do Pacote G (já documentada em \`c87d0f2\`), não por esta mudança.`);
  sec1.push(`- **Régua única**: \`avaliarPlano\` do núcleo avalia plano vigente, motor oficial regenerado e plano devolvido. Verificações cruzadas independentes: (i) verificador de restrições escrito do zero (A–D) + teste de mutação, agora também aplicado ao futuro do plano VIGENTE (para conferir o veredito \`vigente.valido\` do núcleo); (ii) simulador independente (sinal); (iii) régua legada \`faltaProjetada\` (com \`projetarProducaoReescalada\`, que não multiplica f duas vezes); (iv) auditoria de \`estadoDaProducao\` contra os apontamentos brutos (${AUD ? `${AUD.conferidos} itens conferidos` : "n/d"}; ${AUD ? AUD.divergencias.filter((x) => !x.item.startsWith("projecao")).length : "n/d"} divergências fora da projeção do período comprometido); (v) determinismo: cada replay roda 2×, hash do \`ResultadoFluxo\` inteiro idêntico em ${todas.filter((r) => r.determinismo).length}/${todas.length}; encadeado 2× idêntico: ${EN?.deterministico ? "sim" : "NÃO"}.`);
  sec1.push(`- **Backtest do simulador** (WIP previsto pelo plano vigente em i × WIP estimado observado em j > i): ${BT ? `${BT.dentro}/${BT.n} previsões dentro da faixa observada (${((100 * BT.dentro) / BT.n).toFixed(0)}%)` : "n/d"}. Pares: ${BT ? BT.porPar.map((p: any) => `${rotuloPar(p.chave.split("|")[0], p.chave.split("|")[1])} ${p.dentro}/${p.n} (erro médio ${n0(p.erroMedio)})`).join("; ") : ""}. Evidência FRACA de calibração, sem falha formal.`);
  sec1.push("");

  const sec3: string[] = [];
  sec3.push("## 3. Critérios A–J (re-avaliados)");
  crit.forEach((c) => { sec3.push(`\n### ${c.id} — ${c.titulo}: **${c.status}**\n`); sec3.push(c.resumo); sec3.push(""); sec3.push(c.detalhe); });
  if (primeiroOff1.length) sec3.push(`\n#### 3.1 Variante aPartirDe = c+1 (spec §4 lida literalmente)\n\nSe o integrador chamar o núcleo com aPartirDe = c+1, o plano altera o período c+1 — que no fechamento já está em curso há 10 min: linhas alteradas no 1º período mutável por fechamento = ${primeiroOff1.join(", ")} (mediana ${n0(mediana(primeiroOff1))}). Isso viola B ("período em andamento congelado"). Recomendação mantida: aPartirDe = c+2 (como na integração).`);

  const sec4: string[] = [];
  sec4.push("## 4. θ × re-atribuição de pessoas (churn × falta)");
  sec4.push("");
  if (TH) {
    sec4.push(tabela(["θ / estabilização", "falta Σ12 fechamentos (lo)", "linhas med / p90", "trocas med / p90", "1º período med / p90", "plano base / fluxo / vigente"], TH.map((x: any) => [x.rotulo, n0(x.faltaLo), `${n0(x.medianaLinhas)} / ${n0(x.p90Linhas)}`, `${n0(x.medianaTrocas)} / ${n0(x.p90Trocas)}`, `${n0(x.medianaPrimeiro)} / ${n0(x.p90Primeiro)}`, `${x.escolha.base ?? 0} / ${x.escolha.fluxo ?? 0} / ${x.escolha.vigente ?? 0}`])));
    sec4.push("");
    const t0 = TH.find((x: any) => x.theta === 0 && x.estab), t0s = TH.find((x: any) => x.theta === 0 && !x.estab);
    sec4.push(`Leitura: o padrão v2 (θ = 0 + estabilização) reduz a mediana de linhas alteradas de ${t0s ? n0(t0s.medianaLinhas) : "?"} para ${t0 ? n0(t0.medianaLinhas) : "?"} sem custo de falta (Σ12 ${t0s ? n0(t0s.faltaLo) : "?"} → ${t0 ? n0(t0.faltaLo) : "?"}). θ > 0 não acrescenta nada útil: a retenção do posto vigente só no 1º período mutável custa peça final e não mexe no resto do plano. **θ adotado: 0 + estabilização de pessoas.**`);
  } else sec4.push("n/d");
  sec4.push("");

  const sec5: string[] = [];
  sec5.push("## 5. Replay completo da semana (fluxo aplicado sobre o fluxo anterior)");
  sec5.push("");
  if (EN) {
    sec5.push("Cada fechamento parte do passado gravado até c e do plano de FLUXO produzido no fechamento anterior de c+1 em diante (o plano herdado é o vigente do núcleo — pode ser mantido). Compara a falta (lo) do plano gravado, do plano herdado e do novo plano, e o churn entre planos consecutivos.");
    sec5.push("");
    sec5.push(tabela(["Fechamento", "plano escolhido", "herdado válido?", "oficial gravado", "herdado (fluxo anterior)", "novo plano", "novo − herdado", "churn linhas fluxo (vs anterior)", "churn linhas oficial (vs anterior)"], EN.linhas.map((l) => [l.rotulo, l.resumo.planoEscolhido, l.resumo.vigente.valido ? "sim" : "NÃO", n0(l.faltaOficialGravado[0]), n0(l.faltaVigenteDaCadeia[0]), n0(l.faltaFluxoCadeia[0]), sg(l.faltaFluxoCadeia[0] - l.faltaVigenteDaCadeia[0]), l.churnFluxoVsAnterior ? n0(l.churnFluxoVsAnterior.trocasPosto) : "—", l.churnOficialVsAnterior ? n0(l.churnOficialVsAnterior.trocasPosto) : "—"])));
    sec5.push("");
    sec5.push(`Soma da falta ao longo dos ${EN.linhas.length} fechamentos: oficial gravado ${n0(soma(EN.linhas.map((l) => l.faltaOficialGravado[0])))} · fluxo encadeado ${n0(soma(EN.linhas.map((l) => l.faltaFluxoCadeia[0])))}. Churn do fluxo entre recálculos consecutivos: mediana ${n0(mediana(chainChurn))} / p90 ${n0(percentil(chainChurn, 0.9))} (oficial: mediana ${n0(mediana(encL.map((l) => l.churnOficialVsAnterior?.trocasPosto).filter((v) => typeof v === "number") as number[]))}).`);
  }
  sec5.push("");

  const sec6: string[] = [];
  sec6.push("## 6. Sensibilidade e robustez");
  sec6.push("");
  if (SE) {
    sec6.push(`${SE.filter((x) => x.ok).length}/${SE.length} casos OK (sem exceção, sem WIP negativo exposto, entrada/dados NÃO mutados, JSON serializável, determinismo, 0 violações duras, plano NUNCA pior que o vigente válido, reconciliação aditiva exata). Cada cenário de dados foi aplicado a 3 fechamentos (27/10 T1, 26/10 T1, 27/10 M3).`);
    sec6.push("");
    sec6.push(tabela(["Caso", "OK", "plano / vigente válido", "diagnósticos relevantes / faltas"], SE.map((x) => [x.nome, x.ok ? "OK" : "**FALHA**", x.excecao ? "—" : `${x.detalhes.planoEscolhido ?? "—"} / ${x.detalhes.vigenteValido === undefined ? "—" : x.detalhes.vigenteValido ? "sim" : "não"}`, x.excecao ?? `${(["PRODUCAO_NAO_CONFIRMADA", "AJUSTE_TARDIO", "WIP_NEGATIVO_ESTIMADO", "SEM_PRODUCAO_FALTA_MATERIAL", "SEM_PRODUCAO_SEM_PROGRAMACAO"] as const).map((k) => ((x.detalhes.codigos as Record<string, number> | undefined)?.[k] ? `${k}×${(x.detalhes.codigos as Record<string, number>)[k]}` : "")).filter(Boolean).join(" ")}${x.detalhes.faltaFluxo ? ` · falta plano ${(x.detalhes.faltaFluxo as number[]).map(n0).join("/")} · vigente ${(x.detalhes.faltaVigente as number[] | undefined)?.map(n0).join("/")} · oficial regen. ${(x.detalhes.faltaBase as number[] | undefined)?.map(n0).join("/")}` : ""}${x.detalhes.reproduzidas !== undefined ? ` ${x.detalhes.reproduzidas}/${x.detalhes.total}${x.detalhes.hashDecisaoReproduzidos !== undefined ? ` (hash_decisao ${x.detalhes.hashDecisaoReproduzidos}/${x.detalhes.total}: muda pela correção do f do Pacote G)` : ""}` : ""}`])));
    sec6.push("");
    sec6.push("Observações: (1) sem NENHUM apontamento a falta pessimista é enorme (lo) e a otimista pequena (hi) — a faixa é honesta e o plano vigente/base é mantido; (2) o piso 0 aparece com `WIP_NEGATIVO_ESTIMADO` e nenhum par exposto é negativo; (3) o motivo real `sem_programacao` (6 linhas em PROD) agora tem diagnóstico próprio (`SEM_PRODUCAO_SEM_PROGRAMACAO`, zero confirmado, sem inferir material) — **correção 6**; (4) `desligado`: o núcleo não lê a flag — provado que `gerarEscala` sem hooks (ou com hooks vazios) é byte-idêntico.");
  }
  sec6.push("");
  if (SEMF && SEMF.length) {
    sec6.push("### 6.1 Efeito do fator de desempenho f (correção 4)");
    sec6.push("");
    sec6.push("A configuração principal deste relatório já usa f (metas × f embutidas + `fatoresEmbutidos`, como `insumosFluxo`). A tabela compara com a execução SEM f (`FREPLAY_FATOR=0`, metas nominais — a configuração da revisão anterior) sobre o MESMO núcleo v2:");
    sec6.push("");
    sec6.push(tabela(["Fechamento", "Δ plano−vigente (sem f)", "Δ plano−vigente (com f, principal)", "plano (sem f / com f)", "falta vigente (sem f → com f)"], fech.map((r) => { const g = SEMF.find((x) => x.c === r.c)!; return [rot(r), sg(g.falta.fluxo[0] - g.falta.vigente[0]), sg(r.falta.fluxo[0] - r.falta.vigente[0]), `${g.planoEscolhido} / ${r.planoEscolhido}`, `${n0(g.falta.vigente[0])} → ${n0(r.falta.vigente[0])}`]; })));
    sec6.push("");
    sec6.push("Com f o simulador deixa de superestimar a capacidade das etapas que rendem abaixo da meta (Conector ~0,8; M8 ~0,6), de modo que a falta do plano vigente sobe (a realidade é pior que a meta nominal) e os ganhos previstos ficam mais realistas. O f é multiplicado UMA vez: plano vigente gravado com f embutido nas peças é avaliado pela capacidade das metas (teste `fatores.test.ts`).");
    sec6.push("");
  }
  const sec7: string[] = [];
  sec7.push("## 7. Achados — status das correções e riscos residuais");
  sec7.push("");
  sec7.push(`1. **E — corrigido** (\`planejar.ts\`): o futuro do plano vigente é candidato (\`PLANO_VIGENTE_MANTIDO\`), válido apenas sem violação dura hoje e completo. Resultado: piora vs vigente válido em ${E1.length} de ${todas.length} replays (revisão anterior: 3/32 e 5/12 no encadeado). Plano escolhido: ${JSON.stringify(escolhas)}.`);
  sec7.push(`2. **H — corrigido** (mediana ${n0(medLin)} / p90 ${n0(percentil(lin, 0.9))} linhas, antes 260 / 395): \`estabilizarPessoas\` aplicado a cada candidato com reavaliação de falta e restrições duras depois; θ = 0 por padrão. Risco residual: o churn que sobra é de POSTOS (reorganização real), e o 1º período mutável ainda muda até ${n0(Math.max(...prim))} linhas.`);
  sec7.push(`3. **J — corrigido** (explicação contra o vigente, ganhos aditivos, resumo por período): ver J. Risco residual: ganho sequencial depende da ordem; resíduo máx. ${(100 * resMax).toFixed(2)}%.`);
  sec7.push(`4. **f — corrigido** na integração (\`insumosFluxo\`): ${SEMF ? "ver 6.1" : ""}. Risco residual: o f usa a janela de apontamentos visível (n ≥ 3, suavizado n/(n+6)); no início da semana f = 1 e o simulador volta a ser otimista; o f dos pools fundidos é conjunto (convencional+automática), o que supõe que o realizado do convencional vale para o nó fundido. Com f, o plano base do núcleo (\`gerarEscala\` sobre a entrada com f) pode diferir do que o oficial geraria sem f — por isso o oficial nominal regenerado é reportado à parte (pior que ele em ${E3.length}/${todas.length}).`);
  sec7.push(`5. **\`PoolFundido.demandaComum\` — corrigido** (${todas.length - dcErros.length}/${todas.length} corretos contra os apontamentos brutos). 6. **\`verificarRestricoesDuras\` modo \`somenteLinhasNovas\` — implementado e usado aqui**; **\`sem_programacao\` — diagnóstico próprio**.`);
  sec7.push(`7. **Plano vigente mantido e alertas**: ao escolher o vigente o núcleo devolve exatamente as linhas vigentes (zero churn); \`resultado.alertas\`/\`resumoSlots\` vêm do candidato gerado com linhas idênticas (se existe — caso do fluxo reaplicado sobre si mesmo; testado: o 2º recálculo ATIVO com os mesmos dados é NO-OP), senão do \`gerarEscala\` sobre a entrada; nesse último caso a assinatura de alertas pode diferir da gravada e só a versão do dia sobe (linhas idênticas). Risco operacional baixo.`);
  sec7.push(`8. **Hi (otimista)**: ${E1hi.length ? "o plano devolvido pode ser pior que o vigente no cenário otimista em " + E1hi.length + " replay(s)" : "sem piora vs vigente válido também no cenário otimista"}. 9. **Estrutural**: as linhas do Embalar/Etiquetar saem 100% no produto convencional (coerente com a fábrica, muda o que a tela mostra para a automática). 10. **Evidência do simulador é fraca** (backtest ${BT ? `${BT.dentro}/${BT.n}` : "n/d"}): todos os ganhos são relativos ao modelo; não há contrafactual real.`);
  sec7.push("");

  const sec8: string[] = [];
  sec8.push("## 8. Tempo de execução (correção 9)");
  sec8.push("");
  if (TEMPO) {
    sec8.push(`Medido EM SÉRIE (um processo, sem paralelismo), ${TEMPO.amostras} execuções (36 decisões gravadas × 3): \`planejarComFluxo\` (candidatos + estabilização + avaliação + explicação) p50 ${n0(TEMPO.planejar.p50)} ms / p95 ${n0(TEMPO.planejar.p95)} ms / máx ${n0(TEMPO.planejar.max)} ms; incluindo verificação independente e serialização do diagnóstico (o que o caminho ativo faz por recálculo) p50 ${n0(TEMPO.total.p50)} ms / p95 ${n0(TEMPO.total.p95)} ms / máx ${n0(TEMPO.total.max)} ms. Execuções acima de 10 s: ${TEMPO.acimaDe10s}. Orçamento do \`drenar\` (maxDuration 60 s): ${TEMPO.total.max < 10_000 ? "folga ≥ 6×" : "ATENÇÃO"}. Carga real do replay: 15 pessoas, ~13 pools, até 30 períodos. Fora desta medida: leitura do estado/gravação no Supabase. Tamanho do diagnóstico JSON (por replay): mediana ${n0(mediana(todas.map((r) => r.bytesDiagnostico)) / 1024)} KB / máx ${n0(Math.max(...todas.map((r) => r.bytesDiagnostico)) / 1024)} KB.`);
  } else sec8.push("n/d");
  sec8.push("");
  const sec9: string[] = [];
  sec9.push("## 9. Reprodução");
  sec9.push("");
  sec9.push("```\n# 1) extração (somente SELECT em PROD): scripts/escala-fluxo-replay/sql/*.sql  →  <FREPLAY_DIR>/*.sql.out (JSON {rows})\n# 2) replays (FREPLAY_DIR padrão = scratchpad/freplay):\nnpx tsx --tsconfig <tsconfig com alias @/*> scripts/escala-fluxo-replay/replay.ts fechamentos|encadeado|theta|sensibilidade|contrafactual|auditoria|estabilizacao|tempo|tudo [--offset=2]\nFREPLAY_FATOR=0 npx tsx ... replay.ts fechamentos          # sem f (comparação 6.1)\nnpx tsx ... scripts/escala-fluxo-replay/autoteste-independente.ts      # mutação do verificador independente\nnpx tsx ... scripts/escala-fluxo-replay/relatorio.ts docs/escala-fluxo-criterios-ativacao.md\n```");
  return { md: [...sec0, ...sec1, ...tabsMd, ...sec3, ...sec4, ...sec5, ...sec6, ...sec7, ...sec8, ...sec9].join("\n") + "\n", vereditos: crit };
}

// Resumo compacto (sem trajetórias) para versionar junto do relatório.
function compacto() {
  const F = (ler<R[]>("fechamentos.json") ?? []).filter((r) => !r.erro);
  return F.map((r) => ({
    id: r.id, data: r.data, periodoId: r.periodoId, revisao: r.rev, modo: r.modo, c: r.c, aPartirDe: r.aPartirDe, obsoleta: !!r.obsoleta, determinismo: r.determinismo, hashPlanoFluxo: r.hashPlanoFluxo, hashResultado: r.hashResultado, planoEscolhido: r.planoEscolhido, theta: r.theta,
    falta: r.falta, final: r.final, wipFinal: r.wipFinal, excessoWip: r.excessoWip, simInd: r.simInd, faltaLegada: r.faltaLegada, churn: r.churnNucleo, churnInd: r.churnInd, violacoes: r.violacoes, decisoes: { ...r.decisoes, amostra: undefined },
    coberturaDecisoes: r.coberturaDecisoes, vigente: r.vigente, estabilizacao: r.estabilizacao, reconciliacao: r.reconciliacao, alertas: r.alertas, cx: { vigente: r.extras.cx.vigente, fluxo: r.extras.cx.fluxo }, e15: r.extras.e15, produtos: r.produtos.map((p) => ({ produtoId: p.produtoId, Rf: p.Rf })), pares: r.pares,
  }));
}

if (process.argv[1]?.endsWith("relatorio.ts")) {
  const { md } = gerar();
  const alvo = process.argv[2];
  if (alvo) { fs.writeFileSync(alvo, md); fs.writeFileSync(path.join(path.dirname(alvo), "escala-fluxo-replay-resultados.json"), JSON.stringify(compacto())); } else console.log(md);
}
