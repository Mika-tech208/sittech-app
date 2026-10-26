// E-mail do relatório semanal (SERVIDOR). Provedor atrás de uma interface: Resend (HTTPS, sem dependência nova), "mock" (testes/DEV) ou nenhum (falha explícita — nunca "enviado" sem enviar).
// Segredos só em variáveis de ambiente do servidor (RESEND_API_KEY) — nunca NEXT_PUBLIC, nunca gravados no banco.
//
//   ESCALA_EMAIL_PROVIDER   "resend" | "mock"     (ausente = e-mail desligado: toda tentativa vira "falhou" com o motivo)
//   RESEND_API_KEY          chave do Resend (server-only)
//   ESCALA_EMAIL_FROM       remetente com domínio verificado no Resend, ex.: "Sittech <relatorios@sittech.com.br>"
//   ESCALA_EMAIL_PERMITIDOS fora de PRODUÇÃO só estes destinatários (lista separada por vírgula) recebem e-mail real; qualquer outro é bloqueado
import { dataBR, dataHoraSP, somarDias } from "@/features/escala-relatorio/conteudo";

export interface EmailAnexo { nome: string; bytes: Uint8Array; tipo: string }
export interface EmailMensagem { para: string; assunto: string; texto: string; anexos: EmailAnexo[]; chaveIdempotencia?: string }
export interface ProvedorEmail { nome: string; enviar(m: EmailMensagem): Promise<{ id: string }> }

export class ErroEmail extends Error {}

// ---------- conteúdo ----------
export interface DadosEmail { semanaInicio: string; codigo: string; versao: number; fechamentoMs: number; destinatario: string; nomeArquivo: string; pdf: Uint8Array }

export function montarEmail(d: DadosEmail): EmailMensagem {
  const fim = somarDias(d.semanaInicio, 6);
  const curto = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
  const [dia, hora] = dataHoraSP(d.fechamentoMs, false).texto.split(" às ");
  const texto = [
    "Olá, Tamara.",
    "",
    `Segue em anexo o Relatório Semanal de Revezamento de Produção referente à semana de ${dataBR(d.semanaInicio)} a ${dataBR(fim)}.`,
    "",
    `O documento foi finalizado automaticamente pelo sistema em ${dia} às ${hora}.`,
    "",
    "Favor imprimir o relatório e coletar as assinaturas do responsável pela produção e das duas testemunhas indicadas no documento.",
    "",
    `Código do relatório: ${d.codigo}`,
    `Versão: v${d.versao}`,
    "",
    "Atenciosamente,",
    "Sittech Soluções Industriais",
  ].join("\n");
  return {
    para: d.destinatario,
    assunto: `Relatório semanal de revezamento — Semana ${curto(d.semanaInicio)} a ${curto(fim)}`,
    texto,
    anexos: [{ nome: d.nomeArquivo, bytes: d.pdf, tipo: "application/pdf" }],
  };
}

// ---------- provedores ----------
export function provedorResend(apiKey: string, remetente: string, fetchImpl: typeof fetch = fetch): ProvedorEmail {
  return {
    nome: "resend",
    async enviar(m) {
      const cab: Record<string, string> = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
      if (m.chaveIdempotencia) cab["Idempotency-Key"] = m.chaveIdempotencia.slice(0, 256); // reenvio da MESMA tentativa não duplica a mensagem (janela de 24 h do provedor)
      let resp: Response;
      try {
        resp = await fetchImpl("https://api.resend.com/emails", {
          method: "POST", headers: cab, signal: AbortSignal.timeout(20_000),
          body: JSON.stringify({ from: remetente, to: [m.para], subject: m.assunto, text: m.texto, attachments: m.anexos.map((a) => ({ filename: a.nome, content: Buffer.from(a.bytes).toString("base64") })) }),
        });
      } catch (e) {
        throw new ErroEmail(`Falha de rede ao enviar o e-mail: ${e instanceof Error ? e.message : "erro"}`);
      }
      const corpo = (await resp.json().catch(() => null)) as { id?: string; message?: string; name?: string } | null;
      if (!resp.ok || !corpo?.id) throw new ErroEmail(`Provedor de e-mail recusou (HTTP ${resp.status}): ${corpo?.message ?? corpo?.name ?? "sem detalhe"}`);
      return { id: corpo.id };
    },
  };
}

export interface EmailMock extends ProvedorEmail { enviados: EmailMensagem[]; falharComo: string | null }
export function provedorMock(): EmailMock {
  const m: EmailMock = {
    nome: "mock", enviados: [], falharComo: null,
    async enviar(msg) {
      if (m.falharComo) throw new ErroEmail(m.falharComo);
      m.enviados.push(msg);
      return { id: `mock-${m.enviados.length}` };
    },
  };
  return m;
}

// Fora de produção só destinatários explicitamente permitidos recebem e-mail de verdade; os demais são BLOQUEADOS (a tentativa falha e fica registrada).
export function comTravaDeAmbiente(base: ProvedorEmail, producao: boolean, permitidos: string[]): ProvedorEmail {
  if (producao || base.nome === "mock") return base;
  const ok = new Set(permitidos.map((p) => p.trim().toLowerCase()).filter(Boolean));
  return {
    nome: base.nome,
    async enviar(m) {
      if (!ok.has(m.para.trim().toLowerCase())) throw new ErroEmail(`Envio bloqueado fora de produção para ${m.para} (não está em ESCALA_EMAIL_PERMITIDOS).`);
      return base.enviar(m);
    },
  };
}

type Env = Record<string, string | undefined>;
export function provedorDoAmbiente(env: Env = process.env): ProvedorEmail {
  const qual = (env.ESCALA_EMAIL_PROVIDER ?? "").toLowerCase();
  const producao = env.VERCEL_ENV === "production";
  if (qual === "mock") return provedorMock();
  if (qual === "resend") {
    if (!env.RESEND_API_KEY || !env.ESCALA_EMAIL_FROM) return semProvedor("Provedor Resend sem RESEND_API_KEY / ESCALA_EMAIL_FROM configurados.");
    return comTravaDeAmbiente(provedorResend(env.RESEND_API_KEY, env.ESCALA_EMAIL_FROM), producao, (env.ESCALA_EMAIL_PERMITIDOS ?? "").split(","));
  }
  return semProvedor("Envio de e-mail não configurado (ESCALA_EMAIL_PROVIDER).");
}
function semProvedor(motivo: string): ProvedorEmail {
  return { nome: "nenhum", async enviar() { throw new ErroEmail(motivo); } };
}
