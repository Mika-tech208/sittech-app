import { registro } from "./vitest-shim";
async function main() {
  const arquivos = process.argv.slice(2);
  let ok = 0, falhou = 0; const falhas: string[] = [];
  for (const arq of arquivos) {
    registro.length = 0;
    try { await import(arq); } catch (e) { falhou++; falhas.push(`✗ ${arq}: erro ao carregar: ${e instanceof Error ? e.message : e}`); continue; }
    const testes = [...registro];
    for (const t of testes) {
      try { for (const a of t.antes) await a(); await t.fn(); for (const d of t.depois) await d(); ok++; }
      catch (e) { falhou++; falhas.push(`✗ ${arq.split("/").slice(-1)[0]} › ${t.nome}\n    ${e instanceof Error ? e.message : e}`); }
    }
  }
  console.log(`${ok} passaram, ${falhou} falharam (de ${ok + falhou})`);
  falhas.forEach((f) => console.log(f));
  process.exit(falhou ? 1 : 0);
}
main();
