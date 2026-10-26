// RELATÓRIOS SEMANAIS DA ESCALA — montagem do CONTEÚDO canônico (função pura e determinística): mesmos insumos + mesma meta ⇒ mesmo conteúdo ⇒ mesmo hash.
//
// FONTE CANÔNICA DO EXECUTADO (ordem de precedência, por funcionário × dia produtivo × período já consolidado):
//   1) apontamento `produzindo` da pessoa no período            → APONTAMENTO (evidência forte; usa a operacao_id GRAVADA no apontamento, nunca o roteiro atual)
//   2) ausência registrada que cobre o período                  → AUSENCIA (nunca inventa posto)
//   3) linha da Escala oficial, sem apontamento da pessoa:
//        a máquina foi apontada por OUTRA pessoa / lançada sem produção → NAO_COMPROVADO (a oficial é contradita)
//        sem nenhum apontamento da máquina                              → OFICIAL_SEM_APONTAMENTO (evidência FRACA; não é execução comprovada)
//        linha oficial sem posto                                        → SEM_POSTO_OFICIAL (fraca)
//   4) sem linha oficial e sem apontamento                      → SEM_EVIDENCIA
// Escala planejada NUNCA vira execução. Revezamento do executado só é afirmado onde os DOIS períodos da transição estão comprovados por apontamento.
import { ativoNoCorte } from "@/lib/escala/situacaoFuncionario";
import { janelaDaAusencia, fimDaJornadaMin } from "@/lib/escala/ausenciaAberta";
import { jsonCanonico, sha256Hex } from "@/features/escala/hashCanonico";
import { epochMsNoFuso, minutosDoHorario, sobrepoe } from "@/features/escala/tempo";
import type {
  Celula, CoberturaEvidencia, ConteudoRelatorio, DiaConteudo, FontesRelatorio, FuncionarioConteudo, PeriodoBruto, Posto, ResumoRevezamento, StatusRelatorio, TipoRelatorio, ViolacaoRevezamento,
} from "./tipos";

export const EMPRESA = "SITTECH SOLUÇÕES INDUSTRIAIS";
export const TOLERANCIA_APONTAMENTO_MIN = 30; // período recém-encerrado: os apontamentos ainda podem estar chegando — só entra depois disso
export const HORA_FECHAMENTO = "18:00"; // fechamento lógico do relatório semanal (America/Sao_Paulo): sexta 18:00; sábado 18:00 se o sábado for produtivo
export const SCHEMA_VERSAO = 1;

const MS_MIN = 60_000;
const pad = (n: number) => String(n).padStart(2, "0");

// ---------- datas/horas (America/Sao_Paulo é UTC-3 fixo desde 2019) ----------
export function somarDias(iso: string, dias: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + dias)).toISOString().slice(0, 10);
}
export const dataBR = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
export function dataHoraSP(ms: number, comSegundos = true): { texto: string; iso: string } {
  const d = new Date(ms - 3 * 3600_000);
  const dia = `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
  const hora = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}${comSegundos ? `:${pad(d.getUTCSeconds())}` : ""}`;
  return { texto: `${dia} às ${hora}`, iso: new Date(ms).toISOString() };
}

// ---------- períodos e status ----------
const periodosDoDia = (f: FontesRelatorio, data: string): PeriodoBruto[] => (f.periodosPorDia[data] && f.periodosPorDia[data].length > 0 ? f.periodosPorDia[data] : f.periodosPadrao);
const hhmm = (t: string) => t.slice(0, 5);
export const inicioPeriodoMs = (data: string, p: PeriodoBruto) => epochMsNoFuso(data, hhmm(p.inicio));
export const fimPeriodoMs = (data: string, p: PeriodoBruto) => epochMsNoFuso(data, hhmm(p.fim));

// FECHAMENTO LÓGICO: sexta-feira 18:00; se o sábado (ou o domingo) for dia produtivo, o último desses dias às 18:00. Sexta sem produção também fecha na sexta.
// O instante é lógico: um worker que rode às 18:07 continua "consolidando até 18:00".
export function fechamentoLogicoMs(f: FontesRelatorio): number {
  const sexta = somarDias(f.semanaInicio, 4), sabado = somarDias(f.semanaInicio, 5), domingo = somarDias(f.semanaInicio, 6);
  const produtivos = new Set(f.diasProdutivos);
  const dia = produtivos.has(domingo) ? domingo : produtivos.has(sabado) ? sabado : sexta;
  return epochMsNoFuso(dia, HORA_FECHAMENTO);
}
export const elegivelFinalEmMs = fechamentoLogicoMs;
// O sistema decide parcial/final — nunca o usuário.
export function statusDoRelatorio(f: FontesRelatorio, geradoEmMs: number): { status: StatusRelatorio; elegivelFinalEmMs: number } {
  const e = elegivelFinalEmMs(f);
  return { status: geradoEmMs >= e ? "final" : "parcial", elegivelFinalEmMs: e };
}

export interface PeriodoRef { data: string; periodoId: string }
// executada: só períodos já encerrados há ≥ tolerância no instante de consolidação (no FINAL a tolerância é 0: o fechamento 18:00 é o prazo declarado); planejada: todos os períodos dos dias produtivos
export function periodosConsiderados(f: FontesRelatorio, tipo: TipoRelatorio, consolidadoMs: number, toleranciaMin = TOLERANCIA_APONTAMENTO_MIN): PeriodoRef[] {
  const out: PeriodoRef[] = [];
  [...f.diasProdutivos].sort().forEach((data) => {
    periodosDoDia(f, data).forEach((p) => {
      if (tipo === "planejada" || fimPeriodoMs(data, p) + toleranciaMin * MS_MIN <= consolidadoMs) out.push({ data, periodoId: p.id });
    });
  });
  return out;
}

// ---------- digest dos insumos (detecta alterações posteriores sem tocar o relatório antigo) ----------
export function digestDasFontes(f: FontesRelatorio, considerados: PeriodoRef[]): string {
  const set = new Set(considerados.map((c) => `${c.data}|${c.periodoId}`));
  const datas = new Set(considerados.map((c) => c.data));
  const aps = f.apontamentos.filter((a) => set.has(`${a.data}|${a.periodoId}`)).map((a) => ({ id: a.id, d: a.data, p: a.periodoId, f: a.funcionarioId, m: a.maquinaId, pr: a.produtoId, o: a.operacaoId, q: a.produzido, r: a.refugo, s: a.status, mo: a.motivo })).sort((x, y) => (x.id < y.id ? -1 : 1));
  const ofi = f.oficial.filter((o) => set.has(`${o.data}|${o.periodoId}`)).map((o) => ({ d: o.data, p: o.periodoId, f: o.funcionarioId, m: o.maquinaId, pr: o.produtoId, o: o.operacaoId, q: o.pecas, or: o.origem, ms: o.motivoSemPosto }));
  const aus = f.ausencias.filter((a) => datas.has(a.data)).map((a) => ({ f: a.funcionarioId, d: a.data, t: a.tipo, i: a.inicio, e: a.fim, ab: a.emAberto }));
  const sit = f.situacaoFuncionarios.map((s) => ({ f: s.funcionarioId, a: s.acao, e: s.efetivoEm, r: s.registradoEm }));
  return sha256Hex(jsonCanonico({ aps, ofi, aus, sit, equipe: [...f.equipe].sort(), dias: [...f.diasProdutivos].sort() }));
}

export function hashDoConteudo(c: ConteudoRelatorio): { canonico: string; hash: string } {
  const canonico = jsonCanonico(c);
  return { canonico, hash: sha256Hex(canonico) };
}

// ---------- rótulos ----------
const ROTULO_AUSENCIA: Record<string, string> = {
  falta_dia_inteiro: "Falta (dia inteiro)", atraso: "Atraso", saida_antecipada: "Saída antecipada", saida_durante_expediente: "Saída durante o expediente",
  atestado: "Atestado", falta_justificada: "Falta justificada", falta_nao_justificada: "Falta não justificada", outro: "Outro",
};
const ROTULO_MOTIVO_SEM_PRODUCAO: Record<string, string> = {
  falta_operador: "falta de operador", falta_material: "falta de material", sem_programacao: "sem programação", manutencao_programada: "manutenção programada", outro: "outro",
};

export interface MetaGeracao {
  tipo: TipoRelatorio;
  codigo: string;
  versao: number;
  geradoEmMs: number;
  geradoPor: { id: string; nome: string };
  urlVerificacao: string;
  consolidadoAteMs?: number;       // padrão = geradoEmMs; no fechamento automático = o 18:00 lógico (o worker pode rodar depois)
  fechamentoAutomatico?: boolean;  // gerado pelo sistema no fechamento (a pessoa em "geradoPor" é o próprio sistema)
}

// aritmética inteira, meio-para-cima, em décimos de ponto percentual (93,75% → 93,8%)
export function percentualDecimos(numerador: number, denominador: number): number | null {
  if (denominador <= 0) return null;
  return Math.floor((numerador * 2000 + denominador) / (2 * denominador));
}
const textoPct = (dec: number | null) => (dec === null ? "—" : `${Math.floor(dec / 10)},${dec % 10}%`);

export function montarConteudo(f: FontesRelatorio, meta: MetaGeracao): ConteudoRelatorio {
  const { status, elegivelFinalEmMs: elegMs } = statusDoRelatorio(f, meta.geradoEmMs);
  const consolidadoMs = meta.consolidadoAteMs ?? meta.geradoEmMs;
  const toleranciaMin = status === "final" ? 0 : TOLERANCIA_APONTAMENTO_MIN;
  const considerados = periodosConsiderados(f, meta.tipo, consolidadoMs, toleranciaMin);
  const setCons = new Set(considerados.map((c) => `${c.data}|${c.periodoId}`));
  const executada = meta.tipo === "executada";

  const nomeF = new Map(f.funcionarios.map((x) => [x.id, x.nome]));
  const nomeFunc = (id: string) => nomeF.get(id) ?? "(funcionário não cadastrado)";
  const nomeM = (id: string | null) => (id ? f.maquinas[id] ?? "(máquina)" : "—");
  const nomeP = (id: string | null) => (id ? f.produtos[id] ?? "(produto)" : "—");
  const nomeO = (id: string | null) => (id ? f.operacoes[id] ?? "(operação)" : "—");
  const posto = (maquinaId: string | null, produtoId: string | null, operacaoId: string | null, boas: number | null): Posto => ({ maquina: nomeM(maquinaId), operacao: nomeO(operacaoId), operacaoId: operacaoId ?? "", produto: nomeP(produtoId), boas });

  const apProd = f.apontamentos.filter((a) => a.status === "produzindo" && a.funcionarioId && a.maquinaId && setCons.has(`${a.data}|${a.periodoId}`));
  const apPorCelula = new Map<string, typeof apProd>();
  const apPorMaquina = new Map<string, typeof apProd>();
  apProd.forEach((a) => {
    const k1 = `${a.funcionarioId}|${a.data}|${a.periodoId}`;
    if (!apPorCelula.has(k1)) apPorCelula.set(k1, []);
    apPorCelula.get(k1)!.push(a);
    const k2 = `${a.data}|${a.periodoId}|${a.maquinaId}`;
    if (!apPorMaquina.has(k2)) apPorMaquina.set(k2, []);
    apPorMaquina.get(k2)!.push(a);
  });
  const semProd = f.apontamentos.filter((a) => a.status !== "produzindo" && a.maquinaId && setCons.has(`${a.data}|${a.periodoId}`));
  const semProdPorMaquina = new Map(semProd.map((a) => [`${a.data}|${a.periodoId}|${a.maquinaId}`, a.motivo ?? "outro"]));
  const oficialPorCelula = new Map(f.oficial.map((o) => [`${o.funcionarioId}|${o.data}|${o.periodoId}`, o]));
  const sit = new Map<string, typeof f.situacaoFuncionarios>();
  f.situacaoFuncionarios.forEach((s) => { if (!sit.has(s.funcionarioId)) sit.set(s.funcionarioId, []); sit.get(s.funcionarioId)!.push(s); });
  const ativoAtual = new Map(f.funcionarios.map((x) => [x.id, x.ativo]));
  const equipe = new Set(f.equipe);
  const comApontamento = new Set(apProd.map((a) => a.funcionarioId as string));

  // ---- funcionários exibidos ----
  const ids = new Set<string>();
  if (executada) { equipe.forEach((i) => ids.add(i)); comApontamento.forEach((i) => ids.add(i)); }
  else f.oficial.filter((o) => setCons.has(`${o.data}|${o.periodoId}`)).forEach((o) => ids.add(o.funcionarioId));
  const lista = [...ids].filter((id) => nomeF.has(id)).sort((a, b) => (nomeFunc(a).localeCompare(nomeFunc(b), "pt-BR") || (a < b ? -1 : 1)));

  const ausDoDia = (fid: string, data: string, p: PeriodoBruto): { tipo: string; janela: string } | null => {
    const fimJ = fimDaJornadaMin(periodosDoDia(f, data).map((x) => ({ fim: hhmm(x.fim) })));
    for (const a of f.ausencias.filter((x) => x.funcionarioId === fid && x.data === data)) {
      const j = janelaDaAusencia({ horarioInicio: a.inicio, horarioFim: a.fim, emAberto: a.emAberto }, fimJ);
      const cobre = j.inicioMin === null || j.fimMin === null || sobrepoe(j.inicioMin, j.fimMin, minutosDoHorario(hhmm(p.inicio)), minutosDoHorario(hhmm(p.fim)));
      if (cobre) return { tipo: ROTULO_AUSENCIA[a.tipo] ?? a.tipo, janela: a.inicio ? `${hhmm(a.inicio)}–${a.emAberto ? "em aberto" : a.fim ? hhmm(a.fim) : ""}` : "dia inteiro" };
    }
    return null;
  };

  let divergencias = 0, inconsistencias = 0;
  const cob = { esperados: 0, porApontamento: 0, porAusencia: 0, oficialSemApontamento: 0, naoComprovado: 0, semEvidencia: 0, foraDoEsperado: 0 };
  const diasProd = [...f.diasProdutivos].sort();

  const funcionarios: FuncionarioConteudo[] = lista.map((fid) => {
    const dias = diasProd.map((data) => {
      const celulas: Record<string, Celula | null> = {};
      periodosDoDia(f, data).forEach((p) => {
        const chave = `${data}|${p.id}`;
        if (!setCons.has(chave)) { celulas[p.id] = null; return; }
        const of = oficialPorCelula.get(`${fid}|${data}|${p.id}`);
        const postoOficial = of && of.maquinaId ? posto(of.maquinaId, of.produtoId, of.operacaoId, null) : null;

        if (!executada) { // ESCALA PLANEJADA: só o que está registrado
          celulas[p.id] = of
            ? of.maquinaId ? { fonte: "PLANEJADO", postos: [postoOficial!], detalhe: of.origem === "manual" ? "ajuste manual" : null, planejado: null, planejadoRotulo: null, divergente: false }
              : { fonte: "PLANEJADO_SEM_POSTO", postos: [], detalhe: of.motivoSemPosto, planejado: null, planejadoRotulo: null, divergente: false }
            : null;
          return;
        }

        const ativo = ativoNoCorte(sit.get(fid)?.map((s) => ({ acao: s.acao === "reativado" ? "reativado" : "desativado", efetivoEm: s.efetivoEm, registradoEm: s.registradoEm, ativoAntes: s.ativoAntes, ativoDepois: s.ativoDepois })), inicioPeriodoMs(data, p), null, ativoAtual.get(fid) ?? true);
        const esperado = ativo && (equipe.has(fid) || comApontamento.has(fid));
        const aps = apPorCelula.get(`${fid}|${data}|${p.id}`) ?? [];
        const aus = ausDoDia(fid, data, p);

        let cel: Celula | null = null;
        if (aps.length > 0) {
          const postos = aps.map((a) => posto(a.maquinaId, a.produtoId, a.operacaoId, a.produzido - a.refugo)).sort((a, b) => (a.maquina + a.operacao < b.maquina + b.operacao ? -1 : 1));
          const coincide = !!of?.maquinaId && aps.some((a) => a.maquinaId === of.maquinaId && a.operacaoId === of.operacaoId);
          const divergente = !coincide;
          if (divergente) divergencias++;
          if (aus) inconsistencias++;
          cel = {
            fonte: "APONTAMENTO", postos, detalhe: aus ? `ausência registrada no mesmo período (${aus.tipo})` : null,
            planejado: postoOficial, planejadoRotulo: of ? (of.maquinaId ? null : `sem posto oficial${of.motivoSemPosto ? `: ${of.motivoSemPosto}` : ""}`) : "sem linha oficial", divergente,
          };
          if (esperado) cob.porApontamento++; else cob.foraDoEsperado++;
        } else if (!esperado) {
          cel = null;
        } else if (aus) {
          cel = { fonte: "AUSENCIA", postos: [], detalhe: `${aus.tipo} (${aus.janela})`, planejado: postoOficial, planejadoRotulo: null, divergente: false };
          cob.porAusencia++;
        } else if (of && of.maquinaId) {
          const outro = apPorMaquina.get(`${data}|${p.id}|${of.maquinaId}`);
          const semProducao = semProdPorMaquina.get(`${data}|${p.id}|${of.maquinaId}`);
          if (outro && outro.length > 0) {
            cel = { fonte: "NAO_COMPROVADO", postos: [], detalhe: `escala oficial: ${nomeM(of.maquinaId)}; a máquina foi apontada por ${nomeFunc(outro[0].funcionarioId as string)}`, planejado: postoOficial, planejadoRotulo: null, divergente: false };
            cob.naoComprovado++;
          } else if (semProducao) {
            cel = { fonte: "NAO_COMPROVADO", postos: [], detalhe: `escala oficial: ${nomeM(of.maquinaId)}; máquina lançada sem produção (${ROTULO_MOTIVO_SEM_PRODUCAO[semProducao] ?? semProducao})`, planejado: postoOficial, planejadoRotulo: null, divergente: false };
            cob.naoComprovado++;
          } else {
            cel = { fonte: "OFICIAL_SEM_APONTAMENTO", postos: [postoOficial!], detalhe: "escala oficial, sem apontamento", planejado: postoOficial, planejadoRotulo: null, divergente: false };
            cob.oficialSemApontamento++;
          }
        } else if (of) {
          cel = { fonte: "SEM_POSTO_OFICIAL", postos: [], detalhe: `escala oficial sem posto${of.motivoSemPosto ? `: ${of.motivoSemPosto}` : ""}; sem apontamento`, planejado: null, planejadoRotulo: null, divergente: false };
          cob.oficialSemApontamento++;
        } else {
          cel = { fonte: "SEM_EVIDENCIA", postos: [], detalhe: "sem apontamento, ausência ou linha oficial", planejado: null, planejadoRotulo: null, divergente: false };
          cob.semEvidencia++;
        }
        if (esperado) cob.esperados++;
        celulas[p.id] = cel;
      });
      return { data, celulas };
    });
    return { id: fid, nome: nomeFunc(fid), dias };
  });

  // ---- revezamento (mesma operação em períodos CONSECUTIVOS do mesmo dia; M3→T1 conta; T3→M1 do dia seguinte reinicia) ----
  const violacoes: ViolacaoRevezamento[] = [];
  let verificadas = 0, naoAplicaveis = 0, naoVerificaveis = 0;
  funcionarios.forEach((fn) => {
    fn.dias.forEach((dia) => {
      const ps = periodosDoDia(f, dia.data);
      for (let i = 1; i < ps.length; i++) {
        const a = dia.celulas[ps[i - 1].id], b = dia.celulas[ps[i].id];
        if (!a || !b) continue; // período não considerado ou pessoa não esperada
        const planejadas = !executada;
        if (a.fonte === "AUSENCIA" || b.fonte === "AUSENCIA" || a.fonte === "PLANEJADO_SEM_POSTO" || b.fonte === "PLANEJADO_SEM_POSTO") { naoAplicaveis++; continue; }
        const comprovadoA = planejadas ? a.fonte === "PLANEJADO" : a.fonte === "APONTAMENTO";
        const comprovadoB = planejadas ? b.fonte === "PLANEJADO" : b.fonte === "APONTAMENTO";
        if (!comprovadoA || !comprovadoB) { naoVerificaveis++; continue; }
        verificadas++;
        const opsA = new Set(a.postos.map((x) => x.operacaoId));
        const comuns = b.postos.filter((x) => opsA.has(x.operacaoId));
        if (comuns.length > 0) {
          violacoes.push({
            funcionario: fn.nome, data: dia.data, de: ps[i - 1].nome, para: ps[i].nome, operacao: comuns[0].operacao,
            maquinas: `${[...new Set(a.postos.map((x) => x.maquina))].join(" + ")} → ${[...new Set(b.postos.map((x) => x.maquina))].join(" + ")}`,
          });
        }
      }
    });
  });
  const rev = resumoRevezamento(violacoes, verificadas, naoAplicaveis, naoVerificaveis, executada);

  const numerador = cob.porApontamento + cob.porAusencia;
  const dec = percentualDecimos(numerador, cob.esperados);
  const cobertura: CoberturaEvidencia | null = executada ? { ...cob, numerador, percentualDecimos: dec, percentualTexto: textoPct(dec) } : null;

  const dias: DiaConteudo[] = diasProd.map((data) => ({ data, periodos: periodosDoDia(f, data).map((p) => ({ id: p.id, nome: p.nome, inicio: hhmm(p.inicio), fim: hhmm(p.fim), considerado: setCons.has(`${data}|${p.id}`) })) }));
  const g = dataHoraSP(meta.geradoEmMs), c = dataHoraSP(consolidadoMs), e = dataHoraSP(elegMs);
  const fimSemana = somarDias(f.semanaInicio, 6);
  const pessoasExibidas = new Set(lista);

  return {
    schemaVersao: SCHEMA_VERSAO,
    tipo: meta.tipo, codigo: meta.codigo, versao: meta.versao, status,
    empresa: EMPRESA,
    titulo: executada ? "RELATÓRIO SEMANAL DE REVEZAMENTO DE PRODUÇÃO — EXECUTADO" : "RELATÓRIO SEMANAL DE REVEZAMENTO DE PRODUÇÃO — ESCALA PLANEJADA",
    semana: { inicio: f.semanaInicio, fim: fimSemana, texto: `${dataBR(f.semanaInicio)} a ${dataBR(fimSemana)}` },
    geradoEm: g.iso, geradoEmTexto: g.texto,
    geradoPor: meta.geradoPor,
    consolidadoAte: c.iso, consolidadoAteTexto: c.texto.replace(" às ", " "),
    elegivelFinalEm: e.iso, elegivelFinalEmTexto: e.texto,
    toleranciaApontamentoMin: toleranciaMin,
    fechamentoAutomatico: meta.fechamentoAutomatico === true,
    urlVerificacao: meta.urlVerificacao,
    fontes: { planoVersao: f.planoVersao, digest: digestDasFontes(f, considerados), qtdApontamentos: apProd.length + semProd.length, qtdAusencias: f.ausencias.length, qtdOficial: f.oficial.filter((o) => setCons.has(`${o.data}|${o.periodoId}`)).length, qtdAjustesManuais: f.ajustesManuais.length },
    dias, funcionarios,
    semProducao: semProd.map((a) => ({ data: a.data, periodoId: a.periodoId, maquina: nomeM(a.maquinaId), motivo: ROTULO_MOTIVO_SEM_PRODUCAO[a.motivo ?? "outro"] ?? (a.motivo ?? "outro") }))
      .sort((x, y) => (`${x.data}|${x.periodoId}|${x.maquina}` < `${y.data}|${y.periodoId}|${y.maquina}` ? -1 : 1)),
    ausencias: executada
      ? f.ausencias.filter((a) => pessoasExibidas.has(a.funcionarioId) && diasProd.includes(a.data)).map((a) => ({ funcionario: nomeFunc(a.funcionarioId), data: a.data, tipo: ROTULO_AUSENCIA[a.tipo] ?? a.tipo, janela: a.inicio ? `${hhmm(a.inicio)}–${a.emAberto ? "em aberto" : a.fim ? hhmm(a.fim) : ""}` : "dia inteiro" }))
          .sort((x, y) => (`${x.data}|${x.funcionario}` < `${y.data}|${y.funcionario}` ? -1 : 1))
      : [],
    resumo: { revezamento: rev, cobertura, divergencias, inconsistencias },
  } satisfies ConteudoRelatorio;
}

function resumoRevezamento(violacoes: ViolacaoRevezamento[], verificadas: number, naoAplicaveis: number, naoVerificaveis: number, executada: boolean): ResumoRevezamento {
  const plural = (n: number, s: string, p: string) => `${n} ${n === 1 ? s : p}`;
  let estado: ResumoRevezamento["estado"];
  let frase: string;
  if (violacoes.length > 0) {
    estado = "NAO";
    frase = `${plural(violacoes.length, "violação comprovada", "violações comprovadas")} do revezamento${naoVerificaveis > 0 ? `; ${plural(naoVerificaveis, "transição não pôde ser verificada", "transições não puderam ser verificadas")} por ausência de apontamento` : ""}.`;
  } else if (naoVerificaveis > 0 || verificadas === 0) {
    estado = "SIM_COM_RESSALVAS";
    frase = verificadas === 0 && naoVerificaveis === 0
      ? "Nenhuma transição pôde ser verificada (sem períodos consolidados)."
      : `Nenhuma violação comprovada. ${plural(naoVerificaveis, "transição não pôde ser verificada", "transições não puderam ser verificadas")} ${executada ? "por ausência de apontamento" : "por falta de linha registrada"}.`;
  } else {
    estado = "SIM";
    frase = `Todas as ${verificadas} transições verificáveis foram conferidas, sem violação.`;
  }
  return { estado, verificadas, naoAplicaveis, naoVerificaveis, violacoes, frase };
}

export const ROTULO_ESTADO: Record<ResumoRevezamento["estado"], string> = { SIM: "SIM", SIM_COM_RESSALVAS: "SIM COM RESSALVAS", NAO: "NÃO" };

export function nomeArquivo(c: Pick<ConteudoRelatorio, "semana" | "versao">): string {
  return `SITTECH_Revezamento_${c.semana.inicio}_a_${c.semana.fim}_v${c.versao}.pdf`;
}
