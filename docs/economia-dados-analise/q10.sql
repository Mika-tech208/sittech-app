select 'tabela' k, table_name a, '' b from information_schema.tables where table_schema='public' and table_type='BASE TABLE'
union all select 'categoria', nome, '' from categorias
union all select 'colunas_custo', table_name||'.'||column_name, data_type from information_schema.columns where table_schema='public' and (column_name ilike '%custo%' or column_name ilike '%preco%' or column_name ilike '%valor%' or column_name ilike '%material%' or column_name ilike '%insumo%')
order by 1,2;
