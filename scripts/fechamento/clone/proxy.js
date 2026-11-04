/* eslint-disable @typescript-eslint/no-require-imports */
// Proxy mínimo: supabase-js chama <url>/rest/v1/...; PostgREST serve na raiz. Remove o prefixo /rest/v1.
// Escuta só em 127.0.0.1. Sem dependências.
// Opcional (ensaio de latência): LATENCIA_MIN_MS / LATENCIA_MAX_MS atrasam CADA requisição (uniforme entre os dois), emulando a rede até um Supabase remoto.
// GET /__stats devolve { n } = nº de requisições atendidas (para contar as idas ao banco de um fluxo).
const http = require('http');
const [, , listen, target] = process.argv; // ex.: 3300 3301
const MIN = Number(process.env.LATENCIA_MIN_MS || 0), MAX = Number(process.env.LATENCIA_MAX_MS || 0);
let n = 0;
http.createServer((req, res) => {
  if (req.url === '/__stats') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ n })); }
  if (!req.url.startsWith('/rest/v1')) { res.writeHead(404, { 'content-type': 'application/json' }); return res.end('{"message":"clone local: apenas /rest/v1"}'); }
  n++;
  const path = req.url.slice('/rest/v1'.length) || '/';
  const encaminhar = () => {
    const p = http.request({ host: '127.0.0.1', port: +target, path, method: req.method, headers: req.headers }, (r) => {
      res.writeHead(r.statusCode, r.headers); r.pipe(res);
    });
    p.on('error', (e) => { res.writeHead(502); res.end(JSON.stringify({ message: 'postgrest indisponivel: ' + e.message })); });
    req.pipe(p);
  };
  const atraso = MAX > 0 ? MIN + Math.random() * (MAX - MIN) : 0;
  if (atraso > 0) { req.pause(); setTimeout(() => { encaminhar(); req.resume(); }, atraso); } else encaminhar();
}).listen(+listen, '127.0.0.1');
