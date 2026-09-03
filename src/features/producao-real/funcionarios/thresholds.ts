// Funcionários V1 — thresholds próprios (§5/§6, valores exatos aprovados
// na instrução). Magnitude (20%/50%) e persistência (40%) são
// REAPROVEITADAS de Desvios V1 (src/features/producao-real/desvios/
// thresholds.ts), nunca redefinidas aqui — só os números específicos de
// amostra de Funcionários (mais rígidos que Desvios) vivem neste arquivo.

// Amostra do próprio funcionário no contexto — mais rígida que Desvios V1
// (3 períodos/60min) porque erro de leitura aqui recai sobre uma pessoa.
export const AMOSTRA_MINIMA_FUNCIONARIO_PERIODOS = 5;
export const AMOSTRA_MINIMA_FUNCIONARIO_MINUTOS = 100;

// Amostra da baseline de pares (mesmos números de Desvios V1 — reaproveitados,
// não redefinidos com outro valor).
export const AMOSTRA_MINIMA_PARES_PERIODOS = 3;
export const AMOSTRA_MINIMA_PARES_MINUTOS = 60;

// Qualidade/Refugo — mesma proteção de volume de Desvios V1 (>= 1
// meta-período média do contexto), reaplicada aqui pro funcionário e
// para os pares separadamente.
export const AMOSTRA_MINIMA_QUALIDADE_MULTIPLO_META = 1;
