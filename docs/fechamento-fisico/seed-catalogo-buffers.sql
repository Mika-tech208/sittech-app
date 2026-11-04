-- SEED do catálogo de buffers físicos (PROD) — cobre TODOS os produtos ativos com ≥ 2 etapas na semana de 02/11 (Conector 3/4 Conv+Auto, Conector 1.1/4", Caixa Amarela) — rodar DEPOIS da migration 20261110100000 e SÓ com autorização. Idempotente. Não altera nada além do catálogo.
-- Conector 3/4 (enquanto Convencional e Automático existirem separados): 3 buffers FÍSICOS; Conv = 'contabil' (recebe o total), Automático = 'zero' (recebe 0).
-- Caixa Amarela: Etiquetar (E16) → Montagem. Conferir com a query de cobertura (ao final): TODO par de produto ativo com ≥ 2 etapas precisa de buffer.
begin;
insert into public.escala_buffers_fisicos (chave, rotulo, descricao, ordem) values
  ('conector34:rosqueadas',  'Rosqueadas aguardando Parafusar',   'Estoque entre Rosquear e Parafusar (Conector 3/4)', 10),
  ('conector34:parafusadas', 'Parafusadas aguardando Etiquetar',  'UM estoque físico: Parafusadeiras + saída da M8 (Convencional + Automático)', 20),
  ('conector34:etiquetadas', 'Etiquetadas aguardando Embalar',    'UM estoque físico antes da Embalagem (Convencional + Automático)', 30),
  ('caixa:e16-montagem',     'Caixas etiquetadas aguardando Montagem', 'Caixa Amarela: Etiquetar (E16) → Montar Presilha', 40),
  ('conector114:rosqueadas', 'Rosqueadas 1.1/4" aguardando Embalar', 'Conector 1.1/4": Rosquear → Embalar (Embalagem 17B)', 50)
on conflict (chave) do nothing;

insert into public.escala_buffer_pares (buffer_id, produto_id, etapa_origem_id, etapa_seguinte_id, papel, vigente_de)
select b.id, v.produto_id::uuid, v.origem::uuid, v.seguinte::uuid, v.papel, date '2026-11-01'
from (values
  ('conector34:rosqueadas',  '27c229d7-f192-41eb-aad1-0c69ece53eba', 'ca90456c-9077-40f4-a058-bd0f467e87ec', '78aaa207-b8cc-412a-8a8b-d17bd95a1930', 'contabil'),
  ('conector34:parafusadas', '27c229d7-f192-41eb-aad1-0c69ece53eba', '78aaa207-b8cc-412a-8a8b-d17bd95a1930', '34371af3-2608-42cc-9ded-1f7815a635a8', 'contabil'),
  ('conector34:parafusadas', 'a027ac97-ffd1-4834-8ed0-d3a94aac4aee', '1b72bf46-5d13-43c5-89b4-6169436085b7', '1863b452-77f3-4d5c-9c49-a6d28ae77131', 'zero'),
  ('conector34:etiquetadas', '27c229d7-f192-41eb-aad1-0c69ece53eba', '34371af3-2608-42cc-9ded-1f7815a635a8', 'b3db9629-c3f8-46d8-b4dd-64c9a61a5bc4', 'contabil'),
  ('conector34:etiquetadas', 'a027ac97-ffd1-4834-8ed0-d3a94aac4aee', '1863b452-77f3-4d5c-9c49-a6d28ae77131', 'fb96d08d-bd64-43d3-8694-40230c695c39', 'zero'),
  ('caixa:e16-montagem',     '238ca607-2111-4aff-9a19-a9ae6f20da7e', 'c765eb93-4597-405f-803a-91c7fab9ad8e', 'f75cc037-a579-4e82-b457-3287dbb6f694', 'contabil'),
  ('conector114:rosqueadas', 'fbbcfe63-ad4d-4e3d-9376-892f6902a5cc', 'c85fea8c-702d-4484-b9c8-2ad46670abd2', '035e7833-6947-47f9-a23a-fa258bf9a84f', 'contabil')
) as v(chave, produto_id, origem, seguinte, papel)
join public.escala_buffers_fisicos b on b.chave = v.chave
on conflict (buffer_id, produto_id, etapa_origem_id, etapa_seguinte_id, vigente_de) do nothing;

-- máquinas que produzem/consomem cada buffer (erro por máquina): derivado do roteiro (etapa origem = produz; etapa seguinte = consome)
insert into public.escala_buffer_maquinas (buffer_id, maquina_id, papel)
select distinct bp.buffer_id, m.maquina_id, 'produz' from public.escala_buffer_pares bp join public.roteiro_etapa_maquinas m on m.etapa_id = bp.etapa_origem_id
on conflict do nothing;
insert into public.escala_buffer_maquinas (buffer_id, maquina_id, papel)
select distinct bp.buffer_id, m.maquina_id, 'consome' from public.escala_buffer_pares bp join public.roteiro_etapa_maquinas m on m.etapa_id = bp.etapa_seguinte_id
on conflict do nothing;
commit;

-- CONFERÊNCIA (somente leitura): pares consecutivos de roteiro de produtos com previsão na semana SEM buffer no catálogo (deve voltar 0 linhas antes do GO)
-- select p.produto_id, e1.id as etapa_origem, e2.id as etapa_seguinte
-- from public.roteiro_etapas e1 join public.roteiro_etapas e2 on e2.produto_id = e1.produto_id and e2.ordem = e1.ordem + 1
-- join public.previsao_itens p on p.produto_id = e1.produto_id and p.tipo = 'previsto'
-- where not exists (select 1 from public.escala_buffer_pares bp where bp.produto_id = e1.produto_id and bp.etapa_origem_id = e1.id and bp.etapa_seguinte_id = e2.id);
