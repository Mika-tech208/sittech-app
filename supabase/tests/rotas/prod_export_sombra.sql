-- EXPORTAÇÃO SOMENTE LEITURA (usada pelo shadow offline): tudo que o planejador/Escala precisam do cadastro, em UM json. Roda depois da M1 (F existe).
select jsonb_build_object(
  'geradoEm', now(),
  'produtoF', (select jsonb_build_object('id', p.id, 'nome', p.nome, 'valor_unitario', p.valor_unitario, 'ativo', p.ativo) from produtos p where p.nome = 'Conector 3/4" (Final)'),
  'rotas', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'produto_id', r.produto_id, 'codigo', r.codigo, 'nome', r.nome, 'ativa', r.ativa, 'preferencia', r.preferencia)), '[]') from produto_rota r),
  'rotaEtapas', (select coalesce(jsonb_agg(jsonb_build_object('rota_id', x.rota_id, 'etapa_id', x.etapa_id, 'posicao', x.posicao)), '[]') from rota_etapas x),
  'poolComum', (select coalesce(jsonb_agg(jsonb_build_object('produto_id', x.produto_id, 'etapa_id', x.etapa_id, 'posicao', x.posicao, 'final', x.final)), '[]') from produto_pool_comum x),
  'etapas', (select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'produto_id', e.produto_id, 'operacao_id', e.operacao_id, 'ordem', e.ordem, 'meta_m1', e.meta_m1, 'meta_m2', e.meta_m2, 'meta_m3', e.meta_m3, 'meta_t1', e.meta_t1, 'meta_t2', e.meta_t2, 'meta_t3', e.meta_t3)), '[]') from roteiro_etapas e),
  'etapaMaquinas', (select coalesce(jsonb_agg(jsonb_build_object('etapa_id', x.etapa_id, 'maquina_id', x.maquina_id)), '[]') from roteiro_etapa_maquinas x),
  'operacoes', (select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'nome', o.nome)), '[]') from operacoes o),
  'maquinas', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'nome', m.nome)), '[]') from maquinas m),
  'periodos', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'nome', p.nome, 'inicio', p.inicio::text, 'fim', p.fim::text) order by p.id), '[]') from periodos p),
  'funcionarios', (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'nome', f.nome, 'created_at', f.created_at, 'salario_base', f.salario_base, 'ativo', f.ativo, 'desligado_em', f.desligado_em,
      'operacoes', case when o.id is null then null else jsonb_build_object('nome', o.nome) end,
      'funcionario_custos', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'descricao', c.descricao, 'valor', c.valor)), '[]') from funcionario_custos c where c.funcionario_id = f.id))), '[]')
      from funcionarios f left join operacoes o on o.id = f.operacao_id),
  'fixedCosts', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'descricao', c.descricao, 'valor', c.valor, 'ativo', c.ativo, 'categorias', jsonb_build_object('nome', g.nome))), '[]') from fixed_costs c left join categorias g on g.id = c.categoria_id),
  'diasUteis', (select dias_uteis from configuracoes_empresa limit 1),
  'itens2610', (select coalesce(jsonb_agg(jsonb_build_object('produto', pr.nome, 'quantidade', i.quantidade, 'maquinas', (select coalesce(jsonb_agg(m.nome order by m.nome), '[]') from previsao_item_maquinas im join maquinas m on m.id = im.maquina_id where im.item_id = i.id))), '[]')
      from previsao_itens i join previsoes p on p.id = i.previsao_id join produtos pr on pr.id = i.produto_id where p.semana_inicio = '2026-10-26' and i.tipo = 'previsto')
) as j;
