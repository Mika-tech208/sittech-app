// Cobertura da equipe na Previsão Semanal — SOMENTE LEITURA (nada é gravado).
// Exige a permissão `previsao`. Usa o MESMO motor que gera a Escala (simularCobertura →
// montarEntradaEscala + gerarEscala); o diagnóstico só conta o que o motor produziu.
//
// Corpo: { semana_inicio: "AAAA-MM-DD", sugerir?: boolean,
//          itens?: [{ produto_id, quantidade?, quantidade_adicional?, maquinas_por_etapa?, valor_unitario? }] }
// `itens` (opcional) substitui os itens previstos salvos — usado pelo modo simulação e pela
// edição manual da carga adicional ANTES de salvar, para mostrar a consequência na hora.

import { NextResponse } from "next/server";
import { criarClienteAdmin } from "@/lib/supabase-admin";
import { autenticarRequisicaoIntelligence } from "@/features/intelligence/auth";
import { temPermissao } from "@/lib/permissoes";
import { criarEscalaIO, resolverPrevisaoPorSemana } from "@/lib/escala/supabaseIO";
import { simularCobertura } from "@/lib/escala/simularCobertura";
import type { ItemPrevistoBruto } from "@/lib/escala/estado";

export const runtime = "nodejs";
export const maxDuration = 30;

interface ItemRascunho {
  produto_id?: string;
  quantidade?: number;
  quantidade_adicional?: number;
  valor_unitario?: number;
  maquinas_por_etapa?: Record<string, string[]>;
}

export async function POST(request: Request) {
  const auth = await autenticarRequisicaoIntelligence(request);
  if (!auth || !(temPermissao(auth.usuario, "previsao") || temPermissao(auth.usuario, "escala_producao"))) {
    return NextResponse.json({ erro: "Não autorizado." }, { status: 403 });
  }
  const body = await request.json().catch(() => null);
  const semana = typeof body?.semana_inicio === "string" ? body.semana_inicio : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(semana)) return NextResponse.json({ erro: "semana_inicio inválida." }, { status: 400 });

  try {
    const admin = criarClienteAdmin();
    const previsaoId = await resolverPrevisaoPorSemana(admin, semana);
    if (!previsaoId) return NextResponse.json({ erro: "Salve a Previsão desta semana antes de analisar a cobertura." }, { status: 404 });

    const estado = await criarEscalaIO(admin, previsaoId).carregarEstado();

    if (Array.isArray(body.itens)) {
      const salvos = new Map(estado.itens.map((i) => [i.produtoId, i]));
      const itens: ItemPrevistoBruto[] = [];
      for (const it of body.itens as ItemRascunho[]) {
        if (typeof it.produto_id !== "string") continue;
        const salvo = salvos.get(it.produto_id);
        const adicional = Number(it.quantidade_adicional ?? 0);
        if (!Number.isFinite(adicional) || adicional < 0) return NextResponse.json({ erro: "Quantidade adicional inválida." }, { status: 400 });
        itens.push({
          produtoId: it.produto_id,
          quantidade: Number(it.quantidade ?? salvo?.quantidade ?? 0),
          quantidadeAdicional: adicional,
          valorUnitario: Number(it.valor_unitario ?? salvo?.valorUnitario ?? 0),
          maquinasPorEtapa: it.maquinas_por_etapa ?? salvo?.maquinasPorEtapa ?? {},
        });
      }
      estado.itens = itens;
    }

    const resultado = simularCobertura(estado, Date.now(), { sugerir: body.sugerir === true });
    return NextResponse.json({ ok: true, ...resultado });
  } catch (e) {
    console.error("escala/simular-cobertura:", e instanceof Error ? e.message : e);
    return NextResponse.json({ erro: "Falha ao simular a cobertura." }, { status: 500 });
  }
}
