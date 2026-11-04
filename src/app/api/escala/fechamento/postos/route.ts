// Postos programados do período (pré-preenchimento dos apontamentos no fechamento). GET /api/escala/fechamento/postos?data=YYYY-MM-DD&periodo_id=m2 — somente leitura.
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
  const r = await acaoPostos((d, p) => carregarPostosProgramados(admin, d, p), auth.usuario, url.searchParams.get("data") ?? "", url.searchParams.get("periodo_id") ?? "",
    async (d, p) => { const r = await admin.rpc("escala_periodo_liberacao", { p_data: d, p_periodo: p }); if (r.error) throw new Error(`escala_periodo_liberacao: ${r.error.message}`); return (r.data as { liberado?: boolean } | null)?.liberado === true; });
  return NextResponse.json(r.corpo, { status: r.status });
}
