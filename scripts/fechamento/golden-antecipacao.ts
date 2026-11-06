/* eslint-disable @typescript-eslint/no-explicit-any */
// GOLDEN DO ESTADO REAL (clone de PROD; NUNCA PROD): roda o recálculo da semana 02/11 a partir de T1 de 06/11 SEM gravar nada (aplicar interceptado) e imprime o hash das linhas.
// Serve para provar que, com `escala_antecipacao_modo` ausente/'desligado', o plano é BYTE-IDÊNTICO ao do código anterior.
// Uso: set -a; source ~/Documents/sittech-clone/env.clone; set +a; scripts/fechamento/ts.sh scripts/fechamento/golden-antecipacao.ts [arquivo-saida.json]
import { writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { criarEscalaIO, resolverPrevisaoPorSemana } from "@/lib/escala/supabaseIO";
import { processarSemana } from "@/lib/escala/processar";
import { epochMsNoFuso } from "@/features/escala/tempo";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "", KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
if (URL.includes("qcmottqryawyrghdepel") || !/127\.0\.0\.1|localhost/.test(URL)) throw new Error("ABORTADO: só roda no clone local");
const admin = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const SEMANA = "2026-11-02";
const AGORA = process.env.AGORA_REAL === "1" ? Date.now() : epochMsNoFuso("2026-11-06", process.env.HORA ?? "12:50"); // padrão: T1 de 06/11 ainda não começou

(async () => {
  const previsaoId = await resolverPrevisaoPorSemana(admin, SEMANA);
  if (!previsaoId) throw new Error("sem Previsão");
  const io = criarEscalaIO(admin, previsaoId);
  let capturado: any = null;
  // VARIANTE: FRESCO=1 ⇒ planeja do zero (sem hash anterior, sem partir do vigente): a busca inteira roda; senão o comportamento normal de um recálculo.
  const carregar = io.carregarEstado.bind(io);
  const dry = { ...io, carregarEstado: async (...a: any[]) => { const e: any = await (carregar as any)(...a); if (process.env.FRESCO === "1" && e.planejadorCorte) e.planejadorCorte = { ...e.planejadorCorte, hashEntradaAnterior: null, vigenteDoPlanejador: false }; return e; }, aplicar: async (p: any) => { capturado = p; return { versoes: {} }; }, gravarSnapshotsWip: async () => {}, registrarFluxo: async () => {} };
  const r = await processarSemana(dry as any, { agoraMs: AGORA, criarSeNaoExiste: false, maxTentativas: 1 });
  const linhas = (capturado?.alocacoes ?? []) as any[];
  const canon = linhas.map((a) => [a.data, a.periodoId, a.funcionarioId, a.maquinaId, a.produtoId, a.etapaId, a.operacaoId, Math.round(a.pecas), JSON.stringify(a.distribuicao ?? null)].join("|")).sort();
  const hashLinhas = createHash("sha256").update(canon.join("\n")).digest("hex");
  console.log(JSON.stringify({ fresco: process.env.FRESCO === "1", status: r.status, linhas: linhas.length, comPosto: linhas.filter((a) => a.maquinaId).length, hash: hashLinhas, corte: (r as any).corte ?? null }));
  if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify({ hash: hashLinhas, linhas: canon }, null, 1));
})().catch((e) => { console.error("ERRO:", e instanceof Error ? e.stack : e); process.exit(1); });
