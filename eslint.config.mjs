import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Cópia de referência preservada da Etapa 0 (não faz parte do app).
    "docs/**",
  ]),
  {
    // Transplante literal da Fase 1 (ver docs/legacy/). Ainda não quebrado em
    // componentes por domínio (Etapas 2/3) — lint completo fica para quando
    // esse arquivo for desmontado, para não gastar esforço em código que vai
    // ser reescrito/movido em breve.
    files: ["src/features/legacy/**"],
    rules: {
      "react-hooks/preserve-manual-memoization": "off",
      "react/no-unescaped-entities": "off",
      "@typescript-eslint/ban-ts-comment": "off",
    },
  },
]);

export default eslintConfig;
