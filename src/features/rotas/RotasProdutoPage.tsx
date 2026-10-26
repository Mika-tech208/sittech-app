"use client";

// Demonstração SOMENTE LEITURA do modelo de rotas (M0/M1): produto final, rotas, convergência no pool comum e capacidade/gargalo. Não altera nada, não divide demanda,
// não é o planejador e não aparece no sidebar (acesso por /produtos/rotas). Permissão: `produtos` (admin sempre).
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/services/supabase-client";
import { useAuthSession } from "@/hooks/useAuthSession";
import { useSidebarState } from "@/hooks/useSidebarState";
import { useMetaSemanalShell } from "@/hooks/useMetaSemanalShell";
import { useTema } from "@/hooks/useTema";
import LoginScreen from "@/components/shell/LoginScreen";
import Sidebar from "@/components/shell/Sidebar";
import TopBarActions from "@/components/shell/TopBarActions";
import AccountModal from "@/components/shell/AccountModal";
import AcessoNegado from "@/components/shell/AcessoNegado";
import GlobalStyles from "@/components/shell/GlobalStyles";
import { THEMES } from "@/lib/constants";
import { temPermissao } from "@/lib/permissoes";
import { formatBRL, setModoPrivadoAtivo } from "@/lib/format";
import { cenario, estruturaDasLinhas, etapasDoProduto, horasComprometidasPorOutros, selecaoComoPrevisaoLegada, type LinhasRotas } from "./dados";
import { validarEstrutura, todasAsEtapas } from "./estrutura";
import type { ContextoCapacidade, PeriodoId } from "./tipos";
import DiagramaRotas from "./DiagramaRotas";

interface Carga {
  linhas: Omit<LinhasRotas, "produtoId">;
  produtos: { id: string; nome: string; referencia: string | null; valor_unitario: number }[];
  variantes: { produto_legado_id: string; produto_final_id: string; rota_id: string }[];
  maquinas: { id: string; nome: string }[];
  periodos: { id: string; inicio: string; fim: string }[];
  previsoes: { id: string; semana_inicio: string; modelo_rotas: boolean }[];
  todasEtapas: LinhasRotas["etapas"];
}
const min = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const fmt = (n: number) => (Number.isFinite(n) ? Math.round(n).toLocaleString("pt-BR") : "∞");

async function carregar(): Promise<Carga> {
  const q = async <T,>(p: PromiseLike<{ data: T | null; error: { message: string } | null }>) => { const r = await p; if (r.error) throw new Error(r.error.message); return (r.data ?? []) as T; };
  const [rotas, rotaEtapas, poolComum, variantes, etapas, etapaMaquinas, operacoes, produtos, maquinas, periodos, previsoes] = await Promise.all([
    q<Carga["linhas"]["rotas"]>(supabase.from("produto_rota").select("id, produto_id, codigo, nome, ativa, preferencia")),
    q<Carga["linhas"]["rotaEtapas"]>(supabase.from("rota_etapas").select("rota_id, etapa_id, posicao")),
    q<Carga["linhas"]["poolComum"]>(supabase.from("produto_pool_comum").select("produto_id, etapa_id, posicao, final")),
    q<Carga["variantes"]>(supabase.from("produto_variante_legada").select("produto_legado_id, produto_final_id, rota_id")),
    q<Carga["todasEtapas"]>(supabase.from("roteiro_etapas").select("id, produto_id, operacao_id, ordem, meta_m1, meta_m2, meta_m3, meta_t1, meta_t2, meta_t3")),
    q<Carga["linhas"]["etapaMaquinas"]>(supabase.from("roteiro_etapa_maquinas").select("etapa_id, maquina_id")),
    q<Carga["linhas"]["operacoes"]>(supabase.from("operacoes").select("id, nome")),
    q<Carga["produtos"]>(supabase.from("produtos").select("id, nome, referencia, valor_unitario")),
    q<Carga["maquinas"]>(supabase.from("maquinas").select("id, nome")),
    q<Carga["periodos"]>(supabase.from("periodos").select("id, inicio, fim").order("id")),
    q<Carga["previsoes"]>(supabase.from("previsoes").select("id, semana_inicio, modelo_rotas").order("semana_inicio", { ascending: false })),
  ]);
  return { linhas: { etapas, etapaMaquinas, operacoes, rotas, rotaEtapas, poolComum }, produtos, variantes, maquinas, periodos, previsoes, todasEtapas: etapas };
}

export default function RotasProdutoPage() {
  const router = useRouter();
  const [tema, setTema] = useTema();
  const cores = THEMES[tema];
  const [modoPrivado, setModoPrivado] = useState(false);
  const shell = useSidebarState("produtos");
  const auth = useAuthSession();
  const meta = useMetaSemanalShell(auth.autenticado);
  const permitido = temPermissao(auth.usuarioLogado, "produtos");

  const [carga, setCarga] = useState<Carga | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [demanda, setDemanda] = useState(116625);
  const [dias, setDias] = useState(5);
  const [modoMaquinas, setModoMaquinas] = useState<"previsao_legada" | "todas">("previsao_legada");
  const [descontar, setDescontar] = useState(true);
  const [semanaId, setSemanaId] = useState<string>("");
  const [manual, setManual] = useState<Record<string, string[]> | null>(null);   // ajuste manual de máquinas por etapa (o que a Previsão selecionaria)
  const [itensSemana, setItensSemana] = useState<{ produto_id: string; quantidade: number; previsao_item_maquinas: { etapa_id: string; maquina_id: string }[] }[]>([]);

  const ativo = auth.autenticado && permitido;
  useEffect(() => {
    if (!ativo) return;
    let vivo = true;
    void (async () => {
      try { const c = await carregar(); if (vivo) { setErro(null); setCarga(c); setSemanaId((s) => s || c.previsoes.find((p) => !p.modelo_rotas)?.id || ""); } }
      catch (e) { if (vivo) setErro(e instanceof Error ? e.message : "Falha ao carregar."); }
    })();
    return () => { vivo = false; };
  }, [ativo]);
  useEffect(() => {
    if (!ativo || !semanaId) return;
    let vivo = true;
    void (async () => {
      const r = await supabase.from("previsao_itens").select("produto_id, quantidade, previsao_item_maquinas(etapa_id, maquina_id)").eq("previsao_id", semanaId).eq("tipo", "previsto");
      if (vivo && !r.error) setItensSemana((r.data ?? []) as unknown as typeof itensSemana);
    })();
    return () => { vivo = false; };
  }, [ativo, semanaId]);

  const produtoF = carga?.produtos.find((p) => carga.linhas.rotas.some((r) => r.produto_id === p.id));
  const modelo = useMemo(() => {
    if (!carga || !produtoF) return null;
    const linhas: LinhasRotas = { ...carga.linhas, produtoId: produtoF.id };
    const etapas = etapasDoProduto(linhas);
    const estrutura = estruturaDasLinhas(linhas);
    const periodos = carga.periodos.map((p) => ({ id: p.id as PeriodoId, minutos: min(p.fim) - min(p.inicio) }));
    const legados = new Set(carga.variantes.filter((v) => v.produto_final_id === produtoF.id).map((v) => v.produto_legado_id));
    const opDaEtapa = new Map(carga.todasEtapas.map((e) => [e.id, e.operacao_id]));
    const etapasPorId = new Map(carga.todasEtapas.map((e) => [e.id, { operacaoId: e.operacao_id, metas: { m1: Number(e.meta_m1), m2: Number(e.meta_m2), m3: Number(e.meta_m3), t1: Number(e.meta_t1), t2: Number(e.meta_t2), t3: Number(e.meta_t3) } as Record<PeriodoId, number> }]));
    const base = modoMaquinas === "previsao_legada" ? selecaoComoPrevisaoLegada(etapas, itensSemana, legados, opDaEtapa) : Object.fromEntries([...etapas.values()].map((e) => [e.id, e.maquinasIds]));
    const selecao = manual ?? base;
    const ctx: ContextoCapacidade = { periodos, diasProdutivos: dias };
    if (descontar) ctx.horasComprometidasPorMaquina = horasComprometidasPorOutros(itensSemana, new Set([produtoF.id, ...legados]), etapasPorId, ctx);
    const analise = cenario(estrutura, etapas, demanda, ctx, selecao);
    const problemas = validarEstrutura(estrutura, [...etapas.values()]);
    return { etapas, estrutura, analise, problemas, selecao, ctx, legados };
  }, [carga, produtoF, demanda, dias, modoMaquinas, descontar, itensSemana, manual]);

  const nomeMaquina = (id: string) => carga?.maquinas.find((m) => m.id === id)?.nome.trim() ?? id.slice(0, 6);
  const nomeProd = (id: string) => carga?.produtos.find((p) => p.id === id)?.nome.trim() ?? id.slice(0, 6);

  if (meta.loading || auth.restaurandoSessao || !auth.autenticado) {
    return (
      <div className="stx-root">
        <GlobalStyles cores={cores} />
        <LoginScreen loading={auth.restaurandoSessao || (auth.autenticado && meta.loading)} tema={tema} loginUsuario={auth.loginUsuario} setLoginUsuario={auth.setLoginUsuario} loginSenha={auth.loginSenha} setLoginSenha={auth.setLoginSenha}
          loginErro={auth.loginErro} loginCarregando={auth.loginCarregando} onSubmit={auth.handleLogin} campoLogin="email" />
      </div>
    );
  }
  const sidebar = (
    <Sidebar tema={tema} abaAtiva="produtos" onNavigateTab={(key) => { router.push(`/?aba=${key}`); }} gruposAbertos={shell.gruposAbertos} toggleGrupo={shell.toggleGrupo} usuarioLogado={auth.usuarioLogado}
      metaSemanalUsaPrevisto={meta.metaSemanalUsaPrevisto} metaInvalida={meta.metaInvalida} metaSemanalFinal={meta.metaSemanalFinal} formatBRL={formatBRL} onMetaClick={() => { router.push("/"); }}
      onAbrirMinhaConta={auth.abrirMinhaConta} onSair={() => auth.handleLogout()} recolhida={shell.recolhida} onToggleRecolhida={shell.toggleRecolhida} gavetaAberta={shell.gavetaAberta} onFecharGaveta={shell.fecharGaveta} />
  );
  if (!permitido) return <div className="stx-root"><GlobalStyles cores={cores} /><div className="stx-layout">{sidebar}<AcessoNegado /></div></div>;

  const a = modelo?.analise;
  return (
    <div className="stx-root">
      <GlobalStyles cores={cores} />
      <div className="stx-layout">
        {sidebar}
        <div className="stx-content-wrapper">
          <TopBarActions modoPrivado={modoPrivado} onToggleModoPrivado={() => { const n = !modoPrivado; setModoPrivadoAtivo(n); setModoPrivado(n); }} tema={tema} onToggleTema={() => setTema((t) => (t === "dark" ? "light" : "dark"))}
            usuarioLogado={auth.usuarioLogado} abaAtiva="produtos" onAbrirMenu={shell.abrirGaveta} />
          <div className="stx-header"><div><h1 className="stx-title">Rotas de fabricação (demonstração)</h1>
            <p className="stx-panel-sub">Somente leitura — M0/M1. O planejador, a Previsão e a Escala ainda NÃO usam este modelo.</p></div></div>
          {erro && <div className="stx-esc-banner erro">{erro}</div>}
          {!carga && !erro && <div className="stx-empty">Carregando…</div>}
          {carga && !produtoF && <div className="stx-empty">Nenhum produto com rotas neste ambiente (a M1 ainda não foi aplicada).</div>}
          {carga && produtoF && modelo && a && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16, paddingBottom: 24 }}>
              <section style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 14 }}>
                <b>{produtoF.nome}</b> · referência {produtoF.referencia} · valor único R$ {Number(produtoF.valor_unitario).toLocaleString("pt-BR", { minimumFractionDigits: 4 })}
                <div style={{ overflowX: "auto", marginTop: 10 }}><DiagramaRotas estrutura={modelo.estrutura} etapas={modelo.etapas} analise={a} nomeProduto={produtoF.nome} /></div>
              </section>

              <section style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
                <b>Cenário de capacidade</b>
                <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 13, alignItems: "flex-end" }}>
                  <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>Demanda final<input type="number" value={demanda} min={0} onChange={(e) => setDemanda(Math.max(0, Number(e.target.value)))} style={{ width: 120 }} /></label>
                  <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>Dias produtivos<input type="number" value={dias} min={1} max={7} onChange={(e) => setDias(Math.min(7, Math.max(1, Number(e.target.value))))} style={{ width: 80 }} /></label>
                  <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>Semana de referência (itens dos outros produtos / máquinas)
                    <select value={semanaId} onChange={(e) => setSemanaId(e.target.value)}>{carga.previsoes.map((p) => <option key={p.id} value={p.id}>{p.semana_inicio}{p.modelo_rotas ? " (rotas)" : ""}</option>)}</select></label>
                  <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>Máquinas
                    <select value={modoMaquinas} onChange={(e) => { setManual(null); setModoMaquinas(e.target.value as "previsao_legada" | "todas"); }}><option value="previsao_legada">como a Previsão dos produtos legados</option><option value="todas">todas as elegíveis</option></select></label>
                  <label style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={descontar} onChange={(e) => setDescontar(e.target.checked)} />descontar capacidade comprometida por outros produtos</label>
                </div>
                <div style={{ fontSize: 14 }}>
                  <b>{a.atende ? "A demanda cabe" : "A demanda NÃO cabe"}:</b> entregável {fmt(a.maxEntregavel)} de {fmt(a.demanda)}{a.falta > 0 ? ` (faltam ${fmt(a.falta)})` : ""} · entrada das rotas {fmt(a.capacidadeEntrada)} · pool comum {fmt(a.capacidadeComum)}.
                  {a.gargalo?.tipo === "comum" && <> Gargalo <b>comum</b>: {a.gargalo.operacao}.</>}
                  {a.gargalo?.tipo === "entrada" && <> A soma das rotas não cobre a demanda: {a.gargalo.limitantes.map((l) => `${l.rotaCodigo} (${l.operacao}: ${fmt(l.pecas)})`).join(" + ")}.</>}
                </div>
                <div style={{ overflowX: "auto" }}>
                  <table className="stx-rel-tabela" style={{ minWidth: 520, width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead><tr><th style={{ textAlign: "left" }}>Etapa</th><th style={{ textAlign: "left" }}>Onde</th><th style={{ textAlign: "left" }}>Máquinas marcadas (peças/semana)</th><th style={{ textAlign: "right" }}>Capacidade</th></tr></thead>
                    <tbody>
                      {[...a.capacidadePorRota.flatMap((r) => r.etapas.map((c) => ({ c, onde: r.rotaCodigo }))), ...a.comum.map((c) => ({ c, onde: "POOL COMUM" }))].map(({ c, onde }) => (
                        <tr key={c.etapaId}><td>{c.operacao}</td><td>{onde}</td><td>
                          {modelo.etapas.get(c.etapaId)?.maquinasIds.map((m) => {
                            const marcada = (modelo.selecao?.[c.etapaId] ?? []).includes(m);
                            return (
                              <label key={m} style={{ marginRight: 10, whiteSpace: "nowrap" }}>
                                <input type="checkbox" checked={marcada} onChange={() => setManual({ ...(modelo.selecao ?? {}), [c.etapaId]: marcada ? (modelo.selecao?.[c.etapaId] ?? []).filter((x) => x !== m) : [...(modelo.selecao?.[c.etapaId] ?? []), m] })} />
                                {" "}{nomeMaquina(m)}{c.porMaquina[m] !== undefined ? ` ${fmt(c.porMaquina[m])}` : ""}
                              </label>
                            );
                          })}
                        </td><td style={{ textAlign: "right" }}>{fmt(c.pecas)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 14, fontSize: 13 }}>
                <b>Verificações estruturais</b>
                <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
                  <li>Estrutura válida: {modelo.problemas.length === 0 ? "sim" : <span style={{ color: "var(--danger)" }}>{modelo.problemas.join("; ")}</span>}</li>
                  <li>Etapas do produto final: {todasAsEtapas(modelo.estrutura).length} (todas com ids novos; nenhuma etapa legada referenciada)</li>
                  <li>Etapa final (explícita, não por ordem): {modelo.etapas.get(modelo.estrutura.etapaFinalId ?? "")?.operacao ?? "—"}</li>
                  <li>Vínculo analítico: {carga.variantes.filter((v) => v.produto_final_id === produtoF.id).map((v) => `${nomeProd(v.produto_legado_id)} → ${carga.linhas.rotas.find((r) => r.id === v.rota_id)?.codigo}`).join(" · ")}</li>
                </ul>
              </section>
            </div>
          )}
        </div>
      </div>
      <AccountModal usuarioLogado={auth.usuarioLogado} aberta={auth.minhaContaAberta} onFechar={() => auth.setMinhaContaAberta(false)} minhaSenhaAtual={auth.minhaSenhaAtual} setMinhaSenhaAtual={auth.setMinhaSenhaAtual}
        minhaSenhaNova={auth.minhaSenhaNova} setMinhaSenhaNova={auth.setMinhaSenhaNova} minhaSenhaConfirma={auth.minhaSenhaConfirma} setMinhaSenhaConfirma={auth.setMinhaSenhaConfirma} minhaContaMsg={auth.minhaContaMsg} onSalvar={auth.alterarMinhaSenha} />
    </div>
  );
}
