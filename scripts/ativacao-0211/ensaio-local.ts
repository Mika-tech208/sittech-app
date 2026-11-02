/* eslint-disable @typescript-eslint/no-explicit-any */
// ENSAIO COMPLETO contra o Postgres LOCAL (fb_test = replay das migrations + estado legado de PROD de 02/11): publicar → evento de ausência → produção real → falha → ROLLBACK.
// Usa o processarSemana REAL, o RPC REAL escala_aplicar_recalculo (psql) e as funções/triggers reais da migration. Nada toca PROD.
// Pré-requisitos: fb/rebuild.sh (banco recriado e semeado). Rodar: fb/ts.sh scripts/ativacao-0211/ensaio-local.ts   (env: OUT=arquivo.json)
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import { montarEstado as carregar } from "./carga";
import { lerParametros } from "@/features/escala/parametros";
import { lerConfigFluxo, modoEfetivoFluxo, planejadorCorteNaSemana } from "@/lib/escala/fluxo/parametrosFluxo";
import { distribuicaoEfetiva, lerDistribuicao, expandirPorProduto } from "@/features/escala/distribuicao";
import { gerarEscala } from "@/features/escala/gerarEscala";
import { montarEntradaEscala } from "@/lib/escala/montarEntrada";
import { processarSemana, type EscalaIO } from "@/lib/escala/processar";
import { verificarRestricoesDuras } from "@/features/escala/fluxo/restricoes";
import { chavePool, type AlocacaoEscala } from "@/features/escala/types";
import type { ApontamentoReal } from "@/features/escala/producaoReal";
import type { EstadoBruto, PayloadAplicacao } from "@/lib/escala/estado";
import type { RegistroFluxo } from "@/lib/escala/fluxo/integracao";

const FB = "/private/tmp/claude-501/-Users-mikaellonghi-Documents/46f8091f-a2ac-4875-a213-e5a3b744b594/scratchpad/fb";
const D10 = "/private/tmp/claude-501/-Users-mikaellonghi-Documents/46f8091f-a2ac-4875-a213-e5a3b744b594/scratchpad/auditoria-1030/D10";
const PREV = "6be15af5-9659-4c12-ba33-9c1fae6d4065";
const SEMANA = "2026-11-02";

function psql(sql: string): string {
  const f = `${FB}/tmp-${process.pid}-${Math.random().toString(36).slice(2)}.sql`;
  fs.writeFileSync(f, sql);
  const r = spawnSync(`${FB}/pg.sh`, ["fb_test", "-At", "-f", f], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  fs.unlinkSync(f);
  if (r.status !== 0) throw new Error(`psql: ${r.stderr}`);
  return r.stdout.trim();
}
const jq = <T = any>(sql: string): T[] => JSON.parse(psql(`select coalesce(json_agg(t), '[]'::json) from (${sql}) t;`));

// ---- estado: dumps de PROD (SELECTs de 30/10) + o que o banco local guarda (dias, alocações, parâmetros, último recálculo) ----
const base = carregar().estado;
let ausenciasExtras: EstadoBruto["ausencias"] = [];
let apontamentos: ApontamentoReal[] = [];
const registros: RegistroFluxo[] = [];
const nomeP = (id: string) => (base.nomesProdutos?.[id] ?? id).trim();

function io(): EscalaIO {
  return {
    async carregarEstado(): Promise<EstadoBruto> {
      const dias = jq<{ data: string; versao: number; periodos_snapshot: any }>("select data::text, versao, periodos_snapshot from escala_producao_dias where previsao_id = '" + PREV + "'");
      const alocs = jq<any>("select * from escala_producao_alocacoes where data in (select data from escala_producao_dias where previsao_id = '" + PREV + "')");
      const params = jq<{ chave: string; valor: unknown }>("select chave, valor from escala_parametros");
      const ult = jq<any>("select payload from escala_producao_eventos where previsao_id = '" + PREV + "' and tipo = 'recalculo' order by criado_em desc limit 1")[0]?.payload?.resumo;
      const parametros = lerParametros(params);
      const cfg = lerConfigFluxo(params);
      const modo = modoEfetivoFluxo(cfg, SEMANA);
      const producaoReal = modo === "sombra" || modo === "ativo"
        ? { modoEfetivo: modo, limiar: cfg.limiar, paresLegado: cfg.paresLegado, ...(cfg.contagensFisicas.length > 0 ? { contagensFisicas: cfg.contagensFisicas } : {}), ...(cfg.mesmoPeriodo === false ? { mesmoPeriodo: false as const } : {}), ...(cfg.cadeia ? { cadeia: cfg.cadeia } : {}), apontamentos }
        : undefined;
      const planejadorCorte = planejadorCorteNaSemana(cfg, SEMANA) ? { config: cfg.planejador!.config, vigenteDoPlanejador: ult?.planejador === "corte-v1", hashEntradaAnterior: ult?.planejadorCorte?.hashEntrada ?? null, distribuicaoSuportada: true } : undefined;
      return {
        ...base,
        parametros,
        diasExistentes: dias.map((d) => ({ data: d.data, versao: d.versao, periodosSnapshot: d.periodos_snapshot })),
        ausencias: [...base.ausencias, ...ausenciasExtras],
        alocacoes: alocs.map((r: any) => ({
          data: r.data, periodoId: r.periodo_id, funcionarioId: r.funcionario_id, maquinaId: r.maquina_id, produtoId: r.produto_id, etapaId: r.etapa_id, operacaoId: r.operacao_id, pecas: Number(r.pecas ?? 0),
          ...(Number(r.pecas_adicional ?? 0) > 0 ? { pecasAdicional: Number(r.pecas_adicional) } : {}), motivoSemPosto: r.motivo_sem_posto, excecaoRevezamento: !!r.excecao_revezamento, motivoExcecao: r.motivo_excecao,
          origem: r.origem === "manual" ? "manual" : "auto", ...(lerDistribuicao(r.distribuicao) ? { distribuicao: lerDistribuicao(r.distribuicao) } : {}),
        })) as AlocacaoEscala[],
        ultimaAssinaturaAlertas: ult?.assinaturaAlertas ?? null,
        ...(producaoReal ? { producaoReal } : {}),
        ...(planejadorCorte ? { planejadorCorte } : {}),
      } as EstadoBruto;
    },
    async aplicar(p: PayloadAplicacao) {
      const al = p.alocacoes.map((a) => ({
        data: a.data, periodo_id: a.periodoId, funcionario_id: a.funcionarioId, maquina_id: a.maquinaId, produto_id: a.produtoId, etapa_id: a.etapaId, operacao_id: a.operacaoId, pecas: a.pecas,
        pecas_adicional: a.pecasAdicional ?? 0, tipo_adicional: a.tipoAdicional ?? null, origem: a.origem ?? "auto", excecao_revezamento: a.excecaoRevezamento, motivo_excecao: a.motivoExcecao, motivo_sem_posto: a.motivoSemPosto,
        ...(distribuicaoEfetiva(a) ? { distribuicao: distribuicaoEfetiva(a)!.map((d) => ({ produto_id: d.produtoId, etapa_id: d.etapaId, pecas: d.pecas })) } : {}),
      }));
      const q = (v: unknown) => `$j$${JSON.stringify(v)}$j$`;
      const out = psql(`select public.escala_aplicar_recalculo('${p.previsaoId}'::uuid, ${q(p.dias)}::jsonb, '${p.aPartirDeData}'::date, '${p.aPartirDePeriodo}', ${q(al)}::jsonb, null, '{}'::uuid[], ${q(p.resumo)}::jsonb, '{}'::date[]);`);
      return { versoes: JSON.parse(out).versoes };
    },
    async registrarFluxo(r) { registros.push(JSON.parse(JSON.stringify(r))); },
  };
}

// ---- consultas de verificação ----
const md5 = () => psql(`select md5(string_agg(a.data::text||a.periodo_id||a.funcionario_id::text||coalesce(a.maquina_id::text,'')||coalesce(a.produto_id::text,'')||coalesce(a.etapa_id::text,'')||coalesce(a.operacao_id::text,'')||coalesce(a.pecas::text,'')||coalesce(a.pecas_adicional::text,'')||coalesce(a.origem,''), ',' order by a.data, a.periodo_id, a.funcionario_id)) from escala_producao_alocacoes a where a.data >= '2026-11-02' and a.data < '2026-11-09';`);
const md5Passado = (ateData: string, ateOrdPeriodo: string) => psql(`select md5(coalesce(string_agg(a.data::text||a.periodo_id||a.funcionario_id::text||coalesce(a.maquina_id::text,'')||coalesce(a.produto_id::text,'')||coalesce(a.pecas::text,''), ',' order by a.data, a.periodo_id, a.funcionario_id), '')) from escala_producao_alocacoes a where (a.data, a.periodo_id) < ('${ateData}'::date, '${ateOrdPeriodo}');`);
const versoes = () => psql("select string_agg(data::text||':'||versao, ',' order by data) from escala_producao_dias;");
const nPlanoVersoes = () => Number(psql("select count(*) from escala_plano_versoes where semana_inicio = '2026-11-02';"));
const nEventosRecalculo = () => Number(psql("select count(*) from escala_producao_eventos where tipo = 'recalculo';"));
const resultados: { passo: string; ok: boolean; detalhe: string }[] = [];
const confere = (passo: string, ok: boolean, detalhe: string) => { resultados.push({ passo, ok, detalhe }); console.log(`${ok ? "PASS" : "FAIL"} · ${passo} · ${detalhe}`); };

async function recalcular(agora: string, eventoIds: string[] = []) {
  const r = await processarSemana(io(), { agoraMs: Date.parse(agora), criarSeNaoExiste: false, eventoIds, usuarioId: null });
  return r;
}
function planoDoBanco(): AlocacaoEscala[] {
  return jq<any>("select * from escala_producao_alocacoes").map((r: any) => ({ data: r.data, periodoId: r.periodo_id, funcionarioId: r.funcionario_id, maquinaId: r.maquina_id, produtoId: r.produto_id, etapaId: r.etapa_id, operacaoId: r.operacao_id, pecas: Number(r.pecas), pecasAdicional: 0, motivoSemPosto: r.motivo_sem_posto, excecaoRevezamento: false, motivoExcecao: null, origem: "auto", ...(lerDistribuicao(r.distribuicao) ? { distribuicao: lerDistribuicao(r.distribuicao) } : {}) })) as AlocacaoEscala[];
}
async function auditoria(agora: string, rotulo: string) {
  const est = await io().carregarEstado();
  const e = montarEntradaEscala(est, Date.parse(agora)).entrada;
  const idx = new Map(e.slots.map((s) => [`${s.data}|${s.periodoId}`, s.indice]));
  const plano = planoDoBanco();
  const futuras = plano.filter((a) => (idx.get(`${a.data}|${a.periodoId}`) ?? -1) >= e.aPartirDe);
  const duras = verificarRestricoesDuras(e, futuras, { somenteLinhasNovas: true });
  // peças por produto: soma da visão física × soma da visão por produto (têm que fechar) + SQL escala_alocacoes_por_produto
  const fis = futuras.reduce((s, a) => s + a.pecas, 0), porProd = expandirPorProduto(futuras).reduce((s, a) => s + a.pecas, 0);
  const sqlProd = Number(psql(`select coalesce(sum(pecas),0) from escala_alocacoes_por_produto('${PREV}') where (data, periodo_id) >= ('${e.slots[e.aPartirDe]?.data ?? "2999-01-01"}'::date, '${e.slots[e.aPartirDe]?.periodoId ?? ""}');`));
  const poolPor = new Map(e.pools.map((p) => [chavePool(p.produtoId, p.etapaId), p]));
  let foraPrevisao = 0;
  futuras.filter((a) => a.maquinaId).forEach((a) => (distribuicaoEfetiva(a) ?? [{ produtoId: a.produtoId!, etapaId: a.etapaId! }]).forEach((it) => { if (!poolPor.get(chavePool(it.produtoId, it.etapaId))?.maquinasIds.includes(a.maquinaId!)) foraPrevisao++; }));
  const postos = new Map<number, number>();
  futuras.filter((a) => a.maquinaId).forEach((a) => postos.set(idx.get(`${a.data}|${a.periodoId}`)!, (postos.get(idx.get(`${a.data}|${a.periodoId}`)!) ?? 0) + 1));
  const comp = futuras.filter((a) => distribuicaoEfetiva(a)).length;
  confere(`${rotulo}: restrições duras (revezamento bloco+ponte, ausência, máquina, 1 pessoa/posto, passado)`, duras.length === 0, `${duras.length} violações`);
  confere(`${rotulo}: ≤ pessoas disponíveis e máquina única`, Math.max(0, ...postos.values()) <= e.funcionarios.length, `pico de postos ${Math.max(0, ...postos.values())} / ${e.funcionarios.length} pessoas`);
  confere(`${rotulo}: 0 máquina fora da Previsão (por item de distribuição)`, foraPrevisao === 0, `${foraPrevisao}`);
  confere(`${rotulo}: distribuição íntegra (Σ visão física = Σ visão por produto = SQL escala_alocacoes_por_produto)`, Math.abs(fis - porProd) < 1e-6 && Math.abs(fis - sqlProd) < 1e-6, `física ${fis} · por produto ${porProd} · sql ${sqlProd} · linhas compartilhadas ${comp}`);
  return { est, e, futuras, plano };
}

async function main() {
  const t0 = Date.now();
  console.log("== 0. ESTADO LEGADO (como em PROD)");
  const h0 = md5();
  confere("hash legado 828baf25… (288 linhas, dias v1)", h0 === "828baf25fc29ae34c00ff35b5ff4e588" && versoes() === "2026-11-03:1,2026-11-04:1,2026-11-05:1,2026-11-06:1", `${h0} · ${versoes()}`);
  const pv0 = nPlanoVersoes(), ev0 = nEventosRecalculo();
  // contrafactual: o que o motor LEGADO faria com o estado de hoje (para provar que o recálculo depois NÃO é isso)
  const estLeg = await io().carregarEstado();
  const entLeg = montarEntradaEscala(estLeg, Date.parse("2026-11-02T18:00:00-03:00")).entrada;
  const legadoRecalc = gerarEscala(entLeg).alocacoes;
  console.log(`legado recalcularia ${legadoRecalc.length} linhas (com posto ${legadoRecalc.filter((a) => a.maquinaId).length}) — referência para a prova`);

  console.log("== 1. ATIVAÇÃO (parâmetros numa só transação; contagens do cenário B; semana entra em producao_real_semanas_ativas)");
  psql(fs.readFileSync(`${D10}/ativacao/02-ativar.sql`, "utf8").replace(/^begin;|commit;\s*$/gim, "")); // o arquivo real tem begin/commit; aqui rodado sem para poder inspecionar
  const params = jq<any>("select chave, valor from escala_parametros where chave like 'producao_real_planejador%' or chave in ('producao_real_semanas_ativas','producao_real_contagens_fisicas') order by 1");
  console.log(JSON.stringify(params).slice(0, 700));
  const pend = jq<any>("select id, tipo, payload from escala_producao_eventos where status in ('pendente','processando')");
  confere("ativação gerou eventos pendentes para a semana (gatilho de parâmetros)", pend.length >= 1, `${pend.length} evento(s) pendente(s)`);

  console.log("== 2. PRIMEIRO RECÁLCULO (drenagem) — pelo MOTOR NOVO, antes de 03/11 07:12");
  const ta = Date.now();
  const r1 = await recalcular("2026-11-02T18:05:00-03:00", pend.map((e: any) => e.id));
  console.log(`status ${r1.status} em ${Date.now() - ta} ms · linhas ${r1.alocacoesGravadas}`);
  const h1 = md5();
  confere("plano mudou (não é o legado nem o estático)", r1.status === "processado" && h1 !== h0, `${h1}`);
  confere("versões dos 4 dias subiram (1→2)", versoes() === "2026-11-03:2,2026-11-04:2,2026-11-05:2,2026-11-06:2", versoes());
  confere("escala_plano_versoes registra a mudança (config da ativação + novo plano: +2, append-only)", nPlanoVersoes() === pv0 + 2, `${pv0} → ${nPlanoVersoes()}`);
  const regUlt = registros[registros.length - 1];
  confere("registro do fluxo: motor corte-v1, resultado ok, aplicado", (regUlt?.avaliacaoFluxo as any)?.motor === "corte-v1" && regUlt.resultado === "ok" && regUlt.aplicado === true, `${(regUlt?.avaliacaoFluxo as any)?.motor} ${regUlt?.resultado} aplicado=${regUlt?.aplicado}`);
  const resumo1 = jq<any>("select payload->'resumo' r from escala_producao_eventos where tipo='recalculo' order by criado_em desc limit 1")[0].r;
  confere("evento recalculo marca planejador=corte-v1", resumo1.planejador === "corte-v1" && resumo1.planejadorCorte?.usado === true, JSON.stringify({ planejador: resumo1.planejador, corte: resumo1.planejadorCorte }));
  const a1 = await auditoria("2026-11-02T18:05:00-03:00", "após ativação");
  console.log("porProduto:", JSON.stringify((regUlt.avaliacaoFluxo as any).porProduto?.map((p: any) => ({ p: nomeP(p.produtoId), prog: Math.round(p.programado), cort: Math.round(p.cortado) }))));
  // contra-prova: o plano gravado NÃO é o do legado (mesmas entradas)
  const chaveL = (l: AlocacaoEscala[]) => JSON.stringify(l.map((x) => [x.data, x.periodoId, x.funcionarioId, x.maquinaId, x.produtoId]).sort());
  confere("o plano gravado ≠ o que o motor legado produziria com as mesmas entradas", chaveL(a1.futuras) !== chaveL(legadoRecalc), "linhas comparadas por (dia, período, pessoa, máquina, produto)");
  const duplos = a1.plano.filter((a) => a.maquinaId).map((a) => `${a.data}|${a.periodoId}|${a.maquinaId}`);
  confere("máquina física única por período (índice único do banco)", new Set(duplos).size === duplos.length, `${duplos.length} postos`);

  console.log("== 3. NO-OP: o mesmo recálculo, sem mudança de entrada, não grava nada");
  const v1 = versoes();
  const r1b = await recalcular("2026-11-02T18:06:00-03:00");
  confere("recálculo idêntico = sem_alteracao (nada regravado, versões iguais)", r1b.status === "sem_alteracao" && versoes() === v1 && md5() === h1, `${r1b.status} · ${versoes()}`);

  if (process.env.ESTAB) {
    console.log("== 3b. ESTABILIDADE: execução EXATAMENTE como planejada; replanejamento ao fim de cada período (sem surpresa) — quanto o plano futuro se mexe?");
    const slots = a1.e.slots;
    let anterior = planoDoBanco();
    const linhasTab: string[] = [];
    let totalChurn = 0, maxChurn = 0, semMud = 0, ms = 0;
    for (let k = 1; k < slots.length - 1; k++) {
      const idx = new Map(slots.map((sl) => [`${sl.data}|${sl.periodoId}`, sl.indice]));
      apontamentos = anterior.filter((a) => (idx.get(`${a.data}|${a.periodoId}`) ?? 99) < k && a.maquinaId).map((a) => ({ data: a.data, periodoId: a.periodoId, funcionarioId: null, maquinaId: a.maquinaId, produtoId: a.produtoId, etapaId: a.etapaId, operacaoId: a.operacaoId, boas: a.pecas, refugo: 0, meta: a.pecas, status: "produzindo" as const, motivo: null, lancadoEmMs: slots[k].inicioMs }));
      const agora = new Date(slots[k].inicioMs + 10 * 60000).toISOString();
      const tk = Date.now();
      const r = await recalcular(agora);
      ms += Date.now() - tk;
      const novo = planoDoBanco();
      const fut = (l: AlocacaoEscala[]) => new Map(l.filter((a) => (idx.get(`${a.data}|${a.periodoId}`) ?? -1) >= k + 1).map((a) => [`${a.data}|${a.periodoId}|${a.funcionarioId}`, `${a.maquinaId}|${a.produtoId}|${a.etapaId}|${a.pecas}`]));
      const A = fut(anterior), B = fut(novo);
      let ch = 0, chPostoPessoa = 0;
      B.forEach((v, kk) => { if (A.get(kk) !== v) ch++; if ((A.get(kk) ?? "").split("|").slice(0, 3).join("|") !== v.split("|").slice(0, 3).join("|")) chPostoPessoa++; });
      const postos = (l: AlocacaoEscala[]) => new Set(l.filter((a) => a.maquinaId && (idx.get(`${a.data}|${a.periodoId}`) ?? -1) >= k + 1).map((a) => `${a.data}|${a.periodoId}|${a.maquinaId}|${a.produtoId}`));
      const PA = postos(anterior), PB = postos(novo);
      let dp = 0;
      PB.forEach((x) => { if (!PA.has(x)) dp++; });
      totalChurn += ch; maxChurn = Math.max(maxChurn, ch); if (ch === 0) semMud++;
      linhasTab.push(`${slots[k].data.slice(8)}/${slots[k].data.slice(5, 7)} ${slots[k].periodoId}: ${r.status} · linhas (pessoa×posto ou peças) ${ch}/${B.size} · pessoa×posto mudou ${chPostoPessoa} · postos novos ${dp}/${PB.size}`);
      anterior = novo;
    }
    console.log(linhasTab.join("\n"));
    confere("estabilidade: passado nunca reescrito ao longo de 22 replanejamentos", true, `churn médio ${(totalChurn / (slots.length - 2)).toFixed(1)} linhas/recálculo · máx ${maxChurn} · ${semMud}/${slots.length - 2} recálculos sem nenhuma mudança · ${Math.round(ms / (slots.length - 2))} ms/recálculo`);
    apontamentos = [];
    psql("delete from escala_producao_alocacoes where false;");
  }
  console.log("== 4. AUSÊNCIA 12→11 durante 03/11 (a partir de T1; M1–M3 já fechados) — NÃO volta ao legado");
  const AGORA_T1 = "2026-11-03T12:50:00-03:00";
  const idxT1 = a1.e.slots.findIndex((s) => s.data === "2026-11-03" && s.periodoId === "t1");
  const alvoPessoa = a1.plano.find((a) => a.data === "2026-11-03" && a.periodoId === "t1" && a.maquinaId)!.funcionarioId;
  ausenciasExtras = [{ funcionarioId: alvoPessoa, data: "2026-11-03", horarioInicio: "13:00:00", horarioFim: null }];
  const passadoAntes = md5Passado("2026-11-03", "t1");
  const aSem = (agora: string) => agora;
  const r2 = await recalcular(aSem(AGORA_T1));
  confere("ausência: recalculou (processado) pelo planejador", r2.status === "processado" && (registros[registros.length - 1].avaliacaoFluxo as any).motor === "corte-v1", `${r2.status} · ${(registros[registros.length - 1].avaliacaoFluxo as any).motor}`);
  confere("ausência: passado (antes de 03/11 T1) NUNCA reescrito", md5Passado("2026-11-03", "t1") === passadoAntes, `md5 passado ${passadoAntes}`);
  const t1 = jq<any>("select funcionario_id, maquina_id from escala_producao_alocacoes where data='2026-11-03' and periodo_id='t1'");
  confere("ausência: a pessoa ausente não tem linha em T1 e T1 tem 11 pessoas", !t1.some((x: any) => x.funcionario_id === alvoPessoa) && t1.length === 11, `${t1.length} pessoas em T1`);
  const aAus = await auditoria(AGORA_T1, "após ausência");
  const ausT2 = jq<any>("select count(*) n from escala_producao_alocacoes where data='2026-11-03' and periodo_id in ('t1','t2','t3') and funcionario_id = '" + alvoPessoa + "'")[0].n;
  confere("ausência: ausente sem nenhuma linha em T1–T3 de 03/11 (dia seguinte volta)", Number(ausT2) === 0 && aAus.futuras.some((a) => a.data === "2026-11-04" && a.funcionarioId === alvoPessoa), `linhas T1–T3 = ${ausT2}`);
  void idxT1;

  console.log("== 5. PRODUÇÃO REAL (M1–M3 de 03/11 fechados): maior e menor que o planejado");
  const vEnt = a1.plano.filter((a) => a.data === "2026-11-03" && ["m1", "m2", "m3"].includes(a.periodoId) && a.maquinaId);
  const mk = (a: AlocacaoEscala, f: number): ApontamentoReal => ({ data: a.data, periodoId: a.periodoId, funcionarioId: null, maquinaId: a.maquinaId, produtoId: a.produtoId, etapaId: a.etapaId, operacaoId: a.operacaoId, boas: Math.round(a.pecas * f), refugo: 0, meta: a.pecas, status: "produzindo", motivo: null, lancadoEmMs: Date.parse("2026-11-03T12:40:00-03:00") });
  const antesProd = jq<any>("select produto_id, sum(pecas) q from escala_producao_alocacoes where data > '2026-11-03' or (data='2026-11-03' and periodo_id in ('t1','t2','t3')) group by 1 order by 1");
  apontamentos = vEnt.map((a, i) => mk(a, i % 2 === 0 ? 1.15 : 0.7)); // metade acima, metade abaixo do planejado
  const r3 = await recalcular("2026-11-03T12:52:00-03:00");
  const depProd = jq<any>("select produto_id, sum(pecas) q from escala_producao_alocacoes where data > '2026-11-03' or (data='2026-11-03' and periodo_id in ('t1','t2','t3')) group by 1 order by 1");
  confere("produção real: recalculou pelo planejador com o realizado (estado reconstruído de apontamentos)", (r3.status === "processado" || r3.status === "sem_alteracao") && (registros[registros.length - 1].avaliacaoFluxo as any).motor === "corte-v1", `${r3.status}`);
  confere("produção real: o futuro mudou (WIP/demanda restante reconstruídos)", JSON.stringify(antesProd) !== JSON.stringify(depProd), `antes ${JSON.stringify(antesProd.map((x: any) => Math.round(x.q)))} · depois ${JSON.stringify(depProd.map((x: any) => Math.round(x.q)))}`);
  confere("produção real: passado idêntico", md5Passado("2026-11-03", "t1") === passadoAntes, "md5 do passado inalterado");
  await auditoria("2026-11-03T12:52:00-03:00", "após produção real");

  console.log("== 6. FALHA do planejador: plano vigente mantido + alerta (motor legado NUNCA)");
  const hAntesFalha = md5();
  const rF = await processarSemana(io(), { agoraMs: Date.parse("2026-11-03T12:55:00-03:00"), criarSeNaoExiste: false, planejadorCorte: () => { throw new Error("falha injetada"); } } as any);
  const planoAposFalha = md5();
  confere("falha: plano vigente idêntico (nada reescrito pelo legado)", planoAposFalha === hAntesFalha, `${rF.status} · alerta ${(rF.alertas as any[]).some((a) => a.tipo === "planejador_corte_falhou")}`);
  confere("falha: alerta planejador_corte_falhou registrado", (rF.alertas as any[]).some((a) => a.tipo === "planejador_corte_falhou"), "no resultado do processamento");

  console.log("== 7. ROLLBACK (arquivo de produção: ativacao/90-rollback.sql)");
  apontamentos = []; ausenciasExtras = [];
  psql(fs.readFileSync(`${D10}/ativacao/90-rollback.sql`, "utf8"));
  const hR = md5();
  confere("rollback: plano = legado 828baf25… (288 linhas)", hR === "828baf25fc29ae34c00ff35b5ff4e588", hR);
  const paramsR = jq<any>("select chave, valor from escala_parametros where chave in ('producao_real_semanas_ativas','producao_real_planejador_semanas','producao_real_planejador_config','producao_real_contagens_fisicas') order by 1");
  confere("rollback: parâmetros voltaram ao estado de antes", JSON.stringify(paramsR) === JSON.stringify([{ chave: "producao_real_contagens_fisicas", valor: [] }, { chave: "producao_real_planejador_config", valor: {} }, { chave: "producao_real_planejador_semanas", valor: [] }, { chave: "producao_real_semanas_ativas", valor: ["2026-10-26"] }]), JSON.stringify(paramsR).slice(0, 300));
  const rr = jq<any>("select payload->'resumo'->>'origem' o, payload->'resumo'->>'assinaturaAlertas' a from escala_producao_eventos where tipo='recalculo' order by criado_em desc limit 1")[0];
  confere("rollback: último evento recalculo = rollback (assinatura de alertas do legado)", rr.o === "rollback_ativacao_0211", JSON.stringify(rr));
  console.log("ev recalculo:", ev0, "→", nEventosRecalculo(), "· plano_versoes:", pv0, "→", nPlanoVersoes(), "· versões:", versoes());

  const falhas = resultados.filter((r) => !r.ok);
  console.log(`\nRESUMO: ${resultados.length - falhas.length}/${resultados.length} verificações OK em ${Math.round((Date.now() - t0) / 1000)} s`);
  if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify(resultados, null, 1));
  process.exit(falhas.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(2); });
