// Postos programados do período (grade do tablet e pré-preenchimento dos apontamentos). GET /api/escala/fechamento/postos?data=YYYY-MM-DD&periodo_id=m2 — somente leitura.
import { NextResponse } from "next/server";
import { criarClienteAdmin } from "@/lib/supabase-admin";
import { autenticarRequisicaoIntelligence } from "@/features/intelligence/auth";
import { acaoPostos } from "@/lib/escala/fechamento/httpPostos";
import { carregarPostosProgramados } from "@/lib/escala/fechamento/postosProgramados";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: Request) {
  const auth = await autenticarRequisicaoIntelligence(request);
  if (!auth) return NextResponse.json({ erro: "Não autorizado." }, { status: 401 });
  const url = new URL(request.url);
  const admin = criarClienteAdmin();
  const r = await acaoPostos({
    carregar: (d, p) => carregarPostosProgramados(admin, d, p),
    modo: async () => {
      const row = await admin.from("escala_parametros").select("valor").eq("chave", "escala_fechamento_fisico_modo").maybeSingle();
      if (row.error) throw new Error(`escala_parametros: ${row.error.message}`);
      return row.data?.valor === "sombra" || row.data?.valor === "ativo" ? (row.data.valor as "sombra" | "ativo") : "desligado";
    },
    liberado: async (d, p) => { const r2 = await admin.rpc("escala_periodo_liberacao", { p_data: d, p_periodo: p }); if (r2.error) throw new Error(`escala_periodo_liberacao: ${r2.error.message}`); const j = r2.data as { liberado?: boolean; predecessor?: { data: string; periodo: string; rotulo: string } } | null; return { liberado: j?.liberado === true, predecessor: j?.predecessor ?? null }; },
  }, auth.usuario, url.searchParams.get("data") ?? "", url.searchParams.get("periodo_id") ?? "");
  return NextResponse.json(r.corpo, { status: r.status });
}
