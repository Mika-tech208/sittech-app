// EXECUÇÃO EM SOMBRA do planejador + adaptador + motor + feedback (M2/M3): lê o DEV (somente leitura nas tabelas existentes), monta uma Previsão SIMULADA do Conector 3/4" (Final) com seleção
// EXPLÍCITA de máquinas (por nome — como a pessoa marcaria; nada vem do cadastro) e roda os cenários. Grava SOMENTE em `rotas_planejador_sombra` (append-only).
// Não toca Previsão, Escala, WIP, apontamentos nem `escala_rota_divisao`; não liga a trava de suporte.
//   npx tsx scripts/rotas-planejador-sombra.ts [--gravar]      (usa .env.local; recusa banco que não seja o DEV; sem --gravar apenas imprime)
import { readFileSync } from "node:fs";
import { criarClienteAdmin } from "@/lib/supabase-admin";
import { jsonCanonico, sha256Hex } from "@/features/escala/hashCanonico";
import { epochMsNoFuso } from "@/features/escala/tempo";
import type { LinhasRotas } from "@/features/rotas/dados";
import { resolverRotas } from "@/features/rotas/resolucao";
import { estadoDeSimulacao, type EntradaSimulacao } from "@/features/rotas/simulacao";

for (const l of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, ""); }
const CUSTO_HORA_REFERENCIA = 30.6;   // referência uniforme: o custo/hora real por operação vem da UI (/produtos/rotas)
const SEMANA = "2026-11-02";

async function main() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL!.includes("zjwcomwjmhsloyxfypax")) throw new Error("NÃO É DEV");
  const gravar = process.argv.includes("--gravar");
  const admin = criarClienteAdmin();
  const q = async <T>(p: PromiseLike<{ data: T | null; error: { message: string } | null }>) => { const r = await p; if (r.error) throw new Error(r.error.message); return (r.data ?? []) as T; };
  const [rotas, rotaEtapas, poolComum, etapas, etapaMaquinas, operacoes, maquinas, periodos, produtos] = await Promise.all([
    q<LinhasRotas["rotas"]>(admin.from("produto_rota").select("id, produto_id, codigo, nome, ativa, preferencia")),
    q<LinhasRotas["rotaEtapas"]>(admin.from("rota_etapas").select("rota_id, etapa_id, posicao")),
    q<LinhasRotas["poolComum"]>(admin.from("produto_pool_comum").select("produto_id, etapa_id, posicao, final")),
    q<LinhasRotas["etapas"]>(admin.from("roteiro_etapas").select("id, produto_id, operacao_id, ordem, meta_m1, meta_m2, meta_m3, meta_t1, meta_t2, meta_t3")),
    q<LinhasRotas["etapaMaquinas"]>(admin.from("roteiro_etapa_maquinas").select("etapa_id, maquina_id")),
    q<LinhasRotas["operacoes"]>(admin.from("operacoes").select("id, nome")),
    q<{ id: string; nome: string }[]>(admin.from("maquinas").select("id, nome")),
    q<{ id: string; inicio: string; fim: string }[]>(admin.from("periodos").select("id, inicio, fim").order("id")),
    q<{ id: string; nome: string; valor_unitario: number }[]>(admin.from("produtos").select("id, nome, valor_unitario")),
  ]);
  const produtoF = rotas[0]?.produto_id;
  if (!produtoF) throw new Error("Nenhum produto com rotas no DEV.");
  const F = produtos.find((p) => p.id === produtoF)!;
  const linhas: LinhasRotas = { produtoId: produtoF, etapas, etapaMaquinas, operacoes, rotas, rotaEtapas, poolComum };
  const idMaq = (nome: string) => maquinas.find((m) => m.nome.trim() === nome)?.id;
  const etapaDe = (op: string) => etapas.find((e) => e.produto_id === produtoF && operacoes.find((o) => o.id === e.operacao_id)?.nome === op)!.id;
  const marcar = (m: Record<string, string[]>) => Object.fromEntries(Object.entries(m).map(([op, nomes]) => [etapaDe(op), nomes.map((n) => idMaq(n)).filter((x): x is string => !!x)]));
  // seleção da pessoa (só o que ela marcou): AUTO = Máquina Automática 8; CONV = Rosqueadeira 6 (única no cadastro DEV) e Parafusadeiras 9 e 10; Etiquetar = só E15; Embalar = 17
  const BASE = { Rosquear: ["Rosqueadeira 6"], Parafusar: ["Parafusadeira 9", "Parafusadeira 10"], "Rosquear + Parafusar": ["Maquina Automatica 8"], Etiquetar: ["Etiquetadora 15"], Embalar: ["Embalagem 17"] };
  const base = (o: Partial<EntradaSimulacao> = {}): EntradaSimulacao => ({
    produtoId: produtoF, nomeProduto: F.nome, valorUnitario: Number(F.valor_unitario), linhas, todasEtapas: etapas, todasEtapaMaquinas: etapaMaquinas, periodos, semanaInicio: SEMANA, dias: 5,
    demanda: 116625, selecao: marcar(BASE), maquinasIndisponiveis: [], outros: [], pessoas: 20, custoHoraPadrao: CUSTO_HORA_REFERENCIA, ...o,
  });
  const caixa = (q: number, ms: string[]) => ({ produtoId: "00000000-0000-4000-8000-00000000cafe", nome: "Caixa Amarela (simulada)", quantidade: q, valorUnitario: 0.35, maquinasPorEtapa: {} as Record<string, string[]>, _ms: ms });
  void caixa;

  const cenarios: { rotulo: string; entrada: EntradaSimulacao }[] = [
    { rotulo: "M3_selecao_E15_somente", entrada: base() },
    { rotulo: "M3_selecao_E15_E16", entrada: base({ selecao: marcar({ ...BASE, Etiquetar: ["Etiquetadora 15", "Etiquetadora 16"] }) }) },
    { rotulo: "M3_nada_marcado", entrada: base({ selecao: {} }) },
    { rotulo: "M3_demanda_20000", entrada: base({ demanda: 20000 }) },
    { rotulo: "M3_AUTO_sem_maquina", entrada: base({ selecao: marcar({ ...BASE, "Rosquear + Parafusar": [] }) }) },
    { rotulo: "M3_AUTO_cai_na_quinta", entrada: base({ selecao: marcar({ ...BASE, Etiquetar: ["Etiquetadora 15", "Etiquetadora 16"] }), maquinaQueCai: { maquinaId: idMaq("Maquina Automatica 8")!, desdeIso: "2026-11-05T03:00:00.000Z" } }) },
  ];
  const saidas = [];
  for (const c of cenarios) {
    const estado = estadoDeSimulacao(c.entrada);
    const r = resolverRotas(estado, epochMsNoFuso(SEMANA, "05:00"));
    const p = r?.produtos[produtoF];
    if (!p) { saidas.push({ rotulo: c.rotulo, aviso: "sem item de rotas" }); continue; }
    const ult = p.rodadas.at(-1);
    if (process.env.DEBUG_SOMBRA) console.log(c.rotulo, JSON.stringify({ pool: p.previa.plano.poolComum.porOperacao, entrada: p.previa.plano.capacidadeEntrada, rotas: Object.fromEntries(Object.entries(p.previa.plano.capacidadePorRota).map(([k, v]) => [k, Math.round(v.realizavel)])), gargalo: p.previa.plano.gargalo }));
    const entradaJson = { rotulo: c.rotulo, demanda: c.entrada.demanda, dias: c.entrada.dias, pessoas: c.entrada.pessoas, selecao: c.entrada.selecao, maquinaQueCai: c.entrada.maquinaQueCai ?? null, semana: SEMANA };
    const hashEntrada = sha256Hex(jsonCanonico(entradaJson));
    saidas.push({
      rotulo: c.rotulo, rodadas: p.rodadas.length, parada: p.parada, final: Math.round(p.plano.final), falta: Math.round(p.previa.plano.falta), AUTO: Math.round(p.plano.alvo.AUTO ?? 0), CONV: Math.round(p.plano.alvo.CONV ?? 0),
      nomAUTO: Math.round(p.rodadas[0]?.capacidadeNominalPorRota.AUTO ?? 0), realAUTO: Math.round(ult?.capacidadeRealizavelPorRota.AUTO ?? 0), gargalo: p.previa.plano.gargalo?.tipo === "comum" ? `comum:${p.previa.plano.gargalo.operacao}` : p.previa.plano.gargalo ? "entrada" : "-",
    });
    if (gravar) {
      const ins = await admin.from("rotas_planejador_sombra").insert({
        algoritmo_versao: p.previa.plano.versao, produto_id: produtoF, semana_inicio: SEMANA, rotulo: c.rotulo, entrada: entradaJson, resultado: JSON.parse(JSON.stringify({ parada: p.parada, convergiu: p.convergiu, rodadas: p.rodadas, diagnostico: p.diagnostico, plano: p.plano })),
        gargalo: p.previa.plano.gargalo, divisao: p.plano.alvo, custo: p.previa.plano.custo ?? null, hash_entrada: hashEntrada,
      });
      if (ins.error) throw new Error(`gravar sombra: ${ins.error.message}`);
    }
  }
  console.table(saidas);
  console.log(gravar ? `Gravadas ${saidas.length} linhas em rotas_planejador_sombra.` : "Simulação (nada gravado). Use --gravar para registrar na tabela de sombra.");
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
