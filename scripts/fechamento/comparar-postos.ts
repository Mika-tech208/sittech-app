/* eslint-disable @typescript-eslint/no-explicit-any */
// Compara, com DADOS REAIS de PROD (JSON extraído por SELECT), os postos que a API devolve (montarEstadoPostos = o mesmo código de carregarPostosProgramados)
// com as linhas que a TELA monta (linhasIniciais do fluxo único). Uso: scripts/fechamento/ts.sh scripts/fechamento/comparar-postos.ts <raw.json> <t1|t2>
import * as fs from "node:fs";
import { montarEstadoPostos } from "@/lib/escala/fechamento/postosProgramados";
import { linhasIniciais } from "@/features/producao-real/apontamento-simplificado/prefill";
import { alteradoDoPlanejado } from "@/features/producao-real/apontamento-simplificado/diff";
import { filtrarGradeProgramada } from "@/features/producao-real/fechamento/textos";

const [arq, per] = [process.argv[2], process.argv[3] ?? "t1"];
const R = JSON.parse(fs.readFileSync(arq, "utf8"));
const aloc: any[] = R[`aloc_${per}`];
const estado = montarEstadoPostos({ alocacoes: aloc, maquinas: R.maquinas, funcionarios: R.funcionarios, produtos: R.produtos, operacoes: R.operacoes, etapas: R.etapas, etapaMaquinas: R.etapaMaquinas, apontamentos: [] });
let n = 0; const linhas = linhasIniciais(estado.postos, estado.existentes, [], () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`);
const idsDb = [...new Set(aloc.map((a) => a.maquina_id))].sort();
const idsApi = estado.postos.map((p) => p.maquinaId).sort();
const idsTela = linhas.map((l) => l.real.maquinaId as string).sort();
const todasAtivas = R.maquinas.filter((m: any) => m.ativo).map((m: any) => ({ id: m.id, nome: m.nome }));
const grade = filtrarGradeProgramada(todasAtivas.map((m: any) => ({ ...m, estadoPeriodo: "pendente" })), new Set(idsApi), new Set());
const igual = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
console.log(`${per.toUpperCase()}: DB=${idsDb.length} postos · API=${idsApi.length} · TELA(fluxo único)=${idsTela.length} · grade do painel=${grade.length} · máquinas ativas=${todasAtivas.length}`);
console.log(`1:1 DB×API: ${igual(idsDb, idsApi)} · API×TELA: ${igual(idsApi, idsTela)} · painel×API: ${igual(grade.map((m: any) => m.id).sort(), idsApi)}`);
let ok = true;
for (const l of linhas) {
  const p = l.planejado!; const a = aloc.find((x) => x.maquina_id === p.maquinaId);
  const pre = l.real.maquinaId === a.maquina_id && l.real.funcionarioId === a.funcionario_id && l.real.produtoId === a.produto_id && p.operacaoId === a.operacao_id && l.produzido === null && l.refugo === null && !alteradoDoPlanejado(l, estado.catalogo);
  if (!pre) ok = false;
  console.log(`  ${pre ? "✓" : "✗"} ${p.maquinaNome.trim().padEnd(20)} ${p.funcionarioNome.split(" ")[0].padEnd(10)} ${p.produtoNome.padEnd(26)} ${p.operacaoNome.padEnd(14)} ${per.toUpperCase()}`);
}
console.log(`pré-preenchimento (máquina/operador/produto/operação da escala; produzido vazio; refugo vazio=0): ${ok ? "OK" : "FALHOU"}`);
process.exit(igual(idsDb, idsApi) && igual(idsApi, idsTela) && ok && grade.length === idsApi.length ? 0 : 1);
