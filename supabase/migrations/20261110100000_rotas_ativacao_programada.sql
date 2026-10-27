-- ATIVAÇÃO PROGRAMADA do modelo de rotas por SEMANA DE INÍCIO — fail closed, sem cron, idempotente.
-- A liberação é DETERMINADA pela própria configuração e pela data/semana de cada artefato (Previsão, apontamento, WIP), não por alguém ligar uma flag:
--   semana < rotas_config.ativo_desde  ⇒ fechado;   semana >= ativo_desde  ⇒ elegível, SE todas as validações críticas passarem (`rotas_validar_prontidao`) e now() >= ativo_desde.
-- Falha em qualquer validação crítica ⇒ o modelo NÃO abre (os produtos legados continuam normais) e o motivo é registrado/exibido.
-- `suporte_ativo` continua existindo como CHAVE MANUAL de emergência/teste (padrão false): não é necessária para a virada programada.

alter table public.rotas_config add column if not exists ativo_desde timestamptz;
comment on column public.rotas_config.ativo_desde is 'Instante a partir do qual o modelo de rotas pode ser liberado (a semana que contém a data é a primeira elegível). NULL = nunca por programação. A liberação ainda depende das validações de rotas_validar_prontidao().';

-- Registro das verificações/ativações (append-only; só entra linha quando o estado ou o motivo MUDA — idempotente)
create table if not exists public.rotas_ativacao_log (
  id bigserial primary key,
  criado_em timestamptz not null default now(),
  evento text not null,                    -- 'programacao' | 'verificacao' | 'ativacao'
  liberado boolean not null,
  motivo text not null default '',
  detalhes jsonb not null default '{}'::jsonb
);
drop trigger if exists trg_rotas_ativacao_log_imutavel on public.rotas_ativacao_log;
create trigger trg_rotas_ativacao_log_imutavel before update or delete on public.rotas_ativacao_log for each row execute function public.escala_sombra_trg_imutavel();
alter table public.rotas_ativacao_log enable row level security;
drop policy if exists rotas_ativacao_log_select on public.rotas_ativacao_log;
create policy rotas_ativacao_log_select on public.rotas_ativacao_log for select to authenticated using (public.is_admin() or public.has_permissao('produtos'));
revoke all on public.rotas_ativacao_log from anon, authenticated;
grant select on public.rotas_ativacao_log to authenticated, service_role;

-- =========================================================================
-- Validação de prontidão (fail closed). Só LÊ.
-- =========================================================================
create or replace function public.rotas_validar_prontidao()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_checks jsonb := '[]'::jsonb;
  v_ok boolean; v_det text; r record; v_n int; v_total int := 0; v_desde date;
  c_tabelas constant text[] := array['produto_rota', 'rota_etapas', 'produto_pool_comum', 'previsao_rota_limite', 'escala_rota_divisao', 'produto_variante_legada', 'rotas_config', 'rotas_ativacao_log', 'rotas_planejador_sombra'];
  c_funcoes constant text[] := array['produto_estrutura_rotas', 'produto_etapa_final', 'produto_usa_rotas', 'produto_arestas_rotas', 'etapa_grupo_rota', 'produto_rotas_validar', 'produto_rotas_maquinas_ambiguas', 'rotas_cobertura_apontamentos', 'etapas_do_percurso', 'wip_controle_criar', 'obter_indicadores_producao', 'obter_apontado_real_previsao_por_semana', 'calcular_valor_atribuido_operacao'];
begin
  -- 1) esquema: tabelas e funções do modelo presentes
  select count(*) into v_n from unnest(c_tabelas) t where to_regclass('public.' || t) is null;
  v_ok := v_n = 0; v_det := case when v_ok then 'ok' else v_n || ' tabela(s) do modelo ausente(s)' end;
  select count(*) into v_n from unnest(c_funcoes) f where not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = f);
  if v_n > 0 then v_ok := false; v_det := v_det || '; ' || v_n || ' função(ões) ausente(s)'; end if;
  v_checks := v_checks || jsonb_build_object('id', 'esquema', 'ok', v_ok, 'detalhe', v_det);
  if not v_ok then return jsonb_build_object('ok', false, 'checks', v_checks); end if;   -- sem o esquema não dá para continuar

  -- 2) configuração
  v_ok := exists (select 1 from rotas_config where id);
  v_checks := v_checks || jsonb_build_object('id', 'config', 'ok', v_ok, 'detalhe', case when v_ok then 'ok' else 'rotas_config sem linha' end);

  -- 3) produto de rotas existente
  select count(distinct produto_id) into v_total from produto_rota;
  v_checks := v_checks || jsonb_build_object('id', 'produto_de_rotas', 'ok', v_total >= 1, 'detalhe', case when v_total >= 1 then v_total || ' produto(s) de rotas' else 'nenhum produto de rotas cadastrado' end);

  -- 4) estrutura válida, rotas, pool comum e etapa final (por produto de rotas)
  v_ok := v_total >= 1; v_det := 'ok';
  for r in select distinct produto_id from produto_rota loop
    begin
      perform public.produto_rotas_validar(r.produto_id);
      if public.produto_etapa_final(r.produto_id) is null then raise exception 'sem etapa final'; end if;
      if (select count(*) from produto_rota where produto_id = r.produto_id and ativa) < 2 then raise exception 'menos de 2 rotas ativas'; end if;
      if not exists (select 1 from produto_pool_comum where produto_id = r.produto_id and final) then raise exception 'fluxo comum sem etapa final'; end if;
    exception when others then v_ok := false; v_det := 'produto ' || r.produto_id || ': ' || sqlerrm;
    end;
  end loop;
  v_checks := v_checks || jsonb_build_object('id', 'estrutura', 'ok', v_ok, 'detalhe', v_det);

  -- 5) máquinas ambíguas = 0 (uma máquina em duas etapas do mesmo produto deixaria o apontamento sem saber a operação)
  v_n := 0;
  for r in select distinct produto_id from produto_rota loop v_n := v_n + (select count(*) from public.produto_rotas_maquinas_ambiguas(r.produto_id)); end loop;
  v_checks := v_checks || jsonb_build_object('id', 'maquinas_ambiguas', 'ok', v_n = 0, 'detalhe', case when v_n = 0 then '0 ambiguidades' else v_n || ' máquina(s) em mais de uma etapa' end);

  -- 6) vínculo com os produtos legados (histórico/relatórios)
  select count(*) into v_n from (select distinct produto_id from produto_rota) p where not exists (select 1 from produto_variante_legada v where v.produto_final_id = p.produto_id);
  v_checks := v_checks || jsonb_build_object('id', 'variantes_legadas', 'ok', v_n = 0, 'detalhe', case when v_n = 0 then 'ok' else v_n || ' produto(s) de rotas sem vínculo com o legado' end);

  -- 7) produtos legados NÃO podem estar em Previsão de semana do modelo de rotas
  select (ativo_desde at time zone 'America/Sao_Paulo')::date into v_desde from rotas_config where id;
  if v_desde is not null then
    select count(*) into v_n from previsao_itens i join previsoes p on p.id = i.previsao_id join produto_variante_legada v on v.produto_legado_id = i.produto_id where p.semana_inicio >= v_desde;
  else v_n := 0; end if;
  v_checks := v_checks || jsonb_build_object('id', 'legados_fora_da_semana_de_rotas', 'ok', v_n = 0, 'detalhe', case when v_n = 0 then 'ok' else v_n || ' item(ns) de produto legado em semana >= início do modelo: remova-os para liberar' end);

  return jsonb_build_object('ok', not exists (select 1 from jsonb_array_elements(v_checks) c where not (c->>'ok')::boolean), 'checks', v_checks);
end;
$$;

-- Liberação PROGRAMADA (sem a chave manual): é o que decide se a SEMANA é do modelo de rotas sem ninguém ligar flag
create or replace function public.rotas_semana_programada(p_data date)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare v_cfg record; v_desde date;
begin
  select * into v_cfg from rotas_config where id;
  if v_cfg is null or v_cfg.ativo_desde is null or now() < v_cfg.ativo_desde then return false; end if;
  v_desde := (v_cfg.ativo_desde at time zone 'America/Sao_Paulo')::date;
  if p_data is null or p_data < v_desde then return false; end if;
  return coalesce((public.rotas_validar_prontidao() ->> 'ok')::boolean, false);   -- FAIL CLOSED
end;
$$;

-- Liberado = chave MANUAL (emergência/teste; em PROD fica false) OU programação válida
create or replace function public.rotas_liberado(p_data date)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$ select coalesce((select suporte_ativo from public.rotas_config where id), false) or public.rotas_semana_programada(p_data) $$;

create or replace function public.rotas_motivo_bloqueio(p_data date)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare v_cfg record; v_desde date; v_val jsonb; v_falhas text;
begin
  select * into v_cfg from rotas_config where id;
  if v_cfg is null then return 'rotas_config ausente'; end if;
  if v_cfg.suporte_ativo then return ''; end if;
  if v_cfg.ativo_desde is null then return 'o modelo de rotas não está programado (rotas_config.ativo_desde vazio)'; end if;
  v_desde := (v_cfg.ativo_desde at time zone 'America/Sao_Paulo')::date;
  if now() < v_cfg.ativo_desde then return 'o modelo de rotas só abre a partir de ' || to_char(v_cfg.ativo_desde at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI'); end if;
  if p_data is null or p_data < v_desde then return 'data/semana anterior ao início do modelo de rotas (' || to_char(v_desde, 'DD/MM/YYYY') || ')'; end if;
  v_val := public.rotas_validar_prontidao();
  if (v_val ->> 'ok')::boolean then return ''; end if;
  select string_agg((c ->> 'id') || ': ' || (c ->> 'detalhe'), '; ') into v_falhas from jsonb_array_elements(v_val -> 'checks') c where not (c ->> 'ok')::boolean;
  return 'validação crítica falhou — ' || coalesce(v_falhas, '?');
end;
$$;

create or replace function public.rotas_suporte_ativo()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$ select public.rotas_liberado((now() at time zone 'America/Sao_Paulo')::date) $$;

-- Estado para a interface (leitura pura): semana consultada (padrão: hoje)
create or replace function public.rotas_estado_ativacao(p_semana date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare v_cfg record; v_data date := coalesce(p_semana, (now() at time zone 'America/Sao_Paulo')::date); v_val jsonb;
begin
  select * into v_cfg from rotas_config where id;
  v_val := case when to_regclass('public.produto_rota') is not null then public.rotas_validar_prontidao() else jsonb_build_object('ok', false, 'checks', '[]'::jsonb) end;
  return jsonb_build_object(
    'programado', v_cfg.ativo_desde is not null, 'desde', v_cfg.ativo_desde, 'desdeData', (v_cfg.ativo_desde at time zone 'America/Sao_Paulo')::date,
    'agora', now(), 'dataConsultada', v_data, 'suporteManual', coalesce(v_cfg.suporte_ativo, false),
    'liberado', public.rotas_liberado(v_data), 'motivo', public.rotas_motivo_bloqueio(v_data), 'validacao', v_val);
end;
$$;

-- Ativação on-demand, IDEMPOTENTE: quando o modelo está liberado, deixa o produto de rotas ATIVO (necessário para a UX atual) e registra. Pode ser chamada quantas vezes for: mesmo resultado, nenhuma duplicação.
-- Nunca cria Previsão, WIP, máquinas nem quantidades. Se a validação falhar: não faz nada além de registrar o motivo (uma vez por mudança de estado).
create or replace function public.rotas_ativacao_aplicar()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare v_est jsonb; v_lib boolean; v_motivo text; v_n int := 0; v_ult record;
begin
  v_est := public.rotas_estado_ativacao(null);
  v_lib := (v_est ->> 'liberado')::boolean; v_motivo := coalesce(v_est ->> 'motivo', '');
  if v_lib then
    update produtos set ativo = true where ativo = false and exists (select 1 from produto_rota r where r.produto_id = produtos.id);
    get diagnostics v_n = row_count;
  end if;
  select * into v_ult from rotas_ativacao_log order by id desc limit 1;
  if v_ult is null or v_ult.liberado is distinct from v_lib or v_ult.motivo is distinct from v_motivo or v_n > 0 then
    insert into rotas_ativacao_log (evento, liberado, motivo, detalhes) values (case when v_n > 0 then 'ativacao' else 'verificacao' end, v_lib, v_motivo, jsonb_build_object('produtosAtivados', v_n, 'validacao', v_est -> 'validacao'));
  end if;
  return v_est || jsonb_build_object('produtosAtivados', v_n);
end;
$$;

revoke all on function public.rotas_validar_prontidao(), public.rotas_semana_programada(date), public.rotas_liberado(date), public.rotas_motivo_bloqueio(date), public.rotas_estado_ativacao(date), public.rotas_ativacao_aplicar() from public, anon;
grant execute on function public.rotas_validar_prontidao(), public.rotas_semana_programada(date), public.rotas_liberado(date), public.rotas_motivo_bloqueio(date), public.rotas_estado_ativacao(date), public.rotas_ativacao_aplicar() to authenticated, service_role;
revoke all on function public.rotas_suporte_ativo() from public, anon;
grant execute on function public.rotas_suporte_ativo() to authenticated, service_role;

-- =========================================================================
-- GUARDS por DATA/SEMANA do artefato (substituem a trava global): produto de rotas só entra em Previsão, apontamento e WIP de semana liberada
-- =========================================================================
create or replace function public.rotas_guard_apontamento()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if exists (select 1 from public.produto_rota where produto_id = new.produto_id) and not public.rotas_liberado(new.data) then
    raise exception 'PRODUTO_DE_ROTAS_FORA_DE_USO: apontamento de produto de rotas bloqueado — %', public.rotas_motivo_bloqueio(new.data);
  end if;
  return new;
end;
$$;
create or replace function public.rotas_guard_wip()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  -- o controle pode começar no DIA DA CONTAGEM DA VIRADA (véspera da 1ª semana do modelo): vale a data do dia seguinte
  if exists (select 1 from public.produto_rota where produto_id = new.produto_id) and not public.rotas_liberado(new.data_inicio + 1) then
    raise exception 'PRODUTO_DE_ROTAS_FORA_DE_USO: WIP de produto de rotas bloqueado — %', public.rotas_motivo_bloqueio(new.data_inicio + 1);
  end if;
  return new;
end;
$$;
drop trigger if exists trg_produto_de_rotas_guard on public.apontamentos_producao;
drop trigger if exists trg_produto_de_rotas_guard on public.wip_controle;
create trigger trg_produto_de_rotas_guard before insert on public.apontamentos_producao for each row execute function public.rotas_guard_apontamento();
create trigger trg_produto_de_rotas_guard before insert on public.wip_controle for each row execute function public.rotas_guard_wip();

-- Previsão: a semana é do modelo de rotas quando a flag está ligada OU quando está liberada pela programação (derivado — ninguém precisa ligar nada)
create or replace function public.previsao_itens_trg_modelo_rotas()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare v_mod boolean; v_semana date; v_motivo text;
begin
  select modelo_rotas, semana_inicio into v_mod, v_semana from previsoes where id = new.previsao_id;
  v_mod := coalesce(v_mod, false) or public.rotas_semana_programada(v_semana);   -- a semana é do modelo pela flag OU pela programação (a chave manual sozinha não muda a semana)
  if v_mod then
    if exists (select 1 from produto_variante_legada where produto_legado_id = new.produto_id) then
      raise exception 'PREVISAO_MODELO_ROTAS_PRODUTO_LEGADO: esta semana usa o modelo de rotas; o produto legado % não pode entrar (use o produto final)', new.produto_nome;
    end if;
  else
    if exists (select 1 from produto_rota where produto_id = new.produto_id) then
      v_motivo := public.rotas_motivo_bloqueio(v_semana);
      raise exception 'PREVISAO_PRODUTO_DE_ROTAS_EM_SEMANA_LEGADA: o produto % só pode ser usado em semana com modelo de rotas liberado (%)', new.produto_nome, v_motivo;
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.previsoes_trg_modelo_rotas()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.modelo_rotas and not public.rotas_liberado(new.semana_inicio) then
    raise exception 'PREVISAO_MODELO_ROTAS_BLOQUEADO: o modelo de rotas não está liberado para esta semana (%)', public.rotas_motivo_bloqueio(new.semana_inicio);
  end if;
  if new.modelo_rotas and exists (select 1 from previsao_itens i join produto_variante_legada v on v.produto_legado_id = i.produto_id where i.previsao_id = new.id) then
    raise exception 'PREVISAO_MODELO_ROTAS_ITENS_LEGADOS: a semana já tem itens de produtos legados; não é possível ativar o modelo de rotas sem convertê-los';
  end if;
  if not new.modelo_rotas and exists (select 1 from previsao_itens i join produto_rota r on r.produto_id = i.produto_id where i.previsao_id = new.id) then
    raise exception 'PREVISAO_MODELO_ROTAS_ITENS_DE_ROTAS: a semana tem itens de produto de rotas; não é possível voltar ao modelo legado';
  end if;
  return new;
end;
$$;
drop function if exists public.produto_de_rotas_guard();
notify pgrst, 'reload schema';
