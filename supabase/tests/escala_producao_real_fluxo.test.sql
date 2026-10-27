-- Teste de banco (DEV/local) da ESCALA INTELIGENTE (fluxo): flag producao_real_*, portão no banco, gatilho de parâmetros, diagnósticos append-only,
-- RPC idempotente só para service_role e rollback do modo por UPDATE do parâmetro (sem DDL). Transação com ROLLBACK; semana sintética de 2035.
-- Aplicar ANTES a migration 20261105190000_escala_producao_real_fluxo.sql. Nunca em PROD:  npx supabase db query --linked -f ... (somente DEV)
begin;
create temp table t_res (n serial, res text);
do $$
declare
  v_snap jsonb := (select jsonb_agg(jsonb_build_object('id', id, 'nome', nome, 'inicio', to_char(inicio, 'HH24:MI'), 'fim', to_char(fim, 'HH24:MI')) order by id) from periodos);
  v_prev uuid;
  v_ok boolean; v_n integer; v_r jsonb; v_r2 jsonb; v_id uuid; v_msg text;
  v_dados jsonb;
  v_modo0 jsonb := (select valor from escala_parametros where chave = 'producao_real_modo');
begin
  -- F1) defaults: desligado, nenhuma semana, limiar derivado, pares semeados com o Conector 3/4"
  if v_modo0 <> '"desligado"'::jsonb then raise exception 'F1 falhou: modo padrão deve ser desligado: %', v_modo0; end if;
  if (select valor from escala_parametros where chave = 'producao_real_semanas_ativas') <> '[]'::jsonb then raise exception 'F1 falhou: semanas deve nascer vazio'; end if;
  if (select valor from escala_parametros where chave = 'producao_real_limiar_estabilidade') <> 'null'::jsonb then raise exception 'F1 falhou: limiar deve nascer null'; end if;
  if (select jsonb_array_length(valor) from escala_parametros where chave = 'producao_real_pares_legado') <> 1
     or (select valor -> 0 ->> 'convencional' from escala_parametros where chave = 'producao_real_pares_legado') <> '27c229d7-f192-41eb-aad1-0c69ece53eba'
     or (select valor -> 0 ->> 'automatica' from escala_parametros where chave = 'producao_real_pares_legado') <> 'a027ac97-ffd1-4834-8ed0-d3a94aac4aee'
     or (select jsonb_array_length(valor -> 0 -> 'etapasComuns') from escala_parametros where chave = 'producao_real_pares_legado') <> 2 then
    raise exception 'F1 falhou: pares legado mal semeados';
  end if;
  if public.escala_producao_real_modo() <> 'desligado' or public.escala_producao_real_modo_semana('2035-01-01') <> 'desligado' then raise exception 'F1 falhou: funções de modo'; end if;
  insert into t_res(res) values ('ok F1 defaults: modo desligado, semanas [], limiar null, par Conector 3/4" convencional x automática com Etiquetar/Embalar');

  -- F2) constraints no banco
  begin update escala_parametros set valor = '"loucura"' where chave = 'producao_real_modo'; v_ok := false; exception when others then v_ok := position('escala_parametros_producao_real_modo' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'F2 falhou: modo inválido deveria ser recusado'; end if;
  begin update escala_parametros set valor = '"ativo_restrito"' where chave = 'producao_real_modo'; v_ok := false; exception when others then v_ok := position('escala_parametros_producao_real_modo' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'F2 falhou: ativo_restrito não é modo do fluxo'; end if;
  begin update escala_parametros set valor = '["2026-10-19"]'::jsonb where chave = 'producao_real_semanas_ativas'; v_ok := false; exception when others then v_ok := position('escala_parametros_producao_real_semanas' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'F2 falhou: semana anterior a 2026-10-26 deveria ser recusada'; end if;
  begin update escala_parametros set valor = '["2026-10-27"]'::jsonb where chave = 'producao_real_semanas_ativas'; v_ok := false; exception when others then v_ok := position('escala_parametros_producao_real_semanas' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'F2 falhou: terça-feira não é início de semana'; end if;
  begin update escala_parametros set valor = '["2026-13-45"]'::jsonb where chave = 'producao_real_semanas_ativas'; v_ok := false; exception when others then v_ok := position('escala_parametros_producao_real_semanas' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'F2 falhou: data impossível'; end if;
  begin update escala_parametros set valor = '[20261026]'::jsonb where chave = 'producao_real_semanas_ativas'; v_ok := false; exception when others then v_ok := position('escala_parametros_producao_real_semanas' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'F2 falhou: elemento não-string'; end if;
  begin update escala_parametros set valor = '{"a":1}'::jsonb where chave = 'producao_real_semanas_ativas'; v_ok := false; exception when others then v_ok := position('escala_parametros_producao_real_semanas' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'F2 falhou: semanas deve ser array'; end if;
  begin update escala_parametros set valor = '-1'::jsonb where chave = 'producao_real_limiar_estabilidade'; v_ok := false; exception when others then v_ok := position('escala_parametros_producao_real_limiar' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'F2 falhou: limiar negativo'; end if;
  begin update escala_parametros set valor = '"x"'::jsonb where chave = 'producao_real_limiar_estabilidade'; v_ok := false; exception when others then v_ok := position('escala_parametros_producao_real_limiar' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'F2 falhou: limiar não numérico'; end if;
  begin update escala_parametros set valor = '{}'::jsonb where chave = 'producao_real_pares_legado'; v_ok := false; exception when others then v_ok := position('escala_parametros_producao_real_pares' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'F2 falhou: pares deve ser array'; end if;
  update escala_parametros set valor = '["2026-10-26", "2035-01-01"]'::jsonb where chave = 'producao_real_semanas_ativas';
  update escala_parametros set valor = '3'::jsonb where chave = 'producao_real_limiar_estabilidade';
  update escala_parametros set valor = 'null'::jsonb where chave = 'producao_real_limiar_estabilidade';
  insert into t_res(res) values ('ok F2 constraints: modo fora do domínio, semana < 2026-10-26, não-segunda, data impossível, não-string, não-array, limiar negativo/não numérico, pares não-array: todos recusados; valores válidos aceitos');

  -- cenário sintético: 1 previsão FUTURA com escala (para o gatilho ter o que recalcular)
  insert into previsoes (semana_inicio) values ('2035-01-01') returning id into v_prev;
  insert into escala_producao_dias (data, previsao_id, periodos_snapshot, versao) values ('2035-01-02', v_prev, v_snap, 0);
  delete from escala_producao_eventos where previsao_id = v_prev;

  -- F3) gatilho: desligado<->sombra NÃO recalcula; entrar/sair do ATIVO pede recálculo (evento 'previsao'); demais chaves só com o ativo corrente
  update escala_parametros set valor = '"sombra"' where chave = 'producao_real_modo';
  select count(*) into v_n from escala_producao_eventos where previsao_id = v_prev;
  if v_n <> 0 then raise exception 'F3 falhou: desligado->sombra não pode recalcular (eventos=%)', v_n; end if;
  update escala_parametros set valor = '"desligado"' where chave = 'producao_real_modo';
  select count(*) into v_n from escala_producao_eventos where previsao_id = v_prev;
  if v_n <> 0 then raise exception 'F3 falhou: sombra->desligado não pode recalcular (eventos=%)', v_n; end if;
  update escala_parametros set valor = '"sombra"' where chave = 'producao_real_modo';
  update escala_parametros set valor = '[ "2035-01-01" ]'::jsonb where chave = 'producao_real_semanas_ativas';
  update escala_parametros set valor = '5'::jsonb where chave = 'producao_real_limiar_estabilidade';
  select count(*) into v_n from escala_producao_eventos where previsao_id = v_prev;
  if v_n <> 0 then raise exception 'F3 falhou: semanas/limiar em modo sombra não recalculam (eventos=%)', v_n; end if;
  update escala_parametros set valor = '"ativo"' where chave = 'producao_real_modo';
  select count(*) into v_n from escala_producao_eventos where previsao_id = v_prev and tipo = 'previsao' and status = 'pendente';
  if v_n <> 1 then raise exception 'F3 falhou: sombra->ativo deve pedir 1 recálculo (eventos=%)', v_n; end if;
  update escala_producao_eventos set status = 'processado' where previsao_id = v_prev;
  update escala_parametros set valor = '"ativo"' where chave = 'producao_real_modo'; -- UPDATE sem mudança: nada
  select count(*) into v_n from escala_producao_eventos where previsao_id = v_prev and status = 'pendente';
  if v_n <> 0 then raise exception 'F3 falhou: UPDATE sem mudança não pode recalcular'; end if;
  update escala_parametros set valor = '8'::jsonb where chave = 'producao_real_limiar_estabilidade';
  select count(*) into v_n from escala_producao_eventos where previsao_id = v_prev and status = 'pendente';
  if v_n <> 1 then raise exception 'F3 falhou: mudar o limiar com o modo ativo deve recalcular (eventos=%)', v_n; end if;
  update escala_producao_eventos set status = 'processado' where previsao_id = v_prev;
  update escala_parametros set valor = '"sombra"' where chave = 'producao_real_modo';
  select count(*) into v_n from escala_producao_eventos where previsao_id = v_prev and status = 'pendente';
  if v_n <> 1 then raise exception 'F3 falhou: ativo->sombra deve devolver a Escala ao motor oficial (1 recálculo; eventos=%)', v_n; end if;
  insert into t_res(res) values ('ok F3 gatilho: desligado<->sombra e semanas/limiar fora do ativo NÃO recalculam; entrar/sair do ativo e mudar limiar com o ativo pedem 1 recálculo; UPDATE idêntico é inerte');

  -- F4) modo EFETIVO por semana (portão no banco)
  update escala_parametros set valor = '"ativo"' where chave = 'producao_real_modo';
  update escala_parametros set valor = '["2035-01-01"]'::jsonb where chave = 'producao_real_semanas_ativas';
  if public.escala_producao_real_modo_semana('2035-01-01') <> 'ativo' then raise exception 'F4 falhou: semana autorizada em ativo'; end if;
  if public.escala_producao_real_modo_semana('2035-01-08') <> 'desligado' then raise exception 'F4 falhou: semana NÃO autorizada deve ser desligado'; end if;
  update escala_parametros set valor = '"sombra"' where chave = 'producao_real_modo';
  if public.escala_producao_real_modo_semana('2035-01-01') <> 'sombra' then raise exception 'F4 falhou: sombra'; end if;
  insert into t_res(res) values ('ok F4 modo efetivo: ativo/sombra só na semana listada; qualquer outra semana = desligado');

  -- F5) versão do plano registra a configuração do fluxo (e muda quando a flag muda)
  if (escala_plano_entrada(v_prev) -> 'parametros' -> 'producaoReal' ->> 'modoEfetivo') <> 'sombra' then raise exception 'F5 falhou: %', escala_plano_entrada(v_prev) -> 'parametros'; end if;
  if (escala_plano_entrada(v_prev) -> 'parametros' -> 'producaoReal' -> 'paresLegado') is null then raise exception 'F5 falhou: pares'; end if;
  insert into t_res(res) values ('ok F5 escala_plano_entrada.parametros.producaoReal reflete modo efetivo, limiar e pares (versão do plano acompanha a flag)');

  -- F6) RPC de registro: dados mínimos, idempotência, portão
  v_dados := jsonb_build_object(
    'previsao_id', v_prev, 'semana_inicio', '2035-01-01', 'gatilho', 'fechamento', 'modo', 'sombra', 'versao_motor', 'fluxo-teste', 'hash_entrada', 'h1', 'hash_plano_oficial', 'ho', 'hash_plano_fluxo', 'hf',
    'corte_data', '2035-01-02', 'corte_periodo_id', 'm1', 'corte_c', 0, 'diff', '{"linhas": 3}'::jsonb, 'violacoes', '[]'::jsonb, 'replanejamento', '{"antes": {}, "decisao": {}, "motivo": {}, "depois": {}}'::jsonb);
  v_r := escala_fluxo_registrar(v_dados);
  if (v_r ->> 'inserido')::boolean is not true then raise exception 'F6 falhou: não inseriu %', v_r; end if;
  v_r2 := escala_fluxo_registrar(v_dados);
  if (v_r2 ->> 'inserido')::boolean is not false or v_r2 ->> 'id' <> v_r ->> 'id' then raise exception 'F6 falhou: idempotência % / %', v_r, v_r2; end if;
  select count(*) into v_n from escala_fluxo_diagnosticos where previsao_id = v_prev;
  if v_n <> 1 then raise exception 'F6 falhou: duplicou (%)', v_n; end if;
  -- outro plano de fluxo (hash diferente) = outra linha; outro gatilho = outra linha; outro modo = outra linha
  perform escala_fluxo_registrar(v_dados || '{"hash_plano_fluxo": "hf2"}');
  perform escala_fluxo_registrar(v_dados || '{"gatilho": "evento"}');
  select count(*) into v_n from escala_fluxo_diagnosticos where previsao_id = v_prev;
  if v_n <> 3 then raise exception 'F6 falhou: esperava 3 linhas distintas (%)', v_n; end if;
  -- campos jsonb ausentes viram padrão; resultado/aplicado têm padrão
  if (select diff from escala_fluxo_diagnosticos where id = (v_r ->> 'id')::uuid) <> '{"linhas": 3}'::jsonb or (select aplicado from escala_fluxo_diagnosticos where id = (v_r ->> 'id')::uuid) then raise exception 'F6 falhou: conteúdo'; end if;
  if (select wip from escala_fluxo_diagnosticos where id = (v_r ->> 'id')::uuid) <> '{}'::jsonb or (select resultado from escala_fluxo_diagnosticos where id = (v_r ->> 'id')::uuid) <> 'ok' then raise exception 'F6 falhou: padrões'; end if;
  -- dados obrigatórios
  begin perform escala_fluxo_registrar(v_dados - 'hash_entrada'); v_ok := false; exception when others then v_ok := position('ESCALA_FLUXO_DADOS_INVALIDOS' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'F6 falhou: hash_entrada obrigatório'; end if;
  begin perform escala_fluxo_registrar(v_dados || '{"gatilho": "outro", "hash_entrada": "h9"}'); v_ok := false; exception when others then v_ok := position('violates check constraint' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'F6 falhou: gatilho inválido'; end if;
  insert into t_res(res) values ('ok F6 registrar: insere, repete sem duplicar (mesmo id), variações de hash/gatilho geram linhas novas, padrões e obrigatórios corretos');

  -- F7) PORTÃO do registro: semana não autorizada / modo ativo sem autorização / aplicado sem ativo
  v_r := escala_fluxo_registrar(v_dados || '{"semana_inicio": "2035-01-08", "hash_entrada": "h7"}');
  if v_r ->> 'bloqueado' <> 'modo_desligado' then raise exception 'F7 falhou: semana fora da lista deve bloquear: %', v_r; end if;
  v_r := escala_fluxo_registrar(v_dados || '{"modo": "ativo", "hash_entrada": "h8"}');
  if v_r ->> 'bloqueado' <> 'modo_ativo_nao_autorizado' then raise exception 'F7 falhou: registrar ativo com modo efetivo sombra: %', v_r; end if;
  v_r := escala_fluxo_registrar(v_dados || '{"hash_entrada": "h10", "aplicado": true}');
  if v_r ->> 'bloqueado' <> 'aplicado_exige_modo_ativo' then raise exception 'F7 falhou: aplicado sem ativo: %', v_r; end if;
  -- replay é isento do portão da semana (leitura de histórico, nunca altera a Escala)
  v_r := escala_fluxo_registrar(v_dados || '{"semana_inicio": "2035-01-08", "gatilho": "replay", "hash_entrada": "h11"}');
  if (v_r ->> 'inserido')::boolean is not true then raise exception 'F7 falhou: replay: %', v_r; end if;
  -- ativo autorizado: aplicado = true aceito; mas aplicado com resultado fallback é recusado pela constraint
  update escala_parametros set valor = '"ativo"' where chave = 'producao_real_modo';
  v_r := escala_fluxo_registrar(v_dados || '{"modo": "ativo", "hash_entrada": "h12", "aplicado": true}');
  if (v_r ->> 'inserido')::boolean is not true then raise exception 'F7 falhou: ativo aplicado: %', v_r; end if;
  begin perform escala_fluxo_registrar(v_dados || '{"modo": "ativo", "hash_entrada": "h13", "aplicado": true, "resultado": "fallback"}'); v_ok := false; exception when others then v_ok := position('escala_fluxo_diag_aplicado' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'F7 falhou: fallback não pode ser aplicado=true'; end if;
  v_r := escala_fluxo_registrar(v_dados || '{"modo": "ativo", "hash_entrada": "h14", "resultado": "fallback", "erro": "violação de hard constraint"}');
  if (v_r ->> 'inserido')::boolean is not true then raise exception 'F7 falhou: fallback registrado: %', v_r; end if;
  insert into t_res(res) values ('ok F7 portão no banco: semana fora da lista, ativo não autorizado e aplicado sem ativo NÃO gravam; replay isento; ativo autorizado grava aplicado=true; fallback grava aplicado=false');

  -- F8) IMUTABILIDADE (append-only)
  begin update escala_fluxo_diagnosticos set aplicado = false where previsao_id = v_prev; v_ok := false; exception when others then v_ok := position('ESCALA_FLUXO_IMUTAVEL' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'F8 falhou: UPDATE deveria ser bloqueado'; end if;
  begin delete from escala_fluxo_diagnosticos where previsao_id = v_prev; v_ok := false; exception when others then v_ok := position('ESCALA_FLUXO_IMUTAVEL' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'F8 falhou: DELETE deveria ser bloqueado'; end if;
  begin truncate escala_fluxo_diagnosticos; v_ok := false; exception when others then v_ok := position('ESCALA_FLUXO_IMUTAVEL' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'F8 falhou: TRUNCATE deveria ser bloqueado'; end if;
  insert into t_res(res) values ('ok F8 imutável: UPDATE, DELETE e TRUNCATE bloqueados (ESCALA_FLUXO_IMUTAVEL)');

  -- F9) rollback do modo: ativo -> sombra -> desligado SÓ por UPDATE do parâmetro (nenhum DDL); a Escala é entregue ao oficial
  update escala_parametros set valor = '"ativo"' where chave = 'producao_real_modo';
  if public.escala_producao_real_modo_semana('2035-01-01') <> 'ativo' then raise exception 'F9 falhou: ativo'; end if;
  update escala_parametros set valor = '"sombra"' where chave = 'producao_real_modo';
  if public.escala_producao_real_modo_semana('2035-01-01') <> 'sombra' then raise exception 'F9 falhou: sombra'; end if;
  update escala_parametros set valor = '"desligado"' where chave = 'producao_real_modo';
  if public.escala_producao_real_modo_semana('2035-01-01') <> 'desligado' then raise exception 'F9 falhou: desligado'; end if;
  v_r := escala_fluxo_registrar(v_dados || '{"hash_entrada": "h20"}');
  if v_r ->> 'bloqueado' <> 'modo_desligado' then raise exception 'F9 falhou: desligado deve bloquear o registro: %', v_r; end if;
  -- o histórico continua legível e intacto depois do rollback
  select count(*) into v_n from escala_fluxo_diagnosticos where previsao_id = v_prev;
  if v_n < 6 then raise exception 'F9 falhou: histórico perdido (%)', v_n; end if;
  insert into t_res(res) values ('ok F9 rollback ativo->sombra->desligado só por UPDATE do parâmetro: modo efetivo acompanha, registro bloqueia em desligado, histórico preservado');

  -- F10) grants: RPC só service_role; tabela sem escrita direta por ninguém
  if has_function_privilege('anon', 'public.escala_fluxo_registrar(jsonb)', 'execute') or has_function_privilege('authenticated', 'public.escala_fluxo_registrar(jsonb)', 'execute') then raise exception 'F10 falhou: RPC aberta'; end if;
  if not has_function_privilege('service_role', 'public.escala_fluxo_registrar(jsonb)', 'execute') then raise exception 'F10 falhou: service_role sem RPC'; end if;
  if has_table_privilege('service_role', 'public.escala_fluxo_diagnosticos', 'insert') or has_table_privilege('authenticated', 'public.escala_fluxo_diagnosticos', 'insert')
     or has_table_privilege('service_role', 'public.escala_fluxo_diagnosticos', 'update') or has_table_privilege('service_role', 'public.escala_fluxo_diagnosticos', 'delete') or has_table_privilege('anon', 'public.escala_fluxo_diagnosticos', 'select') then
    raise exception 'F10 falhou: privilégios de tabela';
  end if;
  if not has_table_privilege('authenticated', 'public.escala_fluxo_diagnosticos', 'select') or not has_table_privilege('service_role', 'public.escala_fluxo_diagnosticos', 'select') then raise exception 'F10 falhou: leitura'; end if;
  if not (select relrowsecurity from pg_class where oid = 'public.escala_fluxo_diagnosticos'::regclass) then raise exception 'F10 falhou: RLS desligada'; end if;
  insert into t_res(res) values ('ok F10 grants/RLS: RPC só service_role; nenhuma escrita direta (nem service_role); leitura authenticated (RLS admin/escala_producao) e service_role');

  -- F11) chamada real como service_role (a RPC escreve mesmo sem privilégio de INSERT na tabela)
  update escala_parametros set valor = '"sombra"' where chave = 'producao_real_modo';
  set local role service_role;
  v_r := escala_fluxo_registrar(v_dados || '{"hash_entrada": "h30"}');
  reset role;
  if (v_r ->> 'inserido')::boolean is not true then raise exception 'F11 falhou: %', v_r; end if;
  set local role authenticated;
  begin perform escala_fluxo_registrar(v_dados || '{"hash_entrada": "h31"}'); v_ok := false; exception when others then v_ok := position('permission denied' in sqlerrm) > 0; end;
  reset role;
  if not v_ok then raise exception 'F11 falhou: authenticated não pode chamar a RPC'; end if;
  insert into t_res(res) values ('ok F11 como service_role a RPC grava; como authenticated é negada (permission denied)');
end $$;
select res from t_res order by n;
rollback;
