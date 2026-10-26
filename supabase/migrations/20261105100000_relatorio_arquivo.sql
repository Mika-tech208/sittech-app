-- Sittech — Relatórios: ARQUIVO HISTÓRICO (aba /relatorios). Só LEITURA de `escala_relatorios` (nunca regenera PDF, nunca grava).
-- Uma linha por FAMÍLIA (semana + tipo) com a versão mais recente e o total de versões; resumo (cobertura/conformidade) lido do snapshot imutável (`conteudo`).
-- Permissão: `escala_relatorios` (admin sempre). Filtros simples: ano da semana, tipo, status e busca por código/semana. Paginado.
create or replace function public.escala_relatorio_arquivo(p_ano integer default null, p_tipo text default null, p_status text default null, p_busca text default null, p_limite integer default 20, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_busca text := nullif(btrim(coalesce(p_busca, '')), '');
  v_limite integer := least(greatest(coalesce(p_limite, 20), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_out jsonb;
begin
  if not public.has_permissao('escala_relatorios') then raise exception 'Usuário não tem permissão para consultar relatórios da Escala'; end if;
  if p_tipo is not null and p_tipo not in ('executada', 'planejada') then raise exception 'tipo inválido'; end if;
  if p_status is not null and p_status not in ('parcial', 'final') then raise exception 'status inválido'; end if;

  with fam as (       -- uma linha por família (semana + tipo): a versão mais recente
    select distinct on (r.semana_inicio, r.tipo) r.*,
           (select count(*) from public.escala_relatorios x where x.semana_inicio = r.semana_inicio and x.tipo = r.tipo) n_versoes
      from public.escala_relatorios r
     order by r.semana_inicio, r.tipo, r.versao desc
  ), filt as (
    select * from fam f
     where (p_ano is null or extract(year from f.semana_inicio)::int = p_ano)
       and (p_tipo is null or f.tipo = p_tipo)
       and (p_status is null or f.status = p_status)
       and (v_busca is null or f.codigo ilike '%' || v_busca || '%' or to_char(f.semana_inicio, 'DD/MM/YYYY') like '%' || v_busca || '%'
            or to_char(f.semana_inicio + 6, 'DD/MM/YYYY') like '%' || v_busca || '%' or f.semana_inicio::text like '%' || v_busca || '%')
  ), pagina as (
    select * from filt order by semana_inicio desc, case tipo when 'executada' then 0 else 1 end limit v_limite offset v_offset
  )
  select jsonb_build_object(
    'total', (select count(*) from filt),
    'anos', coalesce((select jsonb_agg(a order by a desc) from (select distinct extract(year from semana_inicio)::int a from fam) s), '[]'::jsonb),
    'limite', v_limite, 'offset', v_offset,
    'itens', coalesce((select jsonb_agg(jsonb_build_object(
        'id', i.id, 'semanaInicio', i.semana_inicio, 'tipo', i.tipo, 'codigo', i.codigo, 'versao', i.versao, 'nVersoes', i.n_versoes, 'status', i.status, 'geradoEm', i.gerado_em,
        'consolidadoAte', i.consolidado_ate, 'fechamentoAutomatico', i.fechamento_automatico, 'geradoPor', u.nome, 'pdfBytes', i.pdf_bytes, 'hash', i.hash_sha256,
        'fonteDigest', i.fonte_digest, 'periodosConsiderados', i.periodos_considerados,
        'cobertura', i.conteudo -> 'resumo' -> 'cobertura' ->> 'percentualTexto',
        'conformidade', i.conteudo -> 'resumo' -> 'revezamento' ->> 'estado')
        order by i.semana_inicio desc, case i.tipo when 'executada' then 0 else 1 end)
      from pagina i left join public.usuarios u on u.id = i.gerado_por), '[]'::jsonb))
  into v_out;
  return v_out;
end;
$$;
revoke all on function public.escala_relatorio_arquivo(integer, text, text, text, integer, integer) from public, anon;
grant execute on function public.escala_relatorio_arquivo(integer, text, text, text, integer, integer) to authenticated;

-- ROLLBACK: drop function public.escala_relatorio_arquivo(integer, text, text, text, integer, integer);
