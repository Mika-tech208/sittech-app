// Hash canônico das linhas de T1–T3 (trava de desatualização da aplicação): MESMA definição no SQL (md5 de string_agg ordenado).
import * as crypto from "node:crypto";
export interface LinhaH { data: string; periodoId: string; funcionarioId: string; maquinaId?: string | null; produtoId?: string | null; etapaId?: string | null }
export const textoLinha = (a: LinhaH) => `${a.data}|${a.periodoId}|${a.funcionarioId}|${a.maquinaId ?? ""}|${a.produtoId ?? ""}|${a.etapaId ?? ""}`;
export const hashLinhas = (l: LinhaH[]) => crypto.createHash("md5").update([...l].sort((a, b) => { const x = `${a.data}|${a.periodoId}|${a.funcionarioId}`, y = `${b.data}|${b.periodoId}|${b.funcionarioId}`; return x < y ? -1 : x > y ? 1 : 0; }).map(textoLinha).join(";")).digest("hex");
