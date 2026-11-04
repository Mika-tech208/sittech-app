// Screenshots do harness /dev/apontamento-simplificado com o Chrome headless (CDP puro via o WebSocket nativo do Node 22+). Uso: node scripts/apontamento-simplificado/capturas.cjs [porta-do-dev=3457]
// Não usa banco nem rede externa: o harness intercepta fetch com dados scriptados.
const { spawn } = require("child_process"); const fs = require("fs"); const os = require("os"); const path = require("path"); const http = require("http");
const PORTA = process.argv[2] || "3457"; const BASE = `http://localhost:${PORTA}/dev/apontamento-simplificado`;
const OUT = path.join(__dirname, "../../docs/apontamento-simplificado/screenshots"); fs.mkdirSync(OUT, { recursive: true });
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"; const DBG = 9333;
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const get = (u) => new Promise((res, rej) => http.get(u, (r) => { let d = ""; r.on("data", (c) => (d += c)); r.on("end", () => res(JSON.parse(d))); }).on("error", rej));

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chrome-apx-"));
  const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${DBG}`, `--user-data-dir=${dir}`, "--window-size=900,1500", "--hide-scrollbars", "about:blank"], { stdio: "ignore" });
  try {
    let alvo; for (let i = 0; i < 50 && !alvo; i++) { await dormir(300); try { alvo = (await get(`http://127.0.0.1:${DBG}/json`)).find((t) => t.type === "page"); } catch {} }
    const ws = new WebSocket(alvo.webSocketDebuggerUrl); await new Promise((r) => { ws.onopen = r; });
    let n = 0; const pend = new Map(); ws.onmessage = (m) => { const j = JSON.parse(m.data); if (j.id && pend.has(j.id)) { pend.get(j.id)(j); pend.delete(j.id); } };
    const cmd = (method, params = {}) => new Promise((res) => { const id = ++n; pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
    const js = async (expr) => { const r = await cmd("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300)); return r.result?.result?.value; };
    await cmd("Emulation.setDeviceMetricsOverride", { width: 900, height: 1500, deviceScaleFactor: 1, mobile: false });
    const foto = async (nome) => { await dormir(400); const r = await cmd("Page.captureScreenshot", { format: "jpeg", quality: 72 }); fs.writeFileSync(path.join(OUT, `${nome}.jpg`), Buffer.from(r.result.data, "base64")); console.log("ok", nome); };
    const ir = async (cenario) => { await cmd("Page.navigate", { url: `${BASE}?cenario=${cenario}` }); await dormir(2500); };
    // helpers dentro da página (React: setter nativo + evento input/change)
    const H = `window.__v=(el,v)=>{const p=el.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,'value').set.call(el,v);el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}))};
      window.__set=(label,v)=>__v(document.querySelector('[aria-label="'+label+'"]'),v);
      window.__click=(txt,i=0)=>{const bs=[...document.querySelectorAll('button')].filter(b=>b.textContent.trim()===txt);bs[i].click()};
      window.__card=(nome)=>[...document.querySelectorAll('.stx-apx-card')].find(c=>c.querySelector('.stx-apx-maq').textContent.startsWith(nome));
      window.__cardClick=(nome,txt)=>{[...window.__card(nome).querySelectorAll('button')].find(b=>b.textContent.trim()===txt).click()};
      window.__sel=(nome,i,v)=>__v(window.__card(nome).querySelectorAll('select')[i],v);true`;
    // 01: abre — só os postos programados, pré-preenchidos
    await ir("ativo"); await js(H); await foto("01-postos-programados");
    // 02: preenche, NÃO PRODUZIU com motivo
    await js(`__set('Produzido Rosqueadeira 3','1480');__set('Refugo Rosqueadeira 3','12');__set('Produzido Parafusadeira 10','1190');__cardClick('Rosqueadeira 6','NÃO PRODUZIU');true`); await dormir(200);
    await js(`__cardClick('Rosqueadeira 6','Sem material');__cardClick('Etiquetadora 15','NÃO PRODUZIU');true`); await dormir(200);
    await js(`__cardClick('Etiquetadora 15','Setup / regulagem');true`); await foto("02-preenchido-nao-produziu");
    // 03: tudo editável — operador/máquina diferentes do programado, divergência visível
    await js(`__cardClick('M8 8','Alterar máquina / operador / produto');true`); await dormir(200);
    await js(`__set('Produzido M8 8','800');__sel('M8 8',0,'00000000-0000-4000-8000-000000000009');true`); await dormir(200);
    await js(`__sel('M8 8',1,'00000000-0000-4000-8000-000000000100');true`); await dormir(200);
    await js(`__sel('M8 8',2,'00000000-0000-4000-8000-000000000200');true`); await foto("03-editado-planejado-x-real");
    // 04: + ADICIONAR APONTAMENTO (fora da escala)
    await js(`__click('+ ADICIONAR APONTAMENTO');true`); await dormir(300); await js(`document.querySelector('.stx-fech-sec[data-testid]')?.scrollIntoView();true`); await foto("04-extra-fora-da-escala");
    // 05: salvar → postos resolvidos, estoque físico, pronto para fechar
    await js(`__click('SALVAR APONTAMENTOS');true`); await dormir(1500);
    await js(`__set('Físico: Rosqueadas aguardando Parafusar','1900');__set('Físico: Parafusadas aguardando Etiquetar','7000');true`); await foto("05-salvo-pronto-para-fechar");
    // 06: fecha e recalcula → nova programação
    await js(`__click([...document.querySelectorAll('button')].find(b=>/^FECHAR M2/.test(b.textContent.trim())).textContent.trim());true`); await dormir(600); await foto("06-fechando-recalculando"); await dormir(2200); await foto("07-confirmado-nova-programacao");
    // 08: fluxo de apontamento desligado = BLOQUEIA o fechamento (não volta ao fluxo antigo)
    await ir("desligado"); await foto("08-fluxo-desligado-fechamento-bloqueado");
    // 09: erro do servidor ao salvar
    await ir("erro"); await js(H); await js(`__set('Produzido Rosqueadeira 3','1480');__click('SALVAR APONTAMENTOS');true`); await dormir(1200); await foto("09-erro-ao-salvar-nada-gravado");
    // 10: falha ao carregar os postos programados = fail-closed (nunca as 22 máquinas)
    await ir("falha"); await foto("10-falha-carregar-postos-fail-closed");
    // 11: período não liberado = a programação não é entregue
    await ir("nao-liberado"); await foto("11-periodo-nao-liberado-fail-closed");
    ws.close();
  } finally { chrome.kill(); await dormir(500); try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} }
})().catch((e) => { console.error(e); process.exit(1); });
