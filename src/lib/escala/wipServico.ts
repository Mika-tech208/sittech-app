// Serviço do controle de estoque intermediário (WIP) — regras de permissão e de negócio das AÇÕES (confirmar, ajustar, criar controle),
// independentes de banco (o acesso é injetado) para serem testáveis. A rota só autentica e chama isto.
//
// Quem pode: administrador ou usuário com a permissão específica `escala_wip_confirmar`. Quem só tem Previsão/Escala LÊ.
// O servidor recalcula o ESTIMADO no momento (nunca confia no que o navegador viu) e grava com auditoria (usuário, data/hora).

import { confirmadoDisponivelAte, estimadoAte, resumoWip, type EntradaWip, type OpcoesResumoWip, type ResumoControleWip } from "@/features/escala/wipSaldo";
import { temPermissao, type Permissao } from "@/lib/permissoes";

export type AcaoWip = "ver" | "criar_controle" | "ativar_controle" | "confirmar" | "ajustar";

export interface UsuarioWip {
  id: string;
  papel: "admin" | "usuario";
  permissoes?: string[];
}

export class WipErro extends Error {
  constructor(public codigo: "NAO_AUTORIZADO" | "VALIDACAO" | "NAO_ENCONTRADO", mensagem: string) {
    super(mensagem);
    this.name = "WipErro";
  }
}

const ESCRITA: Permissao[] = ["escala_wip_confirmar"]; // além do administrador
const LEITURA: Permissao[] = ["previsao", "escala_producao", "escala_wip_confirmar"];

export function autorizadoWip(usuario: Pick<UsuarioWip, "papel" | "permissoes"> | null | undefined, acao: AcaoWip): boolean {
  if (!usuario) return false;
  const lista = acao === "ver" ? LEITURA : ESCRITA;
  return lista.some((p) => temPermissao(usuario, p));
}

function exigir(usuario: UsuarioWip | null | undefined, acao: AcaoWip) {
  if (!autorizadoWip(usuario, acao)) throw new WipErro("NAO_AUTORIZADO", acao === "ver" ? "Sem permissão para ver o estoque intermediário." : "Somente administrador ou usuário com a permissão de confirmar estoque intermediário pode alterar o WIP.");
}

export type DadosWip = Omit<EntradaWip, "hoje">;

export interface WipDb {
  carregar(semanaInicio: string): Promise<DadosWip | undefined>;
  criarControle(p: { usuarioId: string; produtoId: string; etapaOrigemId: string; etapaSeguinteId: string; dataInicio: string; saldoInicial: number }): Promise<string>;
  ativarControle(p: { usuarioId: string; controleId: string; ativo: boolean }): Promise<void>;
  ajustar(p: { usuarioId: string; controleId: string; data: string; quantidade: number; motivo: string; chave: string | null }): Promise<string>;
  confirmar(p: { usuarioId: string; controleId: string; dataReferencia: string; quantidade: number; saldoEstimado: number; motivo: string | null; chave: string | null }): Promise<string>;
}

const VAZIO: DadosWip = { controles: [], ajustes: [], confirmacoes: [], producao: [], snapshots: [], semanas: [], roteiro: { produtoAtivo: {}, etapasPorProduto: {} } };

export async function verWip(db: WipDb, usuario: UsuarioWip, semanaInicio: string, hoje: string, opcoes: OpcoesResumoWip = {}): Promise<{ podeAlterar: boolean; controles: ResumoControleWip[] }> {
  exigir(usuario, "ver");
  const d = (await db.carregar(semanaInicio)) ?? VAZIO;
  return { podeAlterar: autorizadoWip(usuario, "confirmar"), controles: resumoWip({ ...d, hoje }, semanaInicio, opcoes) };
}

async function achar(db: WipDb, controleId: string, semanaInicio: string, hoje: string) {
  const d = (await db.carregar(semanaInicio)) ?? VAZIO;
  const c = d.controles.find((x) => x.id === controleId);
  if (!c) throw new WipErro("NAO_ENCONTRADO", "Controle de estoque intermediário não encontrado (ou inativo).");
  return { c, e: { ...d, hoje } as EntradaWip };
}

export async function confirmarWip(
  db: WipDb,
  usuario: UsuarioWip,
  p: { controleId: string; quantidade: number; motivo?: string | null; dataReferencia?: string; chave?: string | null; semanaInicio: string },
  hoje: string
): Promise<{ id: string; saldoEstimado: number }> {
  exigir(usuario, "confirmar");
  if (!Number.isFinite(p.quantidade) || p.quantidade < 0) throw new WipErro("VALIDACAO", "A quantidade confirmada precisa ser um número maior ou igual a zero.");
  const { c, e } = await achar(db, p.controleId, p.semanaInicio, hoje);
  const dataRef = p.dataReferencia ?? hoje;
  if (dataRef > hoje) throw new WipErro("VALIDACAO", "A data da confirmação não pode ser futura.");
  if (dataRef < c.dataInicio) throw new WipErro("VALIDACAO", "A data da confirmação é anterior ao início do controle.");
  const estimado = estimadoAte(c, e, dataRef).valor; // recalculado AQUI: o navegador não decide o estimado
  const motivo = (p.motivo ?? "").trim();
  if (Math.abs(p.quantidade - estimado) > 1e-9 && motivo.length < 3) throw new WipErro("VALIDACAO", `A quantidade difere do estimado (${Math.round(estimado).toLocaleString("pt-BR")}): informe o motivo.`);
  const id = await db.confirmar({ usuarioId: usuario.id, controleId: c.id, dataReferencia: dataRef, quantidade: p.quantidade, saldoEstimado: estimado, motivo: motivo || null, chave: p.chave ?? null });
  return { id, saldoEstimado: estimado };
}

export async function ajustarWip(
  db: WipDb,
  usuario: UsuarioWip,
  p: { controleId: string; quantidade: number; motivo: string; data?: string; chave?: string | null; semanaInicio: string },
  hoje: string
): Promise<{ id: string }> {
  exigir(usuario, "ajustar");
  if (!Number.isFinite(p.quantidade) || p.quantidade === 0) throw new WipErro("VALIDACAO", "Informe um ajuste diferente de zero.");
  if ((p.motivo ?? "").trim().length < 3) throw new WipErro("VALIDACAO", "O motivo do ajuste é obrigatório.");
  const { c, e } = await achar(db, p.controleId, p.semanaInicio, hoje);
  const data = p.data ?? hoje;
  const estimado = estimadoAte(c, e, hoje).valor;
  // "nunca deixar saldo negativo": o ajuste não pode empurrar o saldo para baixo de zero
  if (estimado + p.quantidade < -1e-9) throw new WipErro("VALIDACAO", `O ajuste deixaria o saldo negativo (estimado hoje: ${Math.round(estimado).toLocaleString("pt-BR")}).`);
  const id = await db.ajustar({ usuarioId: usuario.id, controleId: c.id, data, quantidade: p.quantidade, motivo: p.motivo.trim(), chave: p.chave ?? null });
  return { id };
}

export async function criarControleWip(
  db: WipDb,
  usuario: UsuarioWip,
  p: { produtoId: string; etapaOrigemId: string; etapaSeguinteId: string; dataInicio: string; saldoInicial: number }
): Promise<{ id: string }> {
  exigir(usuario, "criar_controle");
  if (!Number.isFinite(p.saldoInicial) || p.saldoInicial < 0) throw new WipErro("VALIDACAO", "O saldo inicial não pode ser negativo.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.dataInicio)) throw new WipErro("VALIDACAO", "Informe a data de início do controle.");
  const id = await db.criarControle({ usuarioId: usuario.id, ...p });
  return { id };
}

export async function ativarControleWip(db: WipDb, usuario: UsuarioWip, p: { controleId: string; ativo: boolean }): Promise<void> {
  exigir(usuario, "ativar_controle");
  await db.ativarControle({ usuarioId: usuario.id, ...p });
}

export { confirmadoDisponivelAte };
