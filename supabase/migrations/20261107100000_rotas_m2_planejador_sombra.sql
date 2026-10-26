-- M2 (DEV/Preview): diagnósticos do PLANEJADOR PURO DE ROTAS em SOMBRA. Tabela PRÓPRIA, append-only.
-- NÃO usa escala_rota_divisao (estrutura oficial futura), NÃO escreve Previsão, Escala, WIP nem apontamentos, NÃO ativa nada (rotas_config.suporte_ativo permanece false).
create table public.rotas_planejador_sombra (
  id uuid primary key default gen_random_uuid(),
  criado_em timestamptz not null default now(),
  algoritmo_versao text not null,
  produto_id uuid not null references public.produtos(id) on delete restrict,
  semana_inicio date,
  rotulo text not null default '',                        -- ex.: 'real_116625_E15', 'AUTO_parada'
  entrada jsonb not null,                                 -- tudo que o planejador recebeu (demanda, dias, máquinas, equipe, WIP...)
  resultado jsonb not null,                               -- saída completa (capacidades, final atingível, falta, motivos...)
  gargalo jsonb,
  divisao jsonb not null,                                 -- alvo por rota (AUTO, CONV)
  custo jsonb,
  hash_entrada text not null                              -- SHA-256 da entrada canônica (reproduzibilidade)
);
create index rotas_planejador_sombra_produto_idx on public.rotas_planejador_sombra (produto_id, criado_em desc);
create trigger trg_rotas_planejador_sombra_imutavel before update or delete on public.rotas_planejador_sombra for each row execute function public.escala_sombra_trg_imutavel();

alter table public.rotas_planejador_sombra enable row level security;
create policy rotas_planejador_sombra_select on public.rotas_planejador_sombra for select to authenticated using (public.is_admin() or public.has_permissao('produtos'));
revoke all on public.rotas_planejador_sombra from anon, authenticated;
grant select on public.rotas_planejador_sombra to authenticated;
grant select, insert on public.rotas_planejador_sombra to service_role;
comment on table public.rotas_planejador_sombra is 'Execuções do planejador de rotas em SOMBRA (append-only). Diagnóstico: nunca alimenta Previsão/Escala/WIP/apontamentos.';
notify pgrst, 'reload schema';
