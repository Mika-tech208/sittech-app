-- INICIALIZAÇÃO FÍSICA do produto único (3 contagens). NUNCA soma saldos estimados dos legados: os valores vêm da CONTAGEM FÍSICA do dia.
--   psql ... -v A=3000 -v B=5000 -v C=2000 -v quando="2026-11-09T05:00:00-03:00" -v por="Mikael" -f 30-inicializar-contagens-fisicas.sql
--   A = Rosqueados aguardando Parafusar · B = Parafusados aguardando Etiquetar (M8 + Parafusadeiras, UMA pilha) · C = Etiquetados aguardando Embalar
-- Grava em escala_parametros.producao_real_contagens_fisicas (mesmo formato/leitura das contagens manuais); a mais recente por par vence. B vai TODO no par Parafusar>Etiquetar (a M8 não tem contagem própria: sua saída é o mesmo buffer).
-- Efeito colateral esperado: a mudança de parâmetro 'producao_real_*' enfileira recálculo das semanas com escala futura (comportamento normal das contagens manuais).
-- Exige produto_unico_cutover ligado e quando >= início do cutover.
create or replace function pg_temp.inicializar(a numeric, b numeric, c numeric, v_quando timestamptz, p_por text) returns void language plpgsql as $$
declare
  v_pu uuid; v_cut date := public.produto_unico_cutover(); v_novos jsonb;
begin
  if v_cut is null then raise exception 'CONTAGEM_INICIAL: produto único não está ativo (rode 20-ativar-cutover.sql)'; end if;
  if a < 0 or b < 0 or c < 0 then raise exception 'CONTAGEM_INICIAL: saldos não podem ser negativos'; end if;
  if (v_quando at time zone 'America/Sao_Paulo')::date < v_cut then raise exception 'CONTAGEM_INICIAL: o instante da contagem (%) é anterior ao cutover (%)', v_quando, v_cut; end if;
  select produto_id into v_pu from public.produto_canonico where codigo = 'CONECTOR_3_4_UNICO';
  select jsonb_agg(jsonb_build_object('produtoId', v_pu, 'etapaOrigemId', x.o, 'etapaSeguinteId', x.d, 'saldo', x.s, 'contadoEm', to_char(v_quando at time zone 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI:SS') || '-03:00',
                                  'informadoPor', p_por, 'observacao', 'Inicialização física do produto único: ' || x.rotulo)) into v_novos
    from (
      select a1.origem_etapa_id o, a1.destino_etapa_id d, oo.nome || ' > ' || od.nome as rotulo,
             case when oo.nome = 'Rosquear' then a when oo.nome = 'Parafusar' then b when oo.nome = 'Etiquetar' then c end as s
        from public.produto_canonico_arestas a1
        join public.roteiro_etapas eo on eo.id = a1.origem_etapa_id join public.operacoes oo on oo.id = eo.operacao_id
        join public.roteiro_etapas ed on ed.id = a1.destino_etapa_id join public.operacoes od on od.id = ed.operacao_id
       where eo.produto_id = v_pu and oo.nome <> 'Rosquear + Parafusar') x;   -- 3 contagens (A, B, C): a saída da M8 não tem contagem própria (vai no B)
  if jsonb_array_length(v_novos) <> 3 then raise exception 'CONTAGEM_INICIAL: esperadas 3 contagens do produto único, achados %', jsonb_array_length(v_novos); end if;
  update public.escala_parametros set valor = coalesce(valor, '[]'::jsonb) || v_novos, atualizado_em = now() where chave = 'producao_real_contagens_fisicas';
  if not found then raise exception 'CONTAGEM_INICIAL: parâmetro producao_real_contagens_fisicas não existe'; end if;
  raise notice 'contagens iniciais gravadas: %', v_novos;
end $$;
select pg_temp.inicializar(:A, :B, :C, :'quando'::timestamptz, :'por');
