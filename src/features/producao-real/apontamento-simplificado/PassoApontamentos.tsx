"use client";

// PASSOS 1 e 2 do fechamento: postos PROGRAMADOS pré-preenchidos pela escala (normalmente só produzido e refugo) + NÃO PRODUZIU + `+ ADICIONAR APONTAMENTO`.
// TUDO editável (máquina, operador, produto); o planejado aparece ao lado e nunca é sobrescrito. Operador = registro de quem estava no posto, não desempenho.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { estadoApontamentosApi, salvarApontamentosApi } from "./api";
import { divergencias, ROTULO_DIVERGENCIA } from "./diff";
import { adicionarExtra, desfazerNaoProduziu, editarDescricao, editarReal, editavel, escolherMotivo, informarQuantidades, marcarNaoProduziu, operacaoDaLinha, produtosDaMaquina, removerExtra } from "./linhas";
import { MOTIVOS_NAO_PRODUZIU, rotuloMotivo } from "./motivos";
import { linhasIniciais } from "./prefill";
import type { Catalogo, LinhaApontamento, MotivoNaoProduziu } from "./tipos";
import { bloqueiosParaSalvar, completude, linhaIniciada, paraRpc, problemasDoConjunto } from "./validacao";

const fmt = (n: number) => Math.round(n).toLocaleString("pt-BR");
const soDigitos = (v: string) => v.replace(/[^0-9]/g, "").slice(0, 9);
const num = (v: string): number | null => (v === "" ? null : Number(v));

export interface PassoApontamentosProps {
  data: string; periodoId: string;
  bloqueado?: boolean;                               // fechamento em andamento: tudo travado
  onModo: (ativo: boolean) => void;                  // false = flag desligada (a tela usa o fluxo anterior)
  onSalvo: () => void;                               // recarrega o contexto do fechamento (postos pendentes)
  onNaoSalvo: (haAlteracoes: boolean) => void;
}

export default function PassoApontamentos({ data, periodoId, bloqueado, onModo, onSalvo, onNaoSalvo }: PassoApontamentosProps) {
  const [carregando, setCarregando] = useState(true);
  const [erroCarga, setErroCarga] = useState<string | null>(null);
  const [cat, setCat] = useState<Catalogo | null>(null);
  const [linhas, setLinhas] = useState<LinhaApontamento[]>([]);
  const [base, setBase] = useState("");                 // fotografia da última carga/salvamento (detecta alterações não salvas)
  const [salvando, setSalvando] = useState(false);
  const [erroSalvar, setErroSalvar] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [editando, setEditando] = useState<Set<string>>(new Set());
  const [tentou, setTentou] = useState(false);
  const salvandoRef = useRef(false);

  const [tick, setTick] = useState(0);
  const recarregar = useCallback(() => setTick((n) => n + 1), []);
  useEffect(() => {
    let vivo = true;
    estadoApontamentosApi(data, periodoId).then((r) => {
      if (!vivo) return;
      setErroCarga(null);
      if (r.status !== 200) { setErroCarga(r.corpo.erro ?? "Não foi possível carregar os apontamentos."); return; }
      if (r.corpo.modo !== "ativo" || !r.corpo.catalogo) { onModo(false); return; }
      onModo(true);
      const l = linhasIniciais(r.corpo.postos ?? [], r.corpo.existentes ?? [], r.corpo.vinculos ?? [], () => crypto.randomUUID());
      setCat(r.corpo.catalogo); setLinhas(l); setBase(JSON.stringify(l.map(chaveEstado))); setEditando(new Set());
    }).catch(() => { if (vivo) setErroCarga("Falha de rede ao carregar os apontamentos."); })
      .finally(() => { if (vivo) setCarregando(false); });
    return () => { vivo = false; };
  }, [data, periodoId, onModo, tick]);

  const alterado = useMemo(() => base !== "" && JSON.stringify(linhas.map(chaveEstado)) !== base, [linhas, base]);
  useEffect(() => { onNaoSalvo(alterado); }, [alterado, onNaoSalvo]);

  const resumo = useMemo(() => (cat ? completude(linhas, cat) : null), [linhas, cat]);
  const bloqueios = useMemo(() => (cat ? bloqueiosParaSalvar(linhas, cat) : []), [linhas, cat]);
  const conjunto = useMemo(() => problemasDoConjunto(linhas), [linhas]);
  const prontas = useMemo(() => (cat ? paraRpc(linhas, cat) : []), [linhas, cat]);
  const travado = !!bloqueado || salvando;

  const atualizar = (chave: string, f: (l: LinhaApontamento) => LinhaApontamento) => { setAviso(null); setLinhas((ls) => ls.map((l) => (l.chave === chave ? f(l) : l))); };

  async function salvar() {
    if (!cat || salvandoRef.current) return;
    setTentou(true);
    if (bloqueios.length > 0 || conjunto.length > 0) { setErroSalvar("Corrija os campos marcados antes de salvar."); return; }
    salvandoRef.current = true; setSalvando(true); setErroSalvar(null);
    try {
      const r = await salvarApontamentosApi(data, periodoId, prontas);
      if (r.status !== 200 || !r.corpo.ok) { setErroSalvar(r.corpo.erro ?? "Não foi possível salvar. Nada foi gravado."); return; }
      setAviso(`${prontas.length} apontamento(s) salvos.`); setTentou(false);
      recarregar(); onSalvo();
    } catch { setErroSalvar("Falha de rede. Nada foi gravado — tente de novo."); }
    finally { salvandoRef.current = false; setSalvando(false); }
  }

  if (carregando && !cat) return <p className="stx-fech-sec" role="status">Carregando os postos programados…</p>;
  if (erroCarga && !cat) return (
    <div className="stx-fech-sec" role="alert">
      <p className="stx-save-error">{erroCarga}</p>
      <button type="button" className="stx-ap-btn-secondary" onClick={() => { setCarregando(true); setErroCarga(null); recarregar(); }}>Tentar de novo</button>{" "}
      <button type="button" className="stx-ap-btn-secondary" onClick={() => onModo(false)}>Usar o painel de apontamentos</button>
    </div>
  );
  if (!cat || !resumo) return null;

  const programadas = linhas.filter((l) => l.origem === "PROGRAMADO");
  const extras = linhas.filter((l) => l.origem === "POSTO_NAO_PLANEJADO");
  const resolvidas = programadas.filter((l) => l.situacao === "EXISTENTE_PAINEL" || (cat && !resumo.pendentes.includes(l))).length;

  const cartao = (l: LinhaApontamento) => {
    const p = l.planejado;
    const probs = tentou || linhaIniciada(l) ? (bloqueios.find((b) => b.chave === l.chave)?.problemas ?? []) : [];
    const dup = conjunto.some((c) => c.chaves.includes(l.chave));
    const div = divergencias(l, cat);
    const op = operacaoDaLinha(cat, l);
    const aberto = editando.has(l.chave) || l.origem === "POSTO_NAO_PLANEJADO";
    const travada = !editavel(l) || travado;
    const maqNome = cat.maquinas.find((m) => m.id === l.real.maquinaId)?.nome;
    return (
      <div key={l.chave} className={`stx-apx-card ${l.naoProduziu ? "nao" : ""} ${probs.length || dup ? "erro" : ""}`}>
        <div className="stx-apx-topo">
          <div>
            <div className="stx-apx-maq">{p ? p.maquinaNome : (maqNome ?? "Posto fora da escala")}{l.origem === "POSTO_NAO_PLANEJADO" && <span className="stx-apx-tag extra">FORA DA ESCALA</span>}</div>
            {p && <div className="stx-apx-plan">Programado: {p.funcionarioNome.split(" ")[0]} · {p.produtoNome} · {p.operacaoNome} · {fmt(p.pecas)} pç</div>}
          </div>
          <div className="stx-apx-tags">
            {l.situacao === "EXISTENTE_PAINEL" && <span className="stx-apx-tag">LANÇADO NO PAINEL</span>}
            {l.situacao === "SALVA_FLUXO" && !alterado && <span className="stx-apx-tag ok">SALVO</span>}
            {div.map((d) => <span key={d} className="stx-apx-tag warn">{ROTULO_DIVERGENCIA[d]}</span>)}
          </div>
        </div>

        {l.situacao === "EXISTENTE_PAINEL" ? (
          <div className="stx-apx-ro">{l.naoProduziu ? `Não produziu — ${rotuloMotivo(l.motivo)}` : `Produzido ${fmt(l.produzido ?? 0)} · refugo ${fmt(l.refugo ?? 0)}`} <span className="stx-apx-dica">(corrija em Apontamentos realizados)</span></div>
        ) : l.naoProduziu ? (
          <div>
            <div className="stx-apx-nao">NÃO PRODUZIU</div>
            <div className="stx-fech-chips" role="group" aria-label="Motivo">
              {MOTIVOS_NAO_PRODUZIU.map((m) => <button type="button" key={m.codigo} disabled={travada} className={`stx-fech-chip ${l.motivo === m.codigo ? "on" : ""}`} onClick={() => atualizar(l.chave, (x) => escolherMotivo(x, m.codigo as MotivoNaoProduziu))}>{m.rotulo}</button>)}
            </div>
            {(l.motivo === "OUTRO" || l.descricao) && <input className="stx-apx-txt" placeholder={l.motivo === "OUTRO" ? "Descreva o motivo" : "Observação (opcional)"} value={l.descricao} disabled={travada} maxLength={300} onChange={(e) => atualizar(l.chave, (x) => editarDescricao(x, e.target.value))} aria-label="Descrição do motivo" />}
            <button type="button" className="stx-apx-link" disabled={travada} onClick={() => atualizar(l.chave, desfazerNaoProduziu)}>Desfazer — vou informar a produção</button>
          </div>
        ) : (
          <div className="stx-apx-qtd">
            <label>Produzido<input inputMode="numeric" pattern="[0-9]*" autoComplete="off" disabled={travada} value={l.produzido === null ? "" : String(l.produzido)} placeholder="0" aria-label={`Produzido ${p?.maquinaNome ?? maqNome ?? "extra"}`} onChange={(e) => atualizar(l.chave, (x) => informarQuantidades(x, { produzido: num(soDigitos(e.target.value)) }))} /></label>
            <label>Refugo<input inputMode="numeric" pattern="[0-9]*" autoComplete="off" disabled={travada} value={l.refugo === null ? "" : String(l.refugo)} placeholder="0" aria-label={`Refugo ${p?.maquinaNome ?? maqNome ?? "extra"}`} onChange={(e) => atualizar(l.chave, (x) => informarQuantidades(x, { refugo: num(soDigitos(e.target.value)) }))} /></label>
            {l.origem === "PROGRAMADO" && <button type="button" className="stx-apx-nao-btn" disabled={travada} onClick={() => atualizar(l.chave, (x) => marcarNaoProduziu(x))}>NÃO PRODUZIU</button>}
          </div>
        )}

        {editavel(l) && !l.naoProduziu && (
          <>
            {l.origem === "PROGRAMADO" && <button type="button" className="stx-apx-link" disabled={travada} onClick={() => setEditando((s) => { const n = new Set(s); if (n.has(l.chave)) n.delete(l.chave); else n.add(l.chave); return n; })}>{aberto ? "Ocultar alterações" : "Alterar máquina / operador / produto"}</button>}
            {aberto && (
              <div className="stx-apx-grade">
                <label>Máquina<select disabled={travada} value={l.real.maquinaId ?? ""} onChange={(e) => atualizar(l.chave, (x) => editarReal(x, { maquinaId: e.target.value || null }, cat))}><option value="">Escolha…</option>{cat.maquinas.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}</select></label>
                <label>Operador (quem estava no posto)<select disabled={travada} value={l.real.funcionarioId ?? ""} onChange={(e) => atualizar(l.chave, (x) => editarReal(x, { funcionarioId: e.target.value || null }, cat))}><option value="">Escolha…</option>{cat.funcionarios.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}</select></label>
                <label>Produto<select disabled={travada} value={l.real.produtoId ?? ""} onChange={(e) => atualizar(l.chave, (x) => editarReal(x, { produtoId: e.target.value || null }, cat))}><option value="">Escolha…</option>{(l.real.maquinaId ? produtosDaMaquina(cat, l.real.maquinaId) : cat.produtos).map((pr) => <option key={pr.id} value={pr.id}>{pr.nome}</option>)}</select></label>
                <div className="stx-apx-op">Operação: <b>{op?.nome ?? "—"}</b> <span className="stx-apx-dica">(definida pela máquina e produto)</span></div>
              </div>
            )}
            {l.origem === "POSTO_NAO_PLANEJADO" && <button type="button" className="stx-apx-link" disabled={travada} onClick={() => setLinhas((ls) => removerExtra(ls, l.chave))}>Remover este apontamento extra</button>}
          </>
        )}
        {(probs.length > 0 || dup) && <ul className="stx-apx-erros" role="alert">{probs.map((x) => <li key={x.codigo}>{x.mensagem}</li>)}{dup && <li>Duas linhas na mesma máquina.</li>}</ul>}
      </div>
    );
  };

  return (
    <div className="stx-fech-sec" data-testid="passo-apontamentos">
      <style>{`
        .stx-apx-card{border:1px solid var(--border,rgba(128,128,128,.25));border-radius:12px;padding:12px 14px;margin-bottom:10px}
        .stx-apx-card.nao{border-color:var(--warning)}.stx-apx-card.erro{border-color:var(--danger,#e5484d)}
        .stx-apx-topo{display:flex;justify-content:space-between;gap:8px;align-items:flex-start}
        .stx-apx-maq{font-size:17px;font-weight:700}.stx-apx-plan{font-size:13px;color:var(--text-3);margin-top:2px}
        .stx-apx-tags{display:flex;flex-wrap:wrap;gap:4px;justify-content:flex-end}
        .stx-apx-tag{font-size:11px;font-weight:600;padding:2px 8px;border-radius:999px;border:1px solid var(--border,rgba(128,128,128,.4));color:var(--text-3);white-space:nowrap}
        .stx-apx-tag.ok{color:var(--accent);border-color:var(--accent)}.stx-apx-tag.warn,.stx-apx-tag.extra{color:var(--warning);border-color:var(--warning)}.stx-apx-maq .stx-apx-tag{margin-left:8px;vertical-align:middle}
        .stx-apx-qtd{display:flex;gap:10px;align-items:flex-end;margin-top:10px;flex-wrap:wrap}.stx-apx-qtd label{display:flex;flex-direction:column;font-size:12px;color:var(--text-3);gap:3px;flex:1;min-width:110px}
        .stx-apx-qtd input,.stx-apx-grade select,.stx-apx-txt{font-size:22px;font-weight:700;padding:8px 12px;border-radius:10px;border:2px solid var(--border,rgba(128,128,128,.35));background:var(--bg,transparent);color:var(--text);text-align:right;font-variant-numeric:tabular-nums;width:100%}
        .stx-apx-grade select,.stx-apx-txt{font-size:15px;font-weight:500;text-align:left}.stx-apx-txt{margin-top:8px}
        .stx-apx-qtd input:focus,.stx-apx-grade select:focus,.stx-apx-txt:focus{outline:none;border-color:var(--accent)}
        .stx-apx-nao-btn{min-height:48px;padding:0 14px;border-radius:10px;border:2px solid var(--warning);background:transparent;color:var(--warning);font-weight:700;cursor:pointer}
        .stx-apx-nao-btn:disabled{opacity:.45;cursor:not-allowed}
        .stx-apx-nao{font-size:16px;font-weight:700;color:var(--warning);margin-top:8px}
        .stx-apx-link{background:none;border:none;color:var(--text-3);text-decoration:underline;cursor:pointer;padding:6px 0;font-size:13px;display:block}
        .stx-apx-grade{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:6px}.stx-apx-grade label{display:flex;flex-direction:column;font-size:12px;color:var(--text-3);gap:3px}
        .stx-apx-op{grid-column:1/-1;font-size:13px}.stx-apx-dica{font-size:12px;color:var(--text-3)}.stx-apx-ro{margin-top:8px;font-size:15px}
        .stx-apx-erros{margin:8px 0 0;padding-left:18px;color:var(--danger,#e5484d);font-size:13px}
        .stx-apx-barra{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:10px}.stx-apx-barra button{padding:12px 18px;min-height:48px;font-weight:700;border-radius:10px}
        @media (max-width:640px){.stx-apx-grade{grid-template-columns:1fr}}
      `}</style>
      <h3>Apontamentos do período</h3>
      {resumo.pendentes.length === 0 && resumo.comProblema.length === 0
        ? <div className="stx-fech-ok">✓ {programadas.length}/{programadas.length} postos programados resolvidos</div>
        : <div className="stx-fech-warn" role="status">⚠ {resolvidas}/{programadas.length} postos resolvidos — falta: {resumo.pendentes.map((l) => l.planejado?.maquinaNome).join(", ") || "corrigir os campos marcados"}</div>}
      <p className="stx-apx-dica" style={{ margin: "4px 0 10px" }}>Os postos vêm da escala deste período. Informe o produzido e o refugo (ou NÃO PRODUZIU). Pode alterar máquina, operador e produto — o que foi programado fica guardado ao lado do que aconteceu.</p>

      {programadas.map(cartao)}

      <h3 style={{ marginTop: 16 }}>Apontamento extra (fora da escala) — opcional</h3>
      {extras.length === 0 && <p className="stx-apx-dica">Nenhum. Use o botão abaixo só se uma máquina produziu sem estar programada.</p>}
      {extras.map(cartao)}
      <div className="stx-apx-barra">
        <button type="button" className="stx-ap-btn-secondary" disabled={travado} onClick={() => setLinhas((ls) => adicionarExtra(ls, crypto.randomUUID()))}>+ ADICIONAR APONTAMENTO</button>
        <button type="button" className="stx-ap-btn-primary" disabled={travado || !alterado} onClick={() => void salvar()}>{salvando ? "Salvando…" : "SALVAR APONTAMENTOS"}</button>
        {alterado && !salvando && <span className="stx-fech-warn" role="status">Alterações não salvas</span>}
      </div>
      {erroSalvar && <p className="stx-save-error" role="alert" style={{ marginTop: 10 }}>{erroSalvar}</p>}
      {aviso && !alterado && <p className="stx-apx-dica" role="status" style={{ marginTop: 8 }}>{aviso}</p>}
    </div>
  );
}

/** Fotografia comparável de uma linha (para saber se há alteração não salva). */
const chaveEstado = (l: LinhaApontamento) => [l.chave, l.real.maquinaId, l.real.funcionarioId, l.real.produtoId, l.produzido, l.refugo, l.naoProduziu, l.motivo, l.descricao, l.situacao];
