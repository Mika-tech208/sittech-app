#!/usr/bin/env node
// Guard de ambiente — roda ANTES de todo build (ver "prebuild" em
// package.json, disparado automaticamente pelo `npm run build`, inclusive
// no build da Vercel). Único objetivo: impedir que um deploy de Production
// suba com config do projeto Supabase DEV (incidente já ocorrido uma vez —
// ver histórico do projeto).
//
// Só age quando VERCEL_ENV === "production" (setado automaticamente pela
// Vercel só nos builds de Production). Preview, DEV e build local (sem
// VERCEL_ENV) passam direto, sem nenhuma exigência de ref — não é objetivo
// deste guard validar Preview/DEV, só travar Production.
//
// Não imprime nenhum segredo: só o "ref" do projeto (identificador de 20
// chars no início da URL/dos JWTs — já público, faz parte da própria URL
// do Supabase) extraído de cada variável, nunca o valor completo.

const PROD_REF = "qcmottqryawyrghdepel";
const DEV_REF = "zjwcomwjmhsloyxfypax";

function refDaUrl(url) {
  const m = /^https:\/\/([a-z0-9]+)\.supabase\.co/.exec(url ?? "");
  return m?.[1] ?? null;
}

function refDoJwt(token) {
  const partes = (token ?? "").split(".");
  if (partes.length !== 3) return null;
  try {
    const payloadBase64 = partes[1].replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(partes[1].length / 4) * 4, "=");
    const payload = JSON.parse(Buffer.from(payloadBase64, "base64").toString("utf8"));
    return payload.ref ?? null;
  } catch {
    return null;
  }
}

function falhar(mensagens) {
  console.error("\n🚫 GUARD DE AMBIENTE — build de Production BLOQUEADO\n");
  for (const linha of mensagens) console.error("   " + linha);
  console.error(
    `\n   Production deve usar exclusivamente o projeto Supabase PROD (ref ${PROD_REF}).\n` +
      `   Corrija as env vars de Production na Vercel (NEXT_PUBLIC_SUPABASE_URL,\n` +
      `   NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY) e rode o build de novo.\n`
  );
  process.exit(1);
}

function main() {
  if (process.env.VERCEL_ENV !== "production") {
    console.log("[check-env-guard] Não é build de Production (VERCEL_ENV=" + (process.env.VERCEL_ENV ?? "local") + ") — guard não se aplica, seguindo.");
    return;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const urlRef = refDaUrl(url);
  const anonRef = refDoJwt(anonKey);
  const serviceRef = refDoJwt(serviceKey);

  const erros = [];

  if (!urlRef) {
    erros.push(`NEXT_PUBLIC_SUPABASE_URL ausente ou em formato inesperado (não foi possível extrair o ref do projeto).`);
  } else if (urlRef === DEV_REF) {
    erros.push(`NEXT_PUBLIC_SUPABASE_URL aponta para o projeto DEV (ref ${DEV_REF}) — Production NUNCA pode usar o banco DEV.`);
  } else if (urlRef !== PROD_REF) {
    erros.push(`NEXT_PUBLIC_SUPABASE_URL aponta para o ref "${urlRef}", diferente do PROD esperado (${PROD_REF}).`);
  }

  if (!anonRef) {
    erros.push(`NEXT_PUBLIC_SUPABASE_ANON_KEY ausente ou não é um JWT válido do Supabase.`);
  } else if (urlRef && anonRef !== urlRef) {
    erros.push(`NEXT_PUBLIC_SUPABASE_ANON_KEY pertence ao ref "${anonRef}", diferente da URL configurada ("${urlRef}") — chave e URL de projetos diferentes.`);
  }

  if (!serviceRef) {
    erros.push(`SUPABASE_SERVICE_ROLE_KEY ausente ou não é um JWT válido do Supabase.`);
  } else if (urlRef && serviceRef !== urlRef) {
    erros.push(`SUPABASE_SERVICE_ROLE_KEY pertence ao ref "${serviceRef}", diferente da URL configurada ("${urlRef}") — chave e URL de projetos diferentes.`);
  }

  if (erros.length > 0) falhar(erros);

  console.log(`[check-env-guard] OK — Production confirmado no projeto Supabase PROD (ref ${PROD_REF}). URL, anon key e service role key consistentes entre si.`);
}

main();
