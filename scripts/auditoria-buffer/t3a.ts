/* eslint-disable @typescript-eslint/no-explicit-any */
import * as fs from "node:fs";
import { carregarTudo, hhmm, nomeador } from "./lib";
const { d, bruto } = carregarTudo("2999-01-01T00:00:00Z");
const nome = nomeador(d.nomes);
const hoje = d.apontamentos.filter((a) => a.data === "2026-10-30");
console.log("APONT hoje:", hoje.length);
hoje.forEach((a) => console.log(a.periodoId, new Date(a.lancadoEmMs - 3*3600e3).toISOString().slice(11,16), "maq", nome(a.maquinaId), "|", nome(a.produtoId), "|", nome(a.etapaId), "| func", nome(a.funcionarioId), "| boas", a.boas, "meta", a.meta, a.status, a.motivo ?? ""));
const v = d.versaoAntes!;
console.log("VERSAO", v.valido, v.origem, v.linhas.length);
const lin = v.linhas.filter((l) => l.data === "2026-10-30");
for (const p of ["t1","t2","t3"]) { console.log("--", p); lin.filter((l) => l.periodoId === p).sort((a,b)=>(nome(a.funcionarioId)<nome(b.funcionarioId)?-1:1)).forEach((l) => console.log("  ", nome(l.funcionarioId).padEnd(28), "->", nome(l.maquinaId).padEnd(26), nome(l.produtoId), "|", nome(l.etapaId), l.pecas ?? "", l.pecasAdicional ? "adic"+l.pecasAdicional : "", l.motivoSemPosto ?? "")); }
console.log("PAR", JSON.stringify(d.cfg).slice(0,1500));
console.log("DEC", d.decisao.criadoEm, d.decisao.periodoId);
