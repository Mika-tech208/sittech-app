export const CATEGORIAS = [
  "Mão de obra",
  "Materiais e insumos",
  "Aluguel",
  "Energia elétrica",
  "Manutenção de equipamentos",
  "Impostos e taxas",
  "Frete e logística",
  "Outros",
];

export const OPERACOES = [
  "Produção",
  "Torno CNC",
  "Fresagem",
  "Solda",
  "Programação CNC",
  "Montagem",
  "Manutenção elétrica",
];

export const MESES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

export const MESES_ABREV = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

export const PIE_COLORS = ["#30B09B", "#1D7A68", "#d9534f", "#8b93a1", "#5c8ba0", "#c98a3d", "#7a9e6e", "#a45c9e"];

export const TITULOS_ABA: Record<string, string> = {
  inicio: "Visão geral",
  custos: "Custos mensais",
  funcionarios: "Custo de funcionários",
  produtos: "Cadastro de produtos",
  maquinas: "Máquinas",
  previsao: "Previsão semanal",
  capacidade: "Capacidade semanal",
  horaEmpresa: "Custo por hora",
  faturamento: "Faturamento mensal",
  bi: "Análise de faturamento",
  importar: "Importar dados",
  prVisaoGeral: "Produção Real — Visão Geral",
  prProdutividade: "Produtividade real",
  prFuncionarios: "Funcionários — Produção Real",
  prDesvios: "Desvios",
  prParadas: "Paradas de máquinas",
  prValidacao: "Validação da Previsão",
  prDadosImportados: "Dados importados",
  usuarios: "Usuários",
};

// Design tokens "Estúdio" (redesign visual aprovado — ver
// design_handoff_sittech_estudio/README.md, seção "Design Tokens"). Nomes e
// valores hex são os literais do handoff, não inventados aqui.
//
// Compatibilidade: os nomes ANTIGOS (border/textMuted/blueprint/laranja/
// btnText/accentSoft) continuam existindo — tanto como CSS custom
// properties em GlobalStyles.tsx quanto como campos literais aqui embaixo
// — são "pontes" pros ~2000 linhas de CSS/TS de conteúdo de página
// (Produção Real, Previsão, Financeiro etc., fora do escopo desta etapa)
// que hoje leem var(--border)/cores.textMuted/etc. (inclusive dentro de
// props de recharts, que precisam do valor literal, não de var()) e assim
// já herdam a paleta nova automaticamente, sem precisar reescrever cada
// regra/componente.
export interface ThemeColors {
  bg: string;
  surface: string;
  surfaceHover: string;
  surfaceRaised: string;
  plane: string;
  line: string;
  text: string;
  text2: string;
  text3: string;
  label: string;
  faint: string;
  accent: string;
  accentHover: string;
  accentDeep: string;
  accentSoft: string;
  warning: string;
  danger: string;
  onAccent: string;
  pillBg: string;
  pillBgHover: string;
  shadowSm: string;
  shadowLg: string;
  /** @deprecated ponte — usar `line` */
  border: string;
  /** @deprecated ponte — usar `text3` */
  textMuted: string;
  /** @deprecated ponte — usar `accentDeep` */
  blueprint: string;
  /** @deprecated ponte — usar `warning` */
  laranja: string;
  /** @deprecated ponte — usar `onAccent` */
  btnText: string;
}

export const THEMES: { dark: ThemeColors; light: ThemeColors } = {
  dark: {
    bg: "#1A1918", surface: "#201E1D", surfaceHover: "#262422", surfaceRaised: "#302D2B", plane: "#161514",
    line: "#262422", text: "#F0EEEB", text2: "#96918B", text3: "#7A756F", label: "#635F5A", faint: "#4A4642",
    accent: "#3ECFA5", accentHover: "#55DBB4", accentDeep: "#2C8F73", accentSoft: "rgba(62,207,165,0.12)",
    warning: "#E0A340", danger: "#E2695C", onAccent: "#141312",
    pillBg: "#211F1E", pillBgHover: "#282524",
    shadowSm: "none", shadowLg: "none",
    border: "#262422", textMuted: "#7A756F", blueprint: "#2C8F73", laranja: "#E0A340", btnText: "#141312",
  },
  light: {
    bg: "#FBFAF8", surface: "#FFFFFF", surfaceHover: "#F5F2ED", surfaceRaised: "#E7E3DC", plane: "#EFECE7",
    line: "#E3DFD8", text: "#1A1918", text2: "#6E6963", text3: "#8A857E", label: "#A39D95", faint: "#C6C0B8",
    accent: "#1B8A6D", accentHover: "#146453", accentDeep: "#3FA487", accentSoft: "rgba(27,138,109,0.10)",
    warning: "#B47A15", danger: "#C0483B", onAccent: "#FFFFFF",
    pillBg: "#FFFFFF", pillBgHover: "#F5F2ED",
    shadowSm: "0 1px 2px rgba(26,25,24,.06)", shadowLg: "0 18px 40px -28px rgba(26,25,24,.4)",
    border: "#E3DFD8", textMuted: "#8A857E", blueprint: "#3FA487", laranja: "#B47A15", btnText: "#FFFFFF",
  },
};

// Trilha de contexto da TopBar ("Produção real / Visão geral") — resolve a
// ausência de breadcrumb e desambigua as duas telas hoje chamadas "Visão
// geral" (§1/§2 do handoff). Chave = o MESMO `abaAtiva` que cada página já
// passa pro Sidebar (nada novo pra threadear): páginas migradas passam uma
// string literal fixa (ex. "prVisaoGeral"), o monólito legado passa o
// `abaAtiva` real da navegação interna. `grupo` ausente = item de topo
// (ex. Início), sem "/" na trilha.
export const TRILHA_POR_ABA: Record<string, { grupo?: string; pagina: string }> = {
  inicio: { pagina: "Início" },
  custos: { grupo: "Gestão", pagina: "Custos mensais" },
  funcionarios: { grupo: "Gestão", pagina: "Funcionários" },
  produtos: { grupo: "Gestão", pagina: "Produtos" },
  maquinas: { grupo: "Gestão", pagina: "Máquinas" },
  horaEmpresa: { grupo: "Gestão", pagina: "Custo por hora" },
  faturamento: { grupo: "Financeiro", pagina: "Faturamento mensal" },
  bi: { grupo: "Financeiro", pagina: "Análise de faturamento" },
  previsao: { grupo: "Planejamento", pagina: "Previsão semanal" },
  capacidade: { grupo: "Planejamento", pagina: "Capacidade semanal" },
  producaoRealPainel: { grupo: "Produção real", pagina: "Apontamento" },
  producaoRealApontamentos: { grupo: "Produção real", pagina: "Apontamentos realizados" },
  prVisaoGeral: { grupo: "Produção real", pagina: "Visão geral" },
  prIndicadores: { grupo: "Produção real", pagina: "Produtividade" },
  prFuncionarios: { grupo: "Produção real", pagina: "Funcionários" },
  prDesvios: { grupo: "Produção real", pagina: "Desvios" },
  prParadas: { grupo: "Produção real", pagina: "Paradas" },
  prValidacao: { grupo: "Produção real", pagina: "Validação da previsão" },
  prDadosImportados: { grupo: "Produção real", pagina: "Dados importados" },
  usuarios: { grupo: "Administração", pagina: "Usuários" },
  importar: { grupo: "Administração", pagina: "Importar dados" },
};
