-- M3 (DEV/Preview): colunas ADITIVAS em escala_rota_divisao para registrar cada rodada do feedback Escala↔planejador (append-only; nenhuma coluna removida/alterada).
-- A seleção de máquinas NÃO ganha tabela nova: continua em previsao_item_maquinas (item, etapa, máquina) — o etapa_id de F já identifica rota exclusiva ou fluxo comum.
alter table public.escala_rota_divisao
  add column semana_inicio date,
  add column rodada int not null default 1 check (rodada >= 1),
  add column rodada_final boolean not null default true,
  add column capacidade_nominal numeric check (capacidade_nominal >= 0),
  add column algoritmo_versao text not null default '',
  add column hash_entrada text not null default '',     -- SHA-256 da entrada do planejador nesta rodada
  add column hash_escala text not null default '',      -- SHA-256 da EntradaEscala (cadeias virtuais) nesta rodada
  add column gargalo jsonb;
comment on column public.escala_rota_divisao.capacidade_rota is 'Capacidade REALIZÁVEL da rota segundo a Escala (= nominal quando o motor entregou o alvo, sem limitação observada).';
comment on column public.escala_rota_divisao.capacidade_nominal is 'Capacidade NOMINAL da rota: só máquinas selecionadas na Previsão, metas, períodos, dias, indisponibilidades e capacidade compartilhada.';
comment on column public.escala_rota_divisao.rodada_final is 'true na última rodada do feedback (a divisão efetiva); as anteriores ficam como trilha de auditoria.';

-- semana vem da Previsão (não depende do chamador)
create or replace function public.escala_rota_divisao_semana() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.semana_inicio is null then select semana_inicio into new.semana_inicio from public.previsoes where id = new.previsao_id; end if;
  return new;
end $$;
create trigger trg_escala_rota_divisao_semana before insert on public.escala_rota_divisao for each row execute function public.escala_rota_divisao_semana();

-- idempotência do registro (retry do orquestrador): mesma previsão/produto/rota/rodada/entradas = mesma linha
create unique index escala_rota_divisao_rodada_uk on public.escala_rota_divisao (previsao_id, produto_id, rota_id, rodada, hash_entrada, hash_escala);
create index escala_rota_divisao_semana_idx on public.escala_rota_divisao (produto_id, semana_inicio, rodada);
notify pgrst, 'reload schema';
