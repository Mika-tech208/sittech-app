-- BASELINE PROD (SOMENTE LEITURA) parte B: RPCs chamadas como administrador (set local role; nenhuma escrita). Semanas/datas FECHADAS (< 2026-10-26) para o hash ser estável.
begin read only;
select set_config('request.jwt.claims', json_build_object('sub', (select auth_user_id from usuarios where papel='admin' and ativo order by id limit 1), 'role', 'authenticated')::text, true);
set local role authenticated;
select 'indicadores_fechado' k, count(*)::text a, md5(coalesce(string_agg((to_jsonb(r) - 'apontamento_id')::text, '|' order by r.apontamento_id),'')) b,
       (count(*) filter (where is_ultima_etapa))::text || ' finais / ' || (count(*) filter (where is_ultima_etapa is null))::text || ' nulos' c
  from public.obter_indicadores_producao('2020-01-01', '2026-10-25') r
union all
select 'apontado_real_fechado', count(*)::text, md5(coalesce(string_agg(to_jsonb(r)::text, '|' order by w.w, r.produto_id, r.etapa_id, r.operacao_id),'')), ''
  from (select generate_series(date_trunc('week', (select min(data) from public.apontamentos_producao))::date, date '2026-10-19', interval '7 days')::date w) w,
       lateral public.obter_apontado_real_previsao_por_semana(w.w) r
union all
select 'indicadores_26_10_vivo', count(*)::text, md5(coalesce(string_agg((to_jsonb(r) - 'apontamento_id')::text, '|' order by r.apontamento_id),'')), '' from public.obter_indicadores_producao('2026-10-26', '2026-11-01') r
union all
select 'apontado_real_26_10_vivo', count(*)::text, md5(coalesce(string_agg(to_jsonb(r)::text, '|' order by r.produto_id, r.etapa_id, r.operacao_id),'')), '' from public.obter_apontado_real_previsao_por_semana('2026-10-26') r;
rollback;
