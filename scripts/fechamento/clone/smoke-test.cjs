// Valida supabase-js contra o clone (service_role). Uso: node smoke-test.cjs
const fs = require('fs');
const env = Object.fromEntries(fs.readFileSync('/Users/mikaellonghi/Documents/sittech-clone/env.clone', 'utf8').split('\n').filter(Boolean).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const { createClient } = require('/Users/mikaellonghi/Documents/sittech-app/node_modules/@supabase/supabase-js');
(async () => {
  const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  const a = await sb.from('previsoes').select('id, semana_inicio').order('semana_inicio', { ascending: false }).limit(3);
  console.log('previsoes:', a.error ? 'ERRO ' + a.error.message : `${a.data.length} linhas, ex.: ${JSON.stringify(a.data[0])}`);
  const r = await sb.rpc('escala_sombra_apontamentos', { p_semana_inicio: '2026-11-02' });
  console.log('rpc escala_sombra_apontamentos:', r.error ? 'ERRO ' + JSON.stringify(r.error) : `ok, tipo=${Array.isArray(r.data) ? 'array[' + r.data.length + ']' : typeof r.data}, amostra=${JSON.stringify(r.data).slice(0, 200)}`);
  const an = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const b = await an.from('previsoes').select('id').limit(1);
  console.log('anon (RLS):', b.error ? 'ERRO ' + b.error.message : `${b.data.length} linhas`);
  process.exit(a.error || r.error ? 1 : 0);
})();
