-- ROLLBACK da migration 20261115120000_produto_unico_ativacao. NÃO é migration; executar à mão, DEPOIS de produto_unico_desativar().
-- RECUSA se o cutover está ligado. Restaura a view escala_contagens_fechamento_para_motor ao texto de 20261110100000 e remove as 3 funções.
begin;
set local lock_timeout = '10s';
do $rb$
begin
  if public.produto_unico_cutover() is not null then
    raise exception 'ROLLBACK_ATIVACAO_ABORTADO: produto_unico_cutover está ligado; rode antes select produto_unico_desativar()';
  end if;
  if exists (select 1 from public.escala_buffer_pares bp join public.produto_canonico c on c.produto_id = bp.produto_id where bp.vigente_ate is null or bp.vigente_ate >= current_date) then
    raise exception 'ROLLBACK_ATIVACAO_ABORTADO: ainda há par de buffer vigente do produto único';
  end if;
end
$rb$;
create or replace view public.escala_contagens_fechamento_para_motor as
  select distinct on (bp.produto_id, bp.etapa_origem_id, bp.etapa_seguinte_id)
    bp.produto_id as "produtoId", bp.etapa_origem_id as "etapaOrigemId", bp.etapa_seguinte_id as "etapaSeguinteId",
    case when bp.papel = 'contabil' then fb.saldo_fisico else 0 end as saldo,
    f.instante_motor as "contadoEm", f.fechado_por as "informadoPor", f.id as fechamento_id, f.data, f.periodo_id, f.revisao, f.fechado_em
  from public.escala_fechamentos_vigentes f
  join public.escala_fechamento_buffers fb on fb.fechamento_id = f.id and fb.saldo_fisico is not null
  join public.escala_buffer_pares bp on bp.buffer_id = fb.buffer_id
       and f.data >= bp.vigente_de and (bp.vigente_ate is null or f.data <= bp.vigente_ate)
  order by bp.produto_id, bp.etapa_origem_id, bp.etapa_seguinte_id, f.instante_motor desc, f.fechado_em desc;
drop function if exists public.produto_unico_ativar(date, text, boolean);
drop function if exists public.produto_unico_desativar(text);
drop function if exists public.produto_unico_estado(date);
notify pgrst, 'reload schema';
commit;
