-- T9: controle de estoque intermediário (WIP) — RPCs, validações, histórico imutável, snapshots idempotentes, grants e eventos.
-- Tudo desfeito no final (RAISE EXCEPTION 'TESTE_OK T9 ...'). Rodar só em DEV/local.
do $$
declare
  v_adm uuid;
  v_prod uuid; E uuid[]; v_outra uuid; v_c uuid; v_c2 uuid; v_id uuid; v_id2 uuid; v_n integer; v_ok boolean; v_err text; v_ev0 bigint; v_ev1 bigint; v_modo_antes jsonb;
  v_chave uuid := gen_random_uuid();
begin
  select id into v_adm from usuarios where papel = 'admin' order by id limit 1;
  select e.produto_id into v_prod from roteiro_etapas e group by e.produto_id having count(*) >= 3 order by count(*) desc, e.produto_id limit 1;
  select array_agg(id order by ordem, id) into E from (select id, ordem from roteiro_etapas where produto_id = v_prod order by ordem, id limit 3) t;
  select id into v_outra from roteiro_etapas where produto_id <> v_prod order by id limit 1;

  -- (1) a permissão específica existe no CHECK
  insert into usuario_permissoes (usuario_id, permissao) select id, 'escala_wip_confirmar' from usuarios where id <> v_adm limit 1 on conflict do nothing;

  -- (2) criar controle: ok; não consecutivas, etapa de outro produto e duplicado são recusados
  v_c := public.wip_controle_criar(v_adm, v_prod, E[1], E[2], '2026-10-05', 100);
  if (select saldo_inicial from wip_controle where id = v_c) <> 100 then raise exception 'FALHOU (2) saldo inicial'; end if;
  begin perform public.wip_controle_criar(v_adm, v_prod, E[1], E[3], '2026-10-05', 0); v_ok := false;
  exception when others then v_ok := position('WIP_ETAPAS_NAO_CONSECUTIVAS' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (2a) não consecutivas'; end if;
  begin perform public.wip_controle_criar(v_adm, v_prod, E[1], v_outra, '2026-10-05', 0); v_ok := false;
  exception when others then v_ok := position('WIP_ETAPA_INVALIDA' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (2b) etapa de outro produto'; end if;
  begin perform public.wip_controle_criar(v_adm, v_prod, E[1], E[2], '2026-10-05', 0); v_ok := false;
  exception when unique_violation then v_ok := true; end;
  if not v_ok then raise exception 'FALHOU (2c) par duplicado'; end if;
  begin perform public.wip_controle_criar(v_adm, v_prod, E[2], E[3], '2026-10-05', -1); v_ok := false;
  exception when others then v_ok := position('WIP_SALDO_INICIAL_NEGATIVO' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (2d) saldo inicial negativo'; end if;
  v_c2 := public.wip_controle_criar(v_adm, v_prod, E[2], E[3], '2026-10-05', 0);

  -- (3) ajuste: motivo obrigatório, zero recusado, data válida, idempotente
  begin perform public.wip_ajustar(v_adm, v_c, '2026-10-10', -400, '  '); v_ok := false;
  exception when others then v_ok := position('WIP_MOTIVO_OBRIGATORIO' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (3a) motivo'; end if;
  begin perform public.wip_ajustar(v_adm, v_c, '2026-10-10', 0, 'x contagem'); v_ok := false;
  exception when others then v_ok := position('WIP_AJUSTE_ZERO' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (3b) zero'; end if;
  begin perform public.wip_ajustar(v_adm, v_c, '2026-10-01', -1, 'antes do início'); v_ok := false;
  exception when others then v_ok := position('WIP_DATA_INVALIDA' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (3c) data antes do início'; end if;
  v_id := public.wip_ajustar(v_adm, v_c, '2026-10-10', -400, 'contagem física', v_chave);
  v_id2 := public.wip_ajustar(v_adm, v_c, '2026-10-10', -400, 'contagem física', v_chave);
  if v_id <> v_id2 or (select count(*) from wip_ajustes where controle_id = v_c) <> 1 then raise exception 'FALHOU (3d) idempotência do ajuste'; end if;

  -- (4) confirmação: divergência exige motivo; negativa recusada; idempotente; guarda o estimado do momento
  begin perform public.wip_confirmar(v_adm, v_c, '2026-10-10', 9200, 9600, null); v_ok := false;
  exception when others then v_ok := position('WIP_MOTIVO_OBRIGATORIO' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (4a) motivo na divergência'; end if;
  begin perform public.wip_confirmar(v_adm, v_c, '2026-10-10', -5, 0, 'x contagem'); v_ok := false;
  exception when others then v_ok := position('WIP_QUANTIDADE_INVALIDA' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (4b) negativa'; end if;
  begin perform public.wip_confirmar(v_adm, v_c, '2099-01-01', 1, 1, null); v_ok := false;
  exception when others then v_ok := position('WIP_DATA_INVALIDA' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (4c) data futura'; end if;
  v_chave := gen_random_uuid();
  v_id := public.wip_confirmar(v_adm, v_c, '2026-10-10', 9200, 9600, 'contagem física', v_chave);
  v_id2 := public.wip_confirmar(v_adm, v_c, '2026-10-10', 9200, 9600, 'contagem física', v_chave);
  if v_id <> v_id2 or (select count(*) from wip_confirmacoes where controle_id = v_c) <> 1 then raise exception 'FALHOU (4d) idempotência da confirmação'; end if;
  perform public.wip_confirmar(v_adm, v_c, '2026-10-11', 9600, 9600, null);   -- igual ao estimado: sem motivo

  -- (5) histórico imutável
  begin update wip_ajustes set quantidade = 1 where controle_id = v_c; v_ok := false; exception when others then v_ok := position('WIP_HISTORICO_IMUTAVEL' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (5a) update ajuste'; end if;
  begin delete from wip_confirmacoes where controle_id = v_c; v_ok := false; exception when others then v_ok := position('WIP_HISTORICO_IMUTAVEL' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (5b) delete confirmação'; end if;
  begin update wip_controle set saldo_inicial = 5 where id = v_c; v_ok := false; exception when others then v_ok := position('WIP_HISTORICO_IMUTAVEL' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (5c) saldo inicial imutável'; end if;
  begin delete from wip_controle where id = v_c; v_ok := false; exception when others then v_ok := position('WIP_HISTORICO_IMUTAVEL' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (5d) controle não apaga'; end if;
  perform public.wip_controle_ativar(v_adm, v_c2, false);
  if (select ativo from wip_controle where id = v_c2) then raise exception 'FALHOU (5e) desativar'; end if;
  begin perform public.wip_ajustar(v_adm, v_c2, '2026-10-10', 5, 'em controle inativo'); v_ok := false; exception when others then v_ok := position('WIP_CONTROLE_INATIVO' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (5f) ajuste em inativo'; end if;
  perform public.wip_controle_ativar(v_adm, v_c2, true);

  -- (6) foto semanal: idempotente; a 1ª gravada vale; nunca atualiza
  v_n := public.wip_gravar_snapshots('2026-10-26', jsonb_build_array(jsonb_build_object('controle_id', v_c, 'saldo_estimado', 9600, 'saldo_confirmado_disponivel', 9200, 'saldo_alocado', 9200)));
  if v_n <> 1 then raise exception 'FALHOU (6a) 1ª foto: %', v_n; end if;
  v_n := public.wip_gravar_snapshots('2026-10-26', jsonb_build_array(jsonb_build_object('controle_id', v_c, 'saldo_estimado', 1, 'saldo_confirmado_disponivel', 1, 'saldo_alocado', 1)));
  if v_n <> 0 then raise exception 'FALHOU (6b) 2ª foto deveria ser ignorada: %', v_n; end if;
  if (select saldo_alocado from wip_saldo_semanal where semana_inicio = '2026-10-26' and controle_id = v_c) <> 9200 then raise exception 'FALHOU (6c) a 1ª foto deve valer'; end if;
  begin update wip_saldo_semanal set saldo_alocado = 0 where controle_id = v_c; v_ok := false; exception when others then v_ok := position('WIP_HISTORICO_IMUTAVEL' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (6d) foto imutável'; end if;
  if (select produto_id from wip_saldo_semanal where controle_id = v_c) <> v_prod then raise exception 'FALHOU (6e) cópia do produto'; end if;

  -- (7) o navegador (authenticated) NÃO escreve nem executa as RPCs; admin só lê
  perform set_config('request.jwt.claims', json_build_object('sub', 'f0c30e9b-68b6-4529-ad1e-3a1887dcdebe', 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin insert into wip_ajustes (controle_id, data, quantidade, motivo) values (v_c, '2026-10-10', 1, 'direto do navegador'); v_ok := false; exception when others then v_ok := position('permission denied' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (7a) escrita direta deveria ser negada'; end if;
  begin perform public.wip_confirmar(v_adm, v_c, '2026-10-10', 1, 1, null); v_ok := false; exception when others then v_ok := position('permission denied' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (7b) RPC só para o servidor'; end if;
  reset role;

  -- (8) eventos: com WIP desligado não recalcula; ligado, registra para a semana com escala futura
  select valor into v_modo_antes from escala_parametros where chave = 'wip_modo';
  update escala_parametros set valor = '"desligado"' where chave = 'wip_modo';
  select count(*) into v_ev0 from escala_producao_eventos;
  perform public.wip_ajustar(v_adm, v_c, '2026-10-12', 10, 'sem efeito no motor');
  select count(*) into v_ev1 from escala_producao_eventos;
  if v_ev1 <> v_ev0 then raise exception 'FALHOU (8a) WIP desligado não deve gerar eventos'; end if;
  update escala_parametros set valor = '"ativo"' where chave = 'wip_modo';
  select count(*) into v_ev0 from escala_producao_eventos;
  perform public.wip_ajustar(v_adm, v_c, '2026-10-13', 10, 'com WIP ativo');
  select count(*) into v_ev1 from escala_producao_eventos;
  raise notice 'eventos com WIP ativo: % -> % (depende de haver escala futura no DEV)', v_ev0, v_ev1;

  raise exception 'TESTE_OK T9: controle WIP — criação/validações, ajuste, confirmação, imutabilidade, foto semanal idempotente, grants e eventos (tudo desfeito)';
end $$;
