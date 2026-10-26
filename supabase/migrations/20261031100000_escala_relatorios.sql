-- Sittech — Escala de Produção: RELATÓRIOS SEMANAIS EM PDF (Escala planejada / Revezamento executado), com SNAPSHOT IMUTÁVEL e hash.
--
-- • `escala_relatorios`: append-only. Cada linha é UMA VERSÃO de um relatório: o conteúdo canônico (texto exato que foi hasheado + jsonb), o SHA-256 do conteúdo
--   (o próprio banco confere), o digest dos insumos (para detectar "alterações posteriores"), o SHA-256 do PDF entregue, quem/quando gerou, parcial/final.
--   UPDATE/DELETE são recusados por trigger. Nada de reconstruir PDF a partir de dados atuais: o PDF nasce do snapshot.
-- • `escala_relatorio_pdfs`: o arquivo (bytea) — também append-only; o hash do arquivo é conferido contra a linha do relatório.
-- • O id da versão é decidido pelo servidor ANTES do hash (o QR/URL de verificação faz parte do conteúdo hasheado).
-- • `escala_relatorio_fontes(semana)`: leitura ÚNICA e consistente (uma chamada) dos insumos — só service_role (o servidor monta o conteúdo; o navegador nunca envia conteúdo).
-- • Permissão própria `escala_relatorios` (administrador sempre pode): gerar, consultar, baixar, ver versões. A página pública do QR NÃO usa essa permissão e só mostra metadados.
-- Aditiva: nenhuma tabela existente é alterada (exceto o CHECK de permissões, que ganha um valor).

-- =========================================================================
-- 1) Permissão
-- =========================================================================
alter table public.usuario_permissoes drop constraint usuario_permissoes_permissao_check;
alter table public.usuario_permissoes add constraint usuario_permissoes_permissao_check check (permissao in (
  'financeiro', 'produtos', 'maquinas', 'funcionarios', 'custo_hora',
  'previsao', 'capacidade',
  'producao_real_apontamento', 'producao_real_historico', 'producao_real_ocorrencias',
  'producao_real_apontamentos_realizados',
  'usuarios', 'auditoria',
  'ausencias_funcionarios',
  'escala_producao', 'escala_producao_tv',
  'escala_wip_confirmar',
  'escala_relatorios'
));

-- =========================================================================
-- 2) Tabelas (append-only)
-- =========================================================================
create table public.escala_relatorios (
  id uuid primary key default gen_random_uuid(),
  codigo text not null,                          -- ESC-EXEC-2026-44-0001 / ESC-PLAN-2026-44-0001 (família = semana + tipo; versões compartilham o código)
  semana_inicio date not null,
  tipo text not null check (tipo in ('planejada', 'executada')),
  versao integer not null check (versao >= 1),
  status text not null check (status in ('parcial', 'final')),
  consolidado_ate timestamptz not null,          -- "dados consolidados até"
  elegivel_final_em timestamptz not null,        -- fim do último período produtivo + 2 h: a partir daqui o relatório pode ser FINAL
  gerado_em timestamptz not null,
  gerado_por uuid not null references public.usuarios(id) on delete restrict,
  schema_versao integer not null,
  conteudo_canonico text not null,               -- o texto EXATO hasheado
  conteudo jsonb not null,                       -- o mesmo conteúdo, consultável
  hash_sha256 text not null,                     -- SHA-256 do conteudo_canonico
  fonte_digest text not null,                    -- SHA-256 dos insumos usados (detecta alterações posteriores sem alterar este registro)
  periodos_considerados jsonb not null,          -- ["2026-10-26|m1", …]: o recorte que o digest cobre
  pdf_sha256 text not null,                      -- SHA-256 do arquivo PDF entregue
  pdf_bytes integer not null check (pdf_bytes > 0),
  criado_em timestamptz not null default now(),
  constraint escala_relatorio_codigo_formato check (codigo ~ '^ESC-(EXEC|PLAN)-[0-9]{4}-[0-9]{2}-[0-9]{4}$'),
  constraint escala_relatorio_codigo_tipo check ((tipo = 'executada' and codigo like 'ESC-EXEC-%') or (tipo = 'planejada' and codigo like 'ESC-PLAN-%')),
  constraint escala_relatorio_hashes_formato check (hash_sha256 ~ '^[0-9a-f]{64}$' and fonte_digest ~ '^[0-9a-f]{64}$' and pdf_sha256 ~ '^[0-9a-f]{64}$'),
  -- o BANCO confere o hash do conteúdo e que o jsonb é o mesmo conteúdo
  constraint escala_relatorio_hash_confere check (hash_sha256 = encode(sha256(convert_to(conteudo_canonico, 'utf8')), 'hex')),
  constraint escala_relatorio_conteudo_confere check (conteudo = conteudo_canonico::jsonb),
  -- FINAL só depois de elegível; o sistema decide (não o usuário)
  constraint escala_relatorio_final_elegivel check (status <> 'final' or gerado_em >= elegivel_final_em),
  constraint escala_relatorio_versao_unica unique (semana_inicio, tipo, versao),
  constraint escala_relatorio_codigo_versao_unica unique (codigo, versao)
);
create index idx_escala_relatorios_semana on public.escala_relatorios (semana_inicio, tipo, versao);

create table public.escala_relatorio_pdfs (
  relatorio_id uuid primary key references public.escala_relatorios(id) on delete restrict,
  pdf bytea not null
);

create or replace function public.escala_relatorios_imutavel()
returns trigger language plpgsql as $$
begin
  raise exception 'ESCALA_RELATORIO_IMUTAVEL: relatórios gerados não podem ser alterados nem apagados — gere uma nova versão';
end;
$$;
create trigger trg_escala_relatorios_imutavel before update or delete on public.escala_relatorios for each row execute function public.escala_relatorios_imutavel();
create trigger trg_escala_relatorio_pdfs_imutavel before update or delete on public.escala_relatorio_pdfs for each row execute function public.escala_relatorios_imutavel();

-- o arquivo precisa ter exatamente o hash registrado no relatório
create or replace function public.escala_relatorio_pdfs_confere()
returns trigger language plpgsql as $$
declare v_hash text; v_bytes integer;
begin
  select pdf_sha256, pdf_bytes into v_hash, v_bytes from public.escala_relatorios where id = new.relatorio_id;
  if v_hash is null or v_hash <> encode(sha256(new.pdf), 'hex') or v_bytes <> length(new.pdf) then
    raise exception 'ESCALA_RELATORIO_PDF_HASH: o PDF não confere com o hash/tamanho registrados';
  end if;
  return new;
end;
$$;
create trigger trg_escala_relatorio_pdfs_confere before insert on public.escala_relatorio_pdfs for each row execute function public.escala_relatorio_pdfs_confere();

alter table public.escala_relatorios enable row level security;
alter table public.escala_relatorio_pdfs enable row level security;
create policy escala_relatorios_select on public.escala_relatorios for select to authenticated using (public.has_permissao('escala_relatorios'));
create policy escala_relatorio_pdfs_select on public.escala_relatorio_pdfs for select to authenticated using (public.has_permissao('escala_relatorios'));
revoke all on public.escala_relatorios, public.escala_relatorio_pdfs from anon, authenticated;
grant select on public.escala_relatorios, public.escala_relatorio_pdfs to authenticated;
grant select, insert on public.escala_relatorios, public.escala_relatorio_pdfs to service_role;

-- =========================================================================
-- 3) Insumos (UMA chamada = visão consistente) — só service_role
-- =========================================================================
create or replace function public.escala_relatorio_fontes(p_semana date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_prev uuid;
  v_fim date := p_semana + 6;
begin
  select id into v_prev from public.previsoes where semana_inicio = p_semana;
  if v_prev is null then raise exception 'ESCALA_RELATORIO_SEM_PREVISAO: não existe Previsão para a semana %', p_semana; end if;

  return jsonb_build_object(
    'agoraBanco', now(),
    'semanaInicio', p_semana,
    'previsaoId', v_prev,
    'diasProdutivos', (select coalesce(jsonb_agg(d.dia::text order by d.dia), '[]'::jsonb) from public.previsao_dias_produtivos d where d.previsao_id = v_prev and d.ativo),
    'periodosPorDia', (select coalesce(jsonb_object_agg(d.data::text, d.periodos_snapshot), '{}'::jsonb) from public.escala_producao_dias d where d.data between p_semana and v_fim),
    'periodosPadrao', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'nome', p.nome, 'inicio', to_char(p.inicio, 'HH24:MI'), 'fim', to_char(p.fim, 'HH24:MI')) order by p.inicio), '[]'::jsonb) from public.periodos p),
    'equipe', (select coalesce(jsonb_agg(e.funcionario_id order by e.funcionario_id), '[]'::jsonb) from public.previsao_equipe_semana e where e.previsao_id = v_prev and e.produtivo),
    'oficial', (select coalesce(jsonb_agg(jsonb_build_object(
        'data', a.data, 'periodoId', a.periodo_id, 'funcionarioId', a.funcionario_id, 'maquinaId', a.maquina_id, 'produtoId', a.produto_id,
        'operacaoId', a.operacao_id, 'pecas', a.pecas, 'origem', a.origem, 'motivoSemPosto', a.motivo_sem_posto, 'excecaoRevezamento', a.excecao_revezamento)
        order by a.data, a.periodo_id, a.funcionario_id), '[]'::jsonb)
        from public.escala_producao_alocacoes a where a.data between p_semana and v_fim),
    'apontamentos', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', ap.id, 'data', ap.data, 'periodoId', ap.periodo_id, 'funcionarioId', ap.funcionario_id, 'maquinaId', ap.maquina_id, 'produtoId', ap.produto_id,
        'operacaoId', ap.operacao_id, 'produzido', ap.quantidade_produzida, 'refugo', ap.quantidade_refugo, 'status', ap.status, 'motivo', ap.motivo_sem_producao)
        order by ap.data, ap.periodo_id, ap.maquina_id, ap.id), '[]'::jsonb)
        from public.apontamentos_producao ap where ap.data between p_semana and v_fim),
    'ausencias', (select coalesce(jsonb_agg(jsonb_build_object(
        'funcionarioId', au.funcionario_id, 'data', au.data, 'tipo', au.tipo, 'inicio', au.horario_inicio, 'fim', au.horario_fim, 'emAberto', au.em_aberto)
        order by au.data, au.funcionario_id, au.horario_inicio nulls first, au.id), '[]'::jsonb)
        from public.ausencias_funcionarios au where au.data between p_semana and v_fim),
    'ajustesManuais', (select coalesce(jsonb_agg(jsonb_build_object('em', ev.criado_em, 'payload', ev.payload) order by ev.criado_em, ev.id), '[]'::jsonb)
        from public.escala_producao_eventos ev where ev.previsao_id = v_prev and ev.tipo = 'edicao_manual'),
    'planoVersao', (select jsonb_build_object('id', v.id, 'hashPlano', v.hash_plano, 'validoDesde', v.valido_desde)
        from public.escala_plano_versoes v where v.previsao_id = v_prev and v.valido_desde <= now() order by v.valido_desde desc limit 1),
    'situacaoFuncionarios', (select coalesce(jsonb_agg(jsonb_build_object('funcionarioId', h.funcionario_id, 'acao', h.acao, 'efetivoEm', h.efetivo_em, 'registradoEm', h.registrado_em,
        'ativoAntes', h.ativo_antes, 'ativoDepois', h.ativo_depois) order by h.efetivo_em, h.registrado_em), '[]'::jsonb) from public.funcionario_situacao_historico h),
    'funcionarios', (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'nome', f.nome, 'ativo', f.ativo) order by f.nome, f.id), '[]'::jsonb) from public.funcionarios f),
    'maquinas', (select coalesce(jsonb_object_agg(m.id::text, m.nome), '{}'::jsonb) from public.maquinas m),
    'produtos', (select coalesce(jsonb_object_agg(p.id::text, p.nome), '{}'::jsonb) from public.produtos p),
    'operacoes', (select coalesce(jsonb_object_agg(o.id::text, o.nome), '{}'::jsonb) from public.operacoes o)
  );
end;
$$;
revoke all on function public.escala_relatorio_fontes(date) from public, anon, authenticated;
grant execute on function public.escala_relatorio_fontes(date) to service_role;

-- =========================================================================
-- 4) Próximo código/versão da família (semana + tipo)
-- =========================================================================
create or replace function public.escala_relatorio_proximo(p_semana date, p_tipo text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_codigo text; v_versao integer; v_seq integer; v_pref text;
begin
  if p_tipo not in ('planejada', 'executada') then raise exception 'tipo inválido'; end if;
  v_pref := case when p_tipo = 'executada' then 'ESC-EXEC' else 'ESC-PLAN' end;
  select codigo, max(versao) into v_codigo, v_versao from public.escala_relatorios where semana_inicio = p_semana and tipo = p_tipo group by codigo;
  if v_codigo is not null then
    return jsonb_build_object('codigo', v_codigo, 'versao', v_versao + 1, 'familiaExistente', true);
  end if;
  -- NNNN = ordem da família (por tipo) dentro do ano ISO
  select count(distinct codigo) + 1 into v_seq from public.escala_relatorios where tipo = p_tipo and codigo like v_pref || '-' || to_char(p_semana, 'IYYY') || '-%';
  v_codigo := v_pref || '-' || to_char(p_semana, 'IYYY') || '-' || to_char(p_semana, 'IW') || '-' || lpad(v_seq::text, 4, '0');
  return jsonb_build_object('codigo', v_codigo, 'versao', 1, 'familiaExistente', false);
end;
$$;
revoke all on function public.escala_relatorio_proximo(date, text) from public, anon, authenticated;
grant execute on function public.escala_relatorio_proximo(date, text) to service_role;

-- =========================================================================
-- 5) Registro (só service_role; o servidor já autenticou e checou a permissão do usuário)
-- =========================================================================
create or replace function public.escala_relatorio_registrar(
  p_id uuid, p_semana date, p_tipo text, p_versao integer, p_codigo text, p_status text,
  p_consolidado_ate timestamptz, p_elegivel_final_em timestamptz, p_gerado_em timestamptz, p_gerado_por uuid, p_schema integer,
  p_conteudo_canonico text, p_hash text, p_fonte_digest text, p_periodos jsonb, p_pdf bytea, p_pdf_sha256 text
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

  insert into public.escala_relatorios (id, codigo, semana_inicio, tipo, versao, status, consolidado_ate, elegivel_final_em, gerado_em, gerado_por, schema_versao,
    conteudo_canonico, conteudo, hash_sha256, fonte_digest, periodos_considerados, pdf_sha256, pdf_bytes)
  values (p_id, p_codigo, p_semana, p_tipo, p_versao, p_status, p_consolidado_ate, p_elegivel_final_em, p_gerado_em, p_gerado_por, p_schema,
    p_conteudo_canonico, p_conteudo_canonico::jsonb, p_hash, p_fonte_digest, p_periodos, p_pdf_sha256, length(p_pdf))
  returning id into v_id;
  insert into public.escala_relatorio_pdfs (relatorio_id, pdf) values (v_id, p_pdf);
  return v_id;
end;
$$;
revoke all on function public.escala_relatorio_registrar(uuid, date, text, integer, text, text, timestamptz, timestamptz, timestamptz, uuid, integer, text, text, text, jsonb, bytea, text) from public, anon, authenticated;
grant execute on function public.escala_relatorio_registrar(uuid, date, text, integer, text, text, timestamptz, timestamptz, timestamptz, uuid, integer, text, text, text, jsonb, bytea, text) to service_role;

-- =========================================================================
-- 6) Lista interna (permissão escala_relatorios; sem o conteúdo pesado) e metadados públicos (service_role, sem nomes)
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
      'consolidadoAte', r.consolidado_ate, 'geradoPor', u.nome, 'hash', r.hash_sha256, 'pdfBytes', r.pdf_bytes, 'fonteDigest', r.fonte_digest, 'periodosConsiderados', r.periodos_considerados)
      order by r.tipo, r.versao desc)
    from public.escala_relatorios r left join public.usuarios u on u.id = r.gerado_por where r.semana_inicio = p_semana), '[]'::jsonb);
end;
$$;
revoke all on function public.escala_relatorio_listar(date) from public, anon;
grant execute on function public.escala_relatorio_listar(date) to authenticated;

create or replace function public.escala_relatorio_verificar(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare r public.escala_relatorios;
begin
  select * into r from public.escala_relatorios where id = p_id;
  if not found then return null; end if;
  return jsonb_build_object(
    'id', r.id, 'codigo', r.codigo, 'semanaInicio', r.semana_inicio, 'tipo', r.tipo, 'versao', r.versao, 'status', r.status, 'geradoEm', r.gerado_em,
    'consolidadoAte', r.consolidado_ate, 'hash', r.hash_sha256, 'pdfSha256', r.pdf_sha256,
    'integridadeBanco', (r.hash_sha256 = encode(sha256(convert_to(r.conteudo_canonico, 'utf8')), 'hex')),
    'conteudoCanonico', r.conteudo_canonico,  -- só para o servidor RECALCULAR o hash; a página pública não o exibe
    'fonteDigest', r.fonte_digest, 'periodosConsiderados', r.periodos_considerados,
    'versaoMaisRecente', (select max(x.versao) from public.escala_relatorios x where x.semana_inicio = r.semana_inicio and x.tipo = r.tipo),
    'existeVersaoPosterior', exists (select 1 from public.escala_relatorios x where x.semana_inicio = r.semana_inicio and x.tipo = r.tipo and x.versao > r.versao));
end;
$$;
revoke all on function public.escala_relatorio_verificar(uuid) from public, anon, authenticated;
grant execute on function public.escala_relatorio_verificar(uuid) to service_role;

-- ROLLBACK (sem perda de dados existentes): drop das funções escala_relatorio_*; as tabelas novas podem ficar (inertes) ou ser removidas se vazias;
-- o CHECK de permissões volta à lista anterior (migration 20261023100000) se nenhum usuário tiver 'escala_relatorios'.
