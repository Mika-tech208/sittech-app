-- Recupera a META ORIGINAL da Caixa Amarela 4x2 na semana 02/11–08/11/2026 e registra o ENCERRAMENTO (decisão de 06/11/2026).
-- Fonte do valor original: backup do passo r13 (~/Documents/sittech-rollbacks/2026-11-03-ativacao-fechamento/r13_caixa_4x2_encerrada.sql): quantidade = 56400, adicional 0, item ec08482b-a571-4652-83b4-f9a228871519.
-- NÃO altera previsao_itens (já está em 0): o motor continua lendo demanda 0. Só insere o registro histórico; protegido por conferência exata do item.
begin;
insert into public.previsao_encerramentos (previsao_id, produto_id, quantidade_original, adicional_original, encerrado_em, encerrado_por, motivo)
select i.previsao_id, i.produto_id, 56400, 0, timestamptz '2026-11-06 12:30:00-03', (select id from public.usuarios where nome = 'Mikael' and ativo limit 1),
       'Caixa Amarela 4x2 encerrada para produção futura (decisão de 06/11/2026). Previsão original (56.400) recuperada do backup r13; registro criado em 08/11/2026. 27.930 peças foram produzidas antes do encerramento.'
from public.previsao_itens i join public.previsoes p on p.id = i.previsao_id
where i.id = 'ec08482b-a571-4652-83b4-f9a228871519' and p.semana_inicio = '2026-11-02' and i.produto_nome = 'Caixa Amarela 4x2' and i.tipo = 'previsto' and i.quantidade = 0
  and not exists (select 1 from public.previsao_encerramentos e where e.previsao_id = i.previsao_id and e.produto_id = i.produto_id and e.reaberto_em is null);
do $$ begin
  if (select count(*) from public.previsao_encerramentos e join public.previsoes p on p.id = e.previsao_id where p.semana_inicio = '2026-11-02' and e.quantidade_original = 56400 and e.reaberto_em is null) <> 1 then
    raise exception 'ENCERRAMENTO_4X2_NAO_REGISTRADO: conferência falhou; nada foi gravado';
  end if;
end $$;
commit;
select e.quantidade_original, e.encerrado_em, p.semana_inicio, pr.nome from public.previsao_encerramentos e join public.previsoes p on p.id = e.previsao_id join public.produtos pr on pr.id = e.produto_id order by e.encerrado_em desc limit 3;
