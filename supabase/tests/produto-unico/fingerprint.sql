select 'T apontamentos_producao|'||count(*)||'|'||coalesce(md5(string_agg(t::text, '~' order by t.id::text)),'-') from apontamentos_producao t;
select 'T escala_producao_alocacoes|'||count(*)||'|'||coalesce(md5(string_agg(t::text, '~' order by t::text)),'-') from escala_producao_alocacoes t;
select 'T escala_producao_dias|'||count(*)||'|'||coalesce(md5(string_agg(t::text, '~' order by t.data::text)),'-') from escala_producao_dias t;
select 'T previsoes|'||count(*)||'|'||coalesce(md5(string_agg(t::text, '~' order by t.id::text)),'-') from previsoes t;
select 'T previsao_itens|'||count(*)||'|'||coalesce(md5(string_agg(t::text, '~' order by t.id::text)),'-') from previsao_itens t;
select 'T previsao_item_maquinas|'||count(*)||'|'||coalesce(md5(string_agg(t::text, '~' order by t::text)),'-') from previsao_item_maquinas t;
select 'T produtos|'||count(*)||'|'||coalesce(md5(string_agg(t::text, '~' order by t.id::text)),'-') from produtos t where nome not like '%(Produto Único)%';
select 'T roteiro_etapas|'||count(*)||'|'||coalesce(md5(string_agg(t::text, '~' order by t.id::text)),'-') from roteiro_etapas t where produto_id not in (select id from produtos where nome like '%(Produto Único)%');
select 'T roteiro_etapa_maquinas|'||count(*)||'|'||coalesce(md5(string_agg(t::text, '~' order by t::text)),'-') from roteiro_etapa_maquinas t where etapa_id not in (select e.id from roteiro_etapas e join produtos p on p.id=e.produto_id where p.nome like '%(Produto Único)%');
select 'T escala_parametros (sem produto_unico_cutover)|'||count(*)||'|'||coalesce(md5(string_agg(t.chave||t.valor::text, '~' order by t.chave)),'-') from escala_parametros t where chave not in ('produto_unico_cutover','produto_unico_planejamento_desde');
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
 where n.nspname = 'public' and p.prokind = 'f' and p.proname !~ '^(produto_canonico|produto_unico|etapa_canonica_de|rota_da_maquina|escala_periodo_liberacao$)' ;
select 'TRIGGERS existentes|'||count(*)||'|'||md5(string_agg(c.relname||'.'||t.tgname||'.'||t.tgenabled::text, '~' order by c.relname, t.tgname))
  from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
 where not t.tgisinternal and n.nspname = 'public' and t.tgname !~ '(produto_canonico|produto_unico)';
select 'COLUNAS tabelas existentes|'||count(*)||'|'||md5(string_agg(table_name||'.'||column_name||':'||udt_name, '~' order by table_name, column_name))
  from information_schema.columns where table_schema = 'public' and table_name !~ '^(produto_canonico|produto_rotas|produto_legado|etapa_legado|produto_unico|vw_)';
select 'CONSTRAINTS existentes|'||count(*)||'|'||md5(string_agg(conrelid::regclass::text||'.'||conname||':'||pg_get_constraintdef(oid), '~' order by conrelid::regclass::text, conname))
  from pg_constraint where connamespace = 'public'::regnamespace and conrelid::regclass::text !~ '(produto_canonico|produto_rotas|produto_legado|etapa_legado|produto_unico)' and conname !~ 'produto_unico_(cutover|planejamento)';


select 'VIEW escala_contagens (saida)|'||count(*)||'|'||coalesce(md5(string_agg(v::text,'~' order by v::text)),'-') from escala_contagens_fechamento_para_motor v;
select 'BUFFERS pares|'||count(*)||'|'||md5(string_agg(t::text,'~' order by t.id::text)) from escala_buffer_pares t;
select 'BUFFERS maquinas|'||count(*)||'|'||md5(string_agg(t::text,'~' order by t::text)) from escala_buffer_maquinas t;
select 'FECHAMENTOS|'||count(*)||'|'||md5(string_agg(t.hash_resumo,'~' order by t.id::text)) from escala_fechamentos t;

-- escala_periodo_liberacao foi SUBSTITUÍDA (precedência do planejamento); com planejamento/cutover null a SAÍDA é a mesma de antes: compara a saída em toda a janela de PROD
select 'LIBERACAO saida 28/10-13/11|'||count(*)||'|'||md5(string_agg(public.escala_periodo_liberacao(d::date, p)::text, '~' order by d, p)) from generate_series('2026-10-28'::date,'2026-11-13'::date,'1 day') d, unnest(array['m1','m2','m3','t1','t2','t3']) p;
