// Teste de ENVIO do relatório semanal (provedor de e-mail) para UM endereço interno autorizado — nunca para a Tamara.
// Envia o PDF de exemplo (dados fictícios) como anexo, pelo MESMO caminho do fechamento automático (montarEmail → provedorDoAmbiente), e confere o hash do anexo.
//
//   ESCALA_EMAIL_PROVIDER=resend RESEND_API_KEY=… ESCALA_EMAIL_FROM="Sittech <relatorios@dominio-verificado>" ESCALA_EMAIL_PERMITIDOS=voce@sittech.com.br \
//     npx tsx scripts/escala-email-teste.ts voce@sittech.com.br
//
// As variáveis vêm do shell (a chave NUNCA é gravada em arquivo do repositório). Sem ESCALA_EMAIL_PERMITIDOS o envio fora de produção é bloqueado de propósito.
import { createHash } from "node:crypto";
import { hashDoConteudo, montarConteudo } from "@/features/escala-relatorio/conteudo";
import { renderizarPdf } from "@/features/escala-relatorio/pdf";
import { ap, aus, em, fontes, OP } from "@/features/escala-relatorio/__tests__/fixtures";
import { montarEmail, provedorDoAmbiente } from "@/lib/escala-relatorio/email";

const BLOQUEADOS = ["tamara@sittech.com.br"];

async function main() {
  const destino = (process.argv[2] ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(destino)) throw new Error("Informe o e-mail de teste: npx tsx scripts/escala-email-teste.ts voce@sittech.com.br");
  if (BLOQUEADOS.includes(destino)) throw new Error("Este script nunca envia para a destinatária final. Use um endereço interno de teste.");

  const ids = ["m1", "m2", "m3", "t1", "t2", "t3"];
  const aps = (f: string, ops: string[]) => ids.map((p, i) => ap(f, p, i % 2 === 0 ? "r3" : "m18", ops[i]));
  const f = fontes({ apontamentos: [...aps("f1", [OP.rosq, OP.mont, OP.emb, OP.etiq, OP.rosq, OP.mont]), ...aps("f2", [OP.mont, OP.rosq, OP.etiq, OP.emb, OP.mont, OP.rosq])], ausencias: [aus("f3")] });
  const sexta = "2026-11-06";
  const c = montarConteudo(f, { tipo: "executada", codigo: "ESC-EXEC-TESTE-0001", versao: 1, geradoEmMs: em("18:07", sexta), geradoPor: { id: "sistema", nome: "Sistema (fechamento automático)" },
    urlVerificacao: `${process.env.RELATORIO_BASE_URL ?? "https://exemplo.test"}/relatorios/escala/verificar/00000000-0000-0000-0000-000000000000`, consolidadoAteMs: em("18:00", sexta), fechamentoAutomatico: true });
  const { hash } = hashDoConteudo(c);
  const pdf = await renderizarPdf(c, hash);
  const sha = createHash("sha256").update(pdf.bytes).digest("hex");

  const msg = montarEmail({ semanaInicio: "2026-11-02", codigo: c.codigo, versao: 1, fechamentoMs: em("18:00", sexta), destinatario: destino, nomeArquivo: pdf.nomeArquivo, pdf: pdf.bytes });
  msg.assunto = `[TESTE] ${msg.assunto}`;
  msg.texto = `*** E-MAIL DE TESTE — dados fictícios — não é um relatório real ***\n\n${msg.texto}\n\nSHA-256 do anexo: ${sha}`;
  const provedor = provedorDoAmbiente();
  console.log(`provedor=${provedor.nome} destino=${destino} anexo=${pdf.nomeArquivo} bytes=${pdf.bytes.length} sha256=${sha}`);
  const r = await provedor.enviar({ ...msg, chaveIdempotencia: `escala-email-teste-${Date.now()}` });
  console.log(`ENVIADO — id do provedor: ${r.id}. Confira na caixa de ${destino}: assunto, corpo, anexo e o SHA-256 acima (sha256sum do arquivo baixado).`);
}
main().catch((e) => { console.error("FALHOU:", e instanceof Error ? e.message : e); process.exit(1); });
