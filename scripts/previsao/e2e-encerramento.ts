/* eslint-disable @typescript-eslint/no-explicit-any */
// PROVA (clone; NUNCA PROD): com a Caixa 4x2 ENCERRADA, o motor REAL (processarSemana, estado REAL da semana 02/11 lido do banco) não programa nenhuma peça de 4x2.
// Não grava nada: o `aplicar` só captura o plano que o motor publicaria. Controle: o MESMO estado com a demanda ORIGINAL (56.400) programa 4x2 — o teste não é vazio.
// Uso: set -a; source ~/Documents/sittech-clone/env.clone; set +a; scripts/fechamento/ts.sh scripts/previsao/e2e-encerramento.ts
import { createClient } from "@supabase/supabase-js";
import { criarEscalaIO } from "@/lib/escala/supabaseIO";
import { processarSemana, type EscalaIO } from "@/lib/escala/processar";
import { epochMsNoFuso } from "@/features/escala/tempo";
import type { EstadoBruto, PayloadAplicacao } from "@/lib/escala/estado";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "", KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
if (URL.includes("qcmottqryawyrghdepel") || !/127\.0\.0\.1|localhost/.test(URL)) throw new Error("ABORTADO: só roda no clone local");
const admin = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const falhas: string[] = [];
const ok = (c: boolean, n: string, d = "") => { console.log(`${c ? "PASS" : "FAIL"}  ${n}${d ? ` — ${d}` : ""}`); if (!c) falhas.push(n); };

async function planoSimulado(previsaoId: string, ajustar: (e: EstadoBruto) => EstadoBruto) {
  const real = criarEscalaIO(admin, previsaoId);
  let capturado: PayloadAplicacao | null = null;
  const io: EscalaIO = {
    async carregarEstado(agora, corte) { const e = await real.carregarEstado(agora, corte); return ajustar({ ...e, operacaoManual: false }); },   // motor LIGADO (hipótese de retomar a automação) — só leitura
    async aplicar(p) { capturado = p; return { versoes: {} }; },                                                                          // NADA é gravado
  };
  const r = await processarSemana(io, { agoraMs: epochMsNoFuso("2026-11-02", "05:00"), criarSeNaoExiste: true });
  return { r, payload: capturado as PayloadAplicacao | null };
}
const pecas = (p: PayloadAplicacao | null, produtoId: string) => (p?.alocacoes ?? []).filter((a) => a.produtoId === produtoId).reduce((s, a) => s + a.pecas + (a.pecasAdicional ?? 0), 0);
const postos = (p: PayloadAplicacao | null, produtoId: string) => (p?.alocacoes ?? []).filter((a) => a.produtoId === produtoId && a.maquinaId).length;

async function main() {
  const prev = await admin.from("previsoes").select("id").eq("semana_inicio", "2026-11-02").single();
  const pr = await admin.from("produtos").select("id").eq("nome", "Caixa Amarela 4x2").single();
  const enc = await admin.from("previsao_encerramentos").select("quantidade_original, reaberto_em").eq("previsao_id", prev.data!.id).eq("produto_id", pr.data!.id).is("reaberto_em", null);
  ok((enc.data ?? []).length === 1 && Number(enc.data![0].quantidade_original) === 56400, "pré: 4x2 encerrada na semana 02/11 com meta original 56.400");
  const id4x2 = pr.data!.id as string;

  // 1) estado REAL (4x2 com demanda 0 e adicional 0, como no banco)
  const real = await planoSimulado(prev.data!.id, (e) => e);
  const item = (await (async () => { const e = await criarEscalaIO(admin, prev.data!.id).carregarEstado(epochMsNoFuso("2026-11-02", "05:00")); return e.itens.find((i) => i.produtoId === id4x2); })());
  ok(!!item && item.quantidade === 0 && (item.quantidadeAdicional ?? 0) === 0, "o motor LÊ a 4x2 com demanda 0 e adicional 0", JSON.stringify({ quantidade: item?.quantidade, adicional: item?.quantidadeAdicional }));
  console.log(`motor (estado real): status=${real.r.status}  alocações no plano simulado=${real.payload?.alocacoes.length ?? 0}`);
  ok(real.r.status === "processado" && (real.payload?.alocacoes.length ?? 0) > 0, "o motor roda e publicaria plano para os demais produtos");
  ok(pecas(real.payload, id4x2) === 0, "MOTOR PROGRAMA 0 PEÇAS de 4x2", `${pecas(real.payload, id4x2)} peças`);
  ok(postos(real.payload, id4x2) === 0, "nenhuma máquina nem pessoa alocada à 4x2 (0 postos)", `${postos(real.payload, id4x2)} postos`);

  // 2) controle: o MESMO estado com a demanda ORIGINAL programa 4x2
  const ctrl = await planoSimulado(prev.data!.id, (e) => ({ ...e, itens: e.itens.map((i) => (i.produtoId === id4x2 ? { ...i, quantidade: 56400 } : i)) }));
  ok(pecas(ctrl.payload, id4x2) > 0, "CONTROLE: com a demanda original (56.400) o motor programaria 4x2 (o teste não é vazio)", `${pecas(ctrl.payload, id4x2)} peças, ${postos(ctrl.payload, id4x2)} postos`);

  console.log(falhas.length ? `\n${falhas.length} FALHA(S): ${falhas.join(" | ")}` : "\nTODAS AS PROVAS PASSARAM");
  process.exit(falhas.length ? 1 : 0);
}
main().catch((e) => { console.error("ERRO:", e); process.exit(2); });
