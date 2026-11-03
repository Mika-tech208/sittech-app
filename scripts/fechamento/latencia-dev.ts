 
// Mede a LATÊNCIA REAL de chamadas ao Supabase DEV a partir desta máquina (conservador: o servidor de produção fica na mesma região do banco). Só DEV; aborta se a URL for PROD.
// Uso: NEXT_PUBLIC_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY do DEV no ambiente → scripts/fechamento/ts.sh scripts/fechamento/latencia-dev.ts
import { createClient } from "@supabase/supabase-js";
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "", KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
if (!URL.includes("zjwcomwjmhsloyxfypax")) throw new Error("só o DEV (zjwcomwjmhsloyxfypax)");
const admin = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const N = Number(process.env.N ?? 60);
const pct = (v: number[], p: number) => { const s = [...v].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]; };
async function medir(nome: string, f: () => PromiseLike<unknown>) {
  await f(); // aquecimento (TLS/DNS)
  const v: number[] = [];
  for (let i = 0; i < N; i++) { const t = performance.now(); await f(); v.push(performance.now() - t); }
  console.log(`${nome.padEnd(44)} p50 ${pct(v, 50).toFixed(0).padStart(4)} ms · p95 ${pct(v, 95).toFixed(0).padStart(4)} ms · pior ${Math.max(...v).toFixed(0).padStart(4)} ms`);
  return { p50: pct(v, 50), p95: pct(v, 95), max: Math.max(...v) };
}
(async () => {
  const r: Record<string, unknown> = {};
  r.select_pequeno = await medir("REST select pequeno (1 linha)", () => admin.from("escala_parametros").select("chave").limit(1));
  r.select_360 = await medir("REST select ~360 linhas (alocações)", () => admin.from("escala_producao_alocacoes").select("*").limit(360));
  r.rpc_leitura = await medir("RPC de leitura (escala_fechamento_fisico_modo)", () => admin.rpc("escala_fechamento_fisico_modo"));
  const { data: us } = await admin.from("usuarios").select("id").limit(1);
  const { data: pv } = await admin.from("previsoes").select("semana_inicio").limit(1);
  r.rpc_escrita = await medir("RPC de ESCRITA (escala_fechamento_abrir)", () => admin.rpc("escala_fechamento_abrir", { p_semana: pv?.[0]?.semana_inicio, p_data: "2026-10-27", p_periodo: "m1", p_usuario: us?.[0]?.id, p_dispositivo: "latencia", p_ttl_min: 1, p_forcar: true }));
  console.log(JSON.stringify(r));
})();
