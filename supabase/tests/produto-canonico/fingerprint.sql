\pset tuples_only on
\pset format unaligned
select 'T apontamentos_producao|'||count(*)||'|'||coalesce(md5(string_agg(t::text, '~' order by t.id::text)),'-') from apontamentos_producao t;
select 'T escala_producao_alocacoes|'||count(*)||'|'||coalesce(md5(string_agg(t::text, '~' order by t::text)),'-') from escala_producao_alocacoes t;
select 'T escala_producao_dias|'||count(*)||'|'||coalesce(md5(string_agg(t::text, '~' order by t.data::text)),'-') from escala_producao_dias t;
select 'T previsoes|'||count(*)||'|'||coalesce(md5(string_agg(t::text, '~' order by t.id::text)),'-') from previsoes t;
select 'T previsao_itens|'||count(*)||'|'||coalesce(md5(string_agg(t::text, '~' order by t.id::text)),'-') from previsao_itens t;
select 'T previsao_item_maquinas|'||count(*)||'|'||coalesce(md5(string_agg(t::text, '~' order by t::text)),'-') from previsao_item_maquinas t;
select 'T produtos|'||count(*)||'|'||coalesce(md5(string_agg(t::text, '~' order by t.id::text)),'-') from produtos t;
select 'T roteiro_etapas|'||count(*)||'|'||coalesce(md5(string_agg(t::text, '~' order by t.id::text)),'-') from roteiro_etapas t;
select 'T roteiro_etapa_maquinas|'||count(*)||'|'||coalesce(md5(string_agg(t::text, '~' order by t::text)),'-') from roteiro_etapa_maquinas t;
select 'T escala_parametros (sem produto_unico_cutover)|'||count(*)||'|'||coalesce(md5(string_agg(t.chave||t.valor::text, '~' order by t.chave)),'-') from escala_parametros t where chave <> 'produto_unico_cutover';
select 'T escala_plano_versoes|'||count(*)||'|'||coalesce(md5(string_agg(t.hash_plano, '~' order by t.id::text)),'-') from escala_plano_versoes t;
select 'T escala_producao_eventos|'||count(*) from escala_producao_eventos;
select 'T wip_controle|'||count(*) from wip_controle;
-- hash de plano da semana 02/11 (conteúdo das alocações em ordem canônica)
select 'HASH plano 02/11 (alocacoes)|'||md5(string_agg(concat_ws('|', data, periodo_id, funcionario_id, maquina_id, produto_id, etapa_id, operacao_id, pecas, coalesce(distribuicao::text,'')), '~' order by data, periodo_id, funcionario_id)) from escala_producao_alocacoes where data >= '2026-11-02';
-- totais de negócio
select 'SOMA pecas 02/11|'||sum(pecas) from escala_producao_alocacoes where data >= '2026-11-02';
select 'SOMA pecas por produto|'||string_agg(produto_id::text||'='||s, ',' order by produto_id::text) from (select produto_id, sum(pecas) s from escala_producao_alocacoes where data >= '2026-11-02' and maquina_id is not null group by 1) z;
select 'PESSOAS-PERIODOS com posto|'||count(*) from escala_producao_alocacoes where data >= '2026-11-02' and maquina_id is not null;
select 'MAQUINAS-PERIODOS|'||count(distinct (data, periodo_id, maquina_id)) from escala_producao_alocacoes where data >= '2026-11-02' and maquina_id is not null;
-- funções/triggers/colunas EXISTENTES (exclui os objetos novos desta frente)
select 'FUNCOES existentes|'||count(*)||'|'||md5(string_agg(p.proname||':'||md5(pg_get_functiondef(p.oid)), '~' order by p.proname, p.oid::text))
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prokind = 'f' and p.proname !~ '^(produto_canonico|produto_unico|etapa_canonica_de|rota_da_maquina)' ;
select 'TRIGGERS existentes|'||count(*)||'|'||md5(string_agg(c.relname||'.'||t.tgname||'.'||t.tgenabled::text, '~' order by c.relname, t.tgname))
  from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
 where not t.tgisinternal and n.nspname = 'public' and t.tgname !~ 'produto_canonico';
select 'COLUNAS tabelas existentes|'||count(*)||'|'||md5(string_agg(table_name||'.'||column_name||':'||udt_name, '~' order by table_name, column_name))
  from information_schema.columns where table_schema = 'public' and table_name !~ '^(produto_canonico|produto_rotas|produto_legado|etapa_legado|vw_)';
select 'CONSTRAINTS existentes|'||count(*)||'|'||md5(string_agg(conrelid::regclass::text||'.'||conname||':'||pg_get_constraintdef(oid), '~' order by conrelid::regclass::text, conname))
  from pg_constraint where connamespace = 'public'::regnamespace and conrelid::regclass::text !~ '(produto_canonico|produto_rotas|produto_legado|etapa_legado)' and conname !~ 'produto_unico_cutover';
select 'OBJETOS novos|'||coalesce(string_agg(relname, ',' order by relname),'-') from pg_class where relnamespace = 'public'::regnamespace and relkind in ('r','v') and relname ~ '^(produto_canonico|produto_rotas|produto_legado|etapa_legado|vw_)';
