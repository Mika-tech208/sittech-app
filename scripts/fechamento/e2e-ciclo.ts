/* eslint-disable @typescript-eslint/no-explicit-any */
// E2E DO CICLO COMPLETO do Fechamento Físico + Liberação (clone local de PROD; NUNCA roda em PROD).
// Em cada virada (M1→M2, M2→M3, M3→T1, T1→T2, T2→T3, T3→M1 seguinte) prova, com banco real e as camadas reais (API → orquestrador → corte-v1 → portão HARD → persistência):
//   próximo período INVISÍVEL (liberação, TV, API dos postos) com: plano antigo existindo / apontamentos incompletos / estoque incompleto → só depois do CONFIRMADO + vínculo explícito fica visível;
//   apontamentos pelo fluxo único (RPC registrar_apontamentos_fechamento: igual ao plano, NÃO PRODUZIU, operador trocado); físico ≠ estimado, inclusive 0; retry idempotente.
// Uso: set -a; source ~/Documents/sittech-clone/env.clone; set +a; DATA=2026-11-03 SEMANA=2026-11-02 scripts/fechamento/ts.sh scripts/fechamento/e2e-ciclo.ts
import { execFileSync } from "node:child_process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { acaoAbrir, acaoConfirmar, acaoRetry, ioDoUsuario, type UsuarioFechamento } from "@/lib/escala/fechamento/http";
import { acaoPostos } from "@/lib/escala/fechamento/httpPostos";
import { carregarPostosProgramados } from "@/lib/escala/fechamento/postosProgramados";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "", KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
if (URL.includes("qcmottqryawyrghdepel") || !/127\.0\.0\.1|localhost/.test(URL)) throw new Error("ABORTADO: só roda no clone local");
const DATA = process.env.DATA ?? "2026-11-03", SEMANA = process.env.SEMANA ?? "2026-11-02";
const admin: SupabaseClient = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const PG = ["-h", "127.0.0.1", "-p", process.env.CLONE_PGPORT ?? "55433", "-U", "postgres", "-d", process.env.CLONE_PGDB ?? "sittech_clone", "-v", "ON_ERROR_STOP=1", "-q", "-At"];
const psql = (q: string): string => execFileSync("/opt/homebrew/opt/libpq/bin/psql", [...PG, "-c", q], { encoding: "utf8", env: { ...process.env, PGPASSWORD: "postgres" } }).trim();
const falhas: string[] = []; const linhas: string[] = [];
const ok = (cond: boolean, nome: string, detalhe = "") => { const l = `${cond ? "PASS" : "FAIL"}  ${nome}${detalhe ? ` — ${detalhe}` : ""}`; console.log(l); linhas.push(l); if (!cond) falhas.push(nome); };
const uuid = () => crypto.randomUUID();
const CICLO: [string, string, string][] = [["m1", DATA, "m2"], ["m2", DATA, "m3"], ["m3", DATA, "t1"], ["t1", DATA, "t2"], ["t2", DATA, "t3"], ["t3", DATA, "m1"]];
const ORDEM = ["m1", "m2", "m3", "t1", "t2", "t3"];

// período seguinte (data, id) da virada
const proximoDe = (periodo: string): { data: string; id: string } => periodo === "t3" ? { data: new Date(Date.parse(`${DATA}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10), id: "m1" } : { data: DATA, id: ORDEM[ORDEM.indexOf(periodo) + 1] };
const liberacao = (data: string, per: string) => JSON.parse(psql(`select public.escala_periodo_liberacao('${data}','${per}')::text`));
// o que a TV (RPC, como administrador) entregaria: períodos com alocações para o dia
const tvPeriodos = (data: string): string[] => {
  const q = `begin; select set_config('request.jwt.claims', json_build_object('sub',(select auth_user_id::text from public.usuarios where papel='admin' and ativo and auth_user_id is not null limit 1),'role','authenticated')::text, true); set local role authenticated;
    select coalesce(string_agg(distinct a->>'periodo_id', ',' order by a->>'periodo_id'), '') from (select jsonb_array_elements(public.escala_tv_snapshot('${data}')->'alocacoes') a) x; rollback;`;
  const saida = psql(q).split("\n").filter((l) => !/^(BEGIN|ROLLBACK|SET|t|\s*)$/.test(l) && !/^\{/.test(l));
  return (saida.at(-1) ?? "").split(",").filter(Boolean);
};

(async () => {
  const { data: us } = await admin.from("usuarios").select("id, nome, auth_user_id").not("auth_user_id", "is", null).order("id").limit(2);
  if (!us || us.length < 2) throw new Error("precisa de ≥ 2 usuários");
  const A: UsuarioFechamento = { id: us[0].id, papel: "usuario", permissoes: ["escala_fechamento"] };
  const authA = us[0].auth_user_id as string;
  const io = ioDoUsuario(admin, A);
  console.log(`# E2E CICLO · clone · semana ${SEMANA} · dia ${DATA} · ${new Date().toISOString()}`);

  // ---- preparação (somente clone): flags, ardósia limpa dos fechamentos e dos apontamentos posteriores ----
  psql(`update public.escala_parametros set valor='"ativo"'::jsonb where chave in ('escala_fechamento_fisico_modo','apontamento_simplificado_modo')`);
  psql(`insert into public.escala_parametros (chave, valor, grupo, descricao) values ('escala_liberacao_desde', '{"data":"${DATA}","periodo":"m2"}'::jsonb, 'operacional', 'e2e ciclo') on conflict (chave) do update set valor = excluded.valor`);
  psql(`begin; set local session_replication_role = replica;
    delete from public.escala_fechamento_plano; delete from public.escala_fechamento_log; delete from public.escala_fechamento_buffers; delete from public.escala_fechamentos; delete from public.escala_fechamento_aberturas;
    delete from public.apontamento_planejado_real; delete from public.apontamento_paradas where apontamento_id in (select id from public.apontamentos_producao where data between '${DATA}' and '${proximoDe("t3").data}');
    delete from public.apontamentos_producao where data between '${DATA}' and '${proximoDe("t3").data}'; commit;`);
  // contagens manuais (parâmetro) posteriores ao dia sairiam na frente do fechamento (a mais recente vence): fora do clone
  psql(`update public.escala_parametros set valor = coalesce((select jsonb_agg(e) from jsonb_array_elements(valor) e where (e->>'contadoEm')::timestamptz < '${DATA}T00:00:00-03:00'::timestamptz), '[]'::jsonb) where chave = 'producao_real_contagens_fisicas'`);
  psql("notify pgrst, 'reload schema'");

  // ---- A: antes de qualquer fechamento: M2.. invisíveis? (M1 é transição) ----
  ok(liberacao(DATA, "m1").liberado === true && liberacao(DATA, "m1").motivo === "TRANSICAO", "M1 do dia de partida = transição (liberado)");
  ok(liberacao(DATA, "m2").liberado === false && liberacao(DATA, "m2").motivo === "AGUARDANDO_FECHAMENTO", "G: M2 com plano antigo no banco e sem fechamento de M1 ⇒ NÃO liberado");

  const vinculosAntes: Record<string, number> = {};
  for (const [periodo] of CICLO) {
    const prox = proximoDe(periodo);
    const rot = periodo.toUpperCase();
    console.log(`\n=== VIRADA ${rot} → ${prox.id.toUpperCase()} (${prox.data}) ===`);

    // 1) antes: próximo invisível na liberação, na TV e na API dos postos (Produção Real); atual visível
    const l0 = liberacao(prox.data, prox.id);
    ok(l0.liberado === false && l0.motivo === "AGUARDANDO_FECHAMENTO", `${rot}→: próximo (${prox.id}) NÃO liberado antes do fechamento`, l0.motivo);
    ok(!tvPeriodos(prox.data).includes(prox.id), `${rot}→: TV (RPC) não entrega NENHUMA alocação de ${prox.id.toUpperCase()}`, `entrega: ${tvPeriodos(prox.data).join(",")}`);
    const apiNao = await acaoPostos({ carregar: (d, p) => carregarPostosProgramados(admin, d, p), modo: async () => "ativo", liberado: async (d, p) => { const r = await admin.rpc("escala_periodo_liberacao", { p_data: d, p_periodo: p }); return r.data as any; } },
      { id: A.id, papel: "usuario", permissoes: ["escala_fechamento"] }, prox.data, prox.id);
    ok((apiNao.corpo as any).naoLiberado === true && (apiNao.corpo as any).postos?.length === 0, `${rot}→: API dos postos (Produção Real) devolve naoLiberado e 0 postos de ${prox.id.toUpperCase()}`);

    // 2) abrir: janela do fechamento (tablet)
    const ab = await acaoAbrir(io, A, { data: DATA, periodo_id: periodo });
    ok(ab.status === 200, `${rot}: abrir fechamento (janela do tablet)`, `${ab.status} ${(ab.corpo as any).erro ?? ""}`);
    const nPostos = (ab.corpo as any).postos?.length ?? 0;

    // 3) H: apontamentos incompletos ⇒ NÃO fecha, próximo continua invisível
    const bufs = ((ab.corpo as any).buffers ?? []) as any[];
    const fisicos = (fator: number) => bufs.map((b, i) => ({ buffer_id: b.buffer_id, fisico: i === 0 ? 0 : Math.max(0, Math.round((b.estimado ?? 1000 * (i + 1)) * fator)), motivo: null }));
    const rPend = await acaoConfirmar(io, A, { data: DATA, periodo_id: periodo, chave: uuid(), buffers: fisicos(1.1) });
    ok(rPend.status === 422 && JSON.stringify(rPend.corpo).includes("POSTOS_PENDENTES"), `H ${rot}: apontamentos incompletos ⇒ recusa POSTOS_PENDENTES (nada gravado)`, String(rPend.status));
    ok(liberacao(prox.data, prox.id).liberado === false, `H ${rot}: próximo continua invisível`);

    // 4) apontamentos pelo FLUXO ÚNICO (RPC registrar_apontamentos_fechamento, como o usuário): 1 NÃO PRODUZIU (PARADA), 1 operador trocado, o resto igual ao plano
    psql(`begin; select set_config('request.jwt.claims', json_build_object('sub','${authA}','role','authenticated')::text, true); set local role authenticated;
      select public.registrar_apontamentos_fechamento('${DATA}', '${periodo}', (
        select jsonb_agg(jsonb_build_object('chave', gen_random_uuid(), 'maquina_planejada_id', a.maquina_id, 'maquina_id', a.maquina_id,
          'produto_id', case when a.rn = 1 then null else a.produto_id end,
          'funcionario_id', case when a.rn = 1 then null when a.rn = 2 then a.outro else a.funcionario_id end,
          'produzido', case when a.rn = 1 then 0 else greatest(a.pecas, 1) end, 'refugo', 0, 'nao_produziu', a.rn = 1,
          'motivo', case when a.rn = 1 then 'PARADA' else null end, 'descricao', ''))
        from (select x.*, row_number() over (order by x.maquina_id) rn, (select y.funcionario_id from public.escala_producao_alocacoes y where y.data = x.data and y.periodo_id = x.periodo_id and y.funcionario_id <> x.funcionario_id order by y.funcionario_id limit 1) outro
              from public.escala_producao_alocacoes x where x.data = '${DATA}' and x.periodo_id = '${periodo}' and x.maquina_id is not null) a)); commit;`);
    const nVinc = Number(psql(`select count(*) from public.apontamento_planejado_real where data='${DATA}' and periodo_id='${periodo}'`));
    ok(nVinc === nPostos, `${rot}: apontamentos gravados pelo fluxo único (planejado × real em ${nVinc}/${nPostos} postos)`);
    ok(Number(psql(`select count(*) from public.apontamento_planejado_real where data='${DATA}' and periodo_id='${periodo}' and nao_produziu and motivo_nao_produziu='PARADA'`)) === 1, `${rot}: NÃO PRODUZIU com motivo fino PARADA gravado`);
    ok(Number(psql(`select count(*) from public.apontamento_planejado_real where data='${DATA}' and periodo_id='${periodo}' and 'OPERADOR' = any(divergencias)`)) >= 1, `${rot}: ALTERADO DO PLANEJADO (operador) registrado como divergência`);

    // 5) I: estoque incompleto ⇒ NÃO fecha
    const rInc = await acaoConfirmar(io, A, { data: DATA, periodo_id: periodo, chave: uuid(), buffers: fisicos(1.1).slice(1) });
    ok(rInc.status === 422 && JSON.stringify(rInc.corpo).includes("BUFFER_FALTANDO"), `I ${rot}: estoque físico incompleto ⇒ recusa BUFFER_FALTANDO`, String(rInc.status));
    ok(liberacao(prox.data, prox.id).liberado === false, `I ${rot}: próximo continua invisível`);

    // 6) fechar: físico ≠ estimado (primeiro = 0, os outros −35%/+25% alternados): aceita sem motivo/confirmação; vínculo explícito; HARD gate; plano persistido
    const chave = uuid();
    const b = fisicos(periodo === "m1" ? 0.65 : 1.25);
    const t0 = Date.now();
    const r = await acaoConfirmar(io, A, { data: DATA, periodo_id: periodo, chave, buffers: b });
    const c = r.corpo as any;
    ok(r.status === 200 && c.estado === "CONFIRMADO", `${rot}: CONFIRMADO (físico 0 e ±>25% do estimado aceitos sem justificativa)`, `${Math.round(Date.now() - t0)} ms · ${c.mensagem ?? c.erros?.[0]?.mensagem ?? ""}`);
    if (c.estado !== "CONFIRMADO") { console.log(JSON.stringify(c).slice(0, 600)); break; }
    const salvo = (await admin.from("escala_fechamento_buffers").select("saldo_fisico, saldo_estimado, diferenca, diferenca_pct, motivo").eq("fechamento_id", c.fechamentoId)).data ?? [];
    ok(salvo.length === b.length && b.every((x: any) => salvo.some((s: any) => Number(s.saldo_fisico) === x.fisico)), `${rot}: inventário físico gravado EXATAMENTE como informado`, `${salvo.length} buffers`);
    ok(salvo.every((s: any) => s.motivo === null) && salvo.some((s: any) => s.saldo_fisico !== null && Number(s.saldo_fisico) === 0), `${rot}: sem motivo falso (motivo nulo) e estimado/físico/diferença/% guardados`);
    const vinc = (await admin.from("escala_fechamento_plano").select("data, versao, hash_plano, metodo, portao_hard").eq("fechamento_id", c.fechamentoId)).data ?? [];
    ok(vinc.length > 0 && vinc.every((v: any) => v.portao_hard === "APROVADO" && v.hash_plano), `${rot}: vínculo EXPLÍCITO fechamento→plano gravado (${vinc.length} dias; ${vinc.map((v: any) => v.metodo).filter((x: string, i: number, a: string[]) => a.indexOf(x) === i).join("/")}), HARD gate APROVADO`);
    ok(vinc.some((v: any) => v.data === prox.data), `${rot}: vínculo cobre o dia do próximo período (${prox.data})`);
    vinculosAntes[periodo] = vinc.length;

    // 7) depois: liberado, visível na TV e na API
    const l1 = liberacao(prox.data, prox.id);
    ok(l1.liberado === true && l1.motivo === "CONFIRMADO" && l1.fechamento_id === c.fechamentoId, `${rot}: próximo (${prox.id}) LIBERADO pelo vínculo`, `${l1.motivo} · plano v${l1.plano_versao} · ${l1.vinculo}`);
    ok(tvPeriodos(prox.data).includes(prox.id), `${rot}: TV (RPC) passa a entregar ${prox.id.toUpperCase()}`, tvPeriodos(prox.data).join(","));
    const apiSim = await acaoPostos({ carregar: (d, p) => carregarPostosProgramados(admin, d, p), modo: async () => "ativo", liberado: async (d, p) => { const rr = await admin.rpc("escala_periodo_liberacao", { p_data: d, p_periodo: p }); return rr.data as any; } }, A, prox.data, prox.id);
    ok((apiSim.corpo as any).postos?.length > 0 && !(apiSim.corpo as any).naoLiberado, `${rot}: API dos postos devolve os postos programados de ${prox.id.toUpperCase()}`, `${(apiSim.corpo as any).postos?.length} postos`);
    const seguinte = ORDEM.indexOf(prox.id) + 1 < ORDEM.length && prox.id !== "m1" ? { data: prox.data, id: ORDEM[ORDEM.indexOf(prox.id) + 1] } : null;
    if (seguinte) ok(liberacao(seguinte.data, seguinte.id).liberado === false, `${rot}: o período DEPOIS do próximo (${seguinte.id}) segue invisível`);

    // 8) P: retry / reenvio idempotente
    const rRe = await acaoConfirmar(io, A, { data: DATA, periodo_id: periodo, chave, buffers: b });
    const rRt = await acaoRetry(io, A, { fechamento_id: c.fechamentoId });
    const nFech = Number(psql(`select count(*) from public.escala_fechamentos where data='${DATA}' and periodo_id='${periodo}'`));
    const nVinc2 = Number(psql(`select count(*) from public.escala_fechamento_plano where fechamento_id='${c.fechamentoId}'`));
    ok((rRe.corpo as any).duplicado === true && (rRt.corpo as any).duplicado === true && nFech === 1 && nVinc2 === vinculosAntes[periodo], `P ${rot}: retry/reenvio não duplica fechamento nem vínculo`, `${nFech} fechamento(s), ${nVinc2} vínculo(s)`);
  }

  console.log(`\n# RESUMO: ${linhas.filter((l) => l.startsWith("PASS")).length} PASS / ${falhas.length} FAIL`);
  falhas.forEach((f) => console.log(`FAIL: ${f}`));
  process.exit(falhas.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
