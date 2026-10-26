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
import { useCadastrosBase } from "@/hooks/useCadastrosBase";
import { useFuncionarios } from "@/hooks/useFuncionarios";
import { useCustos } from "@/hooks/useCustos";
import { calcularPeriodosComDuracao, filtrarPeriodosValidos, calcularHorasPorDia } from "@/lib/calculations/periodos";
import { calcularCustoHoraEOperacoes } from "@/features/custo-hora/calculations";
import LoginScreen from "@/components/shell/LoginScreen";
import Sidebar from "@/components/shell/Sidebar";
import TopBarActions from "@/components/shell/TopBarActions";
import AccountModal from "@/components/shell/AccountModal";
import AcessoNegado from "@/components/shell/AcessoNegado";
import GlobalStyles from "@/components/shell/GlobalStyles";
import { THEMES } from "@/lib/constants";
import { temPermissao } from "@/lib/permissoes";
import { formatBRL, setModoPrivadoAtivo } from "@/lib/format";
import { estruturaDasLinhas, etapasDoProduto, type LinhasRotas } from "./dados";
import { validarEstrutura, todasAsEtapas } from "./estrutura";
import type { PeriodoId } from "./tipos";
import DiagramaRotas from "./DiagramaRotas";
import PlanoRotas from "./PlanoRotas";
import SelecaoRotasPrevisao from "./SelecaoRotasPrevisao";
import { previaComCompartilhamento, type ItemSelecionado, type MetasDaEtapa } from "./compartilhada";
import type { ContextoCusto } from "./custo";
import { resolverRotas, type ResolucaoProduto } from "./resolucao";
import { estadoDeSimulacao } from "./simulacao";
import { epochMsNoFuso } from "@/features/escala/tempo";

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

  // custo/hora real (mesma fórmula do resto do app): cadastros-base → funcionários → custos fixos
  const cadastros = useCadastrosBase(auth.autenticado);
  const funcionariosHook = useFuncionarios(auth.autenticado && !cadastros.loading);
  const custosHook = useCustos(auth.autenticado && !cadastros.loading && !funcionariosHook.loading);
  const custoHora = useMemo(() => {
    const horasDia = calcularHorasPorDia(filtrarPeriodosValidos(calcularPeriodosComDuracao(cadastros.periodos)));
    return calcularCustoHoraEOperacoes(funcionariosHook.funcionarios, custosHook.fixedCosts, horasDia, cadastros.diasUteis);
  }, [cadastros.periodos, cadastros.diasUteis, funcionariosHook.funcionarios, custosHook.fixedCosts]);

  const [carga, setCarga] = useState<Carga | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [demanda, setDemanda] = useState(116625);
  const [dias, setDias] = useState(5);
  const [semanaId, setSemanaId] = useState<string>("");
  // SIMULAÇÃO da Previsão: tudo começa DESMARCADO. Esta página nunca marca máquina por você e não grava nada.
  const [selecao, setSelecao] = useState<Record<string, string[]>>({});
  const [pessoas, setPessoas] = useState(18);
  const [autoCaiNaQuinta, setAutoCaiNaQuinta] = useState(false);   // indisponibilidade dinâmica: só a Escala enxerga ⇒ realizável < nominal
  const [maxRodadas, setMaxRodadas] = useState(3);
  const [simulada, setSimulada] = useState<ResolucaoProduto | null>(null);
  const [itensSemana, setItensSemana] = useState<{ produto_id: string; quantidade: number; valor_unitario: number; previsao_item_maquinas: { etapa_id: string; maquina_id: string }[] }[]>([]);

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
      const r = await supabase.from("previsao_itens").select("produto_id, quantidade, valor_unitario, previsao_item_maquinas(etapa_id, maquina_id)").eq("previsao_id", semanaId).eq("tipo", "previsto");
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
    const etapasPorId = new Map<string, MetasDaEtapa>(carga.todasEtapas.map((e) => [e.id, { operacaoId: e.operacao_id, metas: { m1: Number(e.meta_m1), m2: Number(e.meta_m2), m3: Number(e.meta_m3), t1: Number(e.meta_t1), t2: Number(e.meta_t2), t3: Number(e.meta_t3) } as Record<PeriodoId, number> }]));
    // demais itens da semana de referência (quem também escolheu máquinas) — os legados P/A do Conector ficam de fora (são o mesmo produto)
    const porProduto = new Map<string, ItemSelecionado & { valor: number }>();
    itensSemana.filter((i) => !legados.has(i.produto_id) && i.produto_id !== produtoF.id).forEach((i) => {
      const o = porProduto.get(i.produto_id) ?? { itemId: i.produto_id, produtoNome: carga.produtos.find((x) => x.id === i.produto_id)?.nome.trim(), quantidade: 0, selecao: {}, valor: Number(i.valor_unitario) };
      o.quantidade += Number(i.quantidade);
      i.previsao_item_maquinas.forEach((m) => { o.selecao[m.etapa_id] = [...new Set([...(o.selecao[m.etapa_id] ?? []), m.maquina_id])]; });
      porProduto.set(i.produto_id, o);
    });
    const outros = [...porProduto.values()];
    const etapaAuto = estrutura.rotas.find((r) => r.codigo === "AUTO")?.etapas[0];
    const maquinasAuto = etapaAuto ? etapas.get(etapaAuto)?.maquinasIds ?? [] : [];
    const custo: ContextoCusto = { periodos, custoHoraPorOperacao: custoHora.custoHoraPorOperacao, custoHoraPadrao: custoHora.custoHoraEmpresa };
    const ctx = { periodos, diasProdutivos: dias };
    const previa = previaComCompartilhamento({ itemId: "__F", estrutura, etapas, demanda, ctx, selecao, outros, etapasDosOutros: etapasPorId, custo, valorUnitario: Number(produtoF.valor_unitario) });
    const problemas = validarEstrutura(estrutura, [...etapas.values()]);
    return { etapas, estrutura, periodos, legados, etapasPorId, outros, maquinasAuto, ctx, custo, previa, problemas, linhas };
  }, [carga, produtoF, demanda, dias, selecao, itensSemana, custoHora]);

  const nomeMaquina = (id: string) => carga?.maquinas.find((m) => m.id === id)?.nome.trim() ?? id.slice(0, 6);
  const nomeProd = (id: string) => carga?.produtos.find((p) => p.id === id)?.nome.trim() ?? id.slice(0, 6);
  const alternar = (etapaId: string, maquinaId: string) => { setSimulada(null); setSelecao((s) => { const atual = s[etapaId] ?? []; return { ...s, [etapaId]: atual.includes(maquinaId) ? atual.filter((x) => x !== maquinaId) : [...atual, maquinaId] }; }); };

  function simularEscala() {
    if (!carga || !produtoF || !modelo) return;
    const semanaInicio = "2026-11-02";
    const estado = estadoDeSimulacao({
      produtoId: produtoF.id, nomeProduto: produtoF.nome, valorUnitario: Number(produtoF.valor_unitario), linhas: modelo.linhas, todasEtapas: carga.todasEtapas, todasEtapaMaquinas: carga.linhas.etapaMaquinas,
      periodos: carga.periodos, semanaInicio, dias, demanda, selecao, maquinasIndisponiveis: [],
      outros: modelo.outros.map((o) => ({ produtoId: o.itemId, nome: o.produtoNome ?? o.itemId, quantidade: o.quantidade, valorUnitario: o.valor, maquinasPorEtapa: o.selecao })), pessoas,
      maquinaQueCai: autoCaiNaQuinta && modelo.maquinasAuto[0] ? { maquinaId: modelo.maquinasAuto[0], desdeIso: "2026-11-05T03:00:00.000Z" } : undefined,
      custoHoraPorOperacao: custoHora.custoHoraPorOperacao, custoHoraPadrao: custoHora.custoHoraEmpresa, maxRodadas,
    });
    const r = resolverRotas(estado, epochMsNoFuso(semanaInicio, "05:00"));
    setSimulada(r ? r.produtos[produtoF.id] ?? null : null);
  }

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

  const ultima = simulada?.rodadas.at(-1);
  return (
    <div className="stx-root">
      <GlobalStyles cores={cores} />
      <div className="stx-layout">
        {sidebar}
        <div className="stx-content-wrapper">
          <TopBarActions modoPrivado={modoPrivado} onToggleModoPrivado={() => { const n = !modoPrivado; setModoPrivadoAtivo(n); setModoPrivado(n); }} tema={tema} onToggleTema={() => setTema((t) => (t === "dark" ? "light" : "dark"))}
            usuarioLogado={auth.usuarioLogado} abaAtiva="produtos" onAbrirMenu={shell.abrirGaveta} />
          <div className="stx-header"><div><h1 className="stx-title">Rotas de fabricação (simulação da Previsão)</h1>
            <p className="stx-panel-sub">Ambiente de teste (M3): nada é gravado e a trava de suporte continua fechada. As máquinas começam desmarcadas — o sistema nunca escolhe máquina por você.</p></div></div>
          {erro && <div className="stx-esc-banner erro">{erro}</div>}
          {!carga && !erro && <div className="stx-empty">Carregando…</div>}
          {carga && !produtoF && <div className="stx-empty">Nenhum produto com rotas neste ambiente (a M1 ainda não foi aplicada).</div>}
          {carga && produtoF && modelo && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16, paddingBottom: 24 }}>
              <section style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 14 }}>
                <b>{produtoF.nome}</b> · referência {produtoF.referencia} · valor único R$ {Number(produtoF.valor_unitario).toLocaleString("pt-BR", { minimumFractionDigits: 4 })}
                <div style={{ overflowX: "auto", marginTop: 10 }}><DiagramaRotas estrutura={modelo.estrutura} etapas={modelo.etapas} nomeProduto={produtoF.nome} /></div>
              </section>

              <section style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
                <b>Previsão simulada</b>
                <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 13, alignItems: "flex-end" }}>
                  <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>Quantidade prevista (demanda final)<input type="number" value={demanda} min={0} onChange={(e) => { setSimulada(null); setDemanda(Math.max(0, Number(e.target.value))); }} style={{ width: 130 }} /></label>
                  <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>Dias produtivos<input type="number" value={dias} min={1} max={7} onChange={(e) => { setSimulada(null); setDias(Math.min(7, Math.max(1, Number(e.target.value)))); }} style={{ width: 80 }} /></label>
                  <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>Semana de referência (outros itens e suas máquinas)
                    <select value={semanaId} onChange={(e) => { setSimulada(null); setSemanaId(e.target.value); }}>{carga.previsoes.map((p) => <option key={p.id} value={p.id}>{p.semana_inicio}{p.modelo_rotas ? " (rotas)" : ""}</option>)}</select></label>
                  <button type="button" className="stx-btn-secondary" onClick={() => { setSimulada(null); setSelecao({}); }}>Desmarcar tudo</button>
                </div>
                <SelecaoRotasPrevisao estrutura={modelo.estrutura} etapas={modelo.etapas} nomeMaquina={nomeMaquina} maquinasIndisponiveis={[]} selecao={selecao} onToggleMaquina={alternar} demanda={demanda} ctx={modelo.ctx}
                  outros={modelo.outros} etapasDosOutros={modelo.etapasPorId} custo={modelo.custo} valorUnitario={Number(produtoF.valor_unitario)}
                  realizavel={ultima ? { porRota: ultima.capacidadeRealizavelPorRota, final: ultima.finalRealizavel, observacao: simulada?.convergiu ? "convergiu" : "não convergiu" } : null} />
                {modelo.outros.length > 0 && <p className="stx-panel-sub" style={{ margin: 0 }}>Outros itens da semana de referência usados na disputa por máquina: {modelo.outros.map((o) => nomeProd(o.itemId)).join(", ")}.</p>}
              </section>

              <section style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
                <b>Divisão, funil do fluxo comum e gargalo (nominal)</b>
                <PlanoRotas plano={modelo.previa.plano} />
              </section>

              <section style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
                <b>Escala em memória — capacidade realizável e feedback (até {maxRodadas} rodadas)</b>
                <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 13, alignItems: "flex-end" }}>
                  <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>Pessoas na equipe<input type="number" min={1} value={pessoas} onChange={(e) => { setSimulada(null); setPessoas(Math.max(1, Number(e.target.value))); }} style={{ width: 80 }} /></label>
                  <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>Rodadas (máx.)<input type="number" min={1} max={3} value={maxRodadas} onChange={(e) => { setSimulada(null); setMaxRodadas(Math.min(3, Math.max(1, Number(e.target.value)))); }} style={{ width: 70 }} /></label>
                  <label style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={autoCaiNaQuinta} onChange={(e) => { setSimulada(null); setAutoCaiNaQuinta(e.target.checked); }} />máquina automática cai na quinta (só a Escala vê)</label>
                  <button type="button" className="stx-btn-primary" onClick={simularEscala}>Simular Escala</button>
                </div>
                {!simulada && <p className="stx-panel-sub" style={{ margin: 0 }}>Marque as máquinas e clique em “Simular Escala”. O resultado volta agrupado no Conector 3/4&quot; (Final): Rota convencional, Rota automática e Fluxo comum.</p>}
                {simulada && (
                  <div style={{ fontSize: 13 }}>
                    <b>{simulada.convergiu ? "Convergiu" : "NÃO convergiu"}</b> — motivo da parada: <code>{simulada.parada}</code> · {simulada.rodadas.length} rodada(s)
                    <div style={{ overflowX: "auto", marginTop: 6 }}>
                      <table className="stx-rel-tabela" style={{ minWidth: 560, width: "100%", borderCollapse: "collapse" }}>
                        <thead><tr><th>Rodada</th><th>Rota</th><th style={{ textAlign: "right" }}>Alvo</th><th style={{ textAlign: "right" }}>Nominal</th><th style={{ textAlign: "right" }}>Realizável</th><th>Hash entrada</th></tr></thead>
                        <tbody>{simulada.rodadas.flatMap((r) => Object.keys(r.alvo).map((c) => (
                          <tr key={`${r.rodada}-${c}`}><td>{r.rodada}</td><td>{c === "AUTO" ? "Rota automática" : c === "CONV" ? "Rota convencional" : c}</td><td style={{ textAlign: "right" }}>{fmt(r.alvo[c])}</td><td style={{ textAlign: "right" }}>{fmt(r.capacidadeNominalPorRota[c])}</td><td style={{ textAlign: "right" }}>{fmt(r.capacidadeRealizavelPorRota[c])}</td><td><code>{r.hashEntradaPlanejador.slice(0, 10)}</code></td></tr>
                        )))}</tbody>
                      </table>
                    </div>
                    <p style={{ margin: "6px 0 0" }}>Fluxo comum planejado {fmt(simulada.plano.final)} · realizável pela Escala {fmt(ultima?.finalRealizavel ?? 0)}.</p>
                    {simulada.diagnostico.length > 0 && <ul style={{ margin: "6px 0 0", paddingLeft: 18, color: "var(--warning)" }}>{simulada.diagnostico.map((d) => <li key={d}>{d}</li>)}</ul>}
                  </div>
                )}
              </section>

              <section style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 14, fontSize: 13 }}>
                <b>Verificações estruturais</b>
                <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
                  <li>Estrutura válida: {modelo.problemas.length === 0 ? "sim" : <span style={{ color: "var(--danger)" }}>{modelo.problemas.join("; ")}</span>}</li>
                  <li>Etapas do produto final: {todasAsEtapas(modelo.estrutura).length} (ids novos; nenhuma etapa legada referenciada)</li>
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
