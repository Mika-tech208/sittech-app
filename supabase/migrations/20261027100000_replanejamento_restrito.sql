-- Sittech — Escala de Produção, REPLANEJAMENTO DINÂMICO RESTRITO (modo `ativo_restrito`).
--
-- Primeira versão ATIVA e RESTRITA: depois de cada período fechado, a sombra calcula a decisão (snapshot) e — SÓ nas semanas autorizadas
-- (`replanejamento_semanas_ativas`) e com o modo `ativo_restrito` — o servidor aplica à Escala oficial APENAS os períodos alteráveis (c+2 em
-- diante; o comprometido só no reparo mínimo). Segurança:
--   • o PORTÃO é no banco: a RPC recusa se o modo não for ativo_restrito ou a semana não estiver autorizada;
--   • concorrência otimista: usa escala_aplicar_recalculo (versão de cada dia) — se a Escala mudou entre a decisão e a gravação, NADA é gravado;
--   • idempotência: uma única aplicação por decisão (índice único);
--   • auditoria append-only: versões/hash antes e depois, linhas antes/depois e as mudanças aplicadas;
--   • reversão: devolve exatamente as linhas do corte, só se ninguém mexeu na Escala depois.
-- `ativo` (completo) continua sem efeito. Aditiva.

-- 1) modos e semanas autorizadas (função do gatilho primeiro: a semeadura abaixo não pode disparar recálculo)
create or replace function public.escala_trg_parametros()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_prev uuid;
begin
  if coalesce(new.chave, old.chave) in ('replanejamento_modo', 'replanejamento_semanas_ativas') then
    if coalesce(new.chave, old.chave) = 'replanejamento_modo' and tg_op <> 'DELETE' and new.valor in ('"sombra"'::jsonb, '"ativo_restrito"'::jsonb, '"ativo"'::jsonb) then
      for v_prev in select distinct previsao_id from public.escala_producao_dias where data >= current_date - 14 loop
        perform public.escala_plano_registrar(v_prev, 'baseline');
      end loop;
    end if;
    return null;
  end if;
  for v_prev in select * from public.escala_previsoes_com_escala_futura() loop
    perform public.escala_registrar_evento('previsao', v_prev, jsonb_build_object('tabela', 'escala_parametros', 'chave', coalesce(new.chave, old.chave)), null);
  end loop;
  return null;
end;
$$;

alter table public.escala_parametros drop constraint if exists escala_parametros_replanejamento_modo;
alter table public.escala_parametros add constraint escala_parametros_replanejamento_modo
  check (chave <> 'replanejamento_modo' or valor in ('"desligado"'::jsonb, '"sombra"'::jsonb, '"ativo_restrito"'::jsonb, '"ativo"'::jsonb));
alter table public.escala_parametros drop constraint if exists escala_parametros_replanejamento_semanas;
alter table public.escala_parametros add constraint escala_parametros_replanejamento_semanas
  check (chave <> 'replanejamento_semanas_ativas' or jsonb_typeof(valor) = 'array');

-- o gatilho de parâmetros não recalcula o oficial por causa do modo/semanas do replanejamento
insert into public.escala_parametros (chave, valor, grupo, descricao) values
  ('replanejamento_semanas_ativas', '[]'::jsonb, 'operacional', 'Semanas (segunda-feira ISO) em que o modo ativo_restrito PODE escrever na Escala. Fora dela, ativo_restrito se comporta como sombra')
on conflict (chave) do nothing;

create or replace function public.escala_replanejamento_semana_ativa(p_semana date)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.escala_replanejamento_modo() = 'ativo_restrito'
     and coalesce((select valor from public.escala_parametros where chave = 'replanejamento_semanas_ativas'), '[]'::jsonb) ? p_semana::text;
$$;
revoke all on function public.escala_replanejamento_semana_ativa(date) from public, anon;
grant execute on function public.escala_replanejamento_semana_ativa(date) to authenticated, service_role;

-- 2) decisões: várias REVISÕES por período (reavaliação por evento) + motivo; modo ativo_restrito
alter table public.escala_sombra_decisoes add column if not exists revisao integer not null default 0;
alter table public.escala_sombra_decisoes add column if not exists motivo text not null default 'fechamento';
alter table public.escala_sombra_decisoes drop constraint if exists uq_escala_sombra_periodo;
alter table public.escala_sombra_decisoes add constraint uq_escala_sombra_periodo unique (previsao_id, data, periodo_id, revisao);
alter table public.escala_sombra_decisoes drop constraint if exists escala_sombra_decisoes_replanejamento_modo_check;
alter table public.escala_sombra_decisoes add constraint escala_sombra_decisoes_replanejamento_modo_check check (replanejamento_modo in ('sombra', 'ativo_restrito', 'ativo'));

create or replace function public.escala_sombra_gravar_decisao(p_evento_id uuid, p_dados jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  r public.escala_sombra_decisoes;
begin
  r := jsonb_populate_record(null::public.escala_sombra_decisoes, p_dados);
  insert into public.escala_sombra_decisoes (
    evento_id, previsao_id, semana_inicio, data, periodo_id, slot, corte_em, motivo_fechamento, dados_completos, completude_percentual, postos_esperados, postos_recebidos,
    postos_faltantes, ultimo_lancamento_em, lancamentos_tardios_na_leitura, latencia_ms, horizonte, compromisso, entradas, planos, diagnostico, entrada,
    hash_entrada, hash_plano_oficial, hash_plano_sombra, hash_decisao, situacao, versao_motor, replanejamento_modo, revisao, motivo
  ) values (
    p_evento_id, r.previsao_id, r.semana_inicio, r.data, r.periodo_id, r.slot, r.corte_em, r.motivo_fechamento, r.dados_completos, r.completude_percentual, r.postos_esperados, r.postos_recebidos,
    coalesce(r.postos_faltantes, '[]'::jsonb), r.ultimo_lancamento_em, coalesce(r.lancamentos_tardios_na_leitura, 0), coalesce(r.latencia_ms, 0), r.horizonte, r.compromisso, r.entradas, r.planos, r.diagnostico, r.entrada,
    r.hash_entrada, r.hash_plano_oficial, r.hash_plano_sombra, r.hash_decisao, r.situacao, r.versao_motor, r.replanejamento_modo, coalesce(r.revisao, 0), coalesce(r.motivo, 'fechamento')
  )
  on conflict (previsao_id, data, periodo_id, revisao) do nothing
  returning id into v_id;
  if v_id is not null then
    return jsonb_build_object('inserida', true, 'id', v_id);
  end if;
  select id into v_id from public.escala_sombra_decisoes where previsao_id = r.previsao_id and data = r.data and periodo_id = r.periodo_id and revisao = coalesce(r.revisao, 0);
  return jsonb_build_object('inserida', false, 'id', v_id);
end;
$$;

-- 3) leitura da região futura (hash e linhas compactas) — a MESMA para antes, depois e reversão
create or replace function public.escala_regiao_linhas(p_previsao uuid, p_data date, p_periodo text)
returns table (data date, periodo_id text, funcionario_id uuid, maquina_id uuid, produto_id uuid, etapa_id uuid, operacao_id uuid, pecas numeric, pecas_adicional numeric, tipo_adicional text, motivo_sem_posto text, origem text, excecao_revezamento boolean, ord integer)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select a.data, a.periodo_id, a.funcionario_id, a.maquina_id, a.produto_id, a.etapa_id, a.operacao_id, a.pecas, coalesce(a.pecas_adicional, 0), a.tipo_adicional, a.motivo_sem_posto, a.origem, a.excecao_revezamento, o.ord
    from public.escala_producao_alocacoes a
    join public.escala_producao_dias d on d.data = a.data and d.previsao_id = p_previsao
    cross join lateral (select coalesce((select e.ord::integer from jsonb_array_elements(d.periodos_snapshot) with ordinality as e(v, ord) where e.v->>'id' = a.periodo_id), 0) as ord) o
   where a.data > p_data
      or (a.data = p_data and o.ord >= coalesce((select e.ord::integer from jsonb_array_elements((select periodos_snapshot from public.escala_producao_dias where data = p_data)) with ordinality as e(v, ord) where e.v->>'id' = p_periodo), 0));
$$;

create or replace function public.escala_hash_regiao(p_previsao uuid, p_data date, p_periodo text)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select md5(coalesce(string_agg(r.data::text || r.periodo_id || r.funcionario_id::text || coalesce(r.maquina_id::text, '') || coalesce(r.produto_id::text, '') || coalesce(r.etapa_id::text, '') || r.pecas::text || r.pecas_adicional::text || r.origem || r.excecao_revezamento::text, ',' order by r.data, r.ord, r.funcionario_id), ''))
    from public.escala_regiao_linhas(p_previsao, p_data, p_periodo) r;
$$;

create or replace function public.escala_regiao_compacta(p_previsao uuid, p_data date, p_periodo text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_array(r.data::text, r.periodo_id, r.funcionario_id, r.maquina_id, r.produto_id, r.etapa_id, r.operacao_id, r.pecas, r.pecas_adicional, r.tipo_adicional, r.motivo_sem_posto, case when r.origem = 'manual' then 'm' else 'a' end) order by r.data, r.ord, r.funcionario_id), '[]'::jsonb)
    from public.escala_regiao_linhas(p_previsao, p_data, p_periodo) r;
$$;

-- 4) auditoria append-only de cada tentativa de aplicação / reversão
create table if not exists public.escala_replanejamentos (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,          -- ordem estrita de registro (criado_em empata dentro de uma transação)
  decisao_id uuid,                                  -- sem FK: o registro sobrevive a qualquer limpeza
  previsao_id uuid not null,
  semana_inicio date not null,
  data date not null,
  periodo_id text not null,
  slot integer not null,
  revisao integer not null default 0,
  tipo text not null check (tipo in ('aplicacao', 'reversao')),
  resultado text not null check (resultado in ('aplicado', 'sem_mudanca', 'conflito', 'invalida', 'recusado', 'erro', 'revertido')),
  motivo text,
  gatilho text,                                      -- o que disparou a avaliação: fechamento (período fechado) | reavaliacao (evento: a Escala oficial mudou)
  a_partir_data date,
  a_partir_periodo text,
  versoes_antes jsonb,
  hash_antes text,
  hash_proposta text,
  versoes_depois jsonb,
  hash_depois text,
  linhas_antes jsonb,
  linhas_depois jsonb,
  mudancas jsonb,
  resumo jsonb,
  erro text,
  criado_em timestamptz not null default now()
);
create unique index if not exists uq_escala_replanejamento_aplicado on public.escala_replanejamentos(decisao_id) where tipo = 'aplicacao' and resultado = 'aplicado';
create index if not exists idx_escala_replanejamentos_semana on public.escala_replanejamentos(semana_inicio, slot);
drop trigger if exists trg_escala_replanejamentos_imutavel on public.escala_replanejamentos;
create trigger trg_escala_replanejamentos_imutavel before update or delete on public.escala_replanejamentos for each row execute function public.escala_sombra_trg_imutavel();
alter table public.escala_replanejamentos enable row level security;
drop policy if exists escala_replanejamentos_select on public.escala_replanejamentos;
create policy escala_replanejamentos_select on public.escala_replanejamentos for select to authenticated using (public.is_admin() or public.has_permissao('escala_producao'));
revoke all on public.escala_replanejamentos from anon, authenticated;
grant select on public.escala_replanejamentos to authenticated;
grant select, insert on public.escala_replanejamentos to service_role;

-- 5) RPCs (somente service_role)
create or replace function public.escala_replanejamento_registrar(p_dados jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r public.escala_replanejamentos;
  v_id uuid;
begin
  r := jsonb_populate_record(null::public.escala_replanejamentos, p_dados);
  if r.resultado in ('aplicado', 'revertido') then
    raise exception 'ESCALA_REPLAN_REGISTRO_INVALIDO: aplicado/revertido só pelas RPCs de aplicação/reversão';
  end if;
  -- o hash da região é lido NO BANCO, na hora do registro: é o "estado conhecido" que a reavaliação por evento compara depois
  insert into public.escala_replanejamentos (decisao_id, previsao_id, semana_inicio, data, periodo_id, slot, revisao, tipo, resultado, motivo, gatilho, a_partir_data, a_partir_periodo, versoes_antes, hash_antes, hash_proposta, mudancas, resumo, erro)
  values (r.decisao_id, r.previsao_id, r.semana_inicio, r.data, r.periodo_id, r.slot, coalesce(r.revisao, 0), r.tipo, r.resultado, r.motivo, r.gatilho, r.a_partir_data, r.a_partir_periodo,
          (select coalesce(jsonb_object_agg(d.data::text, d.versao), '{}'::jsonb) from public.escala_producao_dias d where d.previsao_id = r.previsao_id),
          case when r.a_partir_data is not null and r.a_partir_periodo is not null then public.escala_hash_regiao(r.previsao_id, r.a_partir_data, r.a_partir_periodo) else null end,
          r.hash_proposta, r.mudancas, r.resumo, r.erro)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.escala_replanejamento_aplicar(
  p_previsao uuid,
  p_decisao_id uuid,
  p_corte jsonb,                 -- {semana_inicio, data, periodo_id, slot, revisao, motivo}
  p_dias jsonb,                  -- [{data, versao_base, periodos_snapshot}] — versões lidas JUNTO com a decisão
  p_a_partir_data date,
  p_a_partir_periodo text,
  p_alocacoes jsonb,
  p_hash_proposta text,
  p_mudancas jsonb,
  p_resumo jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_semana date := (p_corte->>'semana_inicio')::date;
  v_hash_antes text;
  v_hash_depois text;
  v_antes jsonb;
  v_depois jsonb;
  v_vers_antes jsonb;
  v_vers_depois jsonb;
  v_n integer;
  v_id uuid;
begin
  -- PORTÃO no banco: modo ativo_restrito + semana autorizada
  if not public.escala_replanejamento_semana_ativa(v_semana) then
    raise exception 'ESCALA_REPLAN_NAO_AUTORIZADO: modo/semana não autorizados para escrita (%).', v_semana;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('escala:' || p_previsao::text, 0));
  if exists (select 1 from public.escala_replanejamentos where decisao_id = p_decisao_id and tipo = 'aplicacao' and resultado = 'aplicado') then
    raise exception 'ESCALA_REPLAN_JA_APLICADO: decisão % já aplicada', p_decisao_id;
  end if;

  v_hash_antes := public.escala_hash_regiao(p_previsao, p_a_partir_data, p_a_partir_periodo);
  v_antes := public.escala_regiao_compacta(p_previsao, p_a_partir_data, p_a_partir_periodo);
  select coalesce(jsonb_object_agg(data::text, versao), '{}'::jsonb) into v_vers_antes from public.escala_producao_dias where previsao_id = p_previsao;

  -- concorrência otimista + escrita (mesma RPC do recálculo oficial: erro de versão desfaz tudo)
  perform public.escala_aplicar_recalculo(p_previsao, p_dias, p_a_partir_data, p_a_partir_periodo, p_alocacoes, null, '{}'::uuid[],
    coalesce(p_resumo, '{}'::jsonb) || jsonb_build_object('origem', 'replanejamento_restrito', 'decisao_id', p_decisao_id), '{}'::date[]);

  select count(*) into v_n from public.escala_regiao_linhas(p_previsao, p_a_partir_data, p_a_partir_periodo);
  if v_n <> jsonb_array_length(coalesce(p_alocacoes, '[]'::jsonb)) then
    raise exception 'ESCALA_REPLAN_INCONSISTENTE: gravadas % linhas, esperadas %', v_n, jsonb_array_length(coalesce(p_alocacoes, '[]'::jsonb));
  end if;
  v_hash_depois := public.escala_hash_regiao(p_previsao, p_a_partir_data, p_a_partir_periodo);
  v_depois := public.escala_regiao_compacta(p_previsao, p_a_partir_data, p_a_partir_periodo);
  select coalesce(jsonb_object_agg(data::text, versao), '{}'::jsonb) into v_vers_depois from public.escala_producao_dias where previsao_id = p_previsao;

  insert into public.escala_replanejamentos (decisao_id, previsao_id, semana_inicio, data, periodo_id, slot, revisao, tipo, resultado, motivo, gatilho, a_partir_data, a_partir_periodo,
    versoes_antes, hash_antes, hash_proposta, versoes_depois, hash_depois, linhas_antes, linhas_depois, mudancas, resumo)
  values (p_decisao_id, p_previsao, v_semana, (p_corte->>'data')::date, p_corte->>'periodo_id', (p_corte->>'slot')::integer, coalesce((p_corte->>'revisao')::integer, 0), 'aplicacao', 'aplicado', p_corte->>'motivo', p_corte->>'motivo', p_a_partir_data, p_a_partir_periodo,
    v_vers_antes, v_hash_antes, p_hash_proposta, v_vers_depois, v_hash_depois, v_antes, v_depois, p_mudancas, p_resumo)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'hash_antes', v_hash_antes, 'hash_depois', v_hash_depois, 'versoes_antes', v_vers_antes, 'versoes_depois', v_vers_depois, 'linhas', v_n);
end;
$$;

-- Reversão: devolve exatamente as linhas do corte, SÓ se a Escala ainda é a que a aplicação deixou (ninguém mexeu depois)
create or replace function public.escala_replanejamento_reverter(p_aplicacao_id uuid, p_motivo text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  a public.escala_replanejamentos;
  v_dias jsonb;
  v_aloc jsonb;
  v_hash_atual text;
  v_id uuid;
begin
  select * into a from public.escala_replanejamentos where id = p_aplicacao_id and tipo = 'aplicacao' and resultado = 'aplicado';
  if not found then raise exception 'ESCALA_REPLAN_REVERSAO: aplicação % não encontrada', p_aplicacao_id; end if;
  if exists (select 1 from public.escala_replanejamentos where tipo = 'reversao' and resultado = 'revertido' and (resumo->>'aplicacao_id') = p_aplicacao_id::text) then
    raise exception 'ESCALA_REPLAN_REVERSAO: aplicação % já revertida', p_aplicacao_id;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('escala:' || a.previsao_id::text, 0));
  v_hash_atual := public.escala_hash_regiao(a.previsao_id, a.a_partir_data, a.a_partir_periodo);
  if v_hash_atual is distinct from a.hash_depois then
    raise exception 'ESCALA_REPLAN_REVERSAO_CONFLITO: a Escala mudou depois da aplicação (hash % ≠ %)', v_hash_atual, a.hash_depois;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('data', d.data::text, 'versao_base', d.versao, 'periodos_snapshot', d.periodos_snapshot) order by d.data), '[]'::jsonb) into v_dias from public.escala_producao_dias d where d.previsao_id = a.previsao_id;
  select coalesce(jsonb_agg(jsonb_build_object('data', e->>0, 'periodo_id', e->>1, 'funcionario_id', e->>2, 'maquina_id', e->>3, 'produto_id', e->>4, 'etapa_id', e->>5, 'operacao_id', e->>6,
         'pecas', e->7, 'pecas_adicional', e->8, 'tipo_adicional', e->>9, 'motivo_sem_posto', e->>10, 'origem', case when e->>11 = 'm' then 'manual' else 'auto' end, 'excecao_revezamento', false)), '[]'::jsonb)
    into v_aloc from jsonb_array_elements(a.linhas_antes) e;
  perform public.escala_aplicar_recalculo(a.previsao_id, v_dias, a.a_partir_data, a.a_partir_periodo, v_aloc, null, '{}'::uuid[],
    jsonb_build_object('origem', 'reversao_replanejamento', 'aplicacao_id', p_aplicacao_id, 'motivo', p_motivo), '{}'::date[]);
  insert into public.escala_replanejamentos (decisao_id, previsao_id, semana_inicio, data, periodo_id, slot, revisao, tipo, resultado, motivo, a_partir_data, a_partir_periodo, hash_antes, hash_depois, resumo)
  values (a.decisao_id, a.previsao_id, a.semana_inicio, a.data, a.periodo_id, a.slot, a.revisao, 'reversao', 'revertido', p_motivo, a.a_partir_data, a.a_partir_periodo, v_hash_atual,
          public.escala_hash_regiao(a.previsao_id, a.a_partir_data, a.a_partir_periodo), jsonb_build_object('aplicacao_id', p_aplicacao_id, 'hash_original_antes', a.hash_antes))
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'hash_restaurado', public.escala_hash_regiao(a.previsao_id, a.a_partir_data, a.a_partir_periodo), 'hash_original', a.hash_antes);
end;
$$;

-- Semanas autorizadas cuja Escala oficial MUDOU depois da última avaliação (ausência, indisponibilidade, Previsão...): reavaliar o período mais recente
create or replace function public.escala_replanejamento_pendentes(p_semanas date[])
returns table (previsao_id uuid, data date, periodo_id text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select u.previsao_id, u.data, u.periodo_id
    from (
      select distinct on (r.semana_inicio) r.*
        from public.escala_replanejamentos r
       where r.semana_inicio = any(p_semanas) and r.tipo = 'aplicacao' and r.a_partir_data is not null and r.resultado <> 'revertido'
       order by r.semana_inicio, r.seq desc
    ) u
   where public.escala_replanejamento_semana_ativa(u.semana_inicio)
     and coalesce(u.hash_depois, u.hash_antes) is distinct from public.escala_hash_regiao(u.previsao_id, u.a_partir_data, u.a_partir_periodo);
$$;

revoke all on function public.escala_regiao_linhas(uuid, date, text) from public, anon, authenticated;
revoke all on function public.escala_hash_regiao(uuid, date, text) from public, anon, authenticated;
revoke all on function public.escala_regiao_compacta(uuid, date, text) from public, anon, authenticated;
revoke all on function public.escala_replanejamento_registrar(jsonb) from public, anon, authenticated;
revoke all on function public.escala_replanejamento_aplicar(uuid, uuid, jsonb, jsonb, date, text, jsonb, text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.escala_replanejamento_reverter(uuid, text) from public, anon, authenticated;
revoke all on function public.escala_replanejamento_pendentes(date[]) from public, anon, authenticated;
grant execute on function public.escala_replanejamento_pendentes(date[]) to service_role;
grant execute on function public.escala_hash_regiao(uuid, date, text) to service_role;
grant execute on function public.escala_regiao_compacta(uuid, date, text) to service_role;
grant execute on function public.escala_replanejamento_registrar(jsonb) to service_role;
grant execute on function public.escala_replanejamento_aplicar(uuid, uuid, jsonb, jsonb, date, text, jsonb, text, jsonb, jsonb) to service_role;
grant execute on function public.escala_replanejamento_reverter(uuid, text) to service_role;
