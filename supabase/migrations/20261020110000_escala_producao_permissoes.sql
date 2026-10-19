-- Sittech — Escala de Produção: permissões de módulo.
--   escala_producao     — ver, gerar, editar, bloquear/liberar recursos
--   escala_producao_tv  — SOMENTE leitura do snapshot da TV (usuário de quiosque)
-- Mesmo padrão da migration de Faltas e Ausências: recria o CHECK com a
-- lista completa (fonte única no frontend: src/lib/permissoes.ts).

alter table public.usuario_permissoes
  drop constraint usuario_permissoes_permissao_check;

alter table public.usuario_permissoes
  add constraint usuario_permissoes_permissao_check check (permissao in (
    'financeiro', 'produtos', 'maquinas', 'funcionarios', 'custo_hora',
    'previsao', 'capacidade',
    'producao_real_apontamento', 'producao_real_historico', 'producao_real_ocorrencias',
    'producao_real_apontamentos_realizados',
    'usuarios', 'auditoria',
    'ausencias_funcionarios',
    'escala_producao', 'escala_producao_tv'
  ));
