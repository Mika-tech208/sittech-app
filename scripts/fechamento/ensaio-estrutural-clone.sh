#!/bin/bash
# ENSAIO ESTRUTURAL contra um clone PROD-equivalente RECÉM-RESTAURADO do dump (nada toca PROD):
#   baseline → migration (2×) → seed (2×) → verificação estrutural → rollback → comparação com o baseline (funções byte-idênticas, constraints equivalentes, contagens iguais) → migration de novo
# Uso: scripts/fechamento/ensaio-estrutural-clone.sh [arquivo-de-dump]   (padrão: o dump mais recente em ~/Documents/sittech-clone/dumps)
set -euo pipefail
RAIZ="$(cd "$(dirname "$0")/../.." && pwd)"; CLONE=/Users/mikaellonghi/Documents/sittech-clone
DUMP="${1:-$(ls -1t $CLONE/dumps/prod-*.sql | head -1)}"
P() { /opt/homebrew/opt/libpq/bin/psql -h 127.0.0.1 -p 55433 -U postgres -d sittech_clone -v ON_ERROR_STOP=1 -q -At "$@"; }
OUT="${OUT:-$RAIZ/docs/fechamento-fisico/ensaio-estrutural-clone.txt}"; : > "$OUT"; log() { echo "$@" | tee -a "$OUT"; }
impressao() { # impressão digital do que a migration pode tocar
  P -c "select 'fn '||p.proname||' '||md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('escala_aplicar_recalculo','escala_reivindicar_eventos') order by 1"
  P -c "select 'permissoes '||md5(array_to_string(array(select x from (select unnest(string_to_array(trim(both '{}' from (regexp_match(pg_get_constraintdef(oid), '''(\\{[^'']+\\})'''))[1]), ',')) x union select m[1] from regexp_matches(pg_get_constraintdef(oid), '''([^'']+)''::text', 'g') m) t where x !~ '^\\{' order by x), ','))  from pg_constraint where conname='usuario_permissoes_permissao_check'"
  P -c "select 'eventos_tipos '||md5(array_to_string(array(select x from (select unnest(string_to_array(trim(both '{}' from (regexp_match(pg_get_constraintdef(oid), '''(\\{[^'']+\\})'''))[1]), ',')) x union select m[1] from regexp_matches(pg_get_constraintdef(oid), '''([^'']+)''::text', 'g') m) t where x !~ '^\\{' order by x), ','))  from pg_constraint where conname='escala_producao_eventos_tipo_check'"
  for t in apontamentos_producao apontamento_paradas escala_producao_alocacoes escala_producao_dias escala_plano_versoes escala_fluxo_diagnosticos escala_producao_eventos escala_parametros usuario_permissoes previsoes previsao_itens produtos roteiro_etapas maquinas funcionarios; do P -c "select 'linhas $t '||count(*) from public.$t"; done
  P -c "select 'tabelas_public '||count(*) from information_schema.tables where table_schema='public' and table_name !~ '_arquivo\$'"
  P -c "select 'funcoes_public '||count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'"
}
log "# Ensaio estrutural · dump $(basename "$DUMP") · $(date -u +%FT%TZ)"
"$RAIZ/scripts/fechamento/clone/restaurar-clone.sh" --dump "$DUMP" >/dev/null 2>&1; "$RAIZ/scripts/fechamento/clone/start-clone.sh" >/dev/null 2>&1 || true
impressao > /tmp/ff-base.txt; log "baseline: $(wc -l < /tmp/ff-base.txt) impressões (clone restaurado do dump, antes da migration)"
for i in 1 2; do P -f "$RAIZ/supabase/migrations/20261110100000_escala_fechamento_fisico.sql" >/dev/null 2>"$CLONE/err.txt" || { grep -v NOTICE "$CLONE/err.txt"; log "FALHA: migration, aplicação $i"; exit 1; }; log "migration: aplicação $i OK"; done
for i in 1 2; do P -f "$RAIZ/docs/fechamento-fisico/seed-catalogo-buffers.sql" >/dev/null 2>"$CLONE/err.txt" || { grep -v NOTICE "$CLONE/err.txt"; log "FALHA: seed, aplicação $i"; exit 1; }; log "seed: aplicação $i OK"; done
P -c "notify pgrst, 'reload schema'" >/dev/null
log "--- verificação estrutural (após migration + seed)"; /opt/homebrew/opt/libpq/bin/psql -h 127.0.0.1 -p 55433 -U postgres -d sittech_clone -q -f "$RAIZ/scripts/fechamento/verificar-estrutura.sql" 2>&1 | tee -a "$OUT"
impressao > /tmp/ff-pos.txt
log "--- compatibilidade histórica: linhas das tabelas pré-existentes (baseline × depois da migration)"
diff <(grep "^linhas" /tmp/ff-base.txt | grep -v escala_parametros) <(grep "^linhas" /tmp/ff-pos.txt | grep -v escala_parametros) >/dev/null && [ "$(grep "linhas escala_parametros" /tmp/ff-pos.txt | cut -d" " -f3)" = "$(( $(grep "linhas escala_parametros" /tmp/ff-base.txt | cut -d" " -f3) + 1 ))" ] && log "OK    contagens das tabelas pré-existentes IDÊNTICAS (nenhum dado histórico alterado, NENHUM evento/recálculo enfileirado); só escala_parametros +1 (a flag, desligada)" || { log "FALHA contagens mudaram"; diff <(grep "^linhas" /tmp/ff-base.txt) <(grep "^linhas" /tmp/ff-pos.txt) | tee -a "$OUT"; }
log "--- ROLLBACK"
P -f "$RAIZ/supabase/rollbacks/20261110100000_escala_fechamento_fisico_ROLLBACK.sql" >/dev/null 2>"$CLONE/err.txt" || { grep -v NOTICE "$CLONE/err.txt"; log "FALHA: rollback"; exit 1; }
impressao > /tmp/ff-rb.txt
diff /tmp/ff-base.txt /tmp/ff-rb.txt >/dev/null && log "OK    após o rollback TUDO volta idêntico ao baseline: funções byte-idênticas (guarda do histórico, claim da outbox e gatilho de parâmetros), permissões e tipos de evento equivalentes, contagens (nenhum evento criado) e nº de tabelas/funções iguais (as cópias *_arquivo ficam por desenho)" || { log "FALHA: diferenças após rollback"; diff /tmp/ff-base.txt /tmp/ff-rb.txt | tee -a "$OUT"; }
P -c "select 'objetos do fechamento restantes: '||count(*) from information_schema.tables where table_schema='public' and table_name ~ '^(escala_fechamento|escala_buffer)' and table_name !~ 'arquivo\$'" | tee -a "$OUT"
log "--- migration de novo (estado final)"
P -f "$RAIZ/supabase/migrations/20261110100000_escala_fechamento_fisico.sql" >/dev/null 2>/dev/null && P -f "$RAIZ/docs/fechamento-fisico/seed-catalogo-buffers.sql" >/dev/null 2>/dev/null && P -c "notify pgrst, 'reload schema'" >/dev/null && log "OK    migration + seed reaplicados depois do rollback"
