// Busca (somente SELECT em PROD) e cacheia os dados da semana. Uso: tsx buscar.ts [--semana 2026-10-26] [--antes-ate ISO]
import { buscar } from "./carga";
const arg = (k: string) => { const i = process.argv.indexOf("--" + k); return i >= 0 ? process.argv[i + 1] : undefined; };
const semana = arg("semana") ?? "2026-10-26";
const b = buscar({ semana, antesIso: arg("antes-ate") ?? "2026-10-28T08:50:00-03:00", depoisIso: "2999-01-01T00:00:00Z", usarCache: false });
console.log(Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v.length])));
