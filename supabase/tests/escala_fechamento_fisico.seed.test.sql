-- Valida o SEED do catálogo (docs/fechamento-fisico/seed-catalogo-buffers.sql): roda 2× (idempotente) e confere o mapeamento Conv=contábil / Auto=zero.
\set ON_ERROR_STOP on
create table if not exists roteiro_etapa_maquinas(etapa_id uuid, maquina_id uuid);
insert into produtos(id) values ('27c229d7-f192-41eb-aad1-0c69ece53eba'), ('a027ac97-ffd1-4834-8ed0-d3a94aac4aee'), ('238ca607-2111-4aff-9a19-a9ae6f20da7e'), ('fbbcfe63-ad4d-4e3d-9376-892f6902a5cc');
insert into roteiro_etapas(id) values ('ca90456c-9077-40f4-a058-bd0f467e87ec'), ('78aaa207-b8cc-412a-8a8b-d17bd95a1930'), ('34371af3-2608-42cc-9ded-1f7815a635a8'), ('b3db9629-c3f8-46d8-b4dd-64c9a61a5bc4'),
  ('1b72bf46-5d13-43c5-89b4-6169436085b7'), ('1863b452-77f3-4d5c-9c49-a6d28ae77131'), ('fb96d08d-bd64-43d3-8694-40230c695c39'), ('c765eb93-4597-405f-803a-91c7fab9ad8e'), ('f75cc037-a579-4e82-b457-3287dbb6f694'), ('c85fea8c-702d-4484-b9c8-2ad46670abd2'), ('035e7833-6947-47f9-a23a-fa258bf9a84f');
insert into maquinas(id) values ('00000000-0000-0000-0000-00000000aa01');
insert into roteiro_etapa_maquinas values ('78aaa207-b8cc-412a-8a8b-d17bd95a1930', '00000000-0000-0000-0000-00000000aa01'), ('34371af3-2608-42cc-9ded-1f7815a635a8', '00000000-0000-0000-0000-00000000aa01');
\i docs/fechamento-fisico/seed-catalogo-buffers.sql
\i docs/fechamento-fisico/seed-catalogo-buffers.sql
do $$ begin
  assert (select count(*) from escala_buffers_fisicos) = 5, '5 buffers';
  assert (select count(*) from escala_buffer_pares) = 7, '7 pares (idempotente)';
  assert (select count(*) from escala_buffer_pares where papel = 'zero') = 2 and (select count(*) from escala_buffer_pares where papel = 'contabil') = 5, 'Conv contábil / Auto zero';
  assert (select count(distinct buffer_id) from escala_buffer_pares bp join escala_buffers_fisicos b on b.id = bp.buffer_id where b.chave in ('conector34:parafusadas','conector34:etiquetadas') and papel='zero') = 2, 'M8 e Auto Etiquetar/Embalar são zero';
  assert (select count(*) from escala_buffer_maquinas) > 0, 'máquinas derivadas do roteiro';
end $$;
select 'SEED-OK' as resultado;
