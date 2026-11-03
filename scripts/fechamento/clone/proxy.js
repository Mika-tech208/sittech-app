/* eslint-disable @typescript-eslint/no-require-imports */
// Proxy mínimo: supabase-js chama <url>/rest/v1/...; PostgREST serve na raiz. Remove o prefixo /rest/v1.
// Escuta só em 127.0.0.1. Sem dependências.
const http = require('http');
const [, , listen, target] = process.argv; // ex.: 3300 3301
http.createServer((req, res) => {
  if (!req.url.startsWith('/rest/v1')) { res.writeHead(404, { 'content-type': 'application/json' }); return res.end('{"message":"clone local: apenas /rest/v1"}'); }
  const path = req.url.slice('/rest/v1'.length) || '/';
  const p = http.request({ host: '127.0.0.1', port: +target, path, method: req.method, headers: req.headers }, (r) => {
    res.writeHead(r.statusCode, r.headers); r.pipe(res);
  });
  p.on('error', (e) => { res.writeHead(502); res.end(JSON.stringify({ message: 'postgrest indisponivel: ' + e.message })); });
  req.pipe(p);
}).listen(+listen, '127.0.0.1');
