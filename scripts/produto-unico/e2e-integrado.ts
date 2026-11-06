/* eslint-disable @typescript-eslint/no-explicit-any */
// E2E INTEGRADO (clone de PROD; NUNCA PROD): produto único ativo (cutover 09/11) → gerar a Escala da semana 09/11 com o item único (93.300) → inspeciona o plano.
// Uso: set -a; source ~/Documents/sittech-clone/env.clone; set +a; scripts/fechamento/ts.sh scripts/produto-unico/e2e-integrado.ts
import { createClient } from "@supabase/supabase-js";
import { gerarEscalaDaSemana } from "@/lib/escala/supabaseIO";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "", KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
if (URL.includes("qcmottqryawyrghdepel") || !/127\.0\.0\.1|localhost/.test(URL)) throw new Error("ABORTADO: só roda no clone local");
const admin = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
(async () => {
  const { data: u } = await admin.from("usuarios").select("id").eq("papel", "admin").limit(1);
  const t0 = Date.now();
  const r = await gerarEscalaDaSemana(admin, "2026-11-09", (u as any)[0].id, Date.now());
  console.log("resultado:", JSON.stringify(r).slice(0, 600), `· ${Date.now() - t0} ms`);
})().catch((e) => { console.error("ERRO:", e instanceof Error ? e.message : e); process.exit(1); });
