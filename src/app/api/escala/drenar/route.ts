// Worker de drenagem da outbox da Escala de Produção — NÃO depende de
// nenhuma tela aberta. Processa eventos pendentes, com erro (até 3
// tentativas) e "processando" travado (> 5 min), reaproveitando exatamente
// o mesmo processador de /api/escala/processar (locks e versões inclusos).
//
// Protegido por segredo server-side (CRON_SECRET, nunca exposto ao client):
// o Vercel Cron envia `Authorization: Bearer $CRON_SECRET` automaticamente;
// qualquer outro agendador externo pode usar o mesmo cabeçalho. O agendador do
// banco (pg_cron + pg_net) usa um token próprio, gerado no Vault e validado pela
// RPC escala_agendador_token_valido. Sem nenhuma credencial configurada a rota
// se recusa a executar (fail closed).
//
// Não recebe parâmetros e não aceita dados de negócio: só drena a fila e
// recalcula a partir do estado real do banco. Idempotente.

import { NextResponse } from "next/server";
import { criarClienteAdmin } from "@/lib/supabase-admin";
import { autorizarWorker } from "@/lib/escala/autorizacaoWorker";
import { drenarOutbox } from "@/lib/escala/supabaseIO";
import { revalidarDisponibilidadeMaquinas } from "@/lib/escala/revalidarDisponibilidade";
import { processarSombraDoServidor } from "@/lib/escala/sombraSupabase";
import { executarFechamentoAutomatico, portaSupabase } from "@/lib/escala-relatorio/fechamentoAutomatico";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function drenar(request: Request) {
  const ok = await autorizarWorker(request.headers.get("authorization") ?? "", process.env.CRON_SECRET, async (token) => {
    const { data, error } = await criarClienteAdmin().rpc("escala_agendador_token_valido", { p_token: token });
    return !error && data === true;
  });
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
    // Disponibilidade das máquinas (Parada/bloqueio): reconcilia e, na janela de cada período, confere a invariante ANTES de drenar — o evento
    // que isto registrar é processado nesta mesma execução. Idempotente e sem mudança = nada; nunca lança.
    const disponibilidade = await revalidarDisponibilidadeMaquinas(admin, Date.now());
    const resumo = await drenarOutbox(admin, Date.now());
    if (resumo.esgotados > 0) console.error(`escala/drenar: ${resumo.esgotados} evento(s) esgotaram as tentativas`);
    const sombra = await processarSombraDoServidor(admin, Date.now()); // fechamento de períodos (modo sombra); nunca lança
    // Fechamento automático do relatório semanal (sexta/sábado/domingo 18:00 → gera e arquiva o PDF final; sem e-mail). Idempotente, nunca impede a drenagem e nunca lança.
    let relatorios: { semana: string; acao: string; detalhe?: string }[] = [];
    try {
      const base = process.env.RELATORIO_BASE_URL && /^https?:\/\//.test(process.env.RELATORIO_BASE_URL) ? process.env.RELATORIO_BASE_URL : new URL(request.url).origin;
      relatorios = await executarFechamentoAutomatico(portaSupabase(admin, base), Date.now());
      relatorios.filter((r) => r.acao === "erro_geracao" || r.acao === "esgotado").forEach((r) => console.error(`escala/drenar: relatório semanal ${r.semana}: ${r.acao} — ${r.detalhe ?? ""}`));
    } catch (e) {
      console.error("escala/drenar: fechamento automático do relatório semanal falhou:", e instanceof Error ? e.message : e);
    }
    return NextResponse.json({ ok: true, ...resumo, atrasosFechados, disponibilidade, sombra, relatorios });
  } catch (e) {
    console.error("escala/drenar:", e instanceof Error ? e.message : e);
    return NextResponse.json({ erro: "Falha ao drenar a fila da Escala." }, { status: 500 });
  }
}

// Vercel Cron chama com GET; POST fica para agendadores externos.
export const GET = drenar;
export const POST = drenar;
