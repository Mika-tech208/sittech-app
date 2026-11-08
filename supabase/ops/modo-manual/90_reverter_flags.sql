-- MODO MANUAL — ROLLBACK das flags: devolve EXATAMENTE os valores de PROD de 06/11/2026 (backup pre-bk1.json).
-- Ordem inversa do desligamento: producao_real_modo volta por PRIMEIRO? NÃO — ao entrar em 'ativo' o gatilho registra 'baseline' do plano e eventos de recálculo.
-- Por isso ele volta por ÚLTIMO, depois de as demais flags e da migration estarem revertidas (a função escala_registrar_evento volta a enfileirar normalmente).
-- ATENÇÃO: religar producao_real_modo = 'ativo' dispara recálculo das semanas com escala futura (comportamento original do sistema). Rodar só por decisão explícita.
begin;
update public.escala_parametros set valor = '"ativo_restrito"'::jsonb, atualizado_em = now() where chave = 'replanejamento_modo';
update public.escala_parametros set valor = '"ativo"'::jsonb, atualizado_em = now() where chave = 'escala_fechamento_fisico_modo';
update public.escala_parametros set valor = '"ativo"'::jsonb, atualizado_em = now() where chave = 'apontamento_simplificado_modo';
update public.escala_parametros set valor = '"ativo"'::jsonb, atualizado_em = now() where chave = 'producao_real_modo';
commit;
select chave, valor from public.escala_parametros where chave in ('producao_real_modo','replanejamento_modo','escala_fechamento_fisico_modo','apontamento_simplificado_modo') order by 1;
