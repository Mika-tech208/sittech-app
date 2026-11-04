-- STUBS mínimos do esquema real, só para o teste local da migration 20261110100000 (nunca aplicar em banco real).
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
end $$;
create table usuarios(id uuid primary key default gen_random_uuid(), nome text);
create table produtos(id uuid primary key default gen_random_uuid());
create table roteiro_etapas(id uuid primary key default gen_random_uuid());
create table maquinas(id uuid primary key default gen_random_uuid());
create table previsoes(id uuid primary key default gen_random_uuid(), semana_inicio date unique);
create table usuario_permissoes(permissao text, constraint usuario_permissoes_permissao_check check (permissao in ('financeiro','escala_relatorios')));
create table escala_parametros(chave text primary key, valor jsonb not null, grupo text not null, descricao text);
create table escala_producao_eventos(id uuid primary key default gen_random_uuid(), criado_em timestamptz default now(), tipo text not null, previsao_id uuid, payload jsonb default '{}', usuario_id uuid, status text not null default 'pendente', chave text, ultimo_lancamento_em timestamptz, lancamentos int default 0, processado_em timestamptz, tentativas int not null default 0, iniciado_em timestamptz,
  constraint escala_producao_eventos_tipo_check check (tipo in ('ausencia','previsao','geracao_manual','geracao_semanal','apontamento_periodo','recalculo','edicao_manual')));
create table apontamentos_producao(id uuid primary key default gen_random_uuid(), data date not null, periodo_id text not null, criado_por uuid not null, quantidade_produzida numeric default 0, maquina_id uuid);
create table apontamento_paradas(apontamento_id uuid, motivo_id uuid, minutos numeric);
create table escala_producao_dias(data date primary key, previsao_id uuid, periodos_snapshot jsonb not null);
create function is_admin() returns boolean language sql as 'select true';
create function has_permissao(text) returns boolean language sql as 'select true';
-- cópia fiel da função de PROD (20261020190000): a migration a ALTERA pela própria definição
create function escala_reivindicar_eventos(p_limite integer default 50)
returns setof public.escala_producao_eventos
language sql
security invoker
set search_path = public, pg_temp
as $$
  with candidatos as (
    select id
    from escala_producao_eventos
    where tipo in ('ausencia', 'previsao', 'recurso_bloqueado', 'recurso_liberado', 'geracao_manual', 'geracao_semanal')
      and (
        status = 'pendente'
        or (status = 'erro' and tentativas < 3)
        or (status = 'processando' and iniciado_em < now() - interval '5 minutes')
      )
    order by criado_em
    limit greatest(1, least(coalesce(p_limite, 50), 200))
    for update skip locked
  )
  update escala_producao_eventos e
     set status = 'processando', tentativas = e.tentativas + 1, iniciado_em = now()
    from candidatos c
   where e.id = c.id
  returning e.*;
$$;

-- cópia mínima da função de PROD só no que importa: a GUARDA DO HISTÓRICO (a migration a ALTERA pela própria definição)
create function escala_aplicar_recalculo(p_a_partir_data date, p_a_partir_periodo text) returns text language plpgsql as $$
declare v_inicio_corte timestamptz := ((p_a_partir_data + time '07:12') at time zone 'America/Sao_Paulo');
begin
  if v_inicio_corte <= now() then raise exception 'ESCALA_CORTE_NO_PASSADO: o período % de % já começou', p_a_partir_periodo, p_a_partir_data; end if;
  return 'ok';
end $$;

-- gatilho de parâmetros de PROD (forma da função e do gatilho): qualquer chave desconhecida enfileira um recálculo ('previsao'); a migration ALTERA a função pela própria definição
create function escala_trg_parametros() returns trigger language plpgsql as $$
declare
  v_chave text := coalesce(new.chave, old.chave);
begin
  if v_chave in ('replanejamento_modo', 'replanejamento_semanas_ativas') then
    return null;
  end if;
  insert into escala_producao_eventos (tipo, payload) values ('previsao', jsonb_build_object('chave', v_chave));
  return null;
end;
$$;
create trigger trg_escala_parametros_evento after insert or delete or update on escala_parametros for each row execute function escala_trg_parametros();
