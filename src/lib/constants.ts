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

export interface ThemeColors {
  bg: string;
  surface: string;
  surfaceHover: string;
  border: string;
  text: string;
  textMuted: string;
  accent: string;
  accentSoft: string;
  blueprint: string;
  danger: string;
  warning: string;
  laranja: string;
  btnText: string;
}

export const THEMES: { dark: ThemeColors; light: ThemeColors } = {
  dark: {
    bg: "#000000", surface: "#161616", surfaceHover: "#212121", border: "#2a2a2a",
    text: "#ededed", textMuted: "#8f8f8f", accent: "#30B09B", accentSoft: "rgba(48,176,155,0.16)",
    blueprint: "#1D7A68", danger: "#d9534f", warning: "#f0b429", laranja: "#e0812f", btnText: "#ffffff",
  },
  light: {
    bg: "#f2f4f2", surface: "#ffffff", surfaceHover: "#eaeee9", border: "#dde2de",
    text: "#1a1d21", textMuted: "#69737d", accent: "#1F8A73", accentSoft: "rgba(31,138,115,0.10)",
    blueprint: "#145C4E", danger: "#c0392b", warning: "#b8790a", laranja: "#b8631a", btnText: "#ffffff",
  },
};
