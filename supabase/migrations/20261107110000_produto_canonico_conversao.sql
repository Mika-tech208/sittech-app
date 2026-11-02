-- Sittech — F2 (PREPARAÇÃO DO CUTOVER) do produto canônico: conversão transacional da Previsão, reversão, guardas e visões de produção por rota/final.
-- Depende de 20261107100000_produto_canonico_estrutura. INERTE enquanto `produto_unico_cutover` for null e não existir produto canônico (backfill F1 não rodado):
--   • as 2 funções de conversão/reversão só rodam quando CHAMADAS (service_role; sem gatilho, sem agendador);
--   • os 2 gatilhos de guarda (previsao_itens, apontamentos_producao) saem imediatamente sem efeito quando não há cutover (1 SELECT em tabela pequena);
--   • as 2 visões são somente leitura.
-- Esta migration ALTERA a lista de gatilhos de previsao_itens e apontamentos_producao (acrescenta um BEFORE INSERT em cada): por isso é separada da F0 e só é aplicada na preparação do cutover.
--
-- Por que a Previsão e a Escala "viram juntas": a reconciliação (escala_divergencias_cadastro_maquinas) exige que (produto, etapa, máquina) de cada linha esteja em previsao_item_maquinas.
-- A conversão NÃO toca em alocações: o recálculo do motor (evento gerado pela própria conversão) grava as linhas no produto canônico. Se o recálculo falhar, as alocações continuam
-- legadas e a reversão (que restaura os itens legados do backup) devolve um estado coerente; se o recálculo já gravou linhas canônicas, a reversão RECUSA até o plano legado ser restaurado.
-- Reversão do que esta migration cria: supabase/rollbacks/20261107110000_rollback_produto_canonico_conversao.sql

-- =========================================================================
-- 1) Visões de produção por rota (upstream) e final — leitura do histórico SEM atribuir peças finais a produto/rota
-- =========================================================================
create or replace view public.vw_producao_rota_semana with (security_invoker = true) as
select date_trunc('week', v.data)::date as semana_inicio, v.produto_canonico_id, v.rota_id, v.etapa_canonica_id, sum(v.quantidade_boa) as quantidade_boa, count(*) as n_apontamentos
  from public.vw_apontamentos_canonicos v
 where v.status = 'produzindo' and v.papel = 'ROTA'
 group by 1, 2, 3, 4;

create or replace view public.vw_producao_final_semana with (security_invoker = true) as
select date_trunc('week', v.data)::date as semana_inicio, v.produto_canonico_id, sum(v.quantidade_boa) as quantidade_boa, count(*) as n_apontamentos,
       count(*) filter (where v.era_legado) as n_registrados_em_legado
  from public.vw_apontamentos_canonicos v
 where v.status = 'produzindo' and v.papel = 'FINAL'
 group by 1, 2;

-- =========================================================================
-- 2) Trilha de conversões (append-only) com o BACKUP da Previsão legada
-- =========================================================================
create table if not exists public.produto_unico_conversoes (
  id bigint generated always as identity primary key,
  criado_em timestamptz not null default now(),
  previsao_id uuid not null references public.previsoes(id) on delete restrict,
  semana_inicio date not null,
  acao text not null check (acao in ('converter', 'reverter')),
  feito_por text,
  resumo jsonb not null default '{}'::jsonb,
  backup jsonb
);
create index if not exists produto_unico_conversoes_previsao on public.produto_unico_conversoes (previsao_id, id);
drop trigger if exists trg_produto_unico_conversoes_imutavel on public.produto_unico_conversoes;
create trigger trg_produto_unico_conversoes_imutavel before update or delete on public.produto_unico_conversoes for each row execute function public.produto_canonico_trg_imutavel();
alter table public.produto_unico_conversoes enable row level security;
drop policy if exists produto_unico_conversoes_leitura on public.produto_unico_conversoes;
create policy produto_unico_conversoes_leitura on public.produto_unico_conversoes for select to authenticated using (public.is_admin());
revoke all on public.produto_unico_conversoes from anon, authenticated;
grant select on public.produto_unico_conversoes to authenticated;
grant select, insert on public.produto_unico_conversoes to service_role;
revoke all on sequence public.produto_unico_conversoes_id_seq from anon, authenticated;
grant usage, select on sequence public.produto_unico_conversoes_id_seq to service_role;

-- =========================================================================
-- 3) Guardas (BEFORE INSERT): impedem que um cliente antigo (aba aberta) ou o motor antigo regrave o produto do espaço errado
--    upsert_previsao_semana APAGA e reinsere os itens previstos a cada salvamento: sem a guarda, um salvamento de aba antiga desfaria a conversão.
-- =========================================================================
create or replace function public.produto_unico_trg_guarda_previsao_item()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_cut date; v_semana date; v_legado boolean; v_canonico boolean;
begin
  if current_setting('sittech.produto_unico_bypass', true) = 'on' then return new; end if; -- só as funções de conversão/reversão (set_config local à transação)
  select (valor #>> '{}')::date into v_cut from public.escala_parametros where chave = 'produto_unico_cutover' and jsonb_typeof(valor) = 'string';
  select exists (select 1 from public.produto_legado_mapa where produto_legado_id = new.produto_id), exists (select 1 from public.produto_canonico where produto_id = new.produto_id) into v_legado, v_canonico;
  if not v_legado and not v_canonico then return new; end if;
  select semana_inicio into v_semana from public.previsoes where id = new.previsao_id;
  if v_canonico and (v_cut is null or v_semana < v_cut) then
    raise exception 'PRODUTO_CANONICO_ANTES_DO_CUTOVER: o produto único só vale a partir do cutover (%); semana %', v_cut, v_semana using errcode = 'P0001';
  end if;
  if v_legado and new.tipo = 'previsto' and v_cut is not null and v_semana >= v_cut then
    raise exception 'PRODUTO_LEGADO_APOS_CUTOVER: a semana % usa o produto único (cutover %); atualize a tela e salve de novo', v_semana, v_cut using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_produto_unico_guarda_previsao_item on public.previsao_itens;
create trigger trg_produto_unico_guarda_previsao_item before insert on public.previsao_itens for each row execute function public.produto_unico_trg_guarda_previsao_item();

create or replace function public.produto_unico_trg_guarda_apontamento()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_cut date; v_legado boolean; v_canonico boolean;
begin
  if new.produto_id is null or current_setting('sittech.produto_unico_bypass', true) = 'on' then return new; end if;
  select (valor #>> '{}')::date into v_cut from public.escala_parametros where chave = 'produto_unico_cutover' and jsonb_typeof(valor) = 'string';
  select exists (select 1 from public.produto_legado_mapa where produto_legado_id = new.produto_id), exists (select 1 from public.produto_canonico where produto_id = new.produto_id) into v_legado, v_canonico;
  if not v_legado and not v_canonico then return new; end if;
  if v_canonico and (v_cut is null or date_trunc('week', new.data)::date < v_cut) then
    raise exception 'APONTAMENTO_CANONICO_ANTES_DO_CUTOVER: data % é anterior ao cutover (%); lance no produto da época (Convencional/Automática)', new.data, v_cut using errcode = 'P0001';
  end if;
  if v_legado and v_cut is not null and date_trunc('week', new.data)::date >= v_cut then
    raise exception 'APONTAMENTO_LEGADO_APOS_CUTOVER: data % usa o produto único (cutover %); lance no Conector 3/4', new.data, v_cut using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_produto_unico_guarda_apontamento on public.apontamentos_producao;
create trigger trg_produto_unico_guarda_apontamento before insert on public.apontamentos_producao for each row execute function public.produto_unico_trg_guarda_apontamento();

-- =========================================================================
-- 4) Conversão transacional da Previsão (legado -> canônico). UMA transação: itens + máquinas + (cutover). Idempotente.
-- =========================================================================
create or replace function public.produto_unico_converter_previsao(p_previsao uuid, p_valor_unitario numeric default null, p_feito_por text default 'script')
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_semana date;
  v_prod uuid;
  v_nome text;
  v_valor numeric;
  v_cut date;
  v_problemas text;
  v_qtd numeric;
  v_n_itens int;
  v_item uuid;
  v_backup jsonb;
  v_n_maq int;
begin
  perform set_config('sittech.produto_unico_bypass', 'on', true);
  select semana_inicio into v_semana from public.previsoes where id = p_previsao for update;
  if v_semana is null then raise exception 'F2_PREVISAO_INEXISTENTE'; end if;
  if extract(isodow from v_semana) <> 1 or v_semana < date '2026-11-02' then raise exception 'F2_SEMANA_INVALIDA: % (segunda-feira >= 2026-11-02)', v_semana; end if;

  select c.produto_id, c.nome_exibicao, p.valor_unitario into v_prod, v_nome, v_valor from public.produto_canonico c join public.produtos p on p.id = c.produto_id order by c.criado_em limit 1;
  if v_prod is null then raise exception 'F2_SEM_CANONICO: rode o backfill F1'; end if;
  select string_agg(x, '; ') into v_problemas from public.produto_canonico_problemas(v_prod) x;
  if v_problemas is not null then raise exception 'F2_CANONICO_COM_PROBLEMAS: %', v_problemas; end if;
  v_valor := coalesce(p_valor_unitario, v_valor);

  select (valor #>> '{}')::date into v_cut from public.escala_parametros where chave = 'produto_unico_cutover' and jsonb_typeof(valor) = 'string';
  if v_cut is not null and v_cut > v_semana then raise exception 'F2_CUTOVER_POSTERIOR: cutover % é depois da semana %', v_cut, v_semana; end if;

  if exists (select 1 from public.previsao_itens where previsao_id = p_previsao and produto_id = v_prod and tipo = 'previsto') then
    perform set_config('sittech.produto_unico_bypass', 'off', true);
    return jsonb_build_object('ja_convertida', true, 'semana', v_semana);
  end if;

  select count(*), coalesce(sum(i.quantidade), 0) into v_n_itens, v_qtd
    from public.previsao_itens i join public.produto_legado_mapa m on m.produto_legado_id = i.produto_id
   where i.previsao_id = p_previsao and i.tipo = 'previsto';
  if v_n_itens = 0 then raise exception 'F2_SEM_ITEM_LEGADO: a Previsão % não tem item previsto dos legados', p_previsao; end if;

  if exists (select 1 from public.previsao_itens i join public.produto_legado_mapa m on m.produto_legado_id = i.produto_id where i.previsao_id = p_previsao and i.tipo = 'realizado') then
    raise exception 'F2_REALIZADO_LEGADO: há item "realizado" manual dos legados nesta semana; trate antes (não é convertido)';
  end if;
  if exists (select 1 from public.previsao_itens i join public.produto_legado_mapa m on m.produto_legado_id = i.produto_id where i.previsao_id = p_previsao and i.tipo = 'previsto' and i.quantidade_adicional > 0)
     or exists (select 1 from public.previsao_item_adicional_etapa a join public.previsao_itens i on i.id = a.item_id join public.produto_legado_mapa m on m.produto_legado_id = i.produto_id where i.previsao_id = p_previsao) then
    raise exception 'F2_ADICIONAL_NAO_SUPORTADO: carga adicional (por etapa) não é convertida na v1 do produto único';
  end if;
  if exists (select 1 from public.apontamentos_producao a join public.produto_legado_mapa m on m.produto_legado_id = a.produto_id where a.data between v_semana and v_semana + 6) then
    raise exception 'F2_APONTAMENTO_LEGADO_NA_SEMANA: já há apontamento dos legados na semana %; cutover tem que ser no início da semana', v_semana;
  end if;

  -- backup completo (linhas inteiras) ANTES de qualquer alteração
  select jsonb_build_object(
    'itens', coalesce((select jsonb_agg(to_jsonb(i) order by i.id) from public.previsao_itens i join public.produto_legado_mapa m on m.produto_legado_id = i.produto_id where i.previsao_id = p_previsao and i.tipo = 'previsto'), '[]'::jsonb),
    'maquinas', coalesce((select jsonb_agg(to_jsonb(im) order by im.item_id, im.etapa_id, im.maquina_id) from public.previsao_item_maquinas im join public.previsao_itens i on i.id = im.item_id join public.produto_legado_mapa m on m.produto_legado_id = i.produto_id where i.previsao_id = p_previsao and i.tipo = 'previsto'), '[]'::jsonb))
    into v_backup;

  insert into public.previsao_itens (previsao_id, tipo, produto_id, produto_nome, valor_unitario, quantidade, quantidade_adicional)
    values (p_previsao, 'previsto', v_prod, v_nome, v_valor, v_qtd, 0) returning id into v_item;
  insert into public.previsao_item_maquinas (item_id, etapa_id, maquina_id)
    select distinct v_item, l.etapa_canonica_id, im.maquina_id
      from public.previsao_item_maquinas im
      join public.previsao_itens i on i.id = im.item_id
      join public.etapa_legado_mapa l on l.etapa_legado_id = im.etapa_id
     where i.previsao_id = p_previsao and i.tipo = 'previsto' and i.produto_id <> v_prod;
  get diagnostics v_n_maq = row_count;
  delete from public.previsao_itens i using public.produto_legado_mapa m where i.previsao_id = p_previsao and i.tipo = 'previsto' and i.produto_id = m.produto_legado_id;

  if v_cut is null then
    update public.escala_parametros set valor = to_jsonb(to_char(v_semana, 'YYYY-MM-DD')), atualizado_em = now() where chave = 'produto_unico_cutover';
  end if;

  insert into public.produto_unico_conversoes (previsao_id, semana_inicio, acao, feito_por, resumo, backup)
    values (p_previsao, v_semana, 'converter', p_feito_por,
            jsonb_build_object('produto_canonico_id', v_prod, 'item_canonico_id', v_item, 'quantidade', v_qtd, 'valor_unitario', v_valor, 'itens_legado_removidos', v_n_itens, 'maquinas_canonicas', v_n_maq, 'cutover', coalesce(v_cut, v_semana)), v_backup);
  insert into public.produto_canonico_ativacoes (acao, cutover, feito_por, detalhes) values ('ativar', coalesce(v_cut, v_semana), p_feito_por, jsonb_build_object('previsao_id', p_previsao, 'semana', v_semana, 'quantidade', v_qtd));
  perform set_config('sittech.produto_unico_bypass', 'off', true);
  return jsonb_build_object('ja_convertida', false, 'semana', v_semana, 'item_canonico_id', v_item, 'quantidade', v_qtd, 'itens_legado_removidos', v_n_itens, 'maquinas_canonicas', v_n_maq, 'cutover', coalesce(v_cut, v_semana));
end;
$$;

-- =========================================================================
-- 5) Reversão (restaura os itens legados do backup; recusa se o canônico já foi USADO por alocação/apontamento)
-- =========================================================================
create or replace function public.produto_unico_reverter_previsao(p_previsao uuid, p_feito_por text default 'script')
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_semana date;
  v_conv record;
  v_prod uuid;
  v_etapas uuid[];
  v_usos text := '';
  v_n bigint;
  v_cut date;
  v_restantes int;
begin
  perform set_config('sittech.produto_unico_bypass', 'on', true);
  select semana_inicio into v_semana from public.previsoes where id = p_previsao for update;
  if v_semana is null then raise exception 'F2_PREVISAO_INEXISTENTE'; end if;
  select * into v_conv from public.produto_unico_conversoes where previsao_id = p_previsao order by id desc limit 1;
  if v_conv.id is null or v_conv.acao <> 'converter' then raise exception 'F2_NADA_A_REVERTER: a última ação desta Previsão não é uma conversão'; end if;
  v_prod := (v_conv.resumo ->> 'produto_canonico_id')::uuid;
  select coalesce(array_agg(id), '{}') into v_etapas from public.roteiro_etapas where produto_id = v_prod;

  select count(*) into v_n from public.escala_producao_alocacoes a join public.escala_producao_dias d on d.data = a.data
   where d.previsao_id = p_previsao and (a.produto_id = v_prod or a.etapa_id = any(v_etapas) or a.distribuicao::text like '%' || v_prod::text || '%');
  if v_n > 0 then v_usos := v_usos || format(' alocacoes_no_canonico=%s', v_n); end if;
  select count(*) into v_n from public.apontamentos_producao a where a.produto_id = v_prod and a.data between v_semana and v_semana + 6;
  if v_n > 0 then v_usos := v_usos || format(' apontamentos_no_canonico=%s', v_n); end if;
  if v_usos <> '' then raise exception 'F2_REVERSAO_ABORTADA: o canônico já foi usado (%). Restaure o plano legado da semana (e trate os apontamentos) antes.', v_usos; end if;

  delete from public.previsao_itens where previsao_id = p_previsao and produto_id = v_prod and tipo = 'previsto';
  insert into public.previsao_itens select * from jsonb_populate_recordset(null::public.previsao_itens, v_conv.backup -> 'itens');
  insert into public.previsao_item_maquinas select * from jsonb_populate_recordset(null::public.previsao_item_maquinas, v_conv.backup -> 'maquinas');

  select count(*) into v_restantes from public.previsao_itens where produto_id = v_prod and tipo = 'previsto';
  select (valor #>> '{}')::date into v_cut from public.escala_parametros where chave = 'produto_unico_cutover' and jsonb_typeof(valor) = 'string';
  if v_restantes = 0 and v_cut is not null and v_cut >= v_semana then
    update public.escala_parametros set valor = 'null'::jsonb, atualizado_em = now() where chave = 'produto_unico_cutover';
  end if;
  insert into public.produto_unico_conversoes (previsao_id, semana_inicio, acao, feito_por, resumo)
    values (p_previsao, v_semana, 'reverter', p_feito_por, jsonb_build_object('conversao_revertida', v_conv.id, 'itens_restaurados', jsonb_array_length(v_conv.backup -> 'itens'), 'cutover_zerado', v_restantes = 0 and v_cut is not null and v_cut >= v_semana));
  insert into public.produto_canonico_ativacoes (acao, cutover, feito_por, detalhes) values ('reverter', v_cut, p_feito_por, jsonb_build_object('previsao_id', p_previsao, 'semana', v_semana));
  perform set_config('sittech.produto_unico_bypass', 'off', true);
  return jsonb_build_object('semana', v_semana, 'itens_restaurados', jsonb_array_length(v_conv.backup -> 'itens'), 'cutover_zerado', v_restantes = 0 and v_cut is not null and v_cut >= v_semana);
end;
$$;

revoke all on function public.produto_unico_converter_previsao(uuid, numeric, text) from public, anon, authenticated;
revoke all on function public.produto_unico_reverter_previsao(uuid, text) from public, anon, authenticated;
grant execute on function public.produto_unico_converter_previsao(uuid, numeric, text) to service_role;
grant execute on function public.produto_unico_reverter_previsao(uuid, text) to service_role;
revoke all on function public.produto_unico_trg_guarda_previsao_item() from public, anon, authenticated;
revoke all on function public.produto_unico_trg_guarda_apontamento() from public, anon, authenticated;
grant select on public.vw_producao_rota_semana, public.vw_producao_final_semana to authenticated, service_role;
notify pgrst, 'reload schema';
