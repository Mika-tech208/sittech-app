select 'maq' k, id::text id, nome from maquinas union all select 'prod', id::text, nome from produtos union all select 'op', id::text, nome from operacoes union all select 'func', id::text, nome from funcionarios
union all select 'etapa', e.id::text, coalesce(o.nome,'?') from roteiro_etapas e left join operacoes o on o.id=e.operacao_id;
