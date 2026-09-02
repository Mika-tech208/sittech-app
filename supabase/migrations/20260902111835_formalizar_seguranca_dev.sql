-- Sittech — schema PostgreSQL, migration 8
-- Formaliza, em migration versionada, a postura de segurança que hoje só
-- existe no projeto sittech-dev "por fora" das migrations (configurada
-- manualmente antes de haver controle de versão do schema). Descoberta ao
-- preparar o sittech-prod: aplicar as migrations 1-7 num projeto novo NÃO
-- reproduz a segurança real do DEV, porque duas coisas nunca foram
-- versionadas:
--
--   1. RLS habilitado nas tabelas — no DEV isso é feito por um event
--      trigger (`ensure_rls` / `rls_auto_enable()`) que roda ALTER TABLE
--      ... ENABLE ROW LEVEL SECURITY toda vez que uma tabela é criada.
--      Esse event trigger em si NÃO é recriado aqui (decisão explícita —
--      preferimos RLS explícito em cada migration de tabela nova, não um
--      comportamento oculto). Em vez disso, esta migration habilita RLS
--      explicitamente nas 20 tabelas que já existem.
--
--   2. DEFAULT PRIVILEGES do role `postgres` (o role usado pra rodar
--      migrations) no schema `public` — no DEV, esse default NUNCA deu a
--      `anon`/`authenticated`/`service_role` nenhum privilégio de
--      SELECT/INSERT/UPDATE/DELETE em tabela nova, nem EXECUTE em function
--      nova, nem nada em sequence nova (confirmado via pg_default_acl). Um
--      projeto Supabase novo (sittech-prod) vem com o default oposto —
--      GRANT amplo automático pra esses três papéis em tudo que `postgres`
--      cria — que é exatamente o comportamento documentado como
--      `auto_expose_new_tables` em supabase/config.toml. Sem essa correção,
--      toda tabela/função nova continuaria vazando acesso indevido, mesmo
--      com as migrations de GRANT explícito (4, 6) já aplicadas por cima.
--
-- Causa raiz confirmada por introspecção direta (pg_class.relrowsecurity,
-- information_schema.role_table_grants, pg_default_acl) comparando DEV x
-- PROD linha a linha antes de escrever este arquivo — não é suposição.
--
-- Este arquivo só FORMALIZA o que o DEV já tem — não muda nenhuma regra de
-- negócio nem nenhuma policy (as 23 policies das migrations 3/6 continuam
-- exatamente como estão; RLS habilitado não muda o que uma policy permite,
-- só liga a obrigatoriedade de checá-las). Idempotente: REVOKE/GRANT e
-- ENABLE ROW LEVEL SECURITY não falham se já estiverem no estado desejado
-- — seguro rodar tanto no DEV (já correto, deve ser um no-op efetivo)
-- quanto no PROD (corrige o desvio).
--
-- Privilégios residuais TRUNCATE/REFERENCES/TRIGGER (nunca usados pelo
-- app, que só fala com o banco via PostgREST/RPC) são preservados
-- exatamente como estão no DEV hoje — não inventamos uma postura mais
-- restritiva do que a referência real, só formalizamos ela.

-- =========================================================================
-- 1) RLS explícito nas 20 tabelas existentes
-- =========================================================================
do $$
declare
  v_tabela text;
begin
  foreach v_tabela in array array[
    'categorias', 'operacoes', 'configuracoes_empresa', 'fixed_costs', 'variable_entries',
    'funcionarios', 'funcionario_custos', 'periodos', 'maquinas', 'produtos',
    'roteiro_etapas', 'roteiro_etapa_maquinas', 'faturamentos', 'receitas', 'previsoes',
    'previsao_maquinas_indisponiveis', 'previsao_itens', 'previsao_item_maquinas',
    'usuarios', 'auditoria'
  ]
  loop
    execute format('alter table public.%I enable row level security', v_tabela);
  end loop;
end $$;

-- =========================================================================
-- 2) Table grants — reset e re-grant exato, mesma matriz do DEV
--    (baseline Dxtm = truncate,references,trigger pra anon/authenticated/
--    service_role em toda tabela — resíduo inofensivo já presente no DEV,
--    preservado por fidelidade à referência, não usado pelo app; CRUD real
--    só onde as migrations 4/6 já definiam).
-- =========================================================================
do $$
declare
  v_tabela text;
  v_tabelas_full_crud text[] := array[
    'categorias', 'operacoes', 'configuracoes_empresa', 'fixed_costs', 'variable_entries',
    'funcionarios', 'funcionario_custos', 'periodos', 'maquinas', 'produtos',
    'roteiro_etapas', 'roteiro_etapa_maquinas', 'faturamentos', 'receitas', 'previsoes',
    'previsao_maquinas_indisponiveis', 'previsao_itens', 'previsao_item_maquinas'
  ];
begin
  -- reset total nas 20 tabelas pros três papéis — remove qualquer
  -- privilégio implícito/padrão indevido (ex.: SELECT/INSERT/UPDATE/DELETE
  -- que um projeto novo concede por default e que o DEV nunca teve).
  foreach v_tabela in array (v_tabelas_full_crud || array['usuarios', 'auditoria'])
  loop
    execute format('revoke all on public.%I from anon, authenticated, service_role', v_tabela);
    -- baseline residual idêntico ao DEV (nunca usado pelo PostgREST/RPC,
    -- preservado só por fidelidade à referência real).
    execute format('grant truncate, references, trigger on public.%I to anon, authenticated, service_role', v_tabela);
  end loop;

  -- CRUD completo pra authenticated nas 18 tabelas operacionais/financeiras
  -- (mesma regra da migration 4 — nenhuma tela distingue por papel nelas).
  foreach v_tabela in array v_tabelas_full_crud
  loop
    execute format('grant select, insert, update, delete on public.%I to authenticated', v_tabela);
  end loop;
end $$;

-- usuarios: só authenticated e service_role têm CRUD, sem DELETE (mesma
-- regra da migration 4/6 — não existe exclusão de usuário no app).
grant select, insert, update on public.usuarios to authenticated;
grant select, insert, update on public.usuarios to service_role;

-- auditoria: só authenticated e service_role têm CRUD, sem UPDATE nem
-- DELETE (mesma regra da migration 4/6 — log de auditoria é append-only).
grant select, insert on public.auditoria to authenticated;
grant select, insert on public.auditoria to service_role;

-- =========================================================================
-- 3) Function EXECUTE — reset e re-grant exato, mesma matriz do DEV.
--    is_usuario_ativo/is_admin/atualizar_produto_com_roteiro/
--    upsert_previsao_semana: só authenticated (migrations 3/4/5/7).
--    set_updated_at: NINGUÉM além do owner — no DEV nunca teve EXECUTE
--    concedido a nenhum desses três papéis (trigger function, disparada
--    pela própria instrução DML que já passou pela checagem de GRANT da
--    tabela — não precisa de EXECUTE direto pra rodar como trigger).
-- =========================================================================
revoke all on function public.is_usuario_ativo() from public, anon, authenticated, service_role;
grant execute on function public.is_usuario_ativo() to authenticated;

revoke all on function public.is_admin() from public, anon, authenticated, service_role;
grant execute on function public.is_admin() to authenticated;

revoke all on function public.atualizar_produto_com_roteiro(uuid, text, text, numeric, text, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.atualizar_produto_com_roteiro(uuid, text, text, numeric, text, jsonb) to authenticated;

revoke all on function public.upsert_previsao_semana(date, jsonb, jsonb, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.upsert_previsao_semana(date, jsonb, jsonb, jsonb) to authenticated;

revoke all on function public.set_updated_at() from public, anon, authenticated, service_role;

-- =========================================================================
-- 4) DEFAULT PRIVILEGES do role `postgres` (quem roda as migrations) no
--    schema public — pra toda tabela/function/sequence NOVA criada por
--    migration futura nascer com a mesma postura do DEV, sem depender de
--    ninguém lembrar de repetir GRANT/REVOKE manualmente.
-- =========================================================================
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant truncate, references, trigger on tables to anon, authenticated, service_role;

alter default privileges for role postgres in schema public
  revoke all on functions from anon, authenticated, service_role;

alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated, service_role;
