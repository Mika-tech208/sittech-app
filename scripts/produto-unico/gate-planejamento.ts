/* eslint-disable @typescript-eslint/no-explicit-any */
// GATE RÁPIDO DO PLANEJAMENTO (SOMENTE LEITURA; seguro em PROD e no clone): confirma que a semana está pronta para ser PROGRAMADA com o produto único sem tocar na operação.
// Uso: set -a; source <env com NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY>; set +a; SEMANA=2026-11-09 scripts/fechamento/ts.sh scripts/produto-unico/gate-planejamento.ts
// Saída: tabela PASS/FAIL. Código de saída 1 se algum check falhar.
import { createClient } from "@supabase/supabase-js";

const SEMANA = process.env.SEMANA ?? "2026-11-09";
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "", KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
if (!URL || !KEY) { console.error("faltam NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY"); process.exit(2); }
const admin = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const linhas: { check: string; ok: boolean; detalhe: string }[] = [];
const chk = (check: string, ok: boolean, detalhe = "") => linhas.push({ check, ok, detalhe });
const q = async (t: string, c: string, f?: (x: any) => any) => { const x = admin.from(t).select(c); const r = await (f ? f(x) : x); if (r.error) throw new Error(`${t}: ${r.error.message}`); return r.data as any[]; };
const somar = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

(async () => {
  const pars = Object.fromEntries((await q("escala_parametros", "chave, valor")).map((p) => [p.chave, p.valor]));
  const planej = pars["produto_unico_planejamento_desde"] ?? null, cut = pars["produto_unico_cutover"] ?? null;
  chk("planejamento habilitado para a semana", typeof planej === "string" && planej <= SEMANA, `planejamento_desde=${planej} cutover=${cut}`);
  chk("semana nas DUAS listas (semanas_ativas e planejador_semanas)", [pars["producao_real_semanas_ativas"], pars["producao_real_planejador_semanas"]].every((l) => Array.isArray(l) && l.includes(SEMANA)), `${JSON.stringify(pars["producao_real_semanas_ativas"])} / ${JSON.stringify(pars["producao_real_planejador_semanas"])}`);
  const est = await admin.rpc("produto_unico_estado", { p_semana: SEMANA });
  const e: any = est.data ?? {};
  chk("produto único ativo e cadastro sem problemas", e.produto_ativo === true && (e.problemas_cadastro ?? []).length === 0, `ativo=${e.produto_ativo} problemas=${(e.problemas_cadastro ?? []).length}`);
  chk("modo da semana", e.modo_semana === "PLANEJAMENTO" || e.modo_semana === "OPERACIONAL", String(e.modo_semana));
  const pu = e.produto_id as string;
  const prev = (await q("previsoes", "id", (x) => x.eq("semana_inicio", SEMANA)))[0];
  chk("existe Previsão da semana", !!prev, prev?.id ?? "-");
  if (prev) {
    const itens = await q("previsao_itens", "id, produto_id, quantidade, tipo", (x) => x.eq("previsao_id", prev.id).eq("tipo", "previsto"));
    const unicos = itens.filter((i) => i.produto_id === pu);
    const mapa = await q("produto_legado_mapa", "produto_legado_id");
    const legados = itens.filter((i) => mapa.some((m) => m.produto_legado_id === i.produto_id));
    chk("demanda ÚNICA do Conector (1 item, quantidade > 0)", unicos.length === 1 && Number(unicos[0].quantidade) > 0, `item único: ${unicos.map((i) => i.quantidade).join(",") || "nenhum"}`);
    chk("nenhum item legado do Conector na Previsão", legados.length === 0, `${legados.length} item(ns) legado(s)`);
    if (unicos[0]) {
      const maq = await q("previsao_item_maquinas", "etapa_id, maquina_id", (x) => x.eq("item_id", unicos[0].id));
      const etapas = await q("roteiro_etapas", "id, operacao_id", (x) => x.eq("produto_id", pu));
      const ops = Object.fromEntries((await q("operacoes", "id, nome")).map((o) => [o.id, o.nome]));
      const porOp: Record<string, number> = {};
      etapas.forEach((et) => { porOp[ops[et.operacao_id]] = maq.filter((m) => m.etapa_id === et.id).length; });
      chk("máquinas selecionadas em TODAS as etapas (inclui a M8 na etapa 'Rosquear + Parafusar')", Object.values(porOp).length === 5 && Object.values(porOp).every((n) => n > 0), JSON.stringify(porOp));
    }
    const dias = await q("escala_producao_dias", "data, previsao_id", (x) => x.eq("previsao_id", prev.id));
    if (dias.length > 0) {
      const aloc = await q("escala_producao_alocacoes", "produto_id, etapa_id, distribuicao, maquina_id", (x) => x.gte("data", SEMANA).lte("data", somar(SEMANA, 6)).limit(5000));
      const legIds = new Set(mapa.map((m) => m.produto_legado_id));
      const bad = aloc.filter((a) => legIds.has(a.produto_id) || JSON.stringify(a.distribuicao ?? "").split('"').some((t) => legIds.has(t)));
      chk("plano da semana não usa NENHUM id legado do Conector", bad.length === 0, `${aloc.length} linhas, ${bad.length} legadas, ${aloc.filter((a) => a.produto_id === pu && a.maquina_id).length} com posto no produto único`);
    } else chk("plano da semana gerado (informativo)", true, "ainda não gerado");
  }
  if (e.modo_semana === "PLANEJAMENTO") {
    let nao = 0, outros = new Set<string>();
    for (let d = 0; d < 5; d++) for (const p of ["m1", "m2", "m3", "t1", "t2", "t3"]) { const r = await admin.rpc("escala_periodo_liberacao", { p_data: somar(SEMANA, d), p_periodo: p }); const j: any = r.data; if (j?.liberado === false) nao++; outros.add(String(j?.motivo)); }
    chk("PLANO FUTURO: 30 períodos NÃO LIBERADOS (PLANO_FUTURO_AGUARDANDO_CUTOVER)", nao === 30 && outros.size === 1 && outros.has("PLANO_FUTURO_AGUARDANDO_CUTOVER"), `${nao}/30 · ${[...outros].join(",")}`);
  }
  const velhos = await q("escala_producao_eventos", "id, criado_em", (x) => x.in("status", ["pendente", "processando"]).neq("tipo", "apontamento_periodo").lt("criado_em", new Date(Date.now() - 15 * 60_000).toISOString()));
  const esgot = await q("escala_producao_eventos", "id", (x) => x.eq("status", "erro").gte("tentativas", 3).neq("tipo", "apontamento_periodo"));
  chk("fila de recálculo sem pendências antigas (> 15 min) nem eventos esgotados", velhos.length === 0 && esgot.length === 0, `${velhos.length} pendente(s) antigo(s), ${esgot.length} esgotado(s)`);
  console.log(`\nGATE DO PLANEJAMENTO · semana ${SEMANA} · ${URL.replace(/\/\/.*@/, "//")}\n`);
  console.log("RESULTADO  CHECK                                                                         DETALHE");
  linhas.forEach((l) => console.log(`${l.ok ? "PASS" : "FAIL"}       ${l.check.padEnd(82)} ${l.detalhe}`));
  const f = linhas.filter((l) => !l.ok).length;
  console.log(f === 0 ? "\nGATE: PASS" : `\nGATE: FAIL (${f})`);
  process.exit(f ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
