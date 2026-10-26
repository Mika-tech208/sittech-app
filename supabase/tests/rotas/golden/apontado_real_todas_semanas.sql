begin;
select set_config('request.jwt.claims', json_build_object('sub', (select auth_user_id from usuarios where papel='admin' and ativo order by id limit 1), 'role', 'authenticated')::text, true);
set local role authenticated;
select 'apontado_real_todas_semanas' k, md5(coalesce(string_agg(to_jsonb(r)::text, '|' order by w.w, r.produto_id, r.etapa_id),'')) v, count(*) linhas
from (select generate_series(date_trunc('week', (select min(data) from public.apontamentos_producao))::date, (select max(data) from public.apontamentos_producao), interval '7 days')::date w) w,
     lateral public.obter_apontado_real_previsao_por_semana(w.w) r;
rollback;
