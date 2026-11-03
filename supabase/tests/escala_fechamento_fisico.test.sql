-- Teste de comportamento da migration 20261110100000 (Postgres local descartável + stubs). Cada bloco levanta exceção se falhar.
\set ON_ERROR_STOP on
insert into usuarios(id, nome) values ('00000000-0000-0000-0000-0000000000a1','Supervisora A'), ('00000000-0000-0000-0000-0000000000a2','Supervisora B');
insert into produtos(id) values ('27c229d7-f192-41eb-aad1-0c69ece53eba'), ('a027ac97-ffd1-4834-8ed0-d3a94aac4aee');
insert into roteiro_etapas(id) values ('ca90456c-9077-40f4-a058-bd0f467e87ec'), ('78aaa207-b8cc-412a-8a8b-d17bd95a1930'), ('34371af3-2608-42cc-9ded-1f7815a635a8'), ('b3db9629-c3f8-46d8-b4dd-64c9a61a5bc4'),
  ('1b72bf46-5d13-43c5-89b4-6169436085b7'), ('1863b452-77f3-4d5c-9c49-a6d28ae77131'), ('fb96d08d-bd64-43d3-8694-40230c695c39');
insert into previsoes(id, semana_inicio) values ('6be15af5-9659-4c12-ba33-9c1fae6d4065', '2026-11-02');
insert into escala_buffers_fisicos(id, chave, rotulo, ordem) values
  ('b1000000-0000-0000-0000-000000000001','conector34:rosqueadas','Rosqueadas aguardando Parafusar',1),
  ('b1000000-0000-0000-0000-000000000002','conector34:parafusadas','Parafusadas aguardando Etiquetar',2),
  ('b1000000-0000-0000-0000-000000000003','conector34:etiquetadas','Etiquetadas aguardando Embalar',3);
insert into escala_buffer_pares(buffer_id, produto_id, etapa_origem_id, etapa_seguinte_id, papel, vigente_de) values
  ('b1000000-0000-0000-0000-000000000001','27c229d7-f192-41eb-aad1-0c69ece53eba','ca90456c-9077-40f4-a058-bd0f467e87ec','78aaa207-b8cc-412a-8a8b-d17bd95a1930','contabil','2026-10-01'),
  ('b1000000-0000-0000-0000-000000000002','27c229d7-f192-41eb-aad1-0c69ece53eba','78aaa207-b8cc-412a-8a8b-d17bd95a1930','34371af3-2608-42cc-9ded-1f7815a635a8','contabil','2026-10-01'),
  ('b1000000-0000-0000-0000-000000000002','a027ac97-ffd1-4834-8ed0-d3a94aac4aee','1b72bf46-5d13-43c5-89b4-6169436085b7','1863b452-77f3-4d5c-9c49-a6d28ae77131','zero','2026-10-01'),
  ('b1000000-0000-0000-0000-000000000003','27c229d7-f192-41eb-aad1-0c69ece53eba','34371af3-2608-42cc-9ded-1f7815a635a8','b3db9629-c3f8-46d8-b4dd-64c9a61a5bc4','contabil','2026-10-01'),
  ('b1000000-0000-0000-0000-000000000003','a027ac97-ffd1-4834-8ed0-d3a94aac4aee','1863b452-77f3-4d5c-9c49-a6d28ae77131','fb96d08d-bd64-43d3-8694-40230c695c39','zero','2026-10-01');

\set A '00000000-0000-0000-0000-0000000000a1'
\set B '00000000-0000-0000-0000-0000000000a2'
\set BUF '[{"buffer_id":"b1000000-0000-0000-0000-000000000001","saldo_estimado":4850,"saldo_fisico":4150,"motivo":"contagem anterior errada"},{"buffer_id":"b1000000-0000-0000-0000-000000000002","saldo_estimado":3072,"saldo_fisico":750,"motivo":"contagem anterior errada"},{"buffer_id":"b1000000-0000-0000-0000-000000000003","saldo_estimado":8600,"saldo_fisico":9000}]'

-- T1: modo desligado => nada de evento; o trigger de apontamento é inerte
select escala_fechamento_abrir('2026-11-02','2026-11-03','m2',:'A','tablet-1',30) as ab \gset
select escala_fechamento_registrar(:'ab','2026-11-02','2026-11-03','m2','periodo', now()-interval '1 minute', now(), '2026-11-03 10:24-03', :'A','tablet-1', 11,11,'{"postos":[]}', :'BUF'::jsonb, 3, 'f75d1ea0', false, null, null, '11111111-1111-1111-1111-111111111111') as fid \gset
do $$ begin
  assert (select count(*) from escala_producao_eventos where tipo='fechamento_fisico') = 0, 'desligado não enfileira evento';
  assert (select estado from escala_fechamento_estado) = 'RECALCULANDO', 'nasce RECALCULANDO';
end $$;
insert into apontamentos_producao(data, periodo_id, criado_por) values ('2026-11-03','m2',:'B');   -- desligado: não bloqueia

-- T2: duplo clique / retry (mesma chave) devolve o mesmo id e não duplica
select escala_fechamento_registrar(:'ab','2026-11-02','2026-11-03','m2','periodo', now(), now(), '2026-11-03 10:24-03', :'A','tablet-1', 11,11,'{}', :'BUF'::jsonb, 3, null, false, null, null, '11111111-1111-1111-1111-111111111111') as fid2 \gset
select :'fid' = :'fid2' as duplo_clique_mesmo_id;
do $$ begin assert (select count(*) from escala_fechamentos) = 1; end $$;

-- T3: segundo usuário / segunda tentativa com outra chave no mesmo período é recusado
do $$ begin
  begin perform escala_fechamento_registrar(null,'2026-11-02','2026-11-03','m2','periodo',now(),now(),now(),'00000000-0000-0000-0000-0000000000a2','t2',11,11,'{}',(select current_setting('x.buf', true))::jsonb,3,null,false,null,null,gen_random_uuid());
    raise exception 'deveria recusar'; exception when others then if sqlerrm not like 'FECHAMENTO_BUFFERS_INCOMPLETOS%' and sqlerrm not like 'FECHAMENTO_JA_EXISTE%' and sqlerrm not like 'invalid input%' and sqlerrm not like 'unrecognized%' then raise; end if; end;
end $$;
select set_config('x.buf', :'BUF', false);
do $$ begin
  begin perform escala_fechamento_registrar(null,'2026-11-02','2026-11-03','m2','periodo',now(),now(),now(),'00000000-0000-0000-0000-0000000000a2','t2',11,11,'{}',current_setting('x.buf')::jsonb,3,null,false,null,null,gen_random_uuid());
    raise exception 'dois usuários fecharam o mesmo período'; exception when others then if sqlerrm not like 'FECHAMENTO_JA_EXISTE%' then raise; end if; end;
end $$;

-- T4: validações do banco (campo faltando, negativo, postos incompletos, diferença grande sem motivo, exceção sem motivo)
do $$ begin
  begin perform escala_fechamento_registrar(null,'2026-11-02','2026-11-03','m3','periodo',now(),now(),now(),'00000000-0000-0000-0000-0000000000a1','t',11,11,'{}','[{"buffer_id":"b1000000-0000-0000-0000-000000000001","saldo_fisico":1}]'::jsonb,3,null,false,null,null,gen_random_uuid()); raise exception 'campo faltando aceito'; exception when others then if sqlerrm not like 'FECHAMENTO_BUFFERS_INCOMPLETOS%' then raise; end if; end;
  begin perform escala_fechamento_registrar(null,'2026-11-02','2026-11-03','m3','periodo',now(),now(),now(),'00000000-0000-0000-0000-0000000000a1','t',11,11,'{}','[{"buffer_id":"b1000000-0000-0000-0000-000000000001","saldo_fisico":-5}]'::jsonb,1,null,false,null,null,gen_random_uuid()); raise exception 'negativo aceito'; exception when others then if sqlerrm not like 'FECHAMENTO_SALDO_INVALIDO%' then raise; end if; end;
  begin perform escala_fechamento_registrar(null,'2026-11-02','2026-11-03','m3','periodo',now(),now(),now(),'00000000-0000-0000-0000-0000000000a1','t',11,10,'{}','[]'::jsonb,0,null,false,null,null,gen_random_uuid()); raise exception 'postos incompletos aceitos'; exception when check_violation then null; end;
  begin perform escala_fechamento_registrar(null,'2026-11-02','2026-11-03','m3','periodo',now(),now(),now(),'00000000-0000-0000-0000-0000000000a1','t',11,11,'{}','[{"buffer_id":"b1000000-0000-0000-0000-000000000002","saldo_estimado":3072,"saldo_fisico":750}]'::jsonb,1,null,false,null,null,gen_random_uuid()); raise exception 'diferença grande sem motivo aceita'; exception when check_violation then null; end;
  begin perform escala_fechamento_registrar(null,'2026-11-02','2026-11-03','m3','periodo',now(),now(),now(),'00000000-0000-0000-0000-0000000000a1','t',11,11,'{}','[]'::jsonb,0,null,true,'x',null,gen_random_uuid()); raise exception 'exceção sem motivo aceita'; exception when check_violation then null; end;
end $$;

-- T5: imutabilidade
do $$ begin
  begin update escala_fechamentos set observacao='x'; raise exception 'update'; exception when others then if sqlerrm not like 'FECHAMENTO_IMUTAVEL%' then raise; end if; end;
  begin delete from escala_fechamento_buffers; raise exception 'delete'; exception when others then if sqlerrm not like 'FECHAMENTO_IMUTAVEL%' then raise; end if; end;
  begin truncate escala_fechamento_log cascade; raise exception 'truncate'; exception when others then if sqlerrm not like 'FECHAMENTO_IMUTAVEL%' then raise; end if; end;
  begin update escala_fechamento_aberturas set dispositivo='x'; raise exception 'update abertura'; exception when others then if sqlerrm not like 'FECHAMENTO_IMUTAVEL%' then raise; end if; end;
  begin delete from escala_buffers_fisicos; raise exception 'delete catálogo'; exception when others then if sqlerrm not like 'FECHAMENTO_CATALOGO%' then raise; end if; end;
end $$;

-- T6: contagens para o motor — Conv = total físico, Auto = 0 (soma = físico), no instante do motor (fim do período)
do $$ begin
  assert (select saldo from escala_contagens_fechamento_para_motor where "produtoId"='27c229d7-f192-41eb-aad1-0c69ece53eba' and "etapaOrigemId"='78aaa207-b8cc-412a-8a8b-d17bd95a1930') = 750;
  assert (select saldo from escala_contagens_fechamento_para_motor where "produtoId"='a027ac97-ffd1-4834-8ed0-d3a94aac4aee' and "etapaOrigemId"='1b72bf46-5d13-43c5-89b4-6169436085b7') = 0;
  assert (select count(*) from escala_contagens_fechamento_para_motor) = 5;
  assert (select "contadoEm" from escala_contagens_fechamento_para_motor limit 1) = '2026-11-03 10:24-03'::timestamptz, 'instante do motor = fim do período';
end $$;

-- T7: resultado: RECALCULANDO -> ERRO_RECALCULO -> (retry) CONFIRMADO, tudo no log append-only; estoque salvo continua valendo no erro
select escala_fechamento_resultado(:'fid','ERRO_RECALCULO','{"erro":"motor falhou","tentativa":1}'::jsonb);
do $$ begin
  assert (select estado from escala_fechamento_estado) = 'ERRO_RECALCULO';
  assert (select count(*) from escala_contagens_fechamento_para_motor) = 5, 'inventário preservado no erro';
end $$;
select escala_fechamento_resultado(:'fid','CONFIRMADO','{"tentativa":2,"tempos_ms":{"gravacao":40,"entrada":900,"corte":2500,"validacao":30,"persistencia":400,"total":3870},"hash_plano_anterior":"f75d1ea0","hash_plano_novo":"09663708"}'::jsonb);
do $$ begin
  assert (select estado from escala_fechamento_estado) = 'CONFIRMADO';
  assert (select count(*) from escala_fechamento_log) = 3;
  assert (select total_ms from escala_fechamento_duracao where estado='CONFIRMADO') = 3870;
end $$;

-- T8: trava por semana (dois recálculos concorrentes) com validade
do $$ declare ok1 boolean; ok2 boolean; ok3 boolean; begin
  ok1 := escala_fechamento_trava_adquirir('2026-11-02', gen_random_uuid(), 60);
  ok2 := escala_fechamento_trava_adquirir('2026-11-02', gen_random_uuid(), 60);
  assert ok1 and not ok2, 'segundo recálculo concorrente deve ser recusado';
  update escala_fechamento_trava set ate = now() - interval '1 second';
  ok3 := escala_fechamento_trava_adquirir('2026-11-02', gen_random_uuid(), 60);
  assert ok3, 'trava vencida pode ser retomada';
end $$;

-- T9: modo ATIVO — bloqueio do apontamento durante EM_FECHAMENTO e depois de CONFIRMADO
update escala_parametros set valor='"ativo"' where chave='escala_fechamento_fisico_modo';
do $$ begin
  assert not escala_fechamento_apontamento_permitido('2026-11-03','m2','00000000-0000-0000-0000-0000000000a2'), 'período fechado: outro usuário não lança';
  assert not escala_fechamento_apontamento_permitido('2026-11-03','m2','00000000-0000-0000-0000-0000000000a1'), 'período fechado: nem o responsável sem nova abertura';
  begin insert into apontamentos_producao(data, periodo_id, criado_por) values ('2026-11-03','m2','00000000-0000-0000-0000-0000000000a2'); raise exception 'apontamento em período fechado aceito'; exception when others then if sqlerrm not like 'FECHAMENTO_PERIODO_EM_FECHAMENTO%' then raise; end if; end;
  assert escala_fechamento_apontamento_permitido('2026-11-03','t3','00000000-0000-0000-0000-0000000000a2'), 'período sem janela aberta: apontamento normal';
end $$;
-- janela do M3 aberta pela A: B não lança; A lança
select escala_fechamento_abrir('2026-11-02','2026-11-03','m3',:'A','tablet-1',30) as ab3 \gset
do $$ begin
  assert escala_fechamento_apontamento_permitido('2026-11-03','m3','00000000-0000-0000-0000-0000000000a1');
  assert not escala_fechamento_apontamento_permitido('2026-11-03','m3','00000000-0000-0000-0000-0000000000a2');
  begin perform escala_fechamento_abrir('2026-11-02','2026-11-03','m3','00000000-0000-0000-0000-0000000000a2','tablet-2',30); raise exception 'segunda abertura concorrente aceita'; exception when others then if sqlerrm not like 'FECHAMENTO_EM_ANDAMENTO%' then raise; end if; end;
  assert escala_fechamento_abrir('2026-11-02','2026-11-03','m3','00000000-0000-0000-0000-0000000000a1','tablet-1',30) = (select id from escala_fechamento_aberturas where periodo_id='m3' order by aberto_em desc limit 1), 'reabrir pelo mesmo usuário é idempotente';
end $$;

-- T10: modo SOMBRA enfileira o evento de segurança; fechamento consecutivo M1→M2→M3
update escala_parametros set valor='"sombra"' where chave='escala_fechamento_fisico_modo';
select escala_fechamento_registrar(:'ab3','2026-11-02','2026-11-03','m3','periodo', now(), now(), '2026-11-03 11:55-03', :'A','tablet-1', 12,12,'{}',
  '[{"buffer_id":"b1000000-0000-0000-0000-000000000001","saldo_estimado":1900,"saldo_fisico":1200,"motivo":"contagem anterior errada"},{"buffer_id":"b1000000-0000-0000-0000-000000000002","saldo_estimado":7122,"saldo_fisico":4800,"motivo":"estoque comum Conv+M8"},{"buffer_id":"b1000000-0000-0000-0000-000000000003","saldo_estimado":8600,"saldo_fisico":9000}]'::jsonb,
  3, null, false, null, null, '33333333-3333-3333-3333-333333333333') as fid3 \gset
do $$ begin
  assert (select count(*) from escala_producao_eventos where tipo='fechamento_fisico' and status='pendente') = 1, 'evento enfileirado em sombra';
  assert (select count(*) from escala_fechamentos_vigentes) = 2;
  assert (select saldo from escala_contagens_fechamento_para_motor where "produtoId"='27c229d7-f192-41eb-aad1-0c69ece53eba' and "etapaOrigemId"='78aaa207-b8cc-412a-8a8b-d17bd95a1930') = 4800, 'o fechamento mais recente vence';
end $$;
select escala_fechamento_resultado(:'fid3','CONFIRMADO','{}'::jsonb);
do $$ begin assert (select status from escala_producao_eventos where tipo='fechamento_fisico' and payload->>'fechamento_id' = (select id::text from escala_fechamentos where revisao=1 and periodo_id='m3')) = 'processado', 'CONFIRMADO baixa o evento'; end $$;

-- T11: fechamento de exceção (sem contagem): registra TODOS os buffers como "sem contagem" (saldo nulo), não gera contagem para o motor, exige motivo e recusa saldo informado
do $$ begin
  begin perform escala_fechamento_registrar(null,'2026-11-02','2026-11-03','t1','periodo', now(), now(), now(), '00000000-0000-0000-0000-0000000000a1','t', 11,11,'{}','[{"buffer_id":"b1000000-0000-0000-0000-000000000001","saldo_fisico":5},{"buffer_id":"b1000000-0000-0000-0000-000000000002"},{"buffer_id":"b1000000-0000-0000-0000-000000000003"}]'::jsonb, 3, null, true, 'galpão interditado', null, gen_random_uuid()); raise exception 'exceção com saldo aceita'; exception when others then if sqlerrm not like 'FECHAMENTO_EXCECAO_COM_SALDO%' then raise; end if; end;
  begin perform escala_fechamento_registrar(null,'2026-11-02','2026-11-03','t1','periodo', now(), now(), now(), '00000000-0000-0000-0000-0000000000a1','t', 11,11,'{}','[]'::jsonb, 3, null, true, 'galpão interditado', null, gen_random_uuid()); raise exception 'exceção sem os buffers aceita'; exception when others then if sqlerrm not like 'FECHAMENTO_BUFFERS_INCOMPLETOS%' then raise; end if; end;
end $$;
select escala_fechamento_registrar(null,'2026-11-02','2026-11-03','t1','periodo', now(), now(), '2026-11-03 14:20-03', :'A','t', 11,11,'{}',
  '[{"buffer_id":"b1000000-0000-0000-0000-000000000001","saldo_estimado":1200},{"buffer_id":"b1000000-0000-0000-0000-000000000002","saldo_estimado":4800},{"buffer_id":"b1000000-0000-0000-0000-000000000003","saldo_estimado":9000}]'::jsonb, 3, null, true, 'impossível acessar o estoque: incêndio no galpão', null, '44444444-4444-4444-4444-444444444444') as fid4 \gset
do $$ begin
  assert (select excecao from escala_fechamentos where periodo_id='t1');
  assert (select count(*) from escala_fechamento_buffers b join escala_fechamentos f on f.id=b.fechamento_id where f.periodo_id='t1' and b.saldo_fisico is null) = 3, '3 buffers registrados sem contagem';
  assert (select count(*) from escala_contagens_fechamento_para_motor where fechamento_id = (select id from escala_fechamentos where periodo_id='t1')) = 0, 'exceção não gera contagem para o motor';
end $$;

-- T11c: fechamento feito em SOMBRA não conta como fechamento oficial quando a flag vira ATIVO (abre, fecha de novo como revisão 2 e libera o apontamento)
update escala_parametros set valor='"sombra"' where chave='escala_fechamento_fisico_modo';
select escala_fechamento_registrar(null,'2026-11-02','2026-11-03','t2','periodo', now(), now(), '2026-11-03 15:40-03', :'A','t', 11,11,'{}',
  '[{"buffer_id":"b1000000-0000-0000-0000-000000000001","saldo_estimado":100,"saldo_fisico":100},{"buffer_id":"b1000000-0000-0000-0000-000000000002","saldo_estimado":100,"saldo_fisico":100},{"buffer_id":"b1000000-0000-0000-0000-000000000003","saldo_estimado":100,"saldo_fisico":100}]'::jsonb, 3, null, false, null, null, '66666666-6666-6666-6666-666666666666') as fsom \gset
select escala_fechamento_resultado(:'fsom','CONFIRMADO','{"sombra":true}'::jsonb);
do $$ begin assert (select sombra from escala_fechamento_estado where periodo_id='t2'), 'view marca sombra'; end $$;
update escala_parametros set valor='"ativo"' where chave='escala_fechamento_fisico_modo';
do $$ begin
  assert escala_fechamento_apontamento_permitido('2026-11-03','t2','00000000-0000-0000-0000-0000000000a2'), 'sombra não bloqueia apontamento em ativo';
  perform escala_fechamento_abrir('2026-11-02','2026-11-03','t2','00000000-0000-0000-0000-0000000000a1','t',30);
  perform escala_fechamento_registrar(null,'2026-11-02','2026-11-03','t2','periodo', now(), now(), '2026-11-03 15:40-03', '00000000-0000-0000-0000-0000000000a1','t', 11,11,'{}',
    '[{"buffer_id":"b1000000-0000-0000-0000-000000000001","saldo_estimado":100,"saldo_fisico":100},{"buffer_id":"b1000000-0000-0000-0000-000000000002","saldo_estimado":100,"saldo_fisico":100},{"buffer_id":"b1000000-0000-0000-0000-000000000003","saldo_estimado":100,"saldo_fisico":100}]'::jsonb, 3, null, false, null, null, '77777777-7777-7777-7777-777777777777');
  assert (select revisao from escala_fechamentos_vigentes where periodo_id='t2') = 2, 'revisão 2 oficial depois da sombra';
end $$;
update escala_parametros set valor='"sombra"' where chave='escala_fechamento_fisico_modo';

-- T11b: o claim da outbox ganhou 'fechamento_fisico' SEM perder os tipos que já existiam; os CHECKs mantêm os valores anteriores
do $$ declare d text; begin
  select pg_get_functiondef(p.oid) into d from pg_proc p where p.proname = 'escala_reivindicar_eventos';
  assert d like '%fechamento_fisico%' and d like '%geracao_semanal%' and d like '%recurso_liberado%', 'claim da outbox';
  assert (select pg_get_constraintdef(oid) from pg_constraint where conname = 'escala_producao_eventos_tipo_check') like '%apontamento_periodo%', 'CHECK de eventos preserva os tipos';
  assert (select pg_get_constraintdef(oid) from pg_constraint where conname = 'usuario_permissoes_permissao_check') like '%escala_relatorios%', 'CHECK de permissões preserva as existentes';
  assert (select pg_get_constraintdef(oid) from pg_constraint where conname = 'usuario_permissoes_permissao_check') like '%escala_fechamento_excecao%';
end $$;

-- T12: custo de gravar o fechamento no banco (Postgres local, 3 buffers; piso de latência — o custo de rede do Supabase entra na fase sombra)
do $$ declare i int; t0 timestamptz; ms numeric[] := '{}'; v numeric[]; fid uuid; begin
  for i in 1..200 loop
    t0 := clock_timestamp();
    fid := escala_fechamento_registrar(null,'2026-11-02', date '2027-01-01' + (i/6), 'p'||(i%6), 'periodo', now(), now(), now(), '00000000-0000-0000-0000-0000000000a1','bench', 11, 11, '{}',
      '[{"buffer_id":"b1000000-0000-0000-0000-000000000001","saldo_estimado":1900,"saldo_fisico":1900},{"buffer_id":"b1000000-0000-0000-0000-000000000002","saldo_estimado":7000,"saldo_fisico":7000},{"buffer_id":"b1000000-0000-0000-0000-000000000003","saldo_estimado":8600,"saldo_fisico":8600}]'::jsonb,
      3, null, false, null, null, gen_random_uuid());
    perform escala_fechamento_resultado(fid, 'CONFIRMADO', '{}'::jsonb);
    ms := ms || (extract(epoch from clock_timestamp() - t0) * 1000)::numeric;
  end loop;
  select array_agg(x order by x) into v from unnest(ms) x;
  raise notice 'BENCH-DB registrar+resultado (200 execuções): p50 % ms · p95 % ms · pior % ms', round(v[100], 2), round(v[190], 2), round(v[200], 2);
end $$;
select 'TESTES-DB-OK' as resultado;
