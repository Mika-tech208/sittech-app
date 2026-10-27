// SHADOW OFFLINE (somente leitura): roda o planejador + adaptador + motor + feedback sobre um EXPORT json do banco (gerado por supabase/tests/rotas/prod_export_sombra.sql).
// Não conecta em banco nenhum e não escreve nada além do arquivo de saída (e, se pedido, um .sql com INSERTs para a tabela de sombra própria).
//   npx tsx scripts/rotas-sombra-offline.ts <export.json.out> <saida.json> [--sql <saida.sql>]
import { readFileSync, writeFileSync } from "node:fs";
import { checarInvariantes } from "@/features/escala/__tests__/helpers";
import { gerarEscala } from "@/features/escala/gerarEscala";
import { jsonCanonico, sha256Hex } from "@/features/escala/hashCanonico";
import { epochMsNoFuso } from "@/features/escala/tempo";
import type { LinhasRotas } from "@/features/rotas/dados";
import { resolverRotas } from "@/features/rotas/resolucao";
import { estadoDeSimulacao, type EntradaSimulacao } from "@/features/rotas/simulacao";
import { montarEntradaEscala } from "@/lib/escala/montarEntrada";
import { custoHoraDaEmpresa, mapearFixedCost, mapearFuncionario, mapearPeriodo, type FixedCostRow, type FuncionarioRow, type PeriodoRow } from "@/lib/custo/custoHoraDados";
import { reverterResultado } from "@/features/rotas/adaptador";

const SEMANA = "2026-11-02";
async function main() {
  const [, , entrada, saida, ...resto] = process.argv;
  const bruto = JSON.parse(readFileSync(entrada, "utf8"));
  const j = bruto.rows[0].j;
  const F = j.produtoF as { id: string; nome: string; valor_unitario: number };
  const linhas: LinhasRotas = { produtoId: F.id, etapas: j.etapas, etapaMaquinas: j.etapaMaquinas, operacoes: j.operacoes, rotas: j.rotas, rotaEtapas: j.rotaEtapas, poolComum: j.poolComum };
  const custoHora = custoHoraDaEmpresa({ funcionarios: (j.funcionarios as FuncionarioRow[]).map(mapearFuncionario), fixedCosts: (j.fixedCosts as FixedCostRow[]).map(mapearFixedCost), periodos: (j.periodos as PeriodoRow[]).map(mapearPeriodo), diasUteis: j.diasUteis });
  const maquinas = j.maquinas as { id: string; nome: string }[];
  const idMaq = (n: string) => maquinas.find((m) => m.nome.trim() === n)?.id;
  const etapaDe = (op: string) => (j.etapas as { id: string; produto_id: string; operacao_id: string }[]).find((e) => e.produto_id === F.id && j.operacoes.find((o: { id: string; nome: string }) => o.id === e.operacao_id)?.nome === op)!.id;
  const marcar = (m: Record<string, string[]>) => Object.fromEntries(Object.entries(m).map(([op, nomes]) => [etapaDe(op), nomes.map((n) => idMaq(n)).filter((x): x is string => !!x)]));
  const BASE = { Rosquear: ["Rosqueadeira 3", "Rosqueadeira 6"], Parafusar: ["Parafusadeira 9", "Parafusadeira 10"], "Rosquear + Parafusar": ["Maquina Automatica 8"], Etiquetar: ["Etiquetadora 15"], Embalar: ["Embalagem 17"] };
  const base = (o: Partial<EntradaSimulacao> = {}): EntradaSimulacao => ({
    produtoId: F.id, nomeProduto: F.nome, valorUnitario: Number(F.valor_unitario), linhas, todasEtapas: j.etapas, todasEtapaMaquinas: j.etapaMaquinas, periodos: j.periodos, semanaInicio: SEMANA, dias: 5,
    demanda: 116625, selecao: marcar(BASE), maquinasIndisponiveis: [], outros: [], pessoas: (j.funcionarios as { ativo: boolean }[]).filter((f) => f.ativo).length,
    custoHoraPorOperacao: custoHora.custoHoraPorOperacao, custoHoraPadrao: custoHora.custoHoraEmpresa, ...o,
  });
  const cenarios: { rotulo: string; esperado?: { final: number; falta: number }; entrada: EntradaSimulacao }[] = [
    { rotulo: "caso_real_E15_somente", esperado: { final: 97500, falta: 19125 }, entrada: base() },
    { rotulo: "E15_E16_marcadas", esperado: { final: 116625, falta: 0 }, entrada: base({ selecao: marcar({ ...BASE, Etiquetar: ["Etiquetadora 15", "Etiquetadora 16"] }) }) },
    { rotulo: "CONV_todas_maquinas_E15", entrada: base({ selecao: marcar({ ...BASE, Rosquear: ["Rosqueadeira 3", "Rosqueadeira 5", "Rosqueadeira 6"], Parafusar: ["Parafusadeira 9", "Parafusadeira 10", "Parafusadeira 11", "Parafusadeira 12"] }) }) },
    { rotulo: "AUTO_nao_marcada", entrada: base({ selecao: marcar({ ...BASE, "Rosquear + Parafusar": [] }) }) },
    { rotulo: "nada_marcado_controle_humano", esperado: { final: 0, falta: 116625 }, entrada: base({ selecao: {} }) },
    { rotulo: "demanda_20000", esperado: { final: 20000, falta: 0 }, entrada: base({ demanda: 20000 }) },
    { rotulo: "AUTO_cai_na_quinta", entrada: base({ selecao: marcar({ ...BASE, Etiquetar: ["Etiquetadora 15", "Etiquetadora 16"] }), maquinaQueCai: { maquinaId: idMaq("Maquina Automatica 8")!, desdeIso: "2026-11-05T03:00:00.000Z" } }) },
  ];
  const linhasSaida = [], sql: string[] = [];
  for (const c of cenarios) {
    const estado = estadoDeSimulacao(c.entrada);
    const agoraMs = epochMsNoFuso(SEMANA, "05:00");
    const r = resolverRotas(estado, agoraMs);
    const p = r?.produtos[F.id];
    if (!p) { linhasSaida.push({ rotulo: c.rotulo, aviso: "sem produto de rotas" }); continue; }
    const m = montarEntradaEscala(estado, agoraMs);
    const res = reverterResultado(gerarEscala(m.entrada));
    const inv = checarInvariantes(m.entrada, gerarEscala(m.entrada));
    const permitidas = new Set(Object.values(c.entrada.selecao).flat());
    const foraDaSelecao = res.alocacoes.filter((a) => a.maquinaId && a.produtoId === F.id && !permitidas.has(a.maquinaId)).length;
    const plano = p.previa.plano, ult = p.rodadas.at(-1)!;
    const ok = c.esperado ? Math.round(p.plano.final) === c.esperado.final && Math.round(plano.falta) === c.esperado.falta : null;
    linhasSaida.push({
      rotulo: c.rotulo, pessoas: c.entrada.pessoas, final: Math.round(p.plano.final), falta: Math.round(plano.falta), pct: Number(plano.percentualAtingivel.toFixed(1)), AUTO: Math.round(p.plano.alvo.AUTO ?? 0), CONV: Math.round(p.plano.alvo.CONV ?? 0),
      nomAUTO: Math.round(p.rodadas[0].capacidadeNominalPorRota.AUTO ?? 0), realAUTO: Math.round(ult.capacidadeRealizavelPorRota.AUTO ?? 0), etiqueta: Math.round(plano.poolComum.porOperacao.Etiquetar ?? 0), embala: Math.round(plano.poolComum.porOperacao.Embalar ?? 0),
      gargalo: plano.gargalo?.tipo === "comum" ? `comum:${plano.gargalo.operacao}` : plano.gargalo ? "entrada" : "-", rodadas: p.rodadas.length, parada: p.parada, custo: plano.custo ? Number(plano.custo.estimado.toFixed(2)) : null, economiaAuto: plano.custo?.economiaAuto ? Number(plano.custo.economiaAuto.total.toFixed(2)) : null,
      invariantesMotor: inv.length === 0, maquinaForaDaSelecao: foraDaSelecao, esperadoOK: ok,
    });
    const entradaJson = { rotulo: c.rotulo, demanda: c.entrada.demanda, dias: c.entrada.dias, pessoas: c.entrada.pessoas, selecao: c.entrada.selecao, maquinaQueCai: c.entrada.maquinaQueCai ?? null, semana: SEMANA, origem: "shadow offline sobre export de PROD" };
    const lit = (v: unknown) => `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
    sql.push(`insert into rotas_planejador_sombra (algoritmo_versao, produto_id, semana_inicio, rotulo, entrada, resultado, gargalo, divisao, custo, hash_entrada) values ('${plano.versao}', '${F.id}', '${SEMANA}', '${"PROD_" + c.rotulo}', ${lit(entradaJson)}, ${lit({ parada: p.parada, convergiu: p.convergiu, rodadas: p.rodadas, diagnostico: p.diagnostico, plano: p.plano })}, ${plano.gargalo ? lit(plano.gargalo) : "null"}, ${lit(p.plano.alvo)}, ${plano.custo ? lit(plano.custo) : "null"}, '${sha256Hex(jsonCanonico(entradaJson))}');`);
  }
  console.table(linhasSaida);
  console.log("custo/hora real (PROD):", JSON.stringify({ porOperacao: custoHora.custoHoraPorOperacao, empresa: Number(custoHora.custoHoraEmpresa.toFixed(4)) }));
  writeFileSync(saida, JSON.stringify({ geradoEm: j.geradoEm, custoHora: { porOperacao: custoHora.custoHoraPorOperacao, empresa: custoHora.custoHoraEmpresa }, cenarios: linhasSaida }, null, 2));
  const i = resto.indexOf("--sql"); if (i >= 0) writeFileSync(resto[i + 1], `begin;\n${sql.join("\n")}\ncommit;\n`);
}
main().catch((e) => { console.error(e instanceof Error ? e.stack : e); process.exit(1); });
