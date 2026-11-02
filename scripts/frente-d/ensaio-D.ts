/* eslint-disable @typescript-eslint/no-explicit-any */
// ENSAIO COMPLETO contra o Postgres LOCAL (fb_test = replay das migrations + estado legado de PROD de 02/11): publicar → evento de ausência → produção real → falha → ROLLBACK.
// Usa o processarSemana REAL, o RPC REAL escala_aplicar_recalculo (psql) e as funções/triggers reais da migration. Nada toca PROD.
// Pré-requisitos: fb/rebuild.sh (banco recriado e semeado). Rodar: fb/ts.sh scripts/ativacao-0211/ensaio-local.ts   (env: OUT=arquivo.json)
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import { montarEstado as carregar } from "../ativacao-0211/carga";
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
import { linhaDiagnostico } from "@/lib/escala/fluxo/supabaseFluxo";

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
const registrosBanco: any[] = [];
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
      const out = psql(`select public.escala_aplicar_recalculo('${p.previsaoId}'::uuid, ${q(p.dias)}::jsonb, '${p.aPartirDeData}'::date, '${p.aPartirDePeriodo}', ${q(al)}::jsonb, null, '{${p.eventoIds.join(",")}}'::uuid[], ${q(p.resumo)}::jsonb, '{}'::date[]);`);
      return { versoes: JSON.parse(out).versoes };
    },
    async registrarFluxo(r) {
      registros.push(JSON.parse(JSON.stringify(r)));
      // grava de verdade pela RPC do banco (a mesma do supabaseFluxo.registrarDiagnosticoFluxo): valida o contrato jsonb do registro do planejador
      const out = JSON.parse(psql(`select public.escala_fluxo_registrar($j$${JSON.stringify(linhaDiagnostico(r))}$j$::jsonb);`));
      registrosBanco.push(out);
    },
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


// ======================= ENSAIO D: registrar contagens D → motor recalcula → rollback (contagens e plano) =======================
import { hashAlocacoes } from "@/features/escala/horizonte";
const A10 = `${D10}/ativacao`;
const D12DIR = "/private/tmp/claude-501/-Users-mikaellonghi-Documents/46f8091f-a2ac-4875-a213-e5a3b744b594/scratchpad/auditoria-1030/D12";
const arq = (f: string) => fs.readFileSync(f, "utf8");
const hashPlano = () => hashAlocacoes(planoDoBanco()).slice(0, 16);
const contMd5 = () => psql("select md5(valor::text) from escala_parametros where chave = 'producao_real_contagens_fisicas'");
const pend = () => jq<any>("select id, tipo from escala_producao_eventos where status in ('pendente','processando')");
async function mainD() {
  console.log("== preparo: estado local = PROD de 02/11 20:23 (ativação + plano ativo restaurado de PROD)");
  psql(arq(`${A10}/02-ativar.sql`).replace(/^begin;|commit;\s*$/gim, ""));
  const p0 = jq<any>("select id from escala_producao_eventos where status = 'pendente'").map((e: any) => e.id);
  await recalcular("2026-11-02T18:05:00-03:00", p0);
  psql(arq(`${D12DIR}/04y-restaurar-plano-ativo.sql`));
  confere("plano ativo de PROD restaurado no banco local (hash D8 4f88c0c3…)", md5() === "4f88c0c30a0e07d7f93dfc61425612d5", md5());
  confere("jsonb das contagens local == PROD (md5 do V0)", contMd5() === "95146b6b60a4fe67b77cd94e8413d126", contMd5());
  const hAtivo = hashPlano();
  confere("hash do plano do planejador do ativo (5cf2045a…) reproduzido", hAtivo === "5cf2045a7e6e5edc", hAtivo);
  const alvo: Record<string, string> = { i: "d1d45ac75a4a4dc5", ii: "a603478f2671cbf0", iii: "f9d02791fc501e3e" };
  for (const v of ["i", "ii", "iii"]) {
    console.log(`== variante D(${v})`);
    psql(arq(`${D12DIR}/04-registrar-contagens-D-${v}.sql`));
    const itensD = Number(psql("select count(*) from escala_parametros p, jsonb_array_elements(p.valor) x where p.chave = 'producao_real_contagens_fisicas' and x->>'informadoPor' like 'Mikael (contagem física D%'"));
    confere(`D(${v}): contagens D registradas, B removidas`, itensD >= 4 && Number(psql("select count(*) from escala_parametros p, jsonb_array_elements(p.valor) x where p.chave = 'producao_real_contagens_fisicas' and x->>'informadoPor' like 'Cenário B%'")) === 0, `${itensD} itens D`);
    const pe = pend();
    confere(`D(${v}): o UPDATE enfileirou o recálculo da semana (evento pendente)`, pe.length >= 1, `${pe.length} evento(s)`);
    const r = await recalcular("2026-11-02T20:30:00-03:00", pe.map((e: any) => e.id));
    const ult = registros[registros.length - 1];
    confere(`D(${v}): recalculado pelo planejador de corte (motor corte-v1, resultado ok)`, (ult?.avaliacaoFluxo as any)?.motor === "corte-v1" && ult.resultado === "ok", `${r.status} · ${(ult?.avaliacaoFluxo as any)?.motor}`);
    const h = hashPlano();
    confere(`D(${v}): plano gravado == replanejamento offline (hash do plano ${alvo[v]})`, h === alvo[v], `${h} · D8 ${md5()}`);
    await auditoria("2026-11-02T20:30:00-03:00", `D(${v})`);
    psql(arq(`${D12DIR}/04z-rollback-contagens-D.sql`));
    confere(`D(${v}): rollback das contagens restaura o jsonb EXATO (md5 do V0)`, contMd5() === "95146b6b60a4fe67b77cd94e8413d126", contMd5());
    const pe2 = pend();
    await recalcular("2026-11-02T20:35:00-03:00", pe2.map((e: any) => e.id));
    psql(arq(`${D12DIR}/04y-restaurar-plano-ativo.sql`));
    confere(`D(${v}): restauração do plano ativo reproduz o hash D8 4f88c0c3…`, md5() === "4f88c0c30a0e07d7f93dfc61425612d5", md5());
  }
  const falhas = resultados.filter((x) => !x.ok);
  console.log(`\nRESUMO D: ${resultados.length - falhas.length}/${resultados.length} OK`);
  process.exit(falhas.length ? 1 : 0);
}
mainD().catch((e) => { console.error(e); process.exit(2); });
