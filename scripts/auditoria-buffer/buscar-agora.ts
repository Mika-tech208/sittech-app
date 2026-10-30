/* eslint-disable @typescript-eslint/no-explicit-any */
// SOMENTE SELECT em PROD: grava o cache (.out) do estado "agora" da semana. Uso: tsx buscar-agora.ts [semana] [agoraIso]
import { buscar } from "./carga";
const semana = process.argv[2] ?? "2026-10-26";
const agora = process.argv[3] ?? new Date().toISOString();
const t0 = Date.now();
const b = buscar({ semana, antesIso: agora, depoisIso: "2999-01-01T00:00:00Z", usarCache: false, somente: ["q_dec", "q_apont", "q_aloc", "q_fluxo", "q_nomes", "q_par", "q_live_ausencias", "q_live_paradas", "q_live_equipe", "q_live_maquinas", "q_hist", "q_prox", "q_ver", "q_ver_depois"] });
console.log(Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v.length])), ((Date.now() - t0) / 1000).toFixed(0) + "s");
