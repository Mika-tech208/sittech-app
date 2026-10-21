// Worker de drenagem da outbox da Escala de Produção — NÃO depende de
// nenhuma tela aberta. Processa eventos pendentes, com erro (até 3
// tentativas) e "processando" travado (> 5 min), reaproveitando exatamente
// o mesmo processador de /api/escala/processar (locks e versões inclusos).
//
// Protegido por segredo server-side (CRON_SECRET, nunca exposto ao client):
// o Vercel Cron envia `Authorization: Bearer $CRON_SECRET` automaticamente;
// qualquer outro agendador externo pode usar o mesmo cabeçalho. Sem o
// segredo configurado a rota se recusa a executar (fail closed).
//
// Não recebe parâmetros e não aceita dados de negócio: só drena a fila e
// recalcula a partir do estado real do banco. Idempotente.

import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { criarClienteAdmin } from "@/lib/supabase-admin";
import { drenarOutbox } from "@/lib/escala/supabaseIO";
import { processarSombraDoServidor } from "@/lib/escala/sombraSupabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function segredoValido(request: Request): boolean | null {
  const segredo = process.env.CRON_SECRET;
  if (!segredo || segredo.length < 16) return null; // não configurado: recusa tudo
  const cabecalho = request.headers.get("authorization") ?? "";
  const esperado = Buffer.from(`Bearer ${segredo}`);
  const recebido = Buffer.from(cabecalho);
  return recebido.length === esperado.length && timingSafeEqual(recebido, esperado);
}

async function drenar(request: Request) {
  const ok = segredoValido(request);
  if (ok === null) return NextResponse.json({ erro: "Worker não configurado." }, { status: 503 });
  if (!ok) return NextResponse.json({ erro: "Não autorizado." }, { status: 401 });

  try {
    const admin = criarClienteAdmin();
    // Atrasos em aberto que passaram do fim da jornada (17:00) ou de um dia anterior: fecha ANTES de drenar, para o evento `ausencia`
    // gerado pelo fechamento ser processado nesta mesma execução. Nunca impede a drenagem (o fechamento tem retentativa no próximo ciclo).
    let atrasosFechados = 0;
    try {
      const { data, error } = await admin.rpc("fechar_atrasos_vencidos");
      if (error) console.error("escala/drenar: fechamento de atrasos em aberto falhou:", error.message);
      else atrasosFechados = Number(data ?? 0);
    } catch (e) {
      console.error("escala/drenar: fechamento de atrasos em aberto falhou:", e instanceof Error ? e.message : e);
    }
    const resumo = await drenarOutbox(admin, Date.now());
    if (resumo.esgotados > 0) console.error(`escala/drenar: ${resumo.esgotados} evento(s) esgotaram as tentativas`);
    const sombra = await processarSombraDoServidor(admin, Date.now()); // fechamento de períodos (modo sombra); nunca lança
    return NextResponse.json({ ok: true, ...resumo, atrasosFechados, sombra });
  } catch (e) {
    console.error("escala/drenar:", e instanceof Error ? e.message : e);
    return NextResponse.json({ erro: "Falha ao drenar a fila da Escala." }, { status: 500 });
  }
}

// Vercel Cron chama com GET; POST fica para agendadores externos.
export const GET = drenar;
export const POST = drenar;
