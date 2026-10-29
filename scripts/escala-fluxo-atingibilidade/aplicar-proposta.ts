/* eslint-disable @typescript-eslint/no-explicit-any */
// APLICAÇÃO da proposta aprovada de T1–T3 — GERA SQL (aplicar + reverter); NÃO executa nada e NÃO fala com PROD.
// Mecanismo escolhido: a MESMA RPC que o worker usa para gravar um recálculo — `escala_aplicar_recalculo` (transacional, advisory lock por previsão, versão do dia, guarda do histórico
// "ESCALA_CORTE_NO_PASSADO": T1 precisa não ter começado; apaga e regrava só T1..T3 do dia informado; registra evento 'recalculo' com `resumo`). Antes dela o SQL confere um HASH do plano atual de T1–T3:
// se o worker/alguém mudou o plano depois que a proposta foi calculada, aborta com PROPOSTA_DESATUALIZADA (nada é gravado).
// As linhas MUDADAS entram com origem='manual': o recálculo seguinte as lê como `trocasManuais` (preferência de continuidade na atribuição de pessoas e `marcarManuais` no núcleo).
// ATENÇÃO (limite do motor): isso é PREFERÊNCIA, não trava. No fechamento de T1 o motor ativo replaneja T2–T3 com o objetivo dele (peças, com f) e pode desfazer postos se achar um plano estritamente melhor
// pelo critério dele; o plano gravado só é "vigente mantido" quando nenhum candidato for estritamente melhor. Para o motor produzir o MESMO plano é preciso o código/flags econômicos em PROD.
//
// Uso: ts.sh aplicar-proposta.ts --json proposta.json [--alvo local|dev|prod] [--commit] [--aprovado-por "Mikael"] [--origem mudadas|todas|nenhuma] [--saida-sql aplicar.sql] [--saida-reverter reverter.sql]
import * as fs from "node:fs";
import * as path from "node:path";
import { hashLinhas } from "./hashProposta";

const argv = process.argv.slice(2);
const arg = (k: string) => { const i = argv.indexOf("--" + k); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : undefined; };
const jsonPath = arg("json");
if (!jsonPath) { console.error("uso: aplicar-proposta.ts --json <proposta.json> [--alvo local|dev|prod] [--commit] [--aprovado-por NOME]"); process.exit(2); }
const alvo = arg("alvo") ?? "local";
const commit = argv.includes("--commit");
const aprovadoPor = arg("aprovado-por") ?? "";
const origemModo = (arg("origem") ?? "mudadas") as "mudadas" | "todas" | "nenhuma";
if (!["local", "dev", "prod"].includes(alvo)) throw new Error("--alvo deve ser local|dev|prod");
if (alvo === "prod" && !aprovadoPor) throw new Error("--alvo prod exige --aprovado-por (registro de auditoria). Este script SÓ GERA o SQL; quem executa em PROD é o responsável, depois da aprovação.");

const P = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
const linhas: any[] = P.linhas;
const atuais: any[] = P.linhasAtuais;
if (!P.previsaoId || !P.data || !linhas?.length) throw new Error("JSON inválido (previsaoId/data/linhas)");
const mudadas = linhas.filter((l) => l.mudou).length;
if (mudadas === 0) { console.log("Nenhuma linha difere do plano atual: NADA A APLICAR."); process.exit(0); }
const q = (v: any) => (v === null || v === undefined ? "null" : `'${String(v).replace(/'/g, "''")}'`);
const periodos = [...new Set(linhas.map((l) => l.periodoId))].sort();
const primeiro = P.periodoInicial ?? periodos[0];

const jsonLinha = (l: any, origem: string) => ({
  data: l.data, periodo_id: l.periodoId, funcionario_id: l.funcionarioId, maquina_id: l.maquinaId ?? null, produto_id: l.produtoId ?? null, etapa_id: l.etapaId ?? null, operacao_id: l.operacaoId ?? null,
  pecas: l.pecas ?? 0, pecas_adicional: l.pecasAdicional ?? 0, tipo_adicional: l.tipoAdicional ?? null, origem, excecao_revezamento: !!l.excecaoRevezamento, motivo_excecao: l.motivoExcecao ?? null, motivo_sem_posto: l.motivoSemPosto ?? null,
});
const origemDe = (l: any) => (origemModo === "todas" ? "manual" : origemModo === "nenhuma" ? (l.origem ?? "auto") : l.mudou ? "manual" : (l.origem ?? "auto"));

const hashSql = (cond: string) => `select md5(coalesce(string_agg(a.data::text || '|' || a.periodo_id || '|' || a.funcionario_id::text || '|' || coalesce(a.maquina_id::text, '') || '|' || coalesce(a.produto_id::text, '') || '|' || coalesce(a.etapa_id::text, ''), ';' order by a.data::text || '|' || a.periodo_id || '|' || a.funcionario_id::text collate "C"), '')) from escala_producao_alocacoes a where ${cond}`;
const cond = `a.data = ${q(P.data)} and a.periodo_id in (${periodos.map(q).join(", ")})`;

function sql(rotulo: string, destino: any[], hashEsperado: string, hashFinal: string, resumo: any, final: "commit" | "rollback") {
  return `-- ${rotulo}
-- ALVO: ${alvo.toUpperCase()}${alvo === "prod" ? "  >>> PRODUÇÃO: executar SOMENTE após a APROVAÇÃO explícita (" + aprovadoPor + ") <<<" : ""}
-- Gerado em ${new Date().toISOString()} | previsão ${P.previsaoId} | ${P.data} ${periodos.join("/")} | ${destino.length} linhas | ${mudadas} alteradas pela proposta | final: ${final.toUpperCase()}
-- Trava: hash do plano atual de T1–T3 = ${hashEsperado} (se divergir, aborta). Hash esperado depois: ${hashFinal}.
begin;
do $$
declare v_hash text;
begin
  ${hashSql(cond).replace("select ", "select ").replace(" from escala_producao_alocacoes", " into v_hash from escala_producao_alocacoes")};
  if v_hash is distinct from ${q(hashEsperado)} then
    raise exception 'PROPOSTA_DESATUALIZADA: o plano atual de ${P.data} ${periodos.join("/")} mudou depois do cálculo (hash % ≠ ${hashEsperado}). Nada foi gravado — recalcule a proposta.', v_hash;
  end if;
end $$;
select public.escala_aplicar_recalculo(
  ${q(P.previsaoId)}::uuid,
  jsonb_build_array(jsonb_build_object('data', ${q(P.data)}, 'versao_base', (select versao from escala_producao_dias where data = ${q(P.data)}), 'periodos_snapshot', (select periodos_snapshot from escala_producao_dias where data = ${q(P.data)}))),
  ${q(P.data)}::date, ${q(primeiro)},
  ${q(JSON.stringify(destino))}::jsonb,
  null::uuid, '{}'::uuid[],
  ${q(JSON.stringify(resumo))}::jsonb,
  '{}'::date[]
) as aplicado;
-- verificação: o plano gravado tem exatamente o hash esperado e cada pessoa tem 1 linha por período
do $$
declare v_hash text; v_n integer;
begin
  ${hashSql(cond).replace(" from escala_producao_alocacoes", " into v_hash from escala_producao_alocacoes")};
  select count(*) into v_n from escala_producao_alocacoes a where ${cond};
  if v_hash is distinct from ${q(hashFinal)} or v_n <> ${destino.length} then
    raise exception 'APLICACAO_DIVERGENTE: hash % linhas % (esperado ${hashFinal} / ${destino.length})', v_hash, v_n;
  end if;
end $$;
${final};
`;
}

const hashAtual = hashLinhas(atuais);
const hashProp = hashLinhas(linhas);
const resumoAplicar = { origem: "proposta_tarde", aprovado_por: aprovadoPor || null, alvo, hash_antes: hashAtual, hash_depois: hashProp, linhas_alteradas: mudadas, proposta_gerada_em_ms: P.geradoEmMs, decisao: P.decisao };
const aplicar = sql("APLICAR proposta de T1–T3", linhas.map((l) => jsonLinha(l, origemDe(l))), hashAtual, hashProp, resumoAplicar, commit ? "commit" : "rollback");
const reverter = sql("REVERTER para o plano que existia antes da proposta", atuais.map((l) => jsonLinha(l, l.origem ?? "auto")), hashProp, hashAtual, { ...resumoAplicar, origem: "reversao_proposta_tarde", hash_antes: hashProp, hash_depois: hashAtual }, commit ? "commit" : "rollback");
const base = path.join(path.dirname(jsonPath), path.basename(jsonPath, ".json"));
const so = arg("saida-sql") ?? base + ".aplicar.sql";
const sr = arg("saida-reverter") ?? base + ".reverter.sql";
fs.writeFileSync(so, aplicar);
fs.writeFileSync(sr, reverter);
console.log(`SQL de APLICAR : ${so}\nSQL de REVERTER: ${sr}\nAlvo ${alvo}${commit ? " COM commit" : " (dry-run: termina em ROLLBACK)"}; ${mudadas} linha(s) alterada(s); origem das alteradas: ${origemModo === "mudadas" ? "manual" : origemModo}.`);
