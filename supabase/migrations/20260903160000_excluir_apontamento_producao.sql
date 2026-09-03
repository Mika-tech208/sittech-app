-- Sittech — schema PostgreSQL, migration 23
-- Exclusão de apontamento realizado (Produção Real → Apontamentos
-- realizados), com histórico preservado antes do DELETE.
--
-- Mapeamento de FKs feito antes de escrever esta migration (consultado
-- direto no pg_catalog do DEV, não só nos arquivos de migration):
--   * apontamento_paradas.apontamento_id -> apontamentos_producao(id)
--     ON DELETE CASCADE — cobre tanto paradas manuais (ocorrencia_id
--     null) quanto o VÍNCULO da parada automática (ocorrencia_id
--     preenchido). Apagar o apontamento já apaga essas linhas sozinho —
--     nenhum DELETE explícito nelas é necessário aqui.
--   * apontamento_paradas.ocorrencia_id -> ocorrencias_maquina(id) ON
--     DELETE RESTRICT — nunca é o lado apagado por essa operação (só
--     removemos a linha de apontamento_paradas que APONTA pra ocorrência,
--     nunca a ocorrência em si) — confirma que ocorrencias_maquina nunca
--     é tocada, exatamente como pedido.
--   * apontamento_producao_historico.apontamento_id ->
--     apontamentos_producao(id) ON DELETE CASCADE — ESTE é o problema:
--     se eu gravasse o registro de auditoria da exclusão (INSERT em
--     apontamento_producao_historico) e SÓ DEPOIS apagasse o
--     apontamento, o CASCADE apagaria também a linha de auditoria que
--     acabei de gravar (e todo o histórico de edições anteriores desse
--     apontamento) — o mecanismo de preservar evidência se autodestruiria
--     junto com o DELETE. Reportando conforme pedido: a menor adaptação
--     é trocar esse ON DELETE CASCADE por ON DELETE SET NULL (e permitir
--     apontamento_id nulo) — como efeito colateral positivo, isso
--     também passa a preservar o histórico de EDIÇÕES anteriores de um
--     apontamento que depois é excluído, que hoje seria perdido junto
--     (CASCADE apaga tudo). O snapshot da exclusão (dados_anteriores)
--     grava o próprio apontamento_id dentro do jsonb, então continua
--     identificável mesmo com a coluna apontamento_id virando NULL.
--   * Nenhuma outra tabela referencia apontamentos_producao (conferido
--     via information_schema.referential_constraints).

-- ---------------------------------------------------------------------
-- 1) apontamento_producao_historico — permite apontamento_id nulo e
--    troca CASCADE por SET NULL, só nessa FK.
-- ---------------------------------------------------------------------
alter table public.apontamento_producao_historico
  alter column apontamento_id drop not null;

alter table public.apontamento_producao_historico
  drop constraint apontamento_producao_historico_apontamento_id_fkey;

alter table public.apontamento_producao_historico
  add constraint apontamento_producao_historico_apontamento_id_fkey
  foreign key (apontamento_id) references public.apontamentos_producao(id) on delete set null;

-- ---------------------------------------------------------------------
-- 2) excluir_apontamento_producao — exclusão transacional (uma function
--    plpgsql é uma única transação: qualquer exceção no meio desfaz tudo
--    — nenhum apagamento parcial, nenhum histórico incompleto).
--
--    Permissão: só admin ou has_permissao('producao_real_historico') —
--    checagem explícita, dentro da function, antes de qualquer leitura
--    ou escrita. producao_real_apontamento sozinho NÃO autoriza (não é
--    checado). Nenhuma permissão nova criada.
--
--    SECURITY INVOKER: quem passa nessa checagem (admin ou
--    producao_real_historico) já tem SELECT liberado em
--    apontamentos_producao pela policy atual (migration 21) — não
--    precisa rodar com privilégio elevado. DELETE em
--    apontamentos_producao/apontamento_paradas continua sob
--    is_usuario_ativo() (política existente, inalterada) — a permissão
--    checada aqui dentro é o portão real, não a RLS de escrita.
--
--    Ordem importa: o histórico é gravado ANTES do DELETE (a FK exige
--    que o apontamento ainda exista no momento do INSERT) — o DELETE
--    então dispara CASCADE em apontamento_paradas e SET NULL na linha de
--    histórico recém-gravada (e em qualquer histórico de edição
--    anterior), preservando tudo.
create or replace function public.excluir_apontamento_producao(p_apontamento_id uuid)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_usuario_id uuid;
  v_apontamento apontamentos_producao;
  v_paradas_manuais jsonb;
  v_ocorrencias_desvinculadas jsonb;
  v_dados_anteriores jsonb;
begin
  select id into v_usuario_id from usuarios where auth_user_id = auth.uid() and ativo = true;
  if v_usuario_id is null then
    raise exception 'Usuário autenticado não encontrado ou inativo';
  end if;

  if not (public.is_admin() or public.has_permissao('producao_real_historico')) then
    raise exception 'Usuário não tem permissão para excluir apontamentos';
  end if;

  select * into v_apontamento from apontamentos_producao where id = p_apontamento_id;
  if not found then
    raise exception 'Apontamento % não encontrado', p_apontamento_id;
  end if;

  -- Paradas manuais (ocorrencia_id null) — snapshot completo, é o que
  -- será apagado pelo CASCADE.
  select coalesce(jsonb_agg(jsonb_build_object(
    'motivo_id', motivo_id, 'minutos', minutos, 'descricao', descricao
  )), '[]'::jsonb)
  into v_paradas_manuais
  from apontamento_paradas
  where apontamento_id = p_apontamento_id and ocorrencia_id is null;

  -- Ocorrências que tinham parada vinculada a este apontamento — só pra
  -- registro/rastreio de qual vínculo foi desfeito; a ocorrência em si
  -- não é tocada.
  select coalesce(jsonb_agg(distinct ocorrencia_id), '[]'::jsonb)
  into v_ocorrencias_desvinculadas
  from apontamento_paradas
  where apontamento_id = p_apontamento_id and ocorrencia_id is not null;

  v_dados_anteriores := jsonb_build_object(
    'apontamento_id', v_apontamento.id,
    'maquina_id', v_apontamento.maquina_id,
    'produto_id', v_apontamento.produto_id,
    'funcionario_id', v_apontamento.funcionario_id,
    'data', v_apontamento.data,
    'periodo_id', v_apontamento.periodo_id,
    'status', v_apontamento.status,
    'quantidade_produzida', v_apontamento.quantidade_produzida,
    'quantidade_refugo', v_apontamento.quantidade_refugo,
    'motivo_sem_producao', v_apontamento.motivo_sem_producao,
    'descricao_sem_producao', v_apontamento.descricao_sem_producao,
    'observacao', v_apontamento.observacao,
    'paradas_manuais', v_paradas_manuais,
    'ocorrencias_desvinculadas', v_ocorrencias_desvinculadas
  );

  insert into apontamento_producao_historico (apontamento_id, dados_anteriores, dados_novos, alterado_por)
  values (p_apontamento_id, v_dados_anteriores, jsonb_build_object('excluido', true), v_usuario_id);

  delete from apontamentos_producao where id = p_apontamento_id;
end;
$$;

revoke all on function public.excluir_apontamento_producao(uuid) from public, anon, authenticated, service_role;
grant execute on function public.excluir_apontamento_producao(uuid) to authenticated;
