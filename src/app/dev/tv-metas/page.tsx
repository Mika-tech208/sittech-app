"use client";

// TV de metas — harness de DEV (sem banco, sem login) para revisar o visual e tirar screenshots. Em produção nunca renderiza (notFound()), mesmo padrão de /dev/fechamento.
// ?cenario= varios (padrão) · abaixo · cem · acima · muitos · poucos · vazio   ·   ?slide=N fixa o slide (0 = geral)
import { notFound } from "next/navigation";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import PainelMetasTv from "@/features/escala/tv-metas/PainelMetasTv";
import { montarModeloTv, type PayloadMetasTv } from "@/features/escala/tv-metas/metasTv";

if (process.env.NODE_ENV === "production") {
  notFound();
}

type P = { id: string; nome: string; meta: number | null; boas: number; encerrado?: boolean };
const payload = (produtos: P[], existe = true): PayloadMetasTv => ({
  agora: "2026-11-14T18:32:00Z", semana_inicio: "2026-11-09", semana_fim: "2026-11-15", existe,
  produtos: produtos.map((p) => ({ produto_id: p.id, nome: p.nome, meta: p.meta, encerrado: !!p.encerrado })),
  apontado: produtos.filter((p) => p.boas > 0).map((p) => ({
    produto_id: p.id, etapa_id: `${p.id}-f`, operacao_id: "op", quantidade_boa: p.boas, n_apontamentos: 5, etapa_ordem: 1, etapa_operacao_id: "op", ultima_ordem: 1, n_na_ultima_ordem: 1, ultima_operacao_id: "op",
  })),
});

const REAIS: P[] = [
  { id: "pino", nome: "Pino", meta: 108000, boas: 78953 },
  { id: "caixa", nome: "Caixa Amarela 4x4", meta: 51600, boas: 35550 },
  { id: "c114", nome: "Conector 1.1/4\"", meta: 2000, boas: 1200 },
  { id: "plug", nome: "Plug Macho", meta: 33000, boas: 30180 },
  { id: "c34", nome: "Conector 3/4\" (Produto Único)", meta: 76125, boas: 78750 },
  { id: "c3", nome: "Conector 3\"", meta: 500, boas: 1535 },
  { id: "leg", nome: "Conector 3/4\"", meta: null, boas: 2500 },
  { id: "c42", nome: "Caixa Amarela 4x2", meta: 56400, boas: 27930, encerrado: true },
];
const MAIS: P[] = [
  ...REAIS.slice(0, 6),
  { id: "t1", nome: "Terminal Fêmea 6,3 mm", meta: 40000, boas: 12000 },
  { id: "t2", nome: "Luva de Emenda 1\"", meta: 18000, boas: 9400 },
  { id: "t3", nome: "Bucha Isolante 3/8\"", meta: 25000, boas: 25000 },
  { id: "t4", nome: "Conector Reto 1/2\"", meta: 30000, boas: 7200 },
  { id: "t5", nome: "Tampa Cega Sobrepor", meta: 12000, boas: 13500 },
  REAIS[7],
];
const CENARIOS: Record<string, PayloadMetasTv> = {
  varios: payload(REAIS),
  abaixo: payload([
    { id: "a", nome: "Pino", meta: 108000, boas: 41000 }, { id: "b", nome: "Caixa Amarela 4x4", meta: 51600, boas: 18200 },
    { id: "c", nome: "Conector 1.1/4\"", meta: 2000, boas: 600 }, { id: "d", nome: "Plug Macho", meta: 33000, boas: 14500 },
  ]),
  cem: payload([
    { id: "a", nome: "Plug Macho", meta: 33000, boas: 33000 }, { id: "b", nome: "Caixa Amarela 4x4", meta: 51600, boas: 51600 }, { id: "c", nome: "Pino", meta: 108000, boas: 91000 },
  ]),
  acima: payload([
    { id: "a", nome: "Conector 3/4\" (Produto Único)", meta: 50000, boas: 56340 }, { id: "b", nome: "Plug Macho", meta: 33000, boas: 40600 }, { id: "c", nome: "Conector 3\"", meta: 500, boas: 1535 },
  ]),
  muitos: payload(MAIS),
  poucos: payload(REAIS.slice(0, 2)),
  vazio: payload([], false),
};

function Cena() {
  const q = useSearchParams();
  const cenario = q.get("cenario") ?? "varios";
  const slide = q.get("slide");
  const modelo = montarModeloTv(CENARIOS[cenario] ?? CENARIOS.varios);
  return <><style>{"nextjs-portal{display:none!important}"}</style><PainelMetasTv modelo={modelo} atualizadoEm="15:32" conexao="ok" slideFixo={slide === null ? 0 : Number(slide)} /></>;
}

export default function Page() {
  return <Suspense><Cena /></Suspense>;
}
