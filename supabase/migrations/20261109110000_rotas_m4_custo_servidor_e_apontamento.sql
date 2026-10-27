-- M4 (DEV/Preview) — (1) leitura de custo/hora pelo SERVIDOR (mesma fonte da tela) e (2) coerência produto×etapa nos apontamentos de PRODUTO DE ROTAS.

-- (1) o orquestrador da Escala (service_role) passa a LER os cadastros que compõem o custo/hora; só SELECT, nenhuma escrita
grant select on public.funcionarios, public.funcionario_custos, public.fixed_costs, public.categorias, public.configuracoes_empresa, public.periodos, public.operacoes to service_role;

-- (2) Apontamento de produto de ROTAS: a etapa precisa pertencer ao produto (o operador nunca escolhe a rota; ela vem da etapa). As RPCs já derivam a etapa por produto×máquina, mas nada impedia
-- um INSERT/UPDATE direto com etapa de outro produto. Produto LINEAR: o gatilho não faz nada (o roteiro de produto linear pode mudar depois do apontamento — comportamento preservado).
create or replace function public.apontamentos_trg_etapa_do_produto_rotas() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.produto_id is not null and new.etapa_id is not null and public.produto_usa_rotas(new.produto_id) then
    if not exists (select 1 from public.roteiro_etapas e where e.id = new.etapa_id and e.produto_id = new.produto_id) then
      raise exception 'APONTAMENTO_ETAPA_FORA_DO_PRODUTO: a etapa % não pertence ao produto de rotas %', new.etapa_id, new.produto_id;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_apontamentos_etapa_do_produto_rotas on public.apontamentos_producao;
create trigger trg_apontamentos_etapa_do_produto_rotas before insert or update of produto_id, etapa_id on public.apontamentos_producao for each row execute function public.apontamentos_trg_etapa_do_produto_rotas();

-- Diagnóstico: máquina elegível a mais de uma etapa do MESMO produto de rotas tornaria o apontamento ambíguo (a RPC deriva a etapa por produto×máquina). Deve devolver 0 linhas.
create or replace function public.produto_rotas_maquinas_ambiguas(p_produto uuid)
returns table(maquina_id uuid, n_etapas integer) language sql stable set search_path = public, pg_temp as $$
  select rem.maquina_id, count(distinct e.id)::integer from public.roteiro_etapas e join public.roteiro_etapa_maquinas rem on rem.etapa_id = e.id
   where e.produto_id = p_produto group by rem.maquina_id having count(distinct e.id) > 1;
$$;
grant execute on function public.produto_rotas_maquinas_ambiguas(uuid) to authenticated, service_role;

-- (3) ADICIONAL / WIP planejado de produto de ROTAS: a regra legada exige adicional não crescente por `ordem` e "acabado = maior ordem", o que é FALSO para F (a AUTO herdaria o limite da CONV).
-- A etapa já identifica a quem o adicional pertence (CONV, AUTO ou fluxo comum), mas a validação por percurso (convergência) só entra com o WIP oficial de F: até lá o banco RECUSA adicional em produto de rotas,
-- em vez de aceitar um valor validado pela regra errada. Produto linear: nada muda.
create or replace function public.previsao_itens_trg_adicional_rotas() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if coalesce(new.quantidade_adicional, 0) > 0 and public.produto_usa_rotas(new.produto_id) then
    raise exception 'ROTAS_ADICIONAL_NAO_SUPORTADO: carga adicional de produto de rotas ainda não é suportada (a validação por ordem não vale para o percurso CONV/AUTO/fluxo comum)';
  end if;
  return new;
end $$;
drop trigger if exists trg_previsao_itens_adicional_rotas on public.previsao_itens;
create trigger trg_previsao_itens_adicional_rotas before insert or update of quantidade_adicional on public.previsao_itens for each row execute function public.previsao_itens_trg_adicional_rotas();

create or replace function public.previsao_item_adicional_etapa_trg_rotas() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.quantidade > 0 and exists (select 1 from public.previsao_itens i where i.id = new.item_id and public.produto_usa_rotas(i.produto_id)) then
    raise exception 'ROTAS_ADICIONAL_NAO_SUPORTADO: adicional por etapa de produto de rotas ainda não é suportado';
  end if;
  return new;
end $$;
drop trigger if exists trg_previsao_item_adicional_etapa_rotas on public.previsao_item_adicional_etapa;
create trigger trg_previsao_item_adicional_etapa_rotas before insert or update on public.previsao_item_adicional_etapa for each row execute function public.previsao_item_adicional_etapa_trg_rotas();

-- 4) Valor atribuído a uma operação (paradas/produção não realizada): o peso de uma operação é seu custo padrão ÷ a soma do custo padrão das etapas do PERCURSO da peça — nunca das duas rotas juntas.
-- Etapa exclusiva de uma rota: percurso = trecho exclusivo dessa rota + fluxo comum. Etapa do fluxo comum (sem rota definida): percurso da rota PREFERIDA (menor `preferencia`). Produto linear: todas as etapas (idêntico).
create or replace function public.etapas_do_percurso(p_produto uuid, p_operacao uuid)
returns setof uuid language sql stable set search_path = public, pg_temp as $$
  with rota_da_op as (
    select re.rota_id from public.rota_etapas re join public.roteiro_etapas e on e.id = re.etapa_id join public.produto_rota r on r.id = re.rota_id
     where r.produto_id = p_produto and e.operacao_id = p_operacao limit 1),
  rota_escolhida as (
    select coalesce((select rota_id from rota_da_op), (select id from public.produto_rota where produto_id = p_produto order by preferencia, codigo limit 1)) as rota_id)
  select re.etapa_id from public.rota_etapas re join rota_escolhida r on r.rota_id = re.rota_id
  union select pc.etapa_id from public.produto_pool_comum pc where pc.produto_id = p_produto;
$$;
grant execute on function public.etapas_do_percurso(uuid, uuid) to authenticated, service_role;

create or replace function public.calcular_valor_atribuido_operacao(
  p_produto_id uuid,
  p_operacao_id uuid,
  p_periodo_id text
)
returns numeric
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  v_duracao_horas numeric;
  v_qtd_etapas int;
  v_soma_custo_padrao numeric := 0;
  v_custo_padrao_operacao numeric;
  v_valor_unitario numeric;
  v_etapa record;
  v_custo_hora numeric;
  v_custo_padrao numeric;
  v_resolvivel boolean := true;
begin
  if p_produto_id is null or p_operacao_id is null or p_periodo_id is null then
    return null;
  end if;

  select extract(epoch from (fim - inicio)) / 3600 into v_duracao_horas
  from public.periodos where id = p_periodo_id;

  if v_duracao_horas is null or v_duracao_horas <= 0 then
    return null;
  end if;

  select count(*) into v_qtd_etapas from public.roteiro_etapas where produto_id = p_produto_id and (not public.produto_usa_rotas(p_produto_id) or id in (select public.etapas_do_percurso(p_produto_id, p_operacao_id)));
  if v_qtd_etapas = 0 then
    return null;
  end if;

  for v_etapa in
    select operacao_id,
      case p_periodo_id
        when 'm1' then meta_m1 when 'm2' then meta_m2 when 'm3' then meta_m3
        when 't1' then meta_t1 when 't2' then meta_t2 when 't3' then meta_t3
        else null
      end as meta
    from public.roteiro_etapas
    where produto_id = p_produto_id
      and (not public.produto_usa_rotas(p_produto_id) or id in (select public.etapas_do_percurso(p_produto_id, p_operacao_id)))   -- produto de ROTAS: só o percurso (trecho da rota + fluxo comum); linear: todas as etapas, como sempre
  loop
    -- qualquer etapa do roteiro sem meta cadastrada pra este período
    -- específico torna o peso inteiro não confiável — melhor NULL que
    -- um cálculo parcial/distorcido.
    if v_etapa.meta is null or v_etapa.meta <= 0 then
      v_resolvivel := false;
      exit;
    end if;

    v_custo_hora := public.calcular_custo_hora_operacao_vigente(v_etapa.operacao_id);
    if v_custo_hora is null then
      v_resolvivel := false;
      exit;
    end if;

    v_custo_padrao := v_custo_hora * v_duracao_horas / v_etapa.meta;
    v_soma_custo_padrao := v_soma_custo_padrao + v_custo_padrao;

    if v_etapa.operacao_id = p_operacao_id then
      v_custo_padrao_operacao := v_custo_padrao;
    end if;
  end loop;

  -- p_operacao_id não bateu com nenhuma etapa do roteiro (ambíguo/não
  -- resolvido a montante) — nunca escolhe arbitrariamente, retorna NULL.
  if not v_resolvivel or v_custo_padrao_operacao is null or v_soma_custo_padrao <= 0 then
    return null;
  end if;

  select valor_unitario into v_valor_unitario from public.produtos where id = p_produto_id;
  if v_valor_unitario is null then
    return null;
  end if;

  return v_valor_unitario * (v_custo_padrao_operacao / v_soma_custo_padrao);
end;
$$;

revoke all on function public.calcular_valor_atribuido_operacao(uuid, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.calcular_valor_atribuido_operacao(uuid, uuid, text) to authenticated;
