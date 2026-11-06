/* eslint-disable @typescript-eslint/no-explicit-any */
// DIAGNÓSTICO (clone; NUNCA PROD) do fallback "planejarFuturo: sem plano executável com as pessoas disponíveis (revezamento)".
// Reproduz o recálculo da semana 02/11 com o relógio dado, captura os postos que a busca produziu em cada tentativa de limiteOp e confere a atribuição de pessoas de forma EXATA.
// Uso: set -a; source ~/Documents/sittech-clone/env.clone; set +a; HORA=13:50 scripts/fechamento/ts.sh scripts/fechamento/diagnostico-fallback-revezamento.ts
import { createClient } from "@supabase/supabase-js";
import { criarEscalaIO, resolverPrevisaoPorSemana } from "@/lib/escala/supabaseIO";
import { processarSemana } from "@/lib/escala/processar";
import { epochMsNoFuso } from "@/features/escala/tempo";
import { montarProblemaCorte, planejarSemanaComCorte } from "@/features/escala/fluxo/planoCorte";
import { planejarFuturo } from "@/features/escala/fluxo/planejadorFuturo";
import { reatribuirPessoasBloco, resolverBlocoExato } from "@/features/escala/estabilidade";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "", KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
if (URL.includes("qcmottqryawyrghdepel") || !/127\.0\.0\.1|localhost/.test(URL)) throw new Error("ABORTADO: só roda no clone local");
const admin = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const AGORA = process.env.HORA ? epochMsNoFuso("2026-11-06", process.env.HORA) : Date.now();
const nomeDe = async (t: string, ids: string[]) => Object.fromEntries(((await admin.from(t).select("id, nome").in("id", ids)).data ?? []).map((r: any) => [r.id, r.nome]));

(async () => {
  const previsaoId = (await resolverPrevisaoPorSemana(admin, "2026-11-02")) as string;
  const io = criarEscalaIO(admin, previsaoId);
  const wrap: any = { ...io, aplicar: async () => ({ versoes: {} }), gravarSnapshotsWip: async () => {}, registrarFluxo: async () => {} };
  let capturado: any = null;
  const planejar: any = (entrada: any, dados: any, opcoes: any, cfg: any, vigente: any) => {
    const sem = process.env.SEM_VIGENTE === "1";
    const m = montarProblemaCorte(entrada, dados, opcoes, { ...cfg, partirDoVigente: sem ? false : cfg.partirDoVigente }, vigente);
    const tentativas: any[] = [];
    try { planejarFuturo({ ...m.entradaPlanejador, diagnosticoAtribuicao: (i) => tentativas.push(i) }); } catch (e) { tentativas.push({ erro: String(e) }); }
    capturado = { entrada, m, tentativas };
    return planejarSemanaComCorte(entrada, dados, opcoes, cfg, vigente);
  };
  const r: any = await processarSemana(wrap, { agoraMs: AGORA, criarSeNaoExiste: false, maxTentativas: 1, planejadorCorte: planejar });
  console.log(`# relógio ${new Date(AGORA).toISOString()} · status ${r.status} · corte ${JSON.stringify(r.corte?.motivoFalha ?? "ok").slice(0, 200)}`);
  const { entrada, m, tentativas } = capturado;
  const ep = m.entradaPlanejador;
  console.log(`aPartirDe=${ep.aPartirDe} (${entrada.slots[ep.aPartirDe]?.data} ${entrada.slots[ep.aPartirDe]?.periodoId}) · equipe ${ep.equipe.length} · ausentes ${JSON.stringify(ep.ausentes)}`);
  const fn = await nomeDe("funcionarios", ep.equipe.map((x: any) => x.id));
  const ops = await nomeDe("operacoes", [...new Set<string>(entrada.pools.map((p: any) => p.operacaoId))]);
  const mq = await nomeDe("maquinas", ep.recursos.map((x: any) => x.id));
  for (const [i, t] of tentativas.entries()) {
    if (t.erro) { console.log(`tentativa ${i}: ${t.erro}`); continue; }
    const porSlot = new Map<number, any[]>();
    t.linhas.forEach((l: any) => { const s = entrada.slots.find((x: any) => x.data === l.data && x.periodoId === l.periodoId).indice; porSlot.set(s, [...(porSlot.get(s) ?? []), l]); });
    console.log(`\n--- tentativa ${i}: atribuição heurística ${t.atribuicaoOk ? "OK" : "FALHOU"}`);
    for (const [s, ls] of [...porSlot.entries()].sort((a, b) => a[0] - b[0])) console.log(`  ${entrada.slots[s].periodoId}: postos ${ls.filter((l) => l.maquinaId).map((l: any) => `${mq[l.maquinaId]}[${ops[l.operacaoId]}]`).join(", ")} · pessoas ${ls.length}`);
    const regras = { escopo: "bloco" as const, ponteM3T1: entrada.revezamentoPonteM3T1 === true, equivalencias: entrada.equivalenciaOperacoes };
    const heur = reatribuirPessoasBloco(t.linhas, t.congeladas, entrada.slots, regras, 600);
    // exato por bloco, igual ao que o fallback faz
    const idx = (a: any) => entrada.slots.find((x: any) => x.data === a.data && x.periodoId === a.periodoId).indice;
    const ordem = [...porSlot.keys()].sort((a, b) => a - b);
    const t0 = Date.now();
    const ex = resolverBlocoExato(ordem, porSlot as any, entrada.slots, t.congeladas, regras, regras.ponteM3T1);
    console.log(`  reatribuirPessoasBloco(600) = ${heur ? "viável" : "null"} · busca EXATA = ${ex === null ? "INVIÁVEL (esgotada)" : ex === "limite" ? "limite de nós" : "VIÁVEL"} (${Date.now() - t0} ms)`);
    if (ex && ex !== "limite") for (const s of ordem) console.log(`    ${entrada.slots[s].periodoId}: ${ex.filter((l: any) => idx(l) === s && l.maquinaId).map((l: any) => `${(fn[l.funcionarioId] ?? "?").split(" ")[0]}→${mq[l.maquinaId]}[${ops[l.operacaoId]}]`).join(" · ")}`);
  }
})().catch((e) => { console.error("ERRO:", e instanceof Error ? e.stack : e); process.exit(1); });
