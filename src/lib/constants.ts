import type { Periodo } from "@/types/domain";

export const STORAGE_KEY = "sittech-custos-mensais";

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

export const PERIODOS_PADRAO: Periodo[] = [
  { id: "m1", nome: "M1", inicio: "07:12", fim: "08:48" },
  { id: "m2", nome: "M2", inicio: "08:48", fim: "10:24" },
  { id: "m3", nome: "M3", inicio: "10:24", fim: "11:55" },
  { id: "t1", nome: "T1", inicio: "13:00", fim: "14:20" },
  { id: "t2", nome: "T2", inicio: "14:20", fim: "15:40" },
  { id: "t3", nome: "T3", inicio: "15:40", fim: "17:00" },
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

export interface UsuarioSeed {
  usuario: string;
  senha: string;
  nome: string;
}

// Seed usado apenas na migração única do formato antigo (senha em texto puro)
// para o formato novo (hash + salt) — ver lib/auth.ts. TEMPORÁRIO: some
// quando a autenticação migrar para Supabase Auth. Vem de variável de
// ambiente (NEXT_PUBLIC_SEED_USUARIOS_JSON, ver .env.example) para que as
// senhas reais nunca entrem no controle de versão — só existem localmente em
// .env.local (gitignored).
function parseUsuariosSeed(): UsuarioSeed[] {
  const raw = process.env.NEXT_PUBLIC_SEED_USUARIOS_JSON;
  if (!raw) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        "NEXT_PUBLIC_SEED_USUARIOS_JSON não definida — copie .env.example para .env.local e preencha com usuários reais para conseguir logar localmente."
      );
    }
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    console.warn("NEXT_PUBLIC_SEED_USUARIOS_JSON não é um JSON válido.");
    return [];
  }
}

export const USUARIOS_SEED: UsuarioSeed[] = parseUsuariosSeed();
