// Cliente do fechamento físico (navegador → /api/escala/fechamento/*). Sem regra de negócio: o servidor valida tudo de novo.
import { supabase } from "@/services/supabase-client";

export interface PostoApi { maquinaId: string; nome: string; status: "pendente" | "produzindo" | "sem_producao"; produzido: number; refugo: number; motivo: string | null }
export interface BufferApi { buffer_id: string; rotulo: string; estimado: number | null; estimado_lo: number | null; estimado_hi: number | null }
export interface AberturaApi {
  ok: true; abertura_id: string; valido_ate_ms: number;
  periodo: { data: string; periodo_id: string; rotulo: string; fim_ms: number; proximo: { rotulo: string; periodo_id: string } | null };
  postos: PostoApi[]; tem_pendentes: boolean; buffers: BufferApi[]; pode_excecao: boolean; pares_sem_buffer: { produtoId: string; produto: string; etapaOrigem: string; etapaDestino: string; rota: string }[];
  alertas: { codigo: string; mensagem: string }[];
}
export interface DiagnosticoApi { codigo: string; mensagem: string; detalhes?: { produto?: string; rota?: string; etapaOrigem?: string; etapaDestino?: string; semana?: string; periodo?: string } }
export interface LinhaProgramacao { maquina: string; pessoa: string; produto: string; pecas: number }
export interface ResultadoApi {
  parcial?: boolean;
  ok: boolean; estado: "RECALCULANDO" | "CONFIRMADO" | "ERRO_RECALCULO" | null; fechamentoId: string | null; mensagem: string | null; duplicado?: boolean;
  erros: { codigo: string; mensagem: string; bufferId?: string }[]; exigeConfirmacao: string[];
  tempos: { gravacao: number; entrada: number; corte: number; validacao: number; persistencia: number; total: number } | null;
  proximo?: { data: string; periodoId: string; rotulo: string } | null; programacao?: LinhaProgramacao[];
}
export interface EstadoApi { modo: "desligado" | "sombra" | "ativo"; fechado: boolean; fechamento_id?: string; estado?: string; erro?: string | null; tempos_ms?: ResultadoApi["tempos"] }

async function chamar<T>(caminho: string, init: RequestInit & { corpo?: unknown } = {}): Promise<{ status: number; corpo: T }> {
  // a leitura da sessão nunca pode travar o fechamento (fábrica parada esperando): 3 s e segue sem token (o servidor responde 401 e a tela mostra o erro)
  const token = await Promise.race([
    supabase.auth.getSession().then(({ data }) => data.session?.access_token).catch(() => undefined),
    new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 3000)),
  ]);
  const resp = await fetch(caminho, { method: init.corpo !== undefined ? "POST" : "GET", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token ?? ""}` }, ...(init.corpo !== undefined ? { body: JSON.stringify(init.corpo) } : {}) });
  return { status: resp.status, corpo: (await resp.json().catch(() => ({}))) as T };
}
export const abrirFechamentoApi = (data: string, periodoId: string) => chamar<AberturaApi & { erro?: string; erros?: DiagnosticoApi[] }>("/api/escala/fechamento/abrir", { corpo: { data, periodo_id: periodoId, dispositivo: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 60) : null } });
export const confirmarFechamentoApi = (c: { data: string; periodoId: string; chave: string; buffers: { buffer_id: string; fisico: number | null; motivo: string | null }[]; confirmouDiferencaGrande: boolean; excecaoMotivo?: string; contadoEmMs?: number }) =>
  chamar<ResultadoApi & { erro?: string }>("/api/escala/fechamento/confirmar", { corpo: { data: c.data, periodo_id: c.periodoId, chave: c.chave, buffers: c.buffers, confirmou_diferenca_grande: c.confirmouDiferencaGrande, ...(c.excecaoMotivo ? { excecao_motivo: c.excecaoMotivo } : {}), ...(c.contadoEmMs ? { contado_em_ms: c.contadoEmMs } : {}) } });
export const retryFechamentoApi = (fechamentoId: string) => chamar<ResultadoApi & { erro?: string }>("/api/escala/fechamento/retry", { corpo: { fechamento_id: fechamentoId } });
export const estadoFechamentoApi = (data: string, periodoId: string) => chamar<EstadoApi>(`/api/escala/fechamento/estado?data=${data}&periodo_id=${periodoId}`);
