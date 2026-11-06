import { limparApontamentosDe, fecharSim, usuarioFechamento, prepararRelogioSimulado, psql, ok } from "./lib-virada";
(async () => {
  prepararRelogioSimulado();
  const u = await usuarioFechamento();
  const seq: [string, string][] = [["2026-11-05","m3"],["2026-11-05","t1"],["2026-11-05","t2"],["2026-11-05","t3"],["2026-11-06","m1"],["2026-11-06","m2"],["2026-11-06","m3"],["2026-11-06","t1"],["2026-11-06","t2"],["2026-11-06","t3"]];
  limparApontamentosDe(seq);
  for (const [d, p] of seq) {
    const t0 = Date.now();
    const x = await fecharSim(u, d, p, (e) => ({ a: Math.round(e.a * 1.1), b: Math.round(e.b * 0.9), c: Math.round(e.c * 1.05) }));
    const c = x.r?.corpo as any;
    console.log(d, p, "apont criados:", x.apontamentosCriados, "abrir:", x.ab.status, (x.ab.corpo as any).erro ?? "", "| est", JSON.stringify(x.estimados), "fis", JSON.stringify(x.abc), "|", x.r?.status, c?.estado, c?.mensagem ?? c?.erros?.[0]?.mensagem ?? "", `${Date.now()-t0}ms`);
    if (!c || c.estado !== "CONFIRMADO") break;
  }
})();
