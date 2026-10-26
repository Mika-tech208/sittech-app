-- T15: ATRASO EM ABERTO — abrir, conflitos, encerrar (agora/manual), duração com almoço, correção do início, histórico, eventos, fechamento automático,
-- dia seguinte independente, lote/unificação/exclusão, permissões. Tudo desfeito no final. Rodar só em DEV/local (ou em BEGIN…ROLLBACK junto com a migration).
-- O relógio é fixado com `app.agora_teste` (função public._agora()); sem ele vale now().
-- A exclusão destrutiva saiu da aplicação (funcionario_exclusao_* recusam "sem unificar"): resta a função interna _funcionario_exclusao para
-- administração de EMERGÊNCIA, fora da interface. Estes testes a exercitam por wrappers temporários (security definer; a checagem de admin é do núcleo).
create or replace function pg_temp.sim(a uuid, b uuid default null, c jsonb default '{}'::jsonb) returns jsonb language sql security definer as $$ select public._funcionario_exclusao(a, b, c, false, null) $$;
create or replace function pg_temp.exe(a uuid, b uuid, c jsonb, d text) returns jsonb language sql security definer as $$ select public._funcionario_exclusao(a, b, c, true, d) $$;
do $$
declare
  v_auth uuid; v_user uuid; v_prev uuid; v_snap jsonb;
  F uuid[]; r public.ausencias_funcionarios; r2 public.ausencias_funcionarios; v_ok boolean; v_n integer; v_n0 integer; v_msg text; v_j jsonb; v_ev0 integer;
  D date := '2031-03-04'; D2 date := '2031-03-05';
  procedure_dummy integer;
begin
  select auth_user_id, id into v_auth, v_user from usuarios where papel = 'admin' and ativo order by id limit 1;
  select array_agg(id order by id) into F from (select id from funcionarios where ativo order by id limit 14) t;
  if v_auth is null or coalesce(array_length(F, 1), 0) < 14 then raise exception 'FALHOU setup do DEV (admin/funcionários)'; end if;
  insert into previsoes (semana_inicio) values ('2031-03-03') returning id into v_prev;
  select jsonb_agg(jsonb_build_object('id', id, 'nome', nome, 'inicio', inicio, 'fim', fim) order by id) into v_snap from periodos;
  insert into escala_producao_dias (data, previsao_id, periodos_snapshot, versao) values (D, v_prev, v_snap, 0);
  perform set_config('request.jwt.claims', json_build_object('sub', v_auth, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- (1) ABRIR às 07:20: em aberto, sem fim, duração provisória 0, histórico de abertura, evento da Escala
  perform set_config('app.agora_teste', '2031-03-04 07:20:00-03', true);
  reset role; update escala_producao_eventos set status = 'processado' where previsao_id = v_prev and status = 'pendente'; v_ev0 := 0; set local role authenticated;
  r := abrir_atraso_funcionario(F[1], D, null, 'não chegou', gen_random_uuid());
  if not r.em_aberto or r.horario_fim is not null or r.horario_inicio <> '07:12' or r.tipo <> 'atraso' or r.duracao_minutos <> 0 then raise exception 'FALHOU (1) abertura: %', to_jsonb(r); end if;
  if (select count(*) from ausencia_funcionario_historico where ausencia_id = r.id and motivo = 'Abertura do atraso em aberto' and dados_anteriores = '{}'::jsonb) <> 1 then raise exception 'FALHOU (1) histórico da abertura'; end if;
  reset role; select count(*) into v_n from escala_producao_eventos where tipo = 'ausencia' and previsao_id = v_prev and status = 'pendente'; set local role authenticated;
  if v_n <= v_ev0 then raise exception 'FALHOU (1) abrir deveria gerar o evento canônico ausencia (% → %)', v_ev0, v_n; end if;

  -- (2) idempotência e segundo atraso aberto do mesmo funcionário/dia
  r2 := abrir_atraso_funcionario(F[1], D, null, 'não chegou', r.idempotency_key);
  if r2.id <> r.id then raise exception 'FALHOU (2) idempotência'; end if;
  begin perform abrir_atraso_funcionario(F[1], D, null, 'de novo', gen_random_uuid()); v_ok := false; exception when others then v_ok := position('já tem um atraso em aberto' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (2) segundo atraso aberto deveria ser recusado'; end if;
  -- e o índice único parcial protege até do SQL direto
  reset role;
  begin insert into ausencias_funcionarios (funcionario_id, data, tipo, horario_inicio, horario_fim, duracao_minutos, periodos_snapshot, criado_por, em_aberto) values (F[1], D, 'atraso', '07:30', null, 0, r.periodos_snapshot, v_user, true); v_ok := false; exception when unique_violation then v_ok := true; end;
  if not v_ok then raise exception 'FALHOU (2) índice único parcial'; end if;
  set local role authenticated;
  -- vários funcionários podem estar em aberto ao mesmo tempo
  perform abrir_atraso_funcionario(F[2], D, null, null, gen_random_uuid());
  if (select count(*) from ausencias_funcionarios where em_aberto and data = D) <> 2 then raise exception 'FALHOU (2) dois funcionários em aberto ao mesmo tempo'; end if;

  -- (3) conflitos: falta dia inteiro, atestado, janela sobreposta (saída durante expediente / saída antecipada), e o inverso (lançar depois de aberto)
  perform registrar_ausencia_funcionario(F[3], D, 'falta_dia_inteiro', null, null, 528, null, gen_random_uuid());
  perform registrar_ausencia_funcionario(F[4], D, 'atestado', null, null, 528, null, gen_random_uuid());
  perform registrar_ausencia_funcionario(F[5], D, 'saida_durante_expediente', '07:30', '08:00', 30, null, gen_random_uuid());
  perform registrar_ausencia_funcionario(F[6], D, 'saida_antecipada', '16:00', '17:00', 60, null, gen_random_uuid());
  foreach v_msg in array array['3', '4', '5', '6'] loop
    begin perform abrir_atraso_funcionario(F[v_msg::int], D, null, null, gen_random_uuid()); v_ok := false; exception when others then v_ok := position('Já existe uma ausência' in sqlerrm) > 0; end;
    if not v_ok then raise exception 'FALHOU (3) conflito deveria bloquear a abertura para o funcionário %', v_msg; end if;
  end loop;
  begin perform registrar_ausencia_funcionario(F[1], D, 'falta_dia_inteiro', null, null, 528, null, gen_random_uuid()); v_ok := false; exception when others then v_ok := position('Já existe uma ausência' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (3) falta dia inteiro sobre atraso aberto deveria conflitar'; end if;
  begin perform registrar_ausencia_funcionario(F[1], D, 'saida_antecipada', '15:00', '17:00', 120, null, gen_random_uuid()); v_ok := false; exception when others then v_ok := position('Já existe uma ausência' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (3) saída antecipada dentro da janela aberta deveria conflitar'; end if;

  -- (4) validações de abertura: horário futuro, fora da jornada, dia diferente de hoje
  begin perform abrir_atraso_funcionario(F[7], D, '13:00', null, gen_random_uuid()); v_ok := false; exception when others then v_ok := position('ainda não chegou' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (4) início futuro'; end if;
  begin perform abrir_atraso_funcionario(F[7], D, '12:30', null, gen_random_uuid()); v_ok := false; exception when others then v_ok := position('dentro da jornada' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (4) início no almoço'; end if;
  begin perform abrir_atraso_funcionario(F[7], D - 1, null, null, gen_random_uuid()); v_ok := false; exception when others then v_ok := position('só pode ser registrado para hoje' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (4) dia diferente de hoje'; end if;

  -- (5) CORREÇÃO do horário inicial do atraso aberto: motivo obrigatório, antes/depois, conflito, evento
  begin perform corrigir_inicio_atraso_aberto(r.id, '07:15', '  '); v_ok := false; exception when others then v_ok := position('Motivo' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (5) motivo obrigatório'; end if;
  begin perform corrigir_inicio_atraso_aberto(r.id, '08:30', 'x'); v_ok := false; exception when others then v_ok := position('futuro' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (5) início no futuro'; end if;
  reset role; update escala_producao_eventos set status = 'processado' where previsao_id = v_prev and status = 'pendente'; v_ev0 := 0; set local role authenticated;
  r2 := corrigir_inicio_atraso_aberto(r.id, '07:15', 'a Clarice abriu 07:12, mas o correto era 07:15');
  if r2.horario_inicio <> '07:15' or not r2.em_aberto or r2.horario_fim is not null then raise exception 'FALHOU (5) correção'; end if;
  if not exists (select 1 from ausencia_funcionario_historico h where h.ausencia_id = r.id and h.motivo like 'a Clarice abriu%' and h.dados_anteriores->>'horario_inicio' = '07:12:00' and h.dados_novos->>'horario_inicio' = '07:15:00' and h.alterado_por = v_user) then
    raise exception 'FALHOU (5) histórico antes/depois da correção';
  end if;
  reset role; select count(*) into v_n from escala_producao_eventos where tipo = 'ausencia' and previsao_id = v_prev and status = 'pendente'; set local role authenticated;
  if v_n <= v_ev0 then raise exception 'FALHOU (5) correção deveria gerar evento'; end if;
  r2 := corrigir_inicio_atraso_aberto(r.id, '07:12', 'voltou ao horário original');

  -- (6) editar a ocorrência em aberto por aqui é recusado
  begin perform editar_ausencia_funcionario(r.id, 'atraso', '07:12', '08:00', 40, null, 'x'); v_ok := false; exception when others then v_ok := position('Atraso em aberto' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (6) editar atraso aberto'; end if;

  -- (7) ENCERRAR "chegou agora" às 08:03: [07:12, 08:03), 51 min produtivos, chegada_manual=false, quem/quando, histórico, evento
  perform set_config('app.agora_teste', '2031-03-04 08:03:40-03', true);
  reset role; update escala_producao_eventos set status = 'processado' where previsao_id = v_prev and status = 'pendente'; v_ev0 := 0; set local role authenticated;
  r2 := encerrar_atraso_funcionario(r.id, null);
  if r2.em_aberto or r2.horario_fim <> '08:03' or r2.duracao_minutos <> 51 or r2.chegada_manual is not false or r2.encerrada_por <> v_user or r2.encerrada_em is null or r2.encerramento_automatico then raise exception 'FALHOU (7) encerramento agora: %', to_jsonb(r2); end if;
  if not exists (select 1 from ausencia_funcionario_historico h where h.ausencia_id = r.id and h.motivo like 'Encerramento por chegada%' and h.dados_anteriores->>'em_aberto' = 'true' and h.dados_novos->>'horario_fim' = '08:03:00') then raise exception 'FALHOU (7) histórico'; end if;
  reset role; select count(*) into v_n from escala_producao_eventos where tipo = 'ausencia' and previsao_id = v_prev and status = 'pendente'; set local role authenticated;
  if v_n <= v_ev0 then raise exception 'FALHOU (7) encerrar deveria gerar evento'; end if;
  begin perform encerrar_atraso_funcionario(r.id, null); v_ok := false; exception when others then v_ok := position('já foi encerrado' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (7) encerrar duas vezes'; end if;
  -- depois de encerrado, o funcionário pode ter OUTRO atraso (agora fechado, janela [07:12,08:03) não conflita com um início depois)
  -- (8) ENCERRAR com horário manual, e chegadas inválidas
  perform set_config('app.agora_teste', '2031-03-04 09:00:00-03', true);
  select * into r from ausencias_funcionarios where funcionario_id = F[2] and em_aberto;
  begin perform encerrar_atraso_funcionario(r.id, '07:12'); v_ok := false; exception when others then v_ok := position('depois do início' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (8) chegada igual ao início'; end if;
  begin perform encerrar_atraso_funcionario(r.id, '09:30'); v_ok := false; exception when others then v_ok := position('futuro' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (8) chegada no futuro'; end if;
  begin perform encerrar_atraso_funcionario(r.id, '17:30'); v_ok := false; exception when others then v_ok := position('fim da jornada' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (8) chegada depois do fim da jornada'; end if;
  r2 := encerrar_atraso_funcionario(r.id, '08:40');
  if r2.horario_fim <> '08:40' or r2.duracao_minutos <> 88 or r2.chegada_manual is not true then raise exception 'FALHOU (8) chegada manual: %', to_jsonb(r2); end if;

  -- (9) DURAÇÃO com almoço: 07:12 → 13:30 = manhã até 12:00 (288) + 13:00–13:30 (30)
  perform set_config('app.agora_teste', '2031-03-04 07:25:00-03', true);
  r := abrir_atraso_funcionario(F[8], D, null, null, gen_random_uuid());
  perform set_config('app.agora_teste', '2031-03-04 16:30:10+00', true);
  r2 := encerrar_atraso_funcionario(r.id, null);
  if r2.duracao_minutos <> 318 or r2.horario_fim <> '13:30' then raise exception 'FALHOU (9) duração atravessando o almoço: %', r2.duracao_minutos; end if;

  -- (10) ATRASO APÓS O ALMOÇO: 13:00 aberto às 13:10, chega 13:37 => 37 min (não é falta da manhã)
  perform set_config('app.agora_teste', '2031-03-04 13:10:00-03', true);
  r := abrir_atraso_funcionario(F[9], D, '13:00', null, gen_random_uuid());
  if r.horario_inicio <> '13:00' then raise exception 'FALHOU (10) início 13:00'; end if;
  perform set_config('app.agora_teste', '2031-03-04 13:37:00-03', true);
  r2 := encerrar_atraso_funcionario(r.id, null);
  if r2.duracao_minutos <> 37 or r2.horario_inicio <> '13:00' or r2.horario_fim <> '13:37' then raise exception 'FALHOU (10) tarde: %', to_jsonb(r2); end if;

  -- (11) FECHAMENTO AUTOMÁTICO às 17:12: fim efetivo 17:00 (não 17:12), encerrada_em = hora real, sem usuário, histórico do sistema, duração da jornada toda
  perform set_config('app.agora_teste', '2031-03-04 14:00:00-03', true);
  r := abrir_atraso_funcionario(F[10], D, '13:00', null, gen_random_uuid());           -- tarde: nunca chega
  perform set_config('app.agora_teste', '2031-03-04 10:00:00-03', true);
  -- (manhã aberta às 10:00 por F[11]: início 07:12, nunca chega)
  r2 := abrir_atraso_funcionario(F[11], D, null, null, gen_random_uuid());
  perform set_config('app.agora_teste', '2031-03-04 16:59:00-03', true);
  reset role;
  if public._fechar_atrasos_vencidos(public._agora()) <> 0 then raise exception 'FALHOU (11) 16:59 ainda não vence'; end if;
  perform set_config('app.agora_teste', '2031-03-04 17:12:00-03', true);
  if public._fechar_atrasos_vencidos(public._agora()) <> 2 then raise exception 'FALHOU (11) deveria fechar os 2 atrasos abertos'; end if;
  select * into r from ausencias_funcionarios where funcionario_id = F[10] and data = D and tipo = 'atraso';
  if r.em_aberto or r.horario_fim <> '17:00' or not r.encerramento_automatico or r.encerrada_por is not null or r.chegada_manual is not null or r.duracao_minutos <> 240 or r.horario_inicio <> '13:00' then raise exception 'FALHOU (11) tarde sem chegada: %', to_jsonb(r); end if;
  if (r.encerrada_em at time zone 'America/Sao_Paulo')::time <> '17:12' then raise exception 'FALHOU (11) encerrada_em deveria ser a hora real do processamento'; end if;
  select * into r2 from ausencias_funcionarios where funcionario_id = F[11] and data = D and tipo = 'atraso';
  if r2.horario_fim <> '17:00' or r2.duracao_minutos <> 528 or not r2.encerramento_automatico then raise exception 'FALHOU (11) manhã sem chegada = jornada toda (528): %', to_jsonb(r2); end if;
  if not exists (select 1 from ausencia_funcionario_historico h where h.ausencia_id = r2.id and h.origem = 'sistema' and h.alterado_por is null and h.motivo like 'Fechamento automático%') then raise exception 'FALHOU (11) histórico do sistema'; end if;
  if public._fechar_atrasos_vencidos(public._agora()) <> 0 then raise exception 'FALHOU (11) idempotência do fechamento'; end if;

  -- (12) DIA SEGUINTE independente: nada em aberto herdado; novo atraso permitido; esquecido de dia anterior fecha sozinho
  set local role authenticated;
  perform set_config('app.agora_teste', '2031-03-05 07:20:00-03', true);
  r := abrir_atraso_funcionario(F[11], D2, null, null, gen_random_uuid());
  if not r.em_aberto or r.data <> D2 then raise exception 'FALHOU (12) novo atraso no dia seguinte'; end if;
  reset role;
  insert into ausencias_funcionarios (funcionario_id, data, tipo, horario_inicio, horario_fim, duracao_minutos, periodos_snapshot, criado_por, em_aberto) values (F[12], D, 'atraso', '07:12', null, 0, r.periodos_snapshot, v_user, true);
  if public._fechar_atrasos_vencidos(public._agora()) <> 1 then raise exception 'FALHOU (12) atraso aberto de dia anterior deveria fechar'; end if;
  if (select horario_fim from ausencias_funcionarios where funcionario_id = F[12] and data = D) <> '17:00' then raise exception 'FALHOU (12) fim do dia anterior = 17:00'; end if;
  if not exists (select 1 from ausencias_funcionarios where id = r.id and em_aberto) then raise exception 'FALHOU (12) o atraso de hoje continua aberto'; end if;

  -- (13) LOTE não cria atraso aberto/sem fim; UNIFICAÇÃO e EXCLUSÃO bloqueadas com atraso em aberto
  set local role authenticated;
  select count(*) into v_n0 from ausencias_funcionarios where tipo = 'atraso' and horario_fim is null and not em_aberto;
  begin perform registrar_ausencias_funcionario_lote(F[13], array[D2], 'atraso', '07:12', null, 0, null, gen_random_uuid()); exception when others then null; end;
  select count(*) into v_n from ausencias_funcionarios where tipo = 'atraso' and horario_fim is null and not em_aberto;
  if v_n <> v_n0 or exists (select 1 from ausencias_funcionarios where funcionario_id = F[13] and data = D2) then raise exception 'FALHOU (13) lote não pode criar atraso sem fim/aberto'; end if;
  v_j := pg_temp.sim(F[11], null, '{}'::jsonb);
  if not exists (select 1 from jsonb_array_elements(v_j->'bloqueios') b where b->>'codigo' = 'ATRASO_EM_ABERTO') then raise exception 'FALHOU (13) exclusão deveria ser bloqueada: %', v_j->'bloqueios'; end if;
  v_j := funcionario_exclusao_simular(F[14], F[11], '{}'::jsonb);
  if not exists (select 1 from jsonb_array_elements(v_j->'bloqueios') b where b->>'codigo' = 'ATRASO_EM_ABERTO') then raise exception 'FALHOU (13) unificação (mantido com atraso aberto) deveria ser bloqueada'; end if;
  v_j := pg_temp.sim(F[14], null, '{}'::jsonb);
  if exists (select 1 from jsonb_array_elements(v_j->'bloqueios') b where b->>'codigo' = 'ATRASO_EM_ABERTO') then raise exception 'FALHOU (13) sem atraso aberto não pode bloquear por isso'; end if;

  -- (14) PERMISSÕES: anônimo não executa; o fechamento interno não é executável por usuário; o público é seguro para qualquer usuário autenticado
  reset role; set local role anon;
  begin perform abrir_atraso_funcionario(F[1], D2, null, null, gen_random_uuid()); v_ok := false; exception when others then v_ok := position('permission denied' in lower(sqlerrm)) > 0; end;
  if not v_ok then raise exception 'FALHOU (14) anon não executa abrir'; end if;
  reset role; set local role authenticated;
  begin perform public._fechar_atrasos_vencidos(now()); v_ok := false; exception when others then v_ok := position('permission denied' in lower(sqlerrm)) > 0; end;
  if not v_ok then raise exception 'FALHOU (14) _fechar_atrasos_vencidos é interno'; end if;
  perform public.fechar_atrasos_vencidos(); -- público: só fecha o que já venceu
  reset role; set local role service_role;
  perform public.fechar_atrasos_vencidos(); -- o worker (drenar) chama como service_role

  reset role;
  raise exception 'TESTE_OK T15: atraso em aberto — abertura, conflitos, encerramento (agora/manual), almoço, correção do início, histórico, eventos, fechamento automático, dia seguinte, lote/unificação/exclusão e permissões';
end $$;
