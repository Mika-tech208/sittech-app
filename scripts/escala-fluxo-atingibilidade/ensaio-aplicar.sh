#!/bin/bash
# ENSAIO LOCAL do aplicar-proposta.ts no banco de ENSAIO (cópia de PROD em 127.0.0.1:55432/prodcopy). NUNCA toca PROD.
# 1) lê as linhas de T1–T3 de hoje da cópia; 2) fabrica uma "proposta" trocando os postos de duas pessoas em T2; 3) gera SQL; 4) aplica (commit) e confere; 5) reverte e confere.
set -e
export PATH=/opt/homebrew/opt/postgresql@16/bin:$PATH
PSQL="psql -h 127.0.0.1 -p 55432 -U postgres -d prodcopy -X -At -v ON_ERROR_STOP=1"
DIA=${1:-$(date +%F)}
OUT=${2:-/tmp/ensaio-aplicar}
TS="/private/tmp/claude-501/-Users-mikaellonghi-Documents/46f8091f-a2ac-4875-a213-e5a3b744b594/scratchpad/ating/ts.sh"
mkdir -p "$OUT"
$PSQL -c "select json_build_object('previsaoId', (select previsao_id from escala_producao_dias where data='$DIA'), 'data','$DIA','periodoInicial','t1','geradoEmMs',0,'decisao','ENSAIO LOCAL',
 'linhasAtuais', (select json_agg(json_build_object('data',data::text,'periodoId',periodo_id,'funcionarioId',funcionario_id,'maquinaId',maquina_id,'produtoId',produto_id,'etapaId',etapa_id,'operacaoId',operacao_id,'pecas',pecas,'pecasAdicional',pecas_adicional,'tipoAdicional',tipo_adicional,'origem',origem,'excecaoRevezamento',excecao_revezamento,'motivoExcecao',motivo_excecao,'motivoSemPosto',motivo_sem_posto) order by periodo_id, funcionario_id) from escala_producao_alocacoes where data='$DIA' and periodo_id in ('t1','t2','t3')))" > "$OUT/atuais.json"
python3 - "$OUT" <<'PY'
import json,sys
o=sys.argv[1]; d=json.load(open(o+'/atuais.json'))
ls=d['linhasAtuais']; n=[dict(l) for l in ls]
t2=[i for i,l in enumerate(n) if l['periodoId']=='t2' and l['maquinaId']]
a,b=t2[0],t2[1]
for k in ('maquinaId','produtoId','etapaId','operacaoId','pecas'): n[a][k],n[b][k]=n[b][k],n[a][k]
for l in n: l['mudou']= False
n[a]['mudou']=n[b]['mudou']=True
d['linhas']=n
json.dump(d,open(o+'/proposta.json','w'))
print('proposta fabricada: troca de postos entre',n[a]['funcionarioId'][:8],'e',n[b]['funcionarioId'][:8],'em T2;',len(n),'linhas')
PY
cd /Users/mikaellonghi/Documents/sittech-app/.worktrees/atingibilidade
$TS scripts/escala-fluxo-atingibilidade/aplicar-proposta.ts --json "$OUT/proposta.json" --alvo local --commit
H0=$($PSQL -c "select md5(coalesce(string_agg(a.data::text || '|' || a.periodo_id || '|' || a.funcionario_id::text || '|' || coalesce(a.maquina_id::text, '') || '|' || coalesce(a.produto_id::text, '') || '|' || coalesce(a.etapa_id::text, ''), ';' order by a.data::text || '|' || a.periodo_id || '|' || a.funcionario_id::text collate \"C\"), '')) from escala_producao_alocacoes a where a.data='$DIA' and a.periodo_id in ('t1','t2','t3')")
V0=$($PSQL -c "select versao from escala_producao_dias where data='$DIA'")
echo "antes: hash=$H0 versao=$V0"
echo "--- APLICAR"; $PSQL -f "$OUT/proposta.aplicar.sql" | tail -3
H1=$($PSQL -c "select md5(coalesce(string_agg(a.data::text || '|' || a.periodo_id || '|' || a.funcionario_id::text || '|' || coalesce(a.maquina_id::text, '') || '|' || coalesce(a.produto_id::text, '') || '|' || coalesce(a.etapa_id::text, ''), ';' order by a.data::text || '|' || a.periodo_id || '|' || a.funcionario_id::text collate \"C\"), '')) from escala_producao_alocacoes a where a.data='$DIA' and a.periodo_id in ('t1','t2','t3')")
echo "depois de aplicar: hash=$H1 versao=$($PSQL -c "select versao from escala_producao_dias where data='$DIA'") origem manual=$($PSQL -c "select count(*) from escala_producao_alocacoes where data='$DIA' and periodo_id in ('t1','t2','t3') and origem='manual'")"
echo "--- APLICAR DE NOVO (deve abortar: PROPOSTA_DESATUALIZADA)"; $PSQL -f "$OUT/proposta.aplicar.sql" 2>&1 | tail -2 || true
echo "--- REVERTER"; $PSQL -f "$OUT/proposta.reverter.sql" | tail -3
H2=$($PSQL -c "select md5(coalesce(string_agg(a.data::text || '|' || a.periodo_id || '|' || a.funcionario_id::text || '|' || coalesce(a.maquina_id::text, '') || '|' || coalesce(a.produto_id::text, '') || '|' || coalesce(a.etapa_id::text, ''), ';' order by a.data::text || '|' || a.periodo_id || '|' || a.funcionario_id::text collate \"C\"), '')) from escala_producao_alocacoes a where a.data='$DIA' and a.periodo_id in ('t1','t2','t3')")
echo "depois de reverter: hash=$H2 (igual ao inicial? $([ "$H0" = "$H2" ] && echo SIM || echo NAO))"
echo "linhas do dia fora de T1–T3 intactas: $($PSQL -c "select count(*) from escala_producao_alocacoes where data='$DIA' and periodo_id in ('m1','m2','m3')")"
