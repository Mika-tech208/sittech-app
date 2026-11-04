# Liberação da programação para o chão (04/11/2026)

**Princípio:** plano existir ≠ escala liberada. Um período só é entregue ao chão quando existir: fechamento físico do período ANTERIOR + estado CONFIRMADO + plano gerado por esse fechamento (corte-v1 + portão HARD aprovado, que é o que leva o fechamento a CONFIRMADO).

## Fonte única (banco)
- `escala_periodo_liberacao(data, periodo)` → `{liberado, motivo, predecessor, fechamento_id, hash_plano, confirmado_em}`; `escala_liberacao_dia(data)` → mapa por período; `escala_liberacao_slots` (apoio).
- Motivos: `TRANSICAO` (períodos anteriores a `escala_liberacao_desde`, padrão M3 de 04/11/2026), `MODO_NAO_ATIVO`, `AGUARDANDO_FECHAMENTO`, `RECALCULANDO`, `ERRO_RECALCULO`, `CONFIRMADO_SEM_PLANO`, `CONFIRMADO`, `PERIODO_DESCONHECIDO` (fail-closed).
- `escala_tv_snapshot` (RPC da TV) **não entrega alocações de períodos não liberados** — protege TV com página/bundle antigos. Devolve também `liberacao`.
- Telas: TV (estados AGUARDANDO NOVA PROGRAMAÇÃO / RECALCULANDO Tn… / PROGRAMAÇÃO NÃO LIBERADA / Tn LIBERADO; sem informação ⇒ AGUARDANDO PROGRAMAÇÃO CONFIRMADA), Produção Real (`/api/escala/fechamento/postos` não entrega postos de período não liberado), Escala interna (selo e aparência ESTIMADO — NÃO LIBERADO).

## ⚠ Vínculo fechamento → plano é TRANSITÓRIO
Hoje **não existe** `fechamento_id → plano_versao_id`: nem `escala_plano_versoes` nem `escala_fluxo_diagnosticos` guardam o id do fechamento. O vínculo usado:
1. `hash_plano_novo` do log CONFIRMADO do fechamento = `hash_plano_fluxo` de um diagnóstico `gatilho='fechamento'` **aplicado**; e
2. o plano do dia foi regravado depois do fechamento (`escala_producao_dias.atualizado_em >= fechado_em`).

Nunca usa "o último plano existente". **Não é a arquitetura final** — tarefa aberta: gravar a relação explícita (fechamento_id no plano/diagnóstico) e substituir a comparação por hash.

## Testes
`scripts/fechamento/teste-liberacao.sql` (22 cenários, transação desfeita) · `visaoTv.test.ts` · `gradeLiberacao.ui.test.tsx` · `postosProgramados.test.ts`.

## Rollback
`supabase/rollbacks/20261111120000_escala_liberacao_programacao_ROLLBACK.sql` devolve a RPC da TV ao corpo ORIGINAL (validado: hash idêntico ao do PROD) e remove as funções novas.
