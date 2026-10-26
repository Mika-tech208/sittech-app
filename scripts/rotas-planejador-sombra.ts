// EXECUÇÃO EM SOMBRA do planejador de rotas (M2): lê o DEV (somente leitura nas tabelas existentes), roda os cenários do Conector 3/4" (Final) com os dados reais do DEV e
// grava SOMENTE em `rotas_planejador_sombra` (append-only). Não toca Previsão, Escala, WIP, apontamentos nem `escala_rota_divisao`.
//   npx tsx scripts/rotas-planejador-sombra.ts [--gravar]      (usa .env.local; recusa banco que não seja o DEV; sem --gravar apenas imprime)
import { readFileSync } from "node:fs";
import { criarClienteAdmin } from "@/lib/supabase-admin";
import { jsonCanonico, sha256Hex } from "@/features/escala/hashCanonico";
import { estruturaDasLinhas, etapasDoProduto, horasComprometidasPorOutros, selecaoComoPrevisaoLegada, type LinhasRotas } from "@/features/rotas/dados";
import { horasMaquinaSemana } from "@/features/rotas/capacidade";
import { planejarRotas, type EntradaPlanejador } from "@/features/rotas/planejador";
import type { ContextoCusto } from "@/features/rotas/custo";
import type { ContextoCapacidade, PeriodoId } from "@/features/rotas/tipos";

for (const l of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, ""); }
const min = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const CUSTO_HORA_REFERENCIA = 30.6;   // referência uniforme: o custo/hora real por operação vem da UI (/produtos/rotas); aqui só importa a ordem de grandeza

async function main() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL!.includes("zjwcomwjmhsloyxfypax")) throw new Error("NÃO É DEV");
  const gravar = process.argv.includes("--gravar");
  const admin = criarClienteAdmin();
  const q = async <T>(p: PromiseLike<{ data: T | null; error: { message: string } | null }>) => { const r = await p; if (r.error) throw new Error(r.error.message); return (r.data ?? []) as T; };
  const [rotas, rotaEtapas, poolComum, variantes, etapas, etapaMaquinas, operacoes, maquinas, periodosDb, previsoes] = await Promise.all([
    q<LinhasRotas["rotas"]>(admin.from("produto_rota").select("id, produto_id, codigo, nome, ativa, preferencia")),
    q<LinhasRotas["rotaEtapas"]>(admin.from("rota_etapas").select("rota_id, etapa_id, posicao")),
    q<LinhasRotas["poolComum"]>(admin.from("produto_pool_comum").select("produto_id, etapa_id, posicao, final")),
    q<{ produto_legado_id: string; produto_final_id: string }[]>(admin.from("produto_variante_legada").select("produto_legado_id, produto_final_id")),
    q<LinhasRotas["etapas"]>(admin.from("roteiro_etapas").select("id, produto_id, operacao_id, ordem, meta_m1, meta_m2, meta_m3, meta_t1, meta_t2, meta_t3")),
    q<LinhasRotas["etapaMaquinas"]>(admin.from("roteiro_etapa_maquinas").select("etapa_id, maquina_id")),
    q<LinhasRotas["operacoes"]>(admin.from("operacoes").select("id, nome")),
    q<{ id: string; nome: string }[]>(admin.from("maquinas").select("id, nome")),
    q<{ id: string; inicio: string; fim: string }[]>(admin.from("periodos").select("id, inicio, fim").order("id")),
    q<{ id: string; semana_inicio: string; modelo_rotas: boolean }[]>(admin.from("previsoes").select("id, semana_inicio, modelo_rotas").order("semana_inicio", { ascending: false })),
  ]);
  const produtoF = rotas[0]?.produto_id;
  if (!produtoF) throw new Error("Nenhum produto com rotas no DEV.");
  const linhas: LinhasRotas = { produtoId: produtoF, etapas, etapaMaquinas, operacoes, rotas, rotaEtapas, poolComum };
  const etapasF = etapasDoProduto(linhas), estrutura = estruturaDasLinhas(linhas);
  const periodos = periodosDb.map((p) => ({ id: p.id as PeriodoId, minutos: min(p.fim) - min(p.inicio) }));
  const legados = new Set(variantes.filter((v) => v.produto_final_id === produtoF).map((v) => v.produto_legado_id));
  const semana = previsoes.find((p) => !p.modelo_rotas);
  const itens = semana ? await q<{ produto_id: string; quantidade: number; previsao_item_maquinas: { etapa_id: string; maquina_id: string }[] }[]>(admin.from("previsao_itens").select("produto_id, quantidade, previsao_item_maquinas(etapa_id, maquina_id)").eq("previsao_id", semana.id).eq("tipo", "previsto")) : [];
  const opDaEtapa = new Map(etapas.map((e) => [e.id, e.operacao_id]));
  const etapasPorId = new Map(etapas.map((e) => [e.id, { operacaoId: e.operacao_id, metas: { m1: Number(e.meta_m1), m2: Number(e.meta_m2), m3: Number(e.meta_m3), t1: Number(e.meta_t1), t2: Number(e.meta_t2), t3: Number(e.meta_t3) } as Record<PeriodoId, number> }]));
  const selecao = selecaoComoPrevisaoLegada(etapasF, itens, legados, opDaEtapa);
  const base: ContextoCapacidade = { periodos, diasProdutivos: 5 };
  const comprometidas = horasComprometidasPorOutros(itens, new Set([produtoF, ...legados]), etapasPorId, base);
  const custo: ContextoCusto = { periodos, custoHoraPorOperacao: {}, custoHoraPadrao: CUSTO_HORA_REFERENCIA };
  const etiqId = estrutura.poolComum?.etapas.find((id) => etapasF.get(id)?.operacao === "Etiquetar") as string;
  const e16 = etapasF.get(etiqId)?.maquinasIds.find((m) => /16/.test(maquinas.find((x) => x.id === m)?.nome ?? ""));
  const autoMaquinas = etapasF.get(estrutura.rotas.find((r) => r.codigo === "AUTO")!.etapas[0])?.maquinasIds ?? [];
  // cadastro do DEV (Etapas de F com TODAS as máquinas elegíveis, sem concorrência de outros produtos): condição de referência para os cenários controlados
  const todas = Object.fromEntries([...etapasF.values()].map((e) => [e.id, e.maquinasIds])) as Record<string, string[]>;
  const comE16 = (livre: number) => ({ selecao: { ...todas, [etiqId]: [...new Set([...(selecao[etiqId] ?? []), ...(e16 ? [e16] : [])])] }, ctx: { ...base, horasComprometidasPorMaquina: { ...(e16 ? { [e16]: horasMaquinaSemana(base) * (1 - livre) } : {}) } } });

  const cenarios: { rotulo: string; extra: Partial<EntradaPlanejador> }[] = [
    { rotulo: "dev_como_esta_previsao_26_10", extra: { ctx: { ...base, horasComprometidasPorMaquina: comprometidas }, selecao } },   // estado real do DEV (a Previsão 26/10 do DEV só tem o item A + concorrência de Luvas)
    { rotulo: "cadastro_todas_maquinas_E16_ocupada", extra: { ...comE16(0) } },
    ...[0.25, 0.5, 1].map((l) => ({ rotulo: `cadastro_E16_${l * 100}pct`, extra: comE16(l) })),
    { rotulo: "demanda_20000", extra: { demanda: 20000, ...comE16(1) } },
    { rotulo: "AUTO_parada", extra: { ...comE16(1), ctx: { ...comE16(1).ctx, maquinasIndisponiveis: autoMaquinas } } },
    { rotulo: "sabado_produtivo_E16_ocupada", extra: { ...comE16(0), ctx: { ...comE16(0).ctx, diasProdutivos: 6 } } },
  ];
  const saidas = [];
  for (const c of cenarios) {
    const entrada: EntradaPlanejador = { estrutura, etapas: etapasF, demanda: 116625, ctx: { ...base, horasComprometidasPorMaquina: comprometidas }, selecao, custo, valorUnitario: 0.1825, ...c.extra };
    const r = planejarRotas(entrada);
    if (!r.aplicavel) throw new Error("não aplicável");
    // a entrada gravada é serializável (Map → objeto) e SEM dados pessoais
    const entradaJson = { ...entrada, etapas: Object.fromEntries(entrada.etapas), estrutura: undefined, estruturaProduto: estrutura.produtoId, rotulo: c.rotulo };
    const hashEntrada = sha256Hex(jsonCanonico(entradaJson));
    saidas.push({ rotulo: c.rotulo, final: Math.round(r.finalAtingivel), falta: Math.round(r.falta), pct: Number(r.percentualAtingivel.toFixed(1)), AUTO: Math.round(r.alvo.AUTO ?? 0), CONV: Math.round(r.alvo.CONV ?? 0), pool: Math.round(r.poolComum.capacidade), gargalo: r.gargalo?.tipo === "comum" ? `comum:${r.gargalo.operacao}` : r.gargalo ? "entrada" : "-", custo: r.custo ? Number(r.custo.estimado.toFixed(2)) : null, economiaAuto: r.custo?.economiaAuto ? Number(r.custo.economiaAuto.total.toFixed(2)) : null });
    if (gravar) {
      const ins = await admin.from("rotas_planejador_sombra").insert({ algoritmo_versao: r.versao, produto_id: produtoF, semana_inicio: semana?.semana_inicio ?? null, rotulo: c.rotulo, entrada: JSON.parse(JSON.stringify(entradaJson)), resultado: JSON.parse(JSON.stringify(r)), gargalo: r.gargalo, divisao: r.alvo, custo: r.custo, hash_entrada: hashEntrada });
      if (ins.error) throw new Error(`gravar sombra: ${ins.error.message}`);
    }
  }
  console.table(saidas);
  console.log(gravar ? `Gravadas ${saidas.length} linhas em rotas_planejador_sombra.` : "Simulação (nada gravado). Use --gravar para registrar na tabela de sombra.");
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
