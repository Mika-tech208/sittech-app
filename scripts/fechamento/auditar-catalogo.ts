/* eslint-disable @typescript-eslint/no-explicit-any */
// AUDITORIA DE CATÁLOGO: para cada (dia, período) da semana, roda o MESMO código de contexto do fechamento (clone com migration+seed e flag `ativo`)
// e lista pares do motor sem buffer/dispensa (= BUFFER_FISICO_NAO_CADASTRADO) e semana sem corte-v1. Nunca roda em PROD.
// Uso: set -a; source ~/Documents/sittech-clone/env.clone; set +a; SEMANA=2026-11-02 scripts/fechamento/ts.sh scripts/fechamento/auditar-catalogo.ts
import { createClient } from "@supabase/supabase-js";
import { ioDoUsuario, type UsuarioFechamento } from "@/lib/escala/fechamento/http";
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "", KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
if (!/127\.0\.0\.1|localhost/.test(URL)) throw new Error("só o clone local");
const admin = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const SEMANA = process.env.SEMANA ?? "2026-11-02";
(async () => {
  const u: UsuarioFechamento = { id: "00000000-0000-0000-0000-000000000000", papel: "usuario", permissoes: ["escala_fechamento"] };
  const io: any = ioDoUsuario(admin, u);
  const { data: prev } = await admin.from("previsoes").select("id, semana_inicio").eq("semana_inicio", SEMANA);
  const { data: dias } = await admin.from("escala_producao_dias").select("data, periodos_snapshot, previsao_id").in("previsao_id", (prev ?? []).map((p: any) => p.id)).order("data");
  let total = 0, falhas = 0;
  const vistos = new Map<string, string>();
  for (const d of dias ?? []) for (const p of d.periodos_snapshot as any[]) {
    try {
      const c = await io.contexto(d.data, p.id, Date.parse(`${d.data}T20:00:00Z`));
      total++;
      const sem = (c.paresSemBuffer ?? []) as any[];
      if (c.semCorteV1) { falhas++; console.log(`BLOQUEIA ${d.data} ${p.nome}: semana sem corte-v1`); }
      for (const s of sem) { falhas++; const k = `${s.produto}|${s.etapaOrigem}→${s.etapaDestino}`; if (!vistos.has(k)) { vistos.set(k, `${d.data} ${p.nome}`); console.log(`BLOQUEIA ${d.data} ${p.nome}: BUFFER_FISICO_NAO_CADASTRADO ${s.produto} · ${s.rota} · ${s.etapaOrigem} → ${s.etapaDestino}`); } }
      console.log(`ok ${d.data} ${p.nome}: ${c.obrigatorios.length} buffers obrigatórios [${c.obrigatorios.map((b: any) => b.rotulo).join("; ")}] · pares sem buffer ${sem.length}`);
    } catch (e: any) { falhas++; console.log(`ERRO ${d.data} ${p.nome}: ${String(e?.message ?? e).slice(0, 200)}`); }
  }
  console.log(`\nAUDITORIA: ${total} contextos · ${falhas} problema(s) ${falhas === 0 ? "→ CATÁLOGO COMPLETO" : "→ NÃO ATIVAR"}`);
  process.exit(falhas === 0 ? 0 : 1);
})();
