/* eslint-disable @typescript-eslint/no-explicit-any */
import * as fs from "node:fs";
import * as path from "node:path";
import * as D from "./dados";
import * as N from "./nucleo";
import { coberturaUniformeMaxima } from "@/features/escala/fluxo/propostaCorte";
import { buscaLocal, prepararDespacho, despachar, linhasParaOcc, type ConfigDespacho, type LinhaPostoD } from "@/features/escala/fluxo/postosDespacho";

const wipB = D.cenarios.find((c) => c.nome === "B")!;
const prods = D.produtosRev("meta", wipB.wip);
const cand = JSON.parse(fs.readFileSync(path.join(N.SCRATCH, "candidato-EQUILIBRIO.json"), "utf8")).alocacoes as any[];
const slotIdx = new Map(N.slots.map((s) => [`${s.data}|${s.periodo_id ?? s.periodoId}`, s.indice]));
const ini: LinhaPostoD[] = cand.filter((a) => a.maquina_id).map((a) => ({ t: slotIdx.get(`${a.data}|${a.periodo_id}`) as number, recursoId: a.maquina_id, operacaoId: a.operacao_id }));
const base = { periodos: N.periodos, recursos: N.recursos, produtos: prods, pessoas: N.pessoas, extensaoPeriodos: 0 };
const dem = Object.fromEntries(prods.map((p) => [p.id, p.demandaFinal]));
const cu = coberturaUniformeMaxima(base, N.idsProd, { semAntecipacao: true, limiteOpBloco: N.limOp });
const piso = Object.fromEntries(N.idsProd.map((i) => [i, 0.9 * cu.c * dem[i]]));
console.log("c_u", cu.c, "piso", Object.fromEntries(Object.entries(piso).map(([k, v]) => [N.nomeCurto(k), Math.round(v)])));
const cfg: ConfigDespacho = { t0: 0, produtos: prods, recursos: N.recursos, pessoas: N.pessoas, operacaoDe: N.opDe, alvo: dem, piso, margem: N.pesosMargem, prioridade: [D.aut, D.conv, N.pino, N.plug, D.cx], blocos: N.blocos, limiteOp: N.NP, penalPiso: 1 };
const Dp = prepararDespacho(cfg);
const d0 = despachar(cfg, Dp, linhasParaOcc(cfg, Dp, ini), true);
console.log("rows ini", ini.length, "obj ini", Math.round(d0.obj), Object.fromEntries(Object.entries(d0.finais).map(([k, v]) => [N.nomeCurto(k), Math.round(v)])));
const t0 = Date.now();
const r = buscaLocal(cfg, process.env.VAZIO ? [] : ini, { iter: Number(process.env.ITER ?? 200000), semente: Number(process.env.SEM ?? 3), reinicios: Number(process.env.REI ?? 2) });
console.log("busca ms", Date.now() - t0, "obj", Math.round(r.desp.obj), "ini", Math.round(r.objInicial), "aceitas", r.aceitas, "melhorias", r.melhorias, Object.fromEntries(Object.entries(r.desp.finais).map(([k, v]) => [N.nomeCurto(k), Math.round(v)])));
const porT = new Array(N.H).fill(0); r.linhas.forEach((l) => porT[l.t]++);
console.log("linhas por período", porT.join(","));
