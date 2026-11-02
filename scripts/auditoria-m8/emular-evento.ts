/* eslint-disable @typescript-eslint/no-explicit-any */
// EMULA, offline, o que o recálculo oficial (processarSemana → planejador de corte corte-v1) faz na semana 02/11 REAL quando um evento chega:
// estado = SELECTs de PROD (dumps + plano ativo atual como "gravado"), a M8 desmarcada só na ENTRADA em memória. Nada é gravado em lugar nenhum (o `io` aqui é em memória).
// Rodar: SQL_DIR=<dumps> PLANO=<plano-ativo.sql.out> fe/ts.sh scripts/auditoria-m8/emular-evento.ts   (env: DESMARCAR=0|1)
import * as fs from "node:fs";
import { montarEstado as carregar, rows } from "../ativacao-0211/carga";
import { processarSemana } from "@/lib/escala/processar";
import { lerConfigPlanejador } from "@/lib/escala/fluxo/parametrosFluxo";
import { lerDistribuicao, distribuicaoEfetiva } from "@/features/escala/distribuicao";
import { hashAlocacoes } from "@/features/escala/horizonte";
import type { AlocacaoEscala } from "@/features/escala/types";
import type { EstadoBruto, PayloadAplicacao } from "@/lib/escala/estado";

const AUTO = "a027ac97-ffd1-4834-8ed0-d3a94aac4aee", M8 = "a118f430-f854-4e89-9e3c-ce6fcbbc52cf", ETAPA_M8 = "1b72bf46-5d13-43c5-89b4-6169436085b7";
const AGORA = Date.parse(process.env.AGORA ?? "2026-11-02T20:00:00-03:00");
const desmarcar = process.env.DESMARCAR === "1";
const { estado, raw } = carregar();
const t = fs.readFileSync(process.env.PLANO as string, "utf8");
const plano: AlocacaoEscala[] = JSON.parse(t.slice(t.indexOf("{"))).rows.map((r: any) => ({
  data: r.d, periodoId: r.p, funcionarioId: r.f, maquinaId: r.m || null, produtoId: r.pr || null, etapaId: r.e || null, operacaoId: r.o || null, pecas: Number(r.pc), pecasAdicional: Number(r.pa),
  motivoSemPosto: r.ms || null, excecaoRevezamento: !!r.exc, motivoExcecao: null, origem: r.orig || "auto", ...(lerDistribuicao(r.dist) ? { distribuicao: lerDistribuicao(r.dist) } : {}),
}));
const param = (k: string) => { const v = raw.q_params.find((x: any) => x.chave === k)?.valor; return typeof v === "string" ? JSON.parse(v) : v; };
const contagens = (param("producao_real_contagens_fisicas") ?? []).map((c: any) => ({ ...c, contadoEmMs: Date.parse(c.contadoEm) }));
const cfg = lerConfigPlanejador(JSON.parse(fs.readFileSync("scripts/ativacao-0211/config-planejador.json", "utf8")));
if (desmarcar) estado.itens = estado.itens.map((i) => (i.produtoId === AUTO ? { ...i, maquinasPorEtapa: { ...i.maquinasPorEtapa, [ETAPA_M8]: (i.maquinasPorEtapa[ETAPA_M8] ?? []).filter((m) => m !== M8) } } : i));
const base: EstadoBruto = {
  ...estado, parametros: { ...estado.parametros!, revezamentoPonteM3T1: true } as any,
  diasExistentes: rows("q_existentes").map((d: any) => ({ data: d.data, versao: Number(d.versao), periodosSnapshot: d.periodos_snapshot })), alocacoes: plano,
  producaoReal: { modoEfetivo: "ativo", limiar: null, paresLegado: param("producao_real_pares_legado") ?? [], contagensFisicas: contagens, apontamentos: [], mesmoPeriodo: false, cadeia: { diagnostico: true } } as any,
  planejadorCorte: { config: cfg as any, vigenteDoPlanejador: true, distribuicaoSuportada: true, hashEntradaAnterior: null },
};
let payload: PayloadAplicacao | null = null;
const io: any = {
  carregarEstado: async () => base,
  aplicar: async (p: PayloadAplicacao) => { payload = p; return { versoes: Object.fromEntries(p.dias.map((d) => [d.data, 1])) }; },
  registrarFluxo: async () => undefined, gravarSnapshotsWip: async () => undefined,
};
(async () => {
  console.log(`M8 ${desmarcar ? "DESMARCADA" : "selecionada"} · plano "gravado" = plano ativo (${plano.length} linhas, hash ${hashAlocacoes(plano)})`);
  const r = await processarSemana(io, { agoraMs: AGORA, criarSeNaoExiste: false });
  console.log("status:", r.status, "· alocacoesGravadas:", r.alocacoesGravadas, "·", (r as any).motivoIgnorado ?? "");
  console.log("alertas retornados:", JSON.stringify((r.alertas ?? []).map((a: any) => a.tipo + (a.produtoId === AUTO ? ":Auto" : ""))));
  if (payload) {
    const p = payload as PayloadAplicacao; const res = p.resumo as any;
    const aut = p.alocacoes.filter((l) => l.maquinaId).flatMap((l) => distribuicaoEfetiva(l) ?? [{ produtoId: l.produtoId, etapaId: l.etapaId, pecas: l.pecas }]).filter((i) => i.produtoId === AUTO);
    const porEtapa = new Map<string, number>(); aut.forEach((i) => porEtapa.set(i.etapaId as string, (porEtapa.get(i.etapaId as string) ?? 0) + i.pecas));
    console.log("PLANO GRAVADO (payload.alocacoes):", p.alocacoes.length, "linhas · hash", hashAlocacoes(p.alocacoes as any), "· peças Auto por etapa:", JSON.stringify([...porEtapa.entries()].map(([k, v]) => k.slice(0, 6) + "=" + Math.round(v))));
    console.log("resumo.planejador:", res.planejador, "· planejadorCorte:", JSON.stringify(res.planejadorCorte), "· alertas:", res.alertas, "· alertasDetalhe tipos:", JSON.stringify((res.alertasDetalhe ?? []).map((a: any) => a.tipo + (a.produtoId === AUTO ? ":Auto:" + a.pecas : ""))));
  } else console.log("nada foi gravado (NO-OP ou mantido).");
})();
