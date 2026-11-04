/* eslint-disable @typescript-eslint/no-require-imports */
// Gera (uma vez) segredo JWT + postgrest.conf + env.clone. Idempotente: se postgrest.conf existir, não mexe (JWTs seguem válidos).
// Segredos só em arquivos chmod 600 fora do repo; nada é impresso.
const fs = require('fs'), crypto = require('crypto');
const [, , root, pgPort, pgrstPort, publicPort] = process.argv;
const conf = `${root}/postgrest.conf`, envf = `${root}/env.clone`;
if (fs.existsSync(conf) && fs.existsSync(envf)) process.exit(0);
const secret = crypto.randomBytes(48).toString('base64url');
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (role) => { const h = b64({ alg: 'HS256', typ: 'JWT' }), p = b64({ role, iss: 'sittech-clone-local', iat: Math.floor(Date.now() / 1000), exp: 4102444800 });
  return `${h}.${p}.${crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url')}`; };
fs.writeFileSync(conf, `db-uri = "postgres://authenticator@127.0.0.1:${pgPort}/sittech_clone"
db-schemas = "public"
db-anon-role = "anon"
db-pool = 10
jwt-secret = "${secret}"
server-host = "127.0.0.1"
server-port = ${pgrstPort}
`, { mode: 0o600 });
fs.writeFileSync(envf, `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:${publicPort}
NEXT_PUBLIC_SUPABASE_ANON_KEY=${jwt('anon')}
SUPABASE_SERVICE_ROLE_KEY=${jwt('service_role')}
`, { mode: 0o600 });
fs.chmodSync(conf, 0o600); fs.chmodSync(envf, 0o600);
