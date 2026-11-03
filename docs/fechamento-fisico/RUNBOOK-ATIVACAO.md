# RUNBOOK — ativação do Fechamento Físico em PROD (04/11/2026, ANTES do início da produção; M1 começa 07:12, fecha 08:48)
Regra: se QUALQUER etapa falhar, PARAR antes da próxima e avisar. Toda escrita em PROD usa `cd …/.worktrees/publish-escala && npx supabase db query --linked --yes -f <arquivo desta pasta>` (a saída mostra "Target: … production"). Leituras: `--read-only`.
Pasta: ~/Documents/sittech-rollbacks/2026-11-03-ativacao-fechamento  (BK)

0. PRÉ-REQUISITOS (hoje à noite): (a) regra de permissão liberada (ver mensagem); (b) variáveis Vercel: Production tem NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY (confirmado por `vercel env ls`; só o Preview da branch não tem — não bloqueia); o build de Production tem guard (scripts/check-env-guard.mjs) que aborta se as chaves não forem do ref PROD; (c) pessoa do tablet = Elizabeth Torres Guerra (provado nos dados; w3 já aponta para ela).
1. CONFERIR PROD (leitura): flag ausente; semana 2026-11-02 em `producao_real_planejador_semanas`; `producao_real_modo`=ativo; fila de eventos sem pendente/processando/erro; sem fechamento em andamento; plano vigente anotado (id/hash).
2. BACKUP FINAL imediatamente antes: pg_dump novo para BK/dumps (mesmo comando do dump de hoje) + estado/ (plano, parâmetros, permissões, eventos). Comparar com o de hoje: mesmas contagens exceto o que mudou no dia.
3. w1_migration_txn.sql  (migration em UMA transação; inerte: flag ausente = desligado).
4. VALIDAR: v1_validar_migration.sql com --read-only → 19 linhas "OK", 0 "FALHA"; contagens das tabelas pré-existentes iguais ao passo 2; fila sem evento novo; plano vigente inalterado.
5. w2_seed_txn.sql (catálogo: 5 buffers / 7 pares).
6. AUDITAR catálogo de novo: v2_cobertura_catalogo.sql --read-only → 0 linhas (e `select count(*) from escala_buffer_pares` = 7).
7. w3_permissoes.sql (escala_fechamento → Elizabeth). Exceção: nenhuma linha (admins já têm pelo papel).
8. MERGE do PR #1 (gh pr merge 1 --merge), SÓ depois de 1–7 OK e do Vercel Production ter as 3 variáveis (confirmado). Não usar auto-merge.
9. AGUARDAR deploy Production (`npx vercel ls`: Production · Ready; conferir que o commit é o do merge; o build roda o guard de ambiente).
10. SMOKE com flag OFF: GET https://sittech-app.vercel.app/api/escala/fechamento/estado sem login → 401/403 (rota existe, protegida); com login admin, POST /abrir → 503 "desligado"; tela /producao-real sem botão FECHAR PERÍODO; Escala/TV carregam normalmente; versão do plano inalterada.
11. CONFIRMAR rotas/tela (itens do 10 + 0 erros novos nos logs do Vercel).
12. w4_flag_ativo.sql  (`escala_fechamento_fisico_modo` = "ativo"; o gatilho de parâmetros NÃO enfileira recálculo — verificar fila vazia).
13. CONFIRMAR flag: select valor from escala_parametros where chave='escala_fechamento_fisico_modo' → "ativo"; fila sem evento novo.
14. SMOKE final: logado como Elizabeth, botão FECHAR PERÍODO aparece (só perto do fim do período / depois); selo AGUARDANDO FECHAMENTO/ESCALA CONFIRMADA nas telas; POST /abrir fora da janela responde 4xx claro (não 5xx).

PRIMEIRO FECHAMENTO REAL (M1→M2, ~08:48): acompanhar em tempo real (leituras): escala_fechamento_estado, escala_fechamento_log (RECALCULANDO→CONFIRMADO|ERRO_RECALCULO, tempos_ms por etapa), escala_fechamento_buffers (físico × estimado), escala_fechamento_duracao, novo hash em escala_plano_versoes, postos/pessoas do plano M2, fila escala_producao_eventos. Se passar: deixar ativo (M2→M3, M3→T1, T1→T2, T2→T3, T3→dia seguinte). Tempo: ≤5 s meta; 5–10 s aceitar e medir; >10 s investigar antes de automatizar.
ROLLBACK: w9_rollback_flag.sql (desliga, não apaga nada) → se necessário 20261110100000_…_ROLLBACK.sql (arquiva em *_arquivo, não apaga inventário coletado) → plano: restaurar linhas da versão anterior (estado/plano_versoes.json). Não reverter o código (inerte com a flag desligada).
