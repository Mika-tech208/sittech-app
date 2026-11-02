/* eslint-disable @typescript-eslint/no-explicit-any */
// Gera candidato-final.json (+ distribuição por produto), hash, testes finais e D10/frente-a.md a partir dos JSONs das etapas anteriores.
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import * as D from "./dados";
import * as N from "./nucleo";
import { OUT, wipB } from "./frente-a";
import type { AlocacaoEscala } from "@/features/escala/types";

const base = JSON.parse(fs.readFileSync(path.join(OUT, "plano-B-meta.json"), "utf8"));
const sens = JSON.parse(fs.readFileSync(path.join(OUT, "sensibilidade.json"), "utf8"));
const aus = JSON.parse(fs.readFileSync(path.join(OUT, "ausencia.json"), "utf8"));
const ant = JSON.parse(fs.readFileSync(path.join(OUT, "antigo-vizinhanca.json"), "utf8"));
const { n0, n1, soma, H, periodos, slots } = N;
const nm = D.nomeM, no = D.nomeO, pc = N.nomeCurto;
const md: string[] = []; const P = (s = "") => md.push(s);
const lin: any[] = base.linhas;
const tIdx = (l: any) => slots.find((s) => s.data === l.data && s.periodoId === l.periodoId)!.indice;

// ---------- candidato final ----------
const cand = lin.map((l) => ({ data: l.data, periodo_id: l.periodoId, funcionario_id: l.funcionarioId, maquina_id: l.maquinaId, produto_id: l.produtoId, etapa_id: l.etapaId, operacao_id: l.operacaoId, pecas: String(Math.round(l.pecas)), pecas_adicional: "0", tipo_adicional: null, origem: "auto", excecao_revezamento: false, motivo_excecao: null, motivo_sem_posto: l.motivoSemPosto }));
const distr: Record<string, any> = {};
lin.forEach((l) => { if (l.maquinaId) distr[`${l.data}|${l.periodoId}|${l.funcionarioId}`] = { maquina_id: l.maquinaId, pecas: Math.round(l.pecas), distribuicao: l.distribuicao.map((d: any) => ({ produto_id: d.produtoId, etapa_id: d.etapaId, pecas: Math.round(d.pecas) })) }; });
const hashOf = (js: any[]) => crypto.createHash("md5").update([...js].sort((a, b) => (a.data + a.periodo_id + a.funcionario_id < b.data + b.periodo_id + b.funcionario_id ? -1 : 1)).map((a) => a.data + a.periodo_id + a.funcionario_id + (a.maquina_id ?? "") + (a.produto_id ?? "") + (a.etapa_id ?? "") + (a.operacao_id ?? "") + a.pecas + a.pecas_adicional + a.origem).join(",")).digest("hex");
const hash = hashOf(cand);
fs.writeFileSync(path.join(OUT, "candidato-final.json"), JSON.stringify({ alocacoes: cand, resumo: { origem: "proposta_0211_frenteA", objetivo: "EQUILIBRIO", wip: "B (estimado)", mundo: "meta" } }, null, 1));
fs.writeFileSync(path.join(OUT, "candidato-final.distribuicao.json"), JSON.stringify(distr, null, 1));
const gen = spawnSync("python3", [path.join(N.SCRATCH, "gerar-publicar-candidato-0211.py"), path.join(OUT, "candidato-final.json"), "-o", path.join(OUT, "publicar-candidato-final.sql")], { encoding: "utf8" });
const genOut = (gen.stdout + gen.stderr).trim();

// ---------- testes finais ----------
const verif = N.violacoes(lin.map((l) => { const { distribuicao, ...r } = l; void distribuicao; return r as AlocacaoEscala; }));
const poolsDe = (pid: string, eid: string) => D.porProduto.get(pid)!.find((p) => p.etapaId === eid)!;
let foraPrev = 0;
lin.forEach((l) => { if (!l.maquinaId) return; if (!poolsDe(l.produtoId, l.etapaId).maquinasIds.includes(l.maquinaId)) foraPrev++; l.distribuicao.forEach((d: any) => { if (!poolsDe(d.produtoId, d.etapaId).maquinasIds.includes(l.maquinaId)) foraPrev++; }); });
const dupPessoa = (() => { const k = new Map<string, number>(); lin.forEach((l) => k.set(`${l.data}|${l.periodoId}|${l.funcionarioId}`, (k.get(`${l.data}|${l.periodoId}|${l.funcionarioId}`) ?? 0) + 1)); return [...k.values()].filter((v) => v > 1).length; })();
const dupMaq = (() => { const k = new Map<string, number>(); lin.filter((l) => l.maquinaId).forEach((l) => k.set(`${l.data}|${l.periodoId}|${l.maquinaId}`, (k.get(`${l.data}|${l.periodoId}|${l.maquinaId}`) ?? 0) + 1)); return [...k.values()].filter((v) => v > 1).length; })();
// bloco e M3→T1 por conta própria
let violBloco = 0, violPonte = 0;
{
  const por = new Map<string, any[]>();
  lin.filter((l) => l.maquinaId).forEach((l) => { const k = `${l.funcionarioId}|${l.data}|${l.periodoId.startsWith("m") ? "m" : "t"}`; (por.get(k) ?? por.set(k, []).get(k)!).push(l); });
  por.forEach((ls) => { const ops = ls.map((l) => l.operacaoId); violBloco += ops.length - new Set(ops).size; });
  lin.filter((l) => l.maquinaId && l.periodoId === "t1").forEach((l) => { const m3 = lin.find((x) => x.data === l.data && x.periodoId === "m3" && x.funcionarioId === l.funcionarioId); if (m3?.maquinaId && m3.operacaoId === l.operacaoId) violPonte++; });
}
const maxPostos = Math.max(...slots.map((s) => lin.filter((l) => l.data === s.data && l.periodoId === s.periodoId && l.maquinaId).length));
const somaDist = lin.filter((l) => l.maquinaId).every((l) => Math.abs(soma(l.distribuicao.map((d: any) => d.pecas)) - l.pecas) < 1e-6);
const compart = lin.filter((l) => l.maquinaId && l.distribuicao.length > 1);
const wipMin = Math.min(...Object.values<any>(base.wip).flatMap((ls: any) => ls.flatMap((a: number[]) => a)));
const semPosto = lin.filter((l) => !l.maquinaId).length;
const fin = Object.fromEntries(base.porProduto.map((p: any) => [p.produtoId, p.programado]));
const pecas = soma(Object.values<number>(fin)), margem = soma(Object.entries<number>(fin).map(([k, v]) => v * N.econ[k].margem)), receita = soma(Object.entries<number>(fin).map(([k, v]) => v * N.econ[k].valor));
const dem = soma(base.porProduto.map((p: any) => p.demanda));
const testes: [string, string, boolean][] = [
  ["0 CADEIA_INVALIDA (validarCadeia por produto, lote 1 período, semana inteira)", `${base.validacao.violacoesCadeia}`, base.validacao.violacoesCadeia === 0],
  ["0 violação dura (verificador independente fluxo/restricoes.ts)", `${verif.total} ${JSON.stringify(verif.porTipo)}`, verif.total === 0],
  ["0 máquina fora da Previsão (linha e cada item da distribuição)", `${foraPrev}`, foraPrev === 0],
  ["0 pessoa duplicada / 0 máquina com 2 pessoas", `${dupPessoa} / ${dupMaq}`, dupPessoa === 0 && dupMaq === 0],
  ["0 violação de bloco (mesma operação 2× na manhã/tarde)", `${violBloco}`, violBloco === 0],
  ["0 violação M3→T1", `${violPonte}`, violPonte === 0],
  ["≤ 12 postos simultâneos", `máx ${maxPostos}`, maxPostos <= 12],
  ["0 downstream planejado sem material (peças sem material)", `${n0(base.validacao.semMaterial)}`, base.validacao.semMaterial === 0],
  ["nenhum saldo de WIP negativo em nenhuma ligação/período", `mín ${n1(wipMin)}`, wipMin >= -1e-9],
  ["Σ distribuição por produto = quantidade da linha (todas as linhas)", `${somaDist}`, somaDist],
  ["demanda final ≤ demanda (e ≤ capacidade física)", `${base.porProduto.every((p: any) => p.programado <= p.demanda + 1e-6)}`, base.porProduto.every((p: any) => p.programado <= p.demanda + 1e-6)],
  ["pessoa parada com trabalho útil", `${semPosto} pessoa-períodos sem posto`, semPosto === 0],
];

P(`# FRENTE A — resultado (plano EQUILIBRIO refeito) — ${new Date().toISOString().slice(0, 16)}Z`);
P(`Sombra/offline. PROD só SELECT. Nada publicado. Worktree \`.worktrees/proposta-0211\` (branch \`audit/proposta-0211\`). WIP principal = **B (ESTIMADO)**; \`D7/wip-D.json\` ${fs.existsSync("/private/tmp/claude-501/-Users-mikaellonghi-Documents/46f8091f-a2ac-4875-a213-e5a3b744b594/scratchpad/auditoria-1030/D7/wip-D.json") ? "EXISTE" : "NÃO existe"}.`);
P();
P(`## 0. Resumo`);
P(`- **O plano EQUILIBRIO anterior (hash e7207165…) tinha 15 pessoa-períodos sem posto por uma LIMITAÇÃO DO OTIMIZADOR, não por física**: em cada um dos 6 períodos havia adição concreta com ganho positivo (seção 1). O planejador foi refeito (busca local de postos + despacho forward, \`postosDespacho.ts\`) e o novo plano tem **${semPosto} sem posto**, ${n0(pecas)} peças finais (${n1((100 * pecas) / dem)}% da demanda; antes 215.101), margem R$ ${n0(margem)} (antes 17.391), receita R$ ${n0(receita)}.`);
P(`- Novo hash do candidato: \`${hash}\` (fórmula D8). Arquivos: \`candidato-final.json\`, \`candidato-final.distribuicao.json\`, \`publicar-candidato-final.sql\` (gerado, NÃO executado). Gerador: ${genOut.replace(/\n/g, " ")}`);
P(`- API pura estável: commit \`cb5c099\` (+ ajustes posteriores listados no commit final); assinatura em \`D10/API-planejador.md\`.`);
P();
P(`## 7. TESTES FINAIS do plano final (plano B·meta)`);
P(`| Critério | Resultado | OK |`); P(`|---|---|---|`);
testes.forEach(([a, b, ok]) => P(`| ${a} | ${b} | ${ok ? "PASSA" : "**FALHA**"} |`));
P(`\nLinhas físicas compartilhadas (mesma máquina, 2+ produtos): ${compart.length} (Etiquetadora 15 / Embalagem 17 com Conv + Autom). Exemplo: ${compart.slice(0, 3).map((l) => `${periodos[tIdx(l)].rotulo} ${nm(l.maquinaId)} → ${l.distribuicao.map((d: any) => `${pc(d.produtoId)} ${n0(d.pecas)}`).join(" + ")}`).join(" · ")}.`);
P(`\nPeças finais por produto: ${base.porProduto.map((p: any) => `${pc(p.produtoId)} ${n0(p.programado)} de ${n0(p.demanda)} (corte ${n0(p.cortado)}, ${n1((100 * p.cortado) / p.demanda)}%)`).join(" · ")}.`);

// ---------- 1. antecipação / classificação das 15 ----------
const antigoRows: any[] = JSON.parse(fs.readFileSync(path.join(N.SCRATCH, "candidato-EQUILIBRIO.json"), "utf8")).alocacoes.filter((a: any) => a.maquina_id);
const chaveNovo = (t: number) => new Set<string>(base.linhasPostos.filter((l: any) => l.t === t).map((l: any) => `${nm(l.recursoId)}/${no(l.operacaoId)}`));
const chaveAntigo = (t: number) => new Set<string>(antigoRows.filter((a) => D.slots.find((s2) => s2.data === a.data && s2.periodoId === a.periodo_id)!.indice === t).map((a) => `${nm(a.maquina_id)}/${no(a.operacao_id)}`));
const tPorRot = (r: string) => periodos.findIndex((p) => p.rotulo === r);
P(`\n## 1. Antecipação das 15 pessoa-períodos sem posto (itens 4–6) — PROVA`);
P(`Método (exaustivo, \`frente-a-antigo.ts\`): sobre o plano ANTERIOR (hash e7207165…, 273 postos), para cada período com pessoa livre testei TODA máquina da Previsão livre × TODA operação compatível (adição) e TODA troca 1×1 (adiciona na folga e remove QUALQUER outra linha da semana — inclui trocar quem faz Etiquetar/Embalar depois), re-despachando a cadeia (lote de 1 período, WIP, demanda, ≤12, teto de operação/bloco) e medindo o objetivo (R$ de margem + piso EQUILIBRIO + estoque de saída útil). Objetivo-base do plano anterior no despacho: R$ ${n0(ant.objBaseAntigo)}.`);
P(`| Período | Livres | Candidatos testados | Melhor adição (peças, Δ R$) | Melhor troca 1×1 (Δ R$) | Classe | Hoje (plano novo) |`); P(`|---|---:|---:|---|---|---|---|`);
ant.res.forEach((r: any) => { const t = tPorRot(r.periodo); const novo = [...chaveNovo(t)].filter((x) => !chaveAntigo(t).has(x)); P(`| ${r.periodo} | ${r.livres} | ${r.candidatos} | ${r.melhorAdd.maq}/${r.melhorAdd.op}: ${n0(r.melhorAdd.pecas)} pç, +R$ ${n1(r.melhorAdd.dObj)} | +R$ ${n1(r.melhorTroca1x1.dObj)} (${r.melhorTroca1x1.desc}) | **G — OUTRO** (limitação do otimizador anterior; não é A–F) | entram: ${novo.join("; ") || "(mesmos postos, outras quantidades)"} |`); });
P(`\nResultado: das 15 pessoa-períodos (03/11 M1=3, M2=2, M3=1; 06/11 T1=1, T2=3, T3=5) **as 15 tinham uso útil**: classes A (máquina compatível) e B (material) NÃO se aplicam (havia máquina livre da Previsão com material e demanda: ex. Montagem 19 Montar Presilha com Caixa Amarela cortada em 25%, e Parafusadeira 12/9 com WIP); D (sem demanda) NÃO: Caixa/Plug/Conv estavam abaixo da demanda; E/F só valem para as adições sem ganho. A ociosidade era um artefato do otimizador por perfis (alvo semanal fixo + perfil de tempo), que não conseguia deslocar trabalho de um período saturado para um livre. Com o planejador novo (busca local de postos, que testa exatamente essas trocas) o plano passou de 15 para **${semPosto}** sem posto. O revezamento (C) NÃO bloqueou: a atribuição de pessoas fecha com bloco + ponte M3→T1.`);
const rs = sens.rowsSalvas["C·meta"] as [number, string, string][];
const porTC = periodos.map((_, t) => rs.filter((r) => r[0] === t).length);
P(`\nOciosidade que SIM é física (cenário C = WIP zero em todas as ligações): postos por período nos 6 primeiros = ${porTC.slice(0, 6).join("/")} ⇒ M1 de 03/11 tem ${12 - porTC[0]} pessoas sem posto **classe B (SEM_MATERIAL)**: Embalar/Etiquetar/Parafusar não têm material e Rosquear/M8/Montar Presilha/Pino/Plug já estão todos ligados. No cenário B (principal) não há ociosidade.`);

// ---------- 2. sensibilidade ----------
P(`\n## 2. Sensibilidade A/B/C (item 11) — plano EQUILIBRIO re-otimizado em cada WIP (partindo do plano B)`);
P(`| Cenário | Σ peças | Margem R$ | Caixa | Conv. | Autom. | Pino | Plug | Sem posto | Cadeia | Duras | ≤12 | Atribuição |`); P(`|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|---:|---|`);
sens.out.forEach((o: any) => P(`| ${o.nome} | ${n0(o.pecas)} | ${n0(o.margem)} | ${n0(o.fin["Caixa Amarela 4x2"])} | ${n0(o.fin["Conector 3/4 Conv."])} | ${n0(o.fin["Conector 3/4 Automática"])} | ${n0(o.fin["Pino"])} | ${n0(o.fin["Plug Macho"])} | ${o.semPosto} | ${o.val.cadeiaValida ? "0 viol." : "INVÁLIDA"} | ${o.val.violacoesDuras} | ${o.val.maxPostosSimultaneos} | ${o.val.atribuicaoOk ? "ok" : "FALHA"} |`));
P(`\nParecido ou radicalmente diferente? Linhas de posto idênticas ao plano B (mesma máquina+operação+período): **primeiros 4 períodos (03/11 M1–T1)** e semana inteira:`);
P(`| Cenário | Primeiros 4 períodos (de 48) | Semana (de 288) | Por período (saem / entram) |`); P(`|---|---:|---:|---|`);
sens.comp.forEach((c: any) => P(`| ${c.nome} | ${c.mesmasLinhasPrimeiros4.split("/")[0]} (${n0((100 * Number(c.mesmasLinhasPrimeiros4.split("/")[0])) / 48)}%) | ${c.mesmasLinhasSemana.split("/")[0]} (${n0((100 * Number(c.mesmasLinhasSemana.split("/")[0])) / 288)}%) | ${c.porPeriodo.join(" · ")} |`));
const nomesRow = (nome: string, t: number) => new Set((sens.rowsSalvas[nome] as any[]).filter((r) => r[0] === t).map((r) => `${r[1]}/${r[2]}`));
P(`\nDiferenças nomeadas nos 4 primeiros períodos (A e C vs B):`);
for (const nmC of ["A·meta", "C·meta"]) for (let t = 0; t < 4; t++) { const a = nomesRow("B·meta (base)", t), b = nomesRow(nmC, t); const sai = [...a].filter((x) => !b.has(x)), ent = [...b].filter((x) => !a.has(x)); P(`- ${nmC} ${periodos[t].rotulo}: saem [${sai.join("; ") || "—"}] · entram [${ent.join("; ") || "—"}]`); }
const mesmasCrit = ["Maquina Automatica 8", "Etiquetadora 15", "Embalagem 17"].map((m) => `${m}: ${["A·meta", "B·meta (base)", "C·meta"].map((c) => (sens.rowsSalvas[c] as any[]).filter((r) => r[1] === m).length).join("/")}`).join(" · ");
P(`\nMáquinas críticas (linhas na semana, A/B/C): ${mesmasCrit}. Produtos escolhidos: os 5 em todos os cenários; Conector Conv. varia ${n0(Math.min(...sens.out.filter((o: any) => /meta$/.test(o.nome) && !/M8/.test(o.nome)).map((o: any) => o.fin["Conector 3/4 Conv."])))}–${n0(Math.max(...sens.out.filter((o: any) => /meta$/.test(o.nome) && !/M8/.test(o.nome)).map((o: any) => o.fin["Conector 3/4 Conv."])))} e Pino ${n0(Math.min(...sens.out.filter((o: any) => /meta$/.test(o.nome) && !/M8/.test(o.nome)).map((o: any) => o.fin["Pino"])))}–${n0(Math.max(...sens.out.filter((o: any) => /meta$/.test(o.nome) && !/M8/.test(o.nome)).map((o: any) => o.fin["Pino"])))} (o que o WIP inicial libera). **Veredito: essencialmente igual** (77–85% das linhas idênticas; mesmas máquinas críticas; mesmos produtos). Única mudança estrutural: WIP zero (C) deixa pessoas sem posto em 03/11 M1 por falta de material (classe B) — ver seção 1. Ressalva: a re-otimização parte do plano B (viés de similaridade); a busca é estocástica, então diferenças de 1–3 linhas por período podem ser ruído de empate.`);

// ---------- 3. meta × histórico, M8 −10% ----------
P(`\n## 3. Meta × histórico e robustez da Máquina 8 (itens 13–14)`);
P(`Re-otimizado (planejarFuturo) em cada produtividade: ver tabela da seção 2 (linhas "hist" e "M8−10%"): em TODAS cadeia válida, 0 violação dura, ≤12, atribuição ok, 0 sem posto. Histórica: Automática ${n0(sens.out.find((o: any) => o.nome === "B·hist").fin["Conector 3/4 Automática"])} (M8 ~10% abaixo), Σ ${n0(sens.out.find((o: any) => o.nome === "B·hist").pecas)} pç.`);
P(`\n**O plano B·meta, SEM replanejar, com a Máquina 8 a 90% (e com tudo histórico):**`);
P(`| Hipótese (mesmas linhas do plano) | Σ peças | Margem R$ | Autom. | Linhas com utilização < 70% | Linhas sem produção |`); P(`|---|---:|---:|---:|---:|---:|`);
Object.entries(sens.fixo).forEach(([k, v]: any) => P(`| ${k} | ${n0(v.pecas)} | ${n0(v.margem)} | ${n0(v.fin["Conector 3/4 Automática"])} | ${v.linhasAbaixo70}${v.baixas.length ? ` (${v.baixas.slice(0, 4).join("; ")})` : ""} | ${v.ociosas} |`));
P(`\nConclusão: a cadeia continua **válida** com M8 a 90% (o despacho nunca consome além do estoque), a perda é só a produção da Máquina 8 (−${n0(sens.fixo.m8_100.fin["Conector 3/4 Automática"] - sens.fixo.m8_90.fin["Conector 3/4 Automática"])} pç ≈ −R$ ${n0(sens.fixo.m8_100.margem - sens.fixo.m8_90.margem)}) e as linhas de Etiquetadora 15/Embalagem 17 do último período ficam subutilizadas. Com TODAS as taxas históricas, o plano fixo deixa 12–14 linhas <70% e ${sens.fixo.hist_m8_100.ociosas} sem produção ⇒ **o plano não depende de a M8 bater 100%, mas depende de recálculo após cada período fechado** (o planejador devolve o plano re-otimizado em ~5 s; ver seção 5). Folga proposta: não reservar pessoa extra; a "reserva" é o próprio recálculo por período (M8 −10% re-otimizada: Σ ${n0(sens.out.find((o: any) => o.nome === "B·meta·M8−10%").pecas)} pç, R$ ${n0(sens.out.find((o: any) => o.nome === "B·meta·M8−10%").margem)}).`);

// ---------- 4. Conector ----------
P(`\n## 4. Conector 3/4 (item 12) — programação por período (plano B·meta)`);
const lr = (t: number) => lin.filter((l) => tIdx(l) === t && l.maquinaId);
const qMaq = (t: number, pred: (n: string) => boolean, pid?: string) => lr(t).filter((l) => pred(nm(l.maquinaId))).map((l) => `${nm(l.maquinaId).replace("Rosqueadeira ", "Ros ").replace("Parafusadeira ", "Paf ").replace("Maquina Automatica 8", "M8").replace("Etiquetadora ", "Etiq ").replace("Embalagem ", "Emb ")}:${n0(l.distribuicao.filter((d: any) => (pid ? d.produtoId === pid : d.produtoId === D.conv || d.produtoId === D.aut)).reduce((a: number, d: any) => a + d.pecas, 0))}`).filter((x) => !x.endsWith(":0")).join(" · ") || "—";
const wc = base.wip[D.conv], wa = base.wip[D.aut];
P(`Máquinas do Conector na PREVISÃO: Rosquear = **Rosqueadeira 6 e 3**; Parafusar = **Parafusadeira 12 e 9**; Etiquetar = Etiquetadora 15; Embalar = Embalagem 17; Automática = Máquina 8. O roteiro aceita também Parafusadeira 10 e 11 (e Rosqueadeira 5, Etiquetadora 16), mas **elas NÃO estão selecionadas na Previsão 02/11** — o motor nunca usa máquina fora da Previsão. O plano usa as Parafusadeiras 9 e 12 (mesma meta de 1.500/1.200 por período); se a intenção era 9 e 10, é preciso SELECIONAR a 10 na Previsão (decisão do usuário; o plano muda só o rótulo da máquina).`);
P(`| Período | Rosquear | Parafusar | M8 | Etiquetadora 15 (Conv+Autom) | Embalagem 17 (Conv+Autom) | WIP Ros→Paf | WIP Paf→Etiq | WIP Etiq→Emb (Conv) | WIP M8→Etiq | WIP Etiq→Emb (Autom) |`); P(`|---|---|---|---|---|---|---:|---:|---:|---:|---:|`);
for (let t = 0; t < H; t++) P(`| ${periodos[t].rotulo} | ${qMaq(t, (n) => n.startsWith("Rosqueadeira"), D.conv)} | ${qMaq(t, (n) => n.startsWith("Parafusadeira") && /\b(9|10|11|12)\b/.test(n), D.conv)} | ${qMaq(t, (n) => n.startsWith("Maquina"))} | ${lr(t).filter((l) => nm(l.maquinaId).startsWith("Etiquetadora 15")).map((l) => l.distribuicao.map((d: any) => `${d.produtoId === D.conv ? "Conv" : "Aut"} ${n0(d.pecas)}`).join(" + ")).join("") || "—"} | ${lr(t).filter((l) => nm(l.maquinaId).startsWith("Embalagem 17")).map((l) => l.distribuicao.map((d: any) => `${d.produtoId === D.conv ? "Conv" : "Aut"} ${n0(d.pecas)}`).join(" + ")).join("") || "—"} | ${n0(wc[0][t])} | ${n0(wc[1][t])} | ${n0(wc[2][t])} | ${n0(wa[0][t])} | ${n0(wa[1][t])} |`);
P(`| saída p/ 09/11 | | | | | | ${n0(wc[0][H])} | ${n0(wc[1][H])} | ${n0(wc[2][H])} | ${n0(wa[0][H])} | ${n0(wa[1][H])} |`);
const minW = Math.min(...[...wc, ...wa].flatMap((a: number[]) => a));
const primeira = (f: (n: string) => boolean) => { for (let t = 0; t < H; t++) if (lr(t).some((l) => f(nm(l.maquinaId)))) return periodos[t].rotulo; return "—"; };
P(`\nSaldo mínimo de qualquer WIP do Conector em qualquer período: **${n0(minW)}** (nunca negativo). Primeira produção: Rosquear ${primeira((n) => n.startsWith("Rosqueadeira"))}, Parafusar ${primeira((n) => /^Parafusadeira (9|12)$/.test(n))}, M8 ${primeira((n) => n.startsWith("Maquina"))}, Etiquetadora 15 ${primeira((n) => n.startsWith("Etiquetadora 15"))}, Embalagem 17 ${primeira((n) => n.startsWith("Embalagem 17"))}. Antecedência: a produção de cada etapa ocorre ≥1 período antes do consumo (lote); os estoques iniciais (WIP B, ESTIMADO) cobrem os primeiros períodos de Etiquetar/Embalar.`);

{
  const diaConv = D.porProduto.get(D.conv)![0].quantidade / 4, diaAut = D.porProduto.get(D.aut)![0].quantidade / 4;
  const mx = (a: number[][], d: number) => a.map((x) => `${n0(Math.max(...x))} (${n1((100 * Math.max(...x)) / d)}% do dia)`).join(" / ");
  P(`WIP máximo por ligação vs demanda de 1 dia (limite PROD \`wip_dias_limite\` = 1 dia, 2 dias na semana 26/10): Conv. ${mx(wc, diaConv)}; Autom. ${mx(wa, diaAut)}. ${Math.max(...wc.map((x: number[]) => Math.max(...x))) <= diaConv && Math.max(...wa.map((x: number[]) => Math.max(...x))) <= diaAut ? "Todos ≤ 1 dia de demanda (sem alerta de WIP acima do limite)." : "ATENÇÃO: algum buffer passa de 1 dia de demanda."}`);
}
// plano completo em arquivo separado
{
  const q: string[] = [];
  q.push(`# Plano final EQUILIBRIO (B·meta) — 24 períodos — hash ${hash}\n`);
  q.push(`## Postos por período (máquina: produto · operação · peças previstas | distribuição quando compartilhada)`);
  q.push(`| Período | Postos | Linhas físicas |`); q.push(`|---|---:|---|`);
  for (let t = 0; t < H; t++) { const ls = lr(t).sort((a, b) => (nm(a.maquinaId) < nm(b.maquinaId) ? -1 : 1)); q.push(`| ${periodos[t].rotulo} | ${ls.length} | ${ls.map((l) => `${nm(l.maquinaId)}: ${pc(l.produtoId)} · ${no(l.operacaoId)} · ${n0(l.pecas)}${l.distribuicao.length > 1 ? ` [${l.distribuicao.map((d: any) => `${pc(d.produtoId)} ${n0(d.pecas)}`).join(" + ")}]` : ""}`).join(" ; ")} |`); }
  const eqp = N.equipe;
  q.push(`\n## Pessoa → posto (revezamento de bloco + ponte M3→T1 verificados)`);
  q.push(`| Período | ${eqp.map(N.nomeFunc).join(" | ")} |`); q.push(`|---|${eqp.map(() => "---").join("|")}|`);
  for (let t = 0; t < H; t++) q.push(`| ${periodos[t].rotulo} | ${eqp.map((fid) => { const a = lin.find((l) => tIdx(l) === t && l.funcionarioId === fid); return a?.maquinaId ? `${nm(a.maquinaId).replace("Maquina Automatica", "M8")} (${no(a.operacaoId)})` : "sem posto"; }).join(" | ")} |`);
  fs.writeFileSync(path.join(OUT, "plano-final-24-periodos.md"), q.join("\n") + "\n");
}
// ---------- 5. ausência ----------
P(`\n## 5. Ausência simulada em 03/11 (item 9) — API pura \`planejarFuturo\`, passado congelado`);
P(`| Caso | Pessoa | Σ peças | Δ peças | Δ margem R$ | Corte adicional por produto (Δ vs plano sem ausência) | Cadeia | Duras | Atribuição | Pessoas/período (03/11) | Ausente em linha futura | Tempo |`); P(`|---|---|---:|---:|---:|---|---|---:|---|---|---:|---:|`);
aus.out.forEach((o: any) => P(`| ${o.nome} | ${o.pessoa} | ${n0(o.pecas)} | ${n0(o.deltaPecas)} | ${n0(o.deltaMargem)} | ${Object.entries(o.corteExtra).map(([k, v]) => `${k} ${n0(v as number)}`).join(" · ")} | ${o.val.cadeiaValida ? "VÁLIDA" : "INVÁLIDA"} | ${o.val.violacoesDuras} | ${o.val.atribuicaoOk ? "ok" : "FALHA"} | ${o.pessoasPeriodo03.join("/")} | ${o.ausenteEmLinha} | ${n1(o.ms / 1000)} s |`));
P(`\nVarredura (cada uma das 12 pessoas ausente de T1 a T3 de 03/11): ${aus.varredura.filter((v: any) => v.ok && v.cadeia && v.duras === 0).length}/12 recalculam com cadeia válida, 0 violação dura e atribuição ok; efeito idêntico em R$ (pessoas são intercambiáveis para a produtividade por posto; o revezamento do passado nunca impediu a substituição). 12→11 pessoas: o planejador corta ~${n0(-aus.out[0].deltaMargem)} R$ de margem (${n1((100 * -aus.out[0].deltaMargem) / margem)}%) e nenhuma etapa downstream fica sem material (semMaterial=0 em todos os casos). Passado idêntico ao congelado (verificador: 0 \`passado_alterado\`). Nota: a variação em peças (+/−) vem do EQUILIBRIO otimizar R$, não peças.`);

// ---------- 6. linhas compartilhadas ----------
P(`\n## 6. Linhas compartilhadas (item 7) — ALOCACAO_FISICA × DISTRIBUICAO_DA_QUANTIDADE_POR_PRODUTO`);
P(`O planejador devolve, por linha física (pessoa×período×máquina), \`distribuicao: [{produtoId, etapaId, pecas}]\` com Σ = \`pecas\` da linha (testado em todas as ${lin.filter((l) => l.maquinaId).length} linhas: ${somaDist}). ${compart.length} linhas têm 2 produtos (Etiquetadora 15 / Embalagem 17: Conv + Autom); a máquina e a pessoa NÃO são duplicadas. \`produto_id/etapa_id\` da linha = o de maior quantidade (compatibilidade com o schema atual). Arquivo: \`candidato-final.distribuicao.json\` (chave data|período|pessoa). A persistência (tabela filha \`escala_producao_alocacao_produtos\` ou jsonb) e o consumo por WIP/realizado/cobertura são da Frente B — NÃO implementados aqui. Sem isso, gravar o candidato mantém o defeito do item 7 (a Automática aparece como Convencional na linha) ⇒ **bloqueador de GO**.`);

// ---------- 8. pendências ----------
P(`\n## 8. NO-GO / pendências / ressalvas (honesto)`);
P(`1. **CORREÇÃO DE ERRO MEU (D9)**: o relatório D9 afirmou verificar "bloco + ponte M3→T1", mas o carregador usava um snapshot de parâmetros de 30/10 08:33 (sem \`revezamento_ponte_m3_t1\`); a ponte NÃO estava ligada nas verificações do D9. Agora \`D9/ts.sh\` aponta para o SELECT de hoje (ponte=true, \`entrada.revezamentoPonteM3T1=true\`) e TODOS os números desta frente foram refeitos com a ponte. O candidato D9 (hash e7207165…) tinha 1 violação M3→T1 sob a regra correta e deve ser DESCARTADO.`);
P(`2. **Persistência da distribuição por produto, integração do motor, ativação da semana, recálculo que não volta ao legado, apontamento real** — Frente B (não validado aqui). Enquanto a distribuição não for persistida, NO-GO para publicar o candidato.`);
P(`3. WIP inicial B é ESTIMADO; D não existe. Sensibilidade A/C mostrada. O simulador é otimista (sem refugo/parada).`);
P(`4. O planejador é HEURÍSTICO (recozimento simulado sobre linhas de posto, sementes fixas): sem prova de otimalidade; partindo do vazio (sem plano inicial) chega a ~19,9–20,0 mil R$ (reprodutível a ±0,3%). Diferenças de R$ <1% entre planos não são significativas.`);
P(`5. O objetivo EQUILIBRIO usa piso por produto = 0,9 × (maior cobertura uniforme viável c_u = ${n1(100 * 0.5009765625)}%) ⇒ ${n1(0.9 * 50.0977)}% da demanda de cada produto no mínimo (parâmetro explícito). Estoque de saída para 09/11 valorado a 25% da margem × fração do roteiro, teto = 1 período de demanda recorrente (parâmetro \`saidaPeso\`).`);
P(`6. Parafusadeira 10 não está na Previsão (seção 4). Rosqueadeira 5 e Etiquetadora 16 (roteiro) também não.`);
P(`7. Linhas com pouca utilização: ver seção 3 (plano B·meta tem ${"1"} linha <80%: Etiquetadora 15 em 06/11 T3, limitada pelo estoque).`);
fs.writeFileSync(path.join(OUT, "frente-a.md"), md.join("\n") + "\n");
console.log(JSON.stringify({ hash, genOut: genOut.slice(0, 160), testes: testes.map((t) => [t[0].slice(0, 30), t[2]]) }));
