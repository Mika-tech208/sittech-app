// Download do PDF GERADO (arquivo armazenado — nunca reconstruído a partir de dados atuais). Exige `escala_relatorios`.
import { NextResponse } from "next/server";
import { criarClienteAdmin } from "@/lib/supabase-admin";
import { autenticarRequisicaoIntelligence } from "@/features/intelligence/auth";
import { temPermissao } from "@/lib/permissoes";
import { baixarPdf } from "@/lib/escala-relatorio/servico";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await autenticarRequisicaoIntelligence(request);
  if (!auth || !temPermissao(auth.usuario, "escala_relatorios")) return NextResponse.json({ erro: "Não autorizado." }, { status: 403 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ erro: "id inválido." }, { status: 400 });
  try {
    const arq = await baixarPdf(criarClienteAdmin(), id);
    if (!arq) return NextResponse.json({ erro: "Relatório não encontrado." }, { status: 404 });
    return new NextResponse(new Uint8Array(arq.bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${arq.nomeArquivo}"`, "Cache-Control": "private, no-store" } });
  } catch (e) {
    console.error("escala/relatorios pdf:", e instanceof Error ? e.message : e);
    return NextResponse.json({ erro: "Falha ao baixar o relatório." }, { status: 500 });
  }
}
