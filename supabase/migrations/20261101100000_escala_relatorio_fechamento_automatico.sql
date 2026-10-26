-- Sittech — Relatório semanal: FECHAMENTO AUTOMÁTICO (sexta 18:00 America/Sao_Paulo; sábado 18:00 se o sábado for produtivo) + ENVIO POR E-MAIL do PDF final.
--
-- • `escala_relatorio_config` (1 linha): liga/desliga o fechamento automático, "a partir de qual semana" (nada retroativo) e o destinatário. Nasce DESLIGADO (inerte): quem liga é uma ação
--   administrativa explícita. Fica fora de `escala_parametros` de propósito (mudar parâmetro dispara recálculo da Escala; isto não é parâmetro do motor).
-- • `escala_relatorio_fechamentos` (1 linha por semana+tipo): o FECHAMENTO LÓGICO (18:00) e a máquina de estados do trabalho — geração (pendente/gerado/erro) e e-mail (pendente/enviado/falhou) SEPARADOS,
--   tentativas, último erro, id do provedor. É a única parte mutável: o relatório (escala_relatorios) continua imutável.
-- • Idempotência: unique(semana, tipo) no fechamento + índice único parcial em escala_relatorios (um relatório automático por semana+tipo) + lease curto para dois workers não gerarem junto.
-- • `escala_relatorio_fontes(semana, como_de)`: com `como_de` devolve o ESTADO CONHECIDO NAQUELE INSTANTE (o worker pode rodar às 18:07 e o relatório continua sendo "o que o sistema sabia às 18:00"):
--   apontamentos/ausências criados depois são ignorados, edições posteriores são desfeitas pelo histórico, o plano oficial vem da versão vigente no instante.
--   Limites conhecidos: exclusões posteriores de apontamento não são reconstruíveis (o histórico da exclusão é apagado em cascata junto) e a equipe da semana (sem carimbo) vale a atual — ambas
--   aparecem como "alterações posteriores" na comparação do digest.

-- =========================================================================
-- 1) Relatório automático (marca + unicidade)
-- =========================================================================
alter table public.escala_relatorios add column fechamento_automatico boolean not null default false;
alter table public.escala_relatorios add constraint escala_relatorio_auto_final_exec check (not fechamento_automatico or (tipo = 'executada' and status = 'final'));
alter table public.escala_relatorios alter column gerado_por drop not null;   -- o fechamento automático é gerado pelo SISTEMA (sem usuário)
alter table public.escala_relatorios add constraint escala_relatorio_gerado_por_obrigatorio check (gerado_por is not null or fechamento_automatico);
create unique index uq_escala_relatorio_fechamento_auto on public.escala_relatorios (semana_inicio, tipo) where fechamento_automatico;

-- =========================================================================
-- 2) Configuração (nasce DESLIGADA)
-- =========================================================================
create table public.escala_relatorio_config (
  id boolean primary key default true check (id),
  automatico_ativo boolean not null default false,
  desde_semana date,                                   -- só semanas >= esta; NULL = nenhuma (o ligar exige informar)
  destinatario text not null default 'tamara@sittech.com.br' check (destinatario ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid references public.usuarios(id) on delete set null,
  constraint escala_relatorio_config_desde check (not automatico_ativo or desde_semana is not null)
);
insert into public.escala_relatorio_config (id) values (true);
alter table public.escala_relatorio_config enable row level security;
create policy escala_relatorio_config_select on public.escala_relatorio_config for select to authenticated using (public.is_admin());
revoke all on public.escala_relatorio_config from anon, authenticated;
grant select on public.escala_relatorio_config to authenticated, service_role;

create or replace function public.escala_relatorio_config_definir(p_ativo boolean, p_desde date, p_destinatario text default null)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare r public.escala_relatorio_config;
begin
  if not public.is_admin() then raise exception 'FUNC_SOMENTE_ADMIN: somente administrador altera o fechamento automático'; end if;
  if p_desde is not null and extract(isodow from p_desde) <> 1 then raise exception 'desde_semana precisa ser uma segunda-feira'; end if;
  update public.escala_relatorio_config
     set automatico_ativo = p_ativo, desde_semana = p_desde, destinatario = coalesce(nullif(btrim(p_destinatario), ''), destinatario), atualizado_em = now(), atualizado_por = public.escala_usuario_atual()
   where id returning * into r;
  return to_jsonb(r);
end;
$$;
revoke all on function public.escala_relatorio_config_definir(boolean, date, text) from public, anon;
grant execute on function public.escala_relatorio_config_definir(boolean, date, text) to authenticated;

-- =========================================================================
-- 3) Fechamentos (estado do trabalho automático — geração e e-mail separados)
-- =========================================================================
create table public.escala_relatorio_fechamentos (
  id uuid primary key default gen_random_uuid(),
  semana_inicio date not null,
  tipo text not null default 'executada' check (tipo = 'executada'),
  fechamento_logico_em timestamptz not null,           -- sexta (ou sábado) 18:00 America/Sao_Paulo — o "consolidado até" do relatório final, mesmo que o worker rode depois
  geracao_status text not null default 'pendente' check (geracao_status in ('pendente', 'gerado', 'erro')),
  geracao_tentativas integer not null default 0,
  geracao_ultimo_erro text,
  geracao_ultima_tentativa_em timestamptz,
  relatorio_id uuid references public.escala_relatorios(id) on delete restrict,
  email_destinatario text not null,
  email_status text not null default 'pendente' check (email_status in ('pendente', 'enviado', 'falhou')),
  email_tentativas integer not null default 0,
  email_ultimo_erro text,
  email_ultima_tentativa_em timestamptz,
  email_enviado_em timestamptz,
  email_provedor_id text,                              -- identificador devolvido pelo provedor (nunca credencial)
  lease_ate timestamptz,                               -- trava curta: dois workers não processam o mesmo fechamento ao mesmo tempo
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint escala_relatorio_fechamento_unico unique (semana_inicio, tipo),
  constraint escala_relatorio_fechamento_gerado check ((geracao_status = 'gerado') = (relatorio_id is not null)),
  constraint escala_relatorio_fechamento_email check (email_status <> 'enviado' or (geracao_status = 'gerado' and email_enviado_em is not null))
);
alter table public.escala_relatorio_fechamentos enable row level security;
create policy escala_relatorio_fechamentos_select on public.escala_relatorio_fechamentos for select to authenticated using (public.has_permissao('escala_relatorios'));
revoke all on public.escala_relatorio_fechamentos from anon, authenticated;
grant select on public.escala_relatorio_fechamentos to authenticated;
grant select, insert, update on public.escala_relatorio_fechamentos to service_role;

-- reivindica o trabalho (idempotente): cria a linha se não existir; devolve NULL se outro worker está com a trava ou se já está tudo feito
create or replace function public.escala_relatorio_fechamento_reivindicar(p_semana date, p_logico timestamptz, p_destinatario text, p_lease_segundos integer default 240)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare r public.escala_relatorio_fechamentos;
begin
  insert into public.escala_relatorio_fechamentos (semana_inicio, tipo, fechamento_logico_em, email_destinatario)
  values (p_semana, 'executada', p_logico, p_destinatario)
  on conflict (semana_inicio, tipo) do nothing;
  select * into r from public.escala_relatorio_fechamentos where semana_inicio = p_semana and tipo = 'executada' for update;
  if r.geracao_status = 'gerado' and r.email_status = 'enviado' then return null; end if;           -- tudo feito
  if r.lease_ate is not null and r.lease_ate > now() then return null; end if;                          -- outro worker
  update public.escala_relatorio_fechamentos set lease_ate = now() + make_interval(secs => p_lease_segundos), atualizado_em = now() where id = r.id returning * into r;
  return to_jsonb(r);
end;
$$;
revoke all on function public.escala_relatorio_fechamento_reivindicar(date, timestamptz, text, integer) from public, anon, authenticated;
grant execute on function public.escala_relatorio_fechamento_reivindicar(date, timestamptz, text, integer) to service_role;

create or replace function public.escala_relatorio_fechamento_gerado(p_id uuid, p_relatorio uuid)
returns void language sql security definer set search_path = public, pg_temp as $$
  update public.escala_relatorio_fechamentos set geracao_status = 'gerado', relatorio_id = p_relatorio, geracao_ultimo_erro = null, geracao_tentativas = geracao_tentativas + 1,
         geracao_ultima_tentativa_em = now(), atualizado_em = now() where id = p_id;
$$;
create or replace function public.escala_relatorio_fechamento_erro_geracao(p_id uuid, p_erro text)
returns void language sql security definer set search_path = public, pg_temp as $$
  update public.escala_relatorio_fechamentos set geracao_status = 'erro', geracao_tentativas = geracao_tentativas + 1, geracao_ultimo_erro = left(coalesce(p_erro, 'erro'), 500),
         geracao_ultima_tentativa_em = now(), lease_ate = null, atualizado_em = now() where id = p_id and geracao_status <> 'gerado';
$$;
-- resultado de UMA tentativa de e-mail (o PDF/relatório nunca é regerado por falha de e-mail)
create or replace function public.escala_relatorio_fechamento_email(p_id uuid, p_ok boolean, p_erro text default null, p_provedor_id text default null)
returns void language sql security definer set search_path = public, pg_temp as $$
  update public.escala_relatorio_fechamentos set
    email_status = case when p_ok then 'enviado' else 'falhou' end,
    email_tentativas = email_tentativas + 1,
    email_ultima_tentativa_em = now(),
    email_enviado_em = case when p_ok then now() else email_enviado_em end,
    email_ultimo_erro = case when p_ok then null else left(coalesce(p_erro, 'erro'), 500) end,
    email_provedor_id = case when p_ok then p_provedor_id else email_provedor_id end,
    lease_ate = null, atualizado_em = now()
  where id = p_id and email_status <> 'enviado';
$$;
create or replace function public.escala_relatorio_fechamento_liberar(p_id uuid)
returns void language sql security definer set search_path = public, pg_temp as $$
  update public.escala_relatorio_fechamentos set lease_ate = null, atualizado_em = now() where id = p_id;
$$;
revoke all on function public.escala_relatorio_fechamento_gerado(uuid, uuid), public.escala_relatorio_fechamento_erro_geracao(uuid, text),
  public.escala_relatorio_fechamento_email(uuid, boolean, text, text), public.escala_relatorio_fechamento_liberar(uuid) from public, anon, authenticated;
grant execute on function public.escala_relatorio_fechamento_gerado(uuid, uuid), public.escala_relatorio_fechamento_erro_geracao(uuid, text),
  public.escala_relatorio_fechamento_email(uuid, boolean, text, text), public.escala_relatorio_fechamento_liberar(uuid) to service_role;

-- =========================================================================
-- 4) Registro: agora aceita o fechamento automático (único por semana+tipo; vincula o fechamento)
-- =========================================================================
drop function if exists public.escala_relatorio_registrar(uuid, date, text, integer, text, text, timestamptz, timestamptz, timestamptz, uuid, integer, text, text, text, jsonb, bytea, text);
create or replace function public.escala_relatorio_registrar(
  p_id uuid, p_semana date, p_tipo text, p_versao integer, p_codigo text, p_status text,
  p_consolidado_ate timestamptz, p_elegivel_final_em timestamptz, p_gerado_em timestamptz, p_gerado_por uuid, p_schema integer,
  p_conteudo_canonico text, p_hash text, p_fonte_digest text, p_periodos jsonb, p_pdf bytea, p_pdf_sha256 text,
  p_fechamento_automatico boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_prox jsonb; v_id uuid;
begin
  if abs(extract(epoch from (p_gerado_em - now()))) > 120 then raise exception 'ESCALA_RELATORIO_RELOGIO: gerado_em precisa ser o instante atual do servidor'; end if;
  v_prox := public.escala_relatorio_proximo(p_semana, p_tipo);
  if (v_prox->>'versao')::integer <> p_versao or v_prox->>'codigo' <> p_codigo then
    raise exception 'ESCALA_RELATORIO_VERSAO_CONFLITO: outra versão foi gerada no meio do caminho (esperado % v%)', v_prox->>'codigo', v_prox->>'versao';
  end if;
  if p_hash <> encode(sha256(convert_to(p_conteudo_canonico, 'utf8')), 'hex') then raise exception 'ESCALA_RELATORIO_HASH: hash do conteúdo não confere'; end if;
  if p_pdf_sha256 <> encode(sha256(p_pdf), 'hex') then raise exception 'ESCALA_RELATORIO_PDF_HASH: hash do PDF não confere'; end if;
  if p_fechamento_automatico and not exists (select 1 from public.escala_relatorio_fechamentos f where f.semana_inicio = p_semana and f.tipo = p_tipo and f.geracao_status <> 'gerado') then
    raise exception 'ESCALA_RELATORIO_FECHAMENTO: não há fechamento automático pendente para esta semana';
  end if;

  insert into public.escala_relatorios (id, codigo, semana_inicio, tipo, versao, status, consolidado_ate, elegivel_final_em, gerado_em, gerado_por, schema_versao,
    conteudo_canonico, conteudo, hash_sha256, fonte_digest, periodos_considerados, pdf_sha256, pdf_bytes, fechamento_automatico)
  values (p_id, p_codigo, p_semana, p_tipo, p_versao, p_status, p_consolidado_ate, p_elegivel_final_em, p_gerado_em, p_gerado_por, p_schema,
    p_conteudo_canonico, p_conteudo_canonico::jsonb, p_hash, p_fonte_digest, p_periodos, p_pdf_sha256, length(p_pdf), coalesce(p_fechamento_automatico, false))
  returning id into v_id;
  insert into public.escala_relatorio_pdfs (relatorio_id, pdf) values (v_id, p_pdf);
  if p_fechamento_automatico then
    update public.escala_relatorio_fechamentos set geracao_status = 'gerado', relatorio_id = v_id, geracao_ultimo_erro = null, geracao_tentativas = geracao_tentativas + 1,
           geracao_ultima_tentativa_em = now(), atualizado_em = now() where semana_inicio = p_semana and tipo = p_tipo;
  end if;
  return v_id;
end;
$$;
revoke all on function public.escala_relatorio_registrar(uuid, date, text, integer, text, text, timestamptz, timestamptz, timestamptz, uuid, integer, text, text, text, jsonb, bytea, text, boolean) from public, anon, authenticated;
grant execute on function public.escala_relatorio_registrar(uuid, date, text, integer, text, text, timestamptz, timestamptz, timestamptz, uuid, integer, text, text, text, jsonb, bytea, text, boolean) to service_role;

-- =========================================================================
-- 5) Insumos "como de" um instante (estado conhecido no fechamento lógico)
-- =========================================================================
drop function if exists public.escala_relatorio_fontes(date);
create or replace function public.escala_relatorio_fontes(p_semana date, p_como_de timestamptz default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_prev uuid;
  v_fim date := p_semana + 6;
  v_ref timestamptz := coalesce(p_como_de, now());
  v_ver public.escala_plano_versoes;
begin
  select id into v_prev from public.previsoes where semana_inicio = p_semana;
  if v_prev is null then raise exception 'ESCALA_RELATORIO_SEM_PREVISAO: não existe Previsão para a semana %', p_semana; end if;
  select * into v_ver from public.escala_plano_versoes v where v.previsao_id = v_prev and v.valido_desde <= v_ref order by v.valido_desde desc limit 1;

  return jsonb_build_object(
    'agoraBanco', now(),
    'comoDe', p_como_de,
    'semanaInicio', p_semana,
    'previsaoId', v_prev,
    'diasProdutivos', (select coalesce(jsonb_agg(d.dia::text order by d.dia), '[]'::jsonb) from public.previsao_dias_produtivos d where d.previsao_id = v_prev and d.ativo),
    'periodosPorDia', case
      when p_como_de is not null and v_ver.id is not null then
        (select coalesce(jsonb_object_agg(d->>'data', d->'periodos_snapshot'), '{}'::jsonb) from jsonb_array_elements(v_ver.dias) d where (d->>'data')::date between p_semana and v_fim)
      else
        (select coalesce(jsonb_object_agg(d.data::text, d.periodos_snapshot), '{}'::jsonb) from public.escala_producao_dias d where d.data between p_semana and v_fim)
    end,
    'periodosPadrao', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'nome', p.nome, 'inicio', to_char(p.inicio, 'HH24:MI'), 'fim', to_char(p.fim, 'HH24:MI')) order by p.inicio), '[]'::jsonb) from public.periodos p),
    'equipe', (select coalesce(jsonb_agg(e.funcionario_id order by e.funcionario_id), '[]'::jsonb) from public.previsao_equipe_semana e where e.previsao_id = v_prev and e.produtivo),
    -- Escala oficial: sem "como_de" ou sem versão anterior ao instante = linhas atuais; com versão = as linhas da versão vigente no instante
    'oficial', case
      when p_como_de is not null and v_ver.id is not null then
        (select coalesce(jsonb_agg(jsonb_build_object('data', l->>0, 'periodoId', l->>1, 'funcionarioId', l->>2, 'maquinaId', l->>3, 'produtoId', l->>4, 'operacaoId', l->>6,
            'pecas', coalesce((l->>7)::numeric, 0), 'origem', case when l->>11 = 'm' then 'manual' else 'auto' end, 'motivoSemPosto', l->>10, 'excecaoRevezamento', false)
            order by l->>0, l->>1, l->>2), '[]'::jsonb)
           from jsonb_array_elements(v_ver.linhas) l where (l->>0)::date between p_semana and v_fim)
      else
        (select coalesce(jsonb_agg(jsonb_build_object(
          'data', a.data, 'periodoId', a.periodo_id, 'funcionarioId', a.funcionario_id, 'maquinaId', a.maquina_id, 'produtoId', a.produto_id,
          'operacaoId', a.operacao_id, 'pecas', a.pecas, 'origem', a.origem, 'motivoSemPosto', a.motivo_sem_posto, 'excecaoRevezamento', a.excecao_revezamento)
          order by a.data, a.periodo_id, a.funcionario_id), '[]'::jsonb)
          from public.escala_producao_alocacoes a where a.data between p_semana and v_fim)
    end,
    -- Apontamentos: criados até o instante; edições POSTERIORES são desfeitas pelo histórico (o valor mais antigo de cada campo entre as edições posteriores é o valor no instante)
    'apontamentos', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'id', ap.id, 'data', ap.data, 'periodoId', ap.periodo_id, 'maquinaId', ap.maquina_id,
          'funcionarioId', case when e.estado ? 'funcionario_id' then (e.estado->>'funcionario_id')::uuid else ap.funcionario_id end,
          'produtoId', case when e.estado ? 'produto_id' then (e.estado->>'produto_id')::uuid else ap.produto_id end,
          'operacaoId', case when e.estado ? 'operacao_id' then (e.estado->>'operacao_id')::uuid else ap.operacao_id end,
          'produzido', case when e.estado ? 'quantidade_produzida' then (e.estado->>'quantidade_produzida')::numeric else ap.quantidade_produzida end,
          'refugo', case when e.estado ? 'quantidade_refugo' then (e.estado->>'quantidade_refugo')::numeric else ap.quantidade_refugo end,
          'status', case when e.estado ? 'status' then e.estado->>'status' else ap.status end,
          'motivo', case when e.estado ? 'motivo_sem_producao' then e.estado->>'motivo_sem_producao' else ap.motivo_sem_producao end)
          order by ap.data, ap.periodo_id, ap.maquina_id, ap.id), '[]'::jsonb)
      from public.apontamentos_producao ap
      left join lateral (
        select jsonb_object_agg(k.key, k.value order by h.alterado_em desc, h.id desc) as estado
          from public.apontamento_producao_historico h, jsonb_each(h.dados_anteriores) k
         where p_como_de is not null and h.apontamento_id = ap.id and h.alterado_em > p_como_de and (h.dados_novos ->> 'excluido') is null
      ) e on true
      where ap.data between p_semana and v_fim and (p_como_de is null or ap.criado_em <= p_como_de)),
    'ausencias', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'funcionarioId', au.funcionario_id, 'data', au.data, 'tipo', case when e.estado ? 'tipo' then e.estado->>'tipo' else au.tipo end,
          'inicio', case when e.estado ? 'horario_inicio' then e.estado->>'horario_inicio' else au.horario_inicio::text end,
          'fim', case when e.estado ? 'horario_fim' then e.estado->>'horario_fim' else au.horario_fim::text end,
          'emAberto', case when e.estado ? 'em_aberto' then (e.estado->>'em_aberto')::boolean else au.em_aberto end)
          order by au.data, au.funcionario_id, au.id), '[]'::jsonb)
      from public.ausencias_funcionarios au
      left join lateral (
        select jsonb_object_agg(k.key, k.value order by h.alterado_em desc, h.id desc) as estado
          from public.ausencia_funcionario_historico h, jsonb_each(h.dados_anteriores) k
         where p_como_de is not null and h.ausencia_id = au.id and h.alterado_em > p_como_de
      ) e on true
      where au.data between p_semana and v_fim and (p_como_de is null or au.criado_em <= p_como_de)),
    'ajustesManuais', (select coalesce(jsonb_agg(jsonb_build_object('em', ev.criado_em, 'payload', ev.payload) order by ev.criado_em, ev.id), '[]'::jsonb)
        from public.escala_producao_eventos ev where ev.previsao_id = v_prev and ev.tipo = 'edicao_manual' and ev.criado_em <= v_ref),
    'planoVersao', case when v_ver.id is null then null else jsonb_build_object('id', v_ver.id, 'hashPlano', v_ver.hash_plano, 'validoDesde', v_ver.valido_desde) end,
    'situacaoFuncionarios', (select coalesce(jsonb_agg(jsonb_build_object('funcionarioId', h.funcionario_id, 'acao', h.acao, 'efetivoEm', h.efetivo_em, 'registradoEm', h.registrado_em,
        'ativoAntes', h.ativo_antes, 'ativoDepois', h.ativo_depois) order by h.efetivo_em, h.registrado_em), '[]'::jsonb)
        from public.funcionario_situacao_historico h where h.registrado_em <= v_ref),
    'funcionarios', (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'nome', f.nome, 'ativo', f.ativo) order by f.nome, f.id), '[]'::jsonb) from public.funcionarios f),
    'maquinas', (select coalesce(jsonb_object_agg(m.id::text, m.nome), '{}'::jsonb) from public.maquinas m),
    'produtos', (select coalesce(jsonb_object_agg(p.id::text, p.nome), '{}'::jsonb) from public.produtos p),
    'operacoes', (select coalesce(jsonb_object_agg(o.id::text, o.nome), '{}'::jsonb) from public.operacoes o)
  );
end;
$$;
revoke all on function public.escala_relatorio_fontes(date, timestamptz) from public, anon, authenticated;
grant execute on function public.escala_relatorio_fontes(date, timestamptz) to service_role;

-- =========================================================================
-- 6) Lista interna: agora com o fechamento automático e o e-mail
-- =========================================================================
create or replace function public.escala_relatorio_listar(p_semana date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.has_permissao('escala_relatorios') then raise exception 'Usuário não tem permissão para consultar relatórios da Escala'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', r.id, 'codigo', r.codigo, 'tipo', r.tipo, 'versao', r.versao, 'status', r.status, 'geradoEm', r.gerado_em,
      'consolidadoAte', r.consolidado_ate, 'geradoPor', u.nome, 'hash', r.hash_sha256, 'pdfBytes', r.pdf_bytes, 'fonteDigest', r.fonte_digest, 'periodosConsiderados', r.periodos_considerados,
      'fechamentoAutomatico', r.fechamento_automatico,
      'email', case when f.id is null then null else jsonb_build_object('status', f.email_status, 'destinatario', f.email_destinatario, 'enviadoEm', f.email_enviado_em,
          'tentativas', f.email_tentativas, 'ultimoErro', f.email_ultimo_erro) end)
      order by r.tipo, r.versao desc)
    from public.escala_relatorios r
    left join public.usuarios u on u.id = r.gerado_por
    left join public.escala_relatorio_fechamentos f on f.relatorio_id = r.id
    where r.semana_inicio = p_semana), '[]'::jsonb);
end;
$$;

-- ROLLBACK: drop das funções escala_relatorio_fechamento_*, escala_relatorio_config_definir; tabelas escala_relatorio_fechamentos/config (se vazias); a coluna/índice fechamento_automatico podem ficar (inertes);
-- restaurar escala_relatorio_fontes(date) e escala_relatorio_registrar sem o parâmetro final (migration 20261031100000).
