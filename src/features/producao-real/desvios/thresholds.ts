// Desvios V1 — único local com números "mágicos" do domínio (§9 da
// análise aprovada: "centralizar esses thresholds em um único local do
// domínio Desvios. Não espalhar números mágicos pelos componentes.").
// Todos os valores aqui são DECISÃO V1, documentada e ajustável depois —
// nenhum foi inventado sem justificativa (ver comentário de cada um).

// ---------------------------------------------------------------------
// Magnitude (§9) — variação relativa das métricas que NÃO são Performance
// (Performance reutiliza classificarPerformance de src/lib/performance.ts,
// que já tem 90/100 como limiares oficiais aprovados).
// ---------------------------------------------------------------------
export const LIMIAR_MAGNITUDE_RELEVANTE_PCT = 20;
export const LIMIAR_MAGNITUDE_FORTE_PCT = 50;

// ---------------------------------------------------------------------
// Persistência — fração de períodos/dias do contexto, na janela atual,
// em que o sinal apareceu. Reaproveita o MESMO número já usado e
// aprovado em Paradas V1 (RecorrenciaParadas.tsx, LIMIAR_RECORRENTE_PCT)
// para "motivo recorrente" — e estende o mesmo corte, por padrão, aos
// demais tipos de desvio comparativo (Produtividade/Qualidade/Economia/
// Sem produção), já que nenhum threshold específico foi decidido pra
// eles na análise aprovada.
// ---------------------------------------------------------------------
export const LIMIAR_PERSISTENCIA_PCT = 40;

// ---------------------------------------------------------------------
// Amostra mínima (§5) — valores exatos aprovados na instrução do usuário.
// ---------------------------------------------------------------------
export const AMOSTRA_MINIMA_PERIODOS = 3;
export const AMOSTRA_MINIMA_MINUTOS_PRODUTIVOS = 60;
// Qualidade/Refugo exigem, além do mínimo acima, volume produzido >= 1
// meta-período MÉDIA do contexto (não um número fixo de peças — a média
// das metas vigentes dos apontamentos do próprio contexto/janela, já que
// a meta pode variar por período do dia dentro do mesmo produto+operação).
export const AMOSTRA_MINIMA_QUALIDADE_MULTIPLO_META = 1;

// ---------------------------------------------------------------------
// Janela estrutural (§4) — 28 dias (4 semanas completas), decisão
// explícita do usuário. A arquitetura (ver janelas.ts) continua aceitando
// qualquer tamanho de janela — este número é só o default da V1.
// ---------------------------------------------------------------------
export const JANELA_ESTRUTURAL_DIAS = 28;
