// GOLDEN MASTER dos produtos lineares (prova de equivalência do modelo de rotas — M0/M1).
// Lê o banco (somente leitura) e calcula, para CADA Previsão existente, os resultados do caminho legado: capacidade da Previsão, EntradaEscala, alocações, atingibilidade, WIP.
// Executar ANTES e DEPOIS das migrations e comparar os hashes: qualquer divergência = PARAR.
//   npx tsx scripts/rotas-golden-master.ts <saida.json>        (usa .env.local; recusa banco que não seja o DEV)
import { readFileSync, writeFileSync } from "node:fs";
import { criarClienteAdmin } from "@/lib/supabase-admin";
import { criarEscalaIO } from "@/lib/escala/supabaseIO";
import { montarEntradaEscala } from "@/lib/escala/montarEntrada";
import { gerarEscala } from "@/features/escala/gerarEscala";
import { analisarAtingibilidade } from "@/features/escala/atingibilidade";
import { jsonCanonico, sha256Hex } from "@/features/escala/hashCanonico";
import { calcularAlocacaoSemanal, calcularAnaliseCapacidadeSemanal, calcularCapacidadeInicialPorMaquina, calcularCapacidadeMaximaProduto, calcularCapacidadeMaximaSemana, calcularHorasPorMaquina, calcularItensSemanaAgregados } from "@/features/capacidade/calculations";
import { calcularMargemProduto } from "@/features/custo-hora/calculations";
import type { Maquina, PeriodoComDuracao, PrevisaoItem, Produto } from "@/types/domain";

for (const l of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, ""); }
const h = (v: unknown) => sha256Hex(jsonCanonico(v)).slice(0, 16);
const minutos = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

async function main() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL!.includes("zjwcomwjmhsloyxfypax")) throw new Error("NÃO É DEV");
  const admin = criarClienteAdmin();
  const q = async <T>(p: PromiseLike<{ data: T | null; error: { message: string } | null }>) => { const r = await p; if (r.error) throw new Error(r.error.message); return r.data as T; };
  const [periodosDb, maquinasDb, operacoesDb, produtosDb, etapasDb, compatDb, previsoes] = await Promise.all([
    q(admin.from("periodos").select("id, nome, inicio, fim").order("id")),
    q(admin.from("maquinas").select("id, nome, operacao_id, ativo")),
    q(admin.from("operacoes").select("id, nome")),
    q(admin.from("produtos").select("id, nome, referencia, valor_unitario, ativo, prioridade")),
    q(admin.from("roteiro_etapas").select("id, produto_id, operacao_id, ordem, meta_m1, meta_m2, meta_m3, meta_t1, meta_t2, meta_t3")),
    q(admin.from("roteiro_etapa_maquinas").select("etapa_id, maquina_id")),
    q(admin.from("previsoes").select("id, semana_inicio").order("semana_inicio")),
  ]) as [{ id: string; nome: string; inicio: string; fim: string }[], { id: string; nome: string; operacao_id: string; ativo: boolean }[], { id: string; nome: string }[], { id: string; nome: string; referencia: string | null; valor_unitario: number; ativo: boolean; prioridade: string }[], Record<string, string | number>[], { etapa_id: string; maquina_id: string }[], { id: string; semana_inicio: string }[]];
  const opNome = new Map(operacoesDb.map((o) => [o.id, o.nome]));
  const periodos: PeriodoComDuracao[] = periodosDb.map((p) => ({ id: p.id as PeriodoComDuracao["id"], nome: p.nome, inicio: p.inicio, fim: p.fim, duracaoHoras: (minutos(p.fim) - minutos(p.inicio)) / 60 } as PeriodoComDuracao));
  const horasDia = periodos.reduce((s, p) => s + p.duracaoHoras, 0);
  const maquinas: Maquina[] = maquinasDb.map((m) => ({ id: m.id, nome: m.nome, operacao: opNome.get(m.operacao_id) ?? "", ativo: m.ativo }));
  const produtos: Produto[] = produtosDb.map((p) => ({
    id: p.id, nome: p.nome, referencia: p.referencia ?? "", valorUnitario: Number(p.valor_unitario), ativo: p.ativo, prioridade: p.prioridade as Produto["prioridade"],
    roteiro: etapasDb.filter((e) => e.produto_id === p.id).sort((a, b) => Number(a.ordem) - Number(b.ordem)).map((e) => ({
      id: String(e.id), operacao: opNome.get(String(e.operacao_id)) ?? "", metas: { m1: Number(e.meta_m1), m2: Number(e.meta_m2), m3: Number(e.meta_m3), t1: Number(e.meta_t1), t2: Number(e.meta_t2), t3: Number(e.meta_t3) },
      maquinasIds: compatDb.filter((c) => c.etapa_id === e.id).map((c) => c.maquina_id).sort(),
    })),
  }));
  // O CORPUS = produtos LINEARES: só os que NÃO têm estrutura de rotas (antes das migrations nenhum tem; depois exclui F)
  let comRotas = new Set<string>();
  const tr = await admin.from("produto_rota").select("produto_id");
  if (!tr.error) comRotas = new Set((tr.data ?? []).map((r) => r.produto_id as string));
  const lineares = produtos.filter((p) => !comRotas.has(p.id));

  const semanas: Record<string, unknown> = {};
  for (const pv of previsoes) {
    const itensDb = await q(admin.from("previsao_itens").select("id, produto_id, produto_nome, valor_unitario, quantidade, tipo, quantidade_adicional, previsao_item_maquinas(etapa_id, maquina_id)").eq("previsao_id", pv.id).eq("tipo", "previsto")) as { id: string; produto_id: string; produto_nome: string; valor_unitario: number; quantidade: number; previsao_item_maquinas: { etapa_id: string; maquina_id: string }[] }[];
    const diasAtivos = ((await q(admin.from("previsao_dias_produtivos").select("dia, ativo").eq("previsao_id", pv.id))) as { dia: string; ativo: boolean }[]).filter((d) => d.ativo).length;
    const itens: PrevisaoItem[] = itensDb.filter((i) => !comRotas.has(i.produto_id)).sort((a, b) => (a.id < b.id ? -1 : 1)).map((i) => {
      const mpe: Record<string, string[]> = {};
      i.previsao_item_maquinas.forEach((r) => { mpe[r.etapa_id] = [...(mpe[r.etapa_id] ?? []), r.maquina_id].sort(); });
      return { id: i.id, produtoId: i.produto_id, produtoNome: i.produto_nome, valorUnitario: Number(i.valor_unitario), quantidade: Number(i.quantidade), maquinasPorEtapa: mpe } as PrevisaoItem;
    });
    const horasSemana = horasDia * Math.max(diasAtivos, 1);
    const indispPrev = ((await q(admin.from("previsao_maquinas_indisponiveis").select("maquina_id").eq("previsao_id", pv.id))) as { maquina_id: string }[]).map((r) => r.maquina_id).sort();
    const analise = calcularAnaliseCapacidadeSemanal(itens, lineares, maquinas, periodos, horasSemana);
    const maxSemana = calcularCapacidadeMaximaSemana(itens, lineares, maquinas, periodos, horasSemana);
    const porItem = itens.map((i) => ({ id: i.id, ...calcularCapacidadeMaximaProduto(i.produtoId, i.maquinasPorEtapa, lineares, periodos, horasSemana) }));
    const horasMaq = calcularHorasPorMaquina(itens, lineares, periodos, horasSemana);
    const agregados = calcularItensSemanaAgregados(itens);
    const aloc = calcularAlocacaoSemanal(agregados, itens, lineares, calcularCapacidadeInicialPorMaquina(maquinas, indispPrev, horasSemana), periodos, maquinas, [...new Set(maquinas.map((m) => m.operacao))].sort(), horasSemana, horasDia / periodos.length,
      (p) => calcularMargemProduto(p, {}, 30, periodos).lucroHora);
    // caminho do motor da Escala (carregamento real + montagem + geração + atingibilidade) — com instante fixo (início da semana)
    const agoraMs = Date.parse(`${pv.semana_inicio}T00:00:00-03:00`);
    let escala: Record<string, unknown> = { erro: "sem entrada" };
    try {
      const estado = await criarEscalaIO(admin, pv.id).carregarEstado(agoraMs);
      const montada = montarEntradaEscala(estado, agoraMs);
      const resultado = gerarEscala(montada.entrada);
      const ating = analisarAtingibilidade(montada.entrada, resultado);
      escala = {
        poolsHash: h(montada.entrada.pools.filter((p) => !comRotas.has(p.produtoId))), entradaHash: h(montada.entrada), avisosHash: h(montada.avisos), alocacoesHash: h(resultado.alocacoes), alertasHash: h(resultado.alertas),
        atingibilidadeHash: h(ating), nAlocacoes: resultado.alocacoes.length, nPools: montada.entrada.pools.length, statusAtingibilidade: ating.status,
      };
    } catch (e) { escala = { erro: (e as Error).message }; }
    semanas[pv.semana_inicio] = {
      capacidade: { analise: h(analise), maximo: h(maxSemana), porItem: h(porItem), horasPorMaquina: h(horasMaq), alocacaoSemanal: h(aloc), horasSemana, itens: itens.length },
      escala,
    };
  }
  // WIP (corpus linear): estado bruto completo das tabelas de WIP
  const wip: Record<string, unknown> = {};
  for (const t of ["wip_controle", "wip_ajustes", "wip_confirmacoes", "wip_saldo_semanal"]) wip[t] = h(await q(admin.from(t).select("*").order("id")));
  // linhas dos cadastros LEGADOS (identidade das etapas/produtos/máquinas por etapa) — excluindo qualquer produto com rotas
  const legado = {
    produtos: h(produtosDb.filter((p) => !comRotas.has(p.id)).sort((a, b) => (a.id < b.id ? -1 : 1))),
    roteiro_etapas: h(etapasDb.filter((e) => !comRotas.has(String(e.produto_id))).sort((a, b) => (String(a.id) < String(b.id) ? -1 : 1))),
    roteiro_etapa_maquinas: h(compatDb.filter((c) => etapasDb.some((e) => e.id === c.etapa_id && !comRotas.has(String(e.produto_id)))).sort((a, b) => (`${a.etapa_id}${a.maquina_id}` < `${b.etapa_id}${b.maquina_id}` ? -1 : 1))),
    n_produtos_lineares: lineares.length,
  };
  writeFileSync(process.argv[2], JSON.stringify({ gerado_com: "rotas-golden-master v1", legado, wip, semanas }, null, 2));
  console.log(`golden master: ${previsoes.length} previsões, ${lineares.length} produtos lineares → ${process.argv[2]}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
