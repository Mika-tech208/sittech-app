-- PRODUTO ENCERRADO NA SEMANA (08/11/2026): separar O QUE HAVIA SIDO PREVISTO de O QUE AINDA SE QUER PRODUZIR.
-- Problema: encerrar a Caixa Amarela 4x2 zerando `previsao_itens.quantidade` (para o motor parar de programá-la) misturou planejamento futuro com histórico:
-- a Previsão passou a mostrar "Previsto 0 / Apontado 27.930 / +27.930 acima / % N/A" e perdeu a meta original (56.400).
--
-- MODELO (aditivo; nada é apagado e o motor NÃO muda): um encerramento por (semana, produto) guarda a META ORIGINAL e o carimbo da decisão.
-- Enquanto o encerramento está ativo, um gatilho em previsao_itens força quantidade = 0 e quantidade_adicional = 0 (o motor continua lendo 0 e nunca programa o produto, nem por
-- "carga adicional", nem num "salvar" da Previsão que reenvie o item — o salvar apaga e recria itens, por isso o encerramento mora em tabela própria). A produção real
-- continua vindo dos apontamentos (fato histórico) e a tela passa a mostrar Previsto ORIGINAL, Apontado, Falta operacional 0 e o selo ENCERRADO.
begin;

create table if not exists public.previsao_encerramentos (
  id uuid primary key default gen_random_uuid(),
  previsao_id uuid not null references public.previsoes(id) on delete cascade,
  produto_id uuid not null references public.produtos(id),
  quantidade_original numeric not null check (quantidade_original >= 0),   -- soma dos itens previstos do produto na semana NO MOMENTO do encerramento
  adicional_original numeric not null default 0 check (adicional_original >= 0),
  encerrado_em timestamptz not null default now(),
  encerrado_por uuid references public.usuarios(id),
  motivo text,
  reaberto_em timestamptz,
  reaberto_por uuid references public.usuarios(id),
  created_at timestamptz not null default now()
);
create unique index if not exists uq_previsao_encerramento_ativo on public.previsao_encerramentos (previsao_id, produto_id) where reaberto_em is null;
create index if not exists idx_previsao_encerramentos_previsao on public.previsao_encerramentos (previsao_id);

alter table public.previsao_encerramentos enable row level security;
drop policy if exists previsao_encerramentos_leitura on public.previsao_encerramentos;
create policy previsao_encerramentos_leitura on public.previsao_encerramentos for select using (public.is_usuario_ativo());
-- escrita: SOMENTE pelas RPCs abaixo (security definer); sem política de INSERT/UPDATE/DELETE para os papéis comuns
revoke all on public.previsao_encerramentos from anon, authenticated;
grant select on public.previsao_encerramentos to authenticated;
grant all on public.previsao_encerramentos to service_role;

-- (sem registro_versoes: o próprio registro é o histórico; nunca é apagado, reabrir só carimba reaberto_em/reaberto_por)

-- INVARIANTE para o motor: produto encerrado na semana = demanda 0 e adicional 0, aconteça o que acontecer (salvar a Previsão, edição manual, importação).
create or replace function public.previsao_itens_trg_encerrado() returns trigger
language plpgsql security definer set search_path to 'public', 'pg_temp' as $fn$
begin
  if new.tipo = 'previsto' and exists (select 1 from public.previsao_encerramentos e where e.previsao_id = new.previsao_id and e.produto_id = new.produto_id and e.reaberto_em is null) then
    new.quantidade := 0;
    new.quantidade_adicional := 0;
  end if;
  return new;
end;
$fn$;
drop trigger if exists trg_previsao_itens_encerrado on public.previsao_itens;
create trigger trg_previsao_itens_encerrado before insert or update of quantidade, quantidade_adicional, previsao_id, produto_id, tipo on public.previsao_itens
  for each row execute function public.previsao_itens_trg_encerrado();

-- adicional POR ETAPA de produto encerrado nunca é gravado (o motor leria estoque a produzir mesmo com quantidade 0)
create or replace function public.previsao_item_adicional_etapa_trg_encerrado() returns trigger
language plpgsql security definer set search_path to 'public', 'pg_temp' as $fn$
begin
  if exists (select 1 from public.previsao_itens i join public.previsao_encerramentos e on e.previsao_id = i.previsao_id and e.produto_id = i.produto_id and e.reaberto_em is null where i.id = new.item_id) then
    return null;
  end if;
  return new;
end;
$fn$;
drop trigger if exists trg_previsao_item_adicional_etapa_encerrado on public.previsao_item_adicional_etapa;
create trigger trg_previsao_item_adicional_etapa_encerrado before insert on public.previsao_item_adicional_etapa
  for each row execute function public.previsao_item_adicional_etapa_trg_encerrado();

-- ENCERRAR: guarda a meta original e zera a demanda operacional do produto na semana
create or replace function public.previsao_produto_encerrar(p_previsao_id uuid, p_produto_id uuid, p_motivo text default null) returns jsonb
language plpgsql security definer set search_path to 'public', 'pg_temp' as $fn$
declare
  v_user uuid; v_qtd numeric; v_adic numeric; v_n integer; v_id uuid;
begin
  select id into v_user from public.usuarios where auth_user_id = auth.uid() and ativo = true;
  if v_user is null then raise exception 'Usuário autenticado não encontrado ou inativo'; end if;
  if not (public.is_admin() or public.has_permissao('previsao')) then raise exception 'PREVISAO_ENCERRAR_SEM_PERMISSAO: é preciso a permissão Previsão para encerrar um produto na semana'; end if;
  perform pg_advisory_xact_lock(hashtextextended('previsao_encerrar|' || p_previsao_id::text || '|' || p_produto_id::text, 0));
  if exists (select 1 from public.previsao_encerramentos where previsao_id = p_previsao_id and produto_id = p_produto_id and reaberto_em is null) then
    raise exception 'PREVISAO_PRODUTO_JA_ENCERRADO: este produto já está encerrado nesta semana';
  end if;
  select count(*), coalesce(sum(quantidade), 0), coalesce(sum(coalesce(quantidade_adicional, 0)), 0) into v_n, v_qtd, v_adic
    from public.previsao_itens where previsao_id = p_previsao_id and produto_id = p_produto_id and tipo = 'previsto';
  if v_n = 0 then raise exception 'PREVISAO_PRODUTO_SEM_ITEM: o produto não está previsto nesta semana'; end if;
  insert into public.previsao_encerramentos (previsao_id, produto_id, quantidade_original, adicional_original, encerrado_por, motivo)
    values (p_previsao_id, p_produto_id, v_qtd, v_adic, v_user, nullif(btrim(coalesce(p_motivo, '')), '')) returning id into v_id;
  update public.previsao_itens set quantidade = 0, quantidade_adicional = 0 where previsao_id = p_previsao_id and produto_id = p_produto_id and tipo = 'previsto';
  delete from public.previsao_item_adicional_etapa where item_id in (select id from public.previsao_itens where previsao_id = p_previsao_id and produto_id = p_produto_id and tipo = 'previsto');
  return jsonb_build_object('encerramento_id', v_id, 'quantidade_original', v_qtd, 'adicional_original', v_adic);
end;
$fn$;

-- REABRIR (só admin): devolve a meta original ao primeiro item do produto. ATENÇÃO: o motor volta a programar o produto no próximo recálculo.
create or replace function public.previsao_produto_reabrir(p_previsao_id uuid, p_produto_id uuid) returns jsonb
language plpgsql security definer set search_path to 'public', 'pg_temp' as $fn$
declare
  v_user uuid; v_enc public.previsao_encerramentos; v_item uuid;
begin
  select id into v_user from public.usuarios where auth_user_id = auth.uid() and ativo = true;
  if v_user is null then raise exception 'Usuário autenticado não encontrado ou inativo'; end if;
  if not public.is_admin() then raise exception 'PREVISAO_REABRIR_SOMENTE_ADMIN: só um administrador reabre um produto encerrado'; end if;
  perform pg_advisory_xact_lock(hashtextextended('previsao_encerrar|' || p_previsao_id::text || '|' || p_produto_id::text, 0));
  select * into v_enc from public.previsao_encerramentos where previsao_id = p_previsao_id and produto_id = p_produto_id and reaberto_em is null for update;
  if not found then raise exception 'PREVISAO_PRODUTO_NAO_ENCERRADO: o produto não está encerrado nesta semana'; end if;
  update public.previsao_encerramentos set reaberto_em = now(), reaberto_por = v_user where id = v_enc.id;
  select id into v_item from public.previsao_itens where previsao_id = p_previsao_id and produto_id = p_produto_id and tipo = 'previsto' order by created_at, id limit 1;
  if v_item is not null then update public.previsao_itens set quantidade = v_enc.quantidade_original, quantidade_adicional = v_enc.adicional_original where id = v_item; end if;
  return jsonb_build_object('encerramento_id', v_enc.id, 'quantidade_restaurada', v_enc.quantidade_original);
end;
$fn$;

revoke all on function public.previsao_produto_encerrar(uuid, uuid, text) from public;
revoke all on function public.previsao_produto_reabrir(uuid, uuid) from public;
grant execute on function public.previsao_produto_encerrar(uuid, uuid, text) to authenticated, service_role;
grant execute on function public.previsao_produto_reabrir(uuid, uuid) to authenticated, service_role;

commit;
