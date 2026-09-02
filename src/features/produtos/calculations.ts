import type { Produto, RoteiroEtapa, Maquina } from "@/types/domain";
import type { RoteiroEtapaForm, EtapaIntegridade } from "@/features/produtos/types";
import { uid } from "@/lib/id";
import { toNumber } from "@/lib/format";

// ---- roteiro: formulário ↔ persistência ----
// A ordem das etapas é dada pela posição no array — não existe campo
// `ordem` separado. COMPORTAMENTO ATUAL — REVISAR PARA BANCO: preservado
// assim nesta etapa; hoje a ordem só importa pra exibição (o "→" entre
// etapas no card do produto) — os cálculos de capacidade tratam cada etapa
// como uma restrição independente (o gargalo é o mínimo entre elas), não
// como uma sequência com dependência real entre etapas.

export function criarEtapaVazia(operacaoPadrao: string): RoteiroEtapaForm {
  return {
    id: uid(),
    operacao: operacaoPadrao,
    metas: { m1: "", m2: "", m3: "", t1: "", t2: "", t3: "" },
    maquinasIds: [],
  };
}

export function roteiroParaFormulario(roteiro: RoteiroEtapa[] | undefined): RoteiroEtapaForm[] {
  return (roteiro || []).map((e) => ({
    id: e.id,
    operacao: e.operacao,
    metas: {
      m1: String(e.metas?.m1 || ""), m2: String(e.metas?.m2 || ""), m3: String(e.metas?.m3 || ""),
      t1: String(e.metas?.t1 || ""), t2: String(e.metas?.t2 || ""), t3: String(e.metas?.t3 || ""),
    },
    maquinasIds: e.maquinasIds || [],
  }));
}

export function roteiroParaPersistencia(roteiroForm: RoteiroEtapaForm[]): RoteiroEtapa[] {
  return roteiroForm
    .filter((e) => e.operacao)
    .map((e) => ({
      id: e.id,
      operacao: e.operacao,
      metas: {
        m1: toNumber(e.metas.m1), m2: toNumber(e.metas.m2), m3: toNumber(e.metas.m3),
        t1: toNumber(e.metas.t1), t2: toNumber(e.metas.t2), t3: toNumber(e.metas.t3),
      },
      maquinasIds: e.maquinasIds,
    }));
}

// ---- edição do roteiro em formulário (extraído dos handlers que hoje
// mexem direto no state dentro do JSX) ----

export function adicionarEtapa(roteiroForm: RoteiroEtapaForm[], operacaoPadrao: string): RoteiroEtapaForm[] {
  return [...roteiroForm, criarEtapaVazia(operacaoPadrao)];
}

export function removerEtapa(roteiroForm: RoteiroEtapaForm[], etapaId: string): RoteiroEtapaForm[] {
  return roteiroForm.filter((e) => e.id !== etapaId);
}

// Troca a operação da etapa a partir do <select> principal — reseta as
// máquinas escolhidas, já que elas dependem da operação (uma máquina de
// "Torno" não faz sentido elegível numa etapa de "Solda").
export function trocarOperacaoEtapa(roteiroForm: RoteiroEtapaForm[], etapaId: string, operacao: string): RoteiroEtapaForm[] {
  return roteiroForm.map((e) => (e.id === etapaId ? { ...e, operacao, maquinasIds: [] } : e));
}

// Usado só depois do fluxo "+ Criar nova etapa/operação" pra aplicar o nome
// recém-criado na etapa. COMPORTAMENTO ATUAL — REVISAR: ao contrário de
// `trocarOperacaoEtapa`, este caminho NÃO reseta `maquinasIds` — é uma
// inconsistência pré-existente no monólito (os dois trocam a operação da
// etapa, só um dos dois limpa as máquinas selecionadas). Preservado como
// estava, sem corrigir.
export function definirOperacaoEtapa(roteiroForm: RoteiroEtapaForm[], etapaId: string, operacao: string): RoteiroEtapaForm[] {
  return roteiroForm.map((e) => (e.id === etapaId ? { ...e, operacao } : e));
}

export function atualizarMetaEtapa(
  roteiroForm: RoteiroEtapaForm[],
  etapaId: string,
  periodoId: keyof RoteiroEtapaForm["metas"],
  valor: string
): RoteiroEtapaForm[] {
  return roteiroForm.map((e) => (e.id === etapaId ? { ...e, metas: { ...e.metas, [periodoId]: valor } } : e));
}

export function alternarMaquinaNaEtapa(roteiroForm: RoteiroEtapaForm[], etapaId: string, maquinaId: string): RoteiroEtapaForm[] {
  return roteiroForm.map((e) => {
    if (e.id !== etapaId) return e;
    const jaTem = e.maquinasIds.includes(maquinaId);
    return { ...e, maquinasIds: jaTem ? e.maquinasIds.filter((m) => m !== maquinaId) : [...e.maquinasIds, maquinaId] };
  });
}

// ---- CRUD de produto (array de produtos) ----
// Mesma lógica que hoje vive inline em submitProduto/toggleProdutoAtivo/
// deleteProduto no monólito — extraída aqui pra sair do JSX e virar
// testável, sem mudar o comportamento.

export function criarProduto(produtos: Produto[], dados: Omit<Produto, "id" | "ativo">): Produto[] {
  return [...produtos, { id: uid(), ...dados, ativo: true }];
}

// Preserva `produto.id` — a edição nunca troca a identidade, só o conteúdo.
export function atualizarProduto(produtos: Produto[], id: string, dados: Omit<Produto, "id" | "ativo">): Produto[] {
  return produtos.map((p) => (p.id === id ? { ...p, ...dados } : p));
}

export function alternarProdutoAtivo(produtos: Produto[], id: string): Produto[] {
  return produtos.map((p) => (p.id === id ? { ...p, ativo: !p.ativo } : p));
}

// COMPORTAMENTO ATUAL — REVISAR PARA BANCO: exclusão é destrutiva (remove
// do array). Não há checagem se o produto está referenciado em previsões
// lançadas (que guardam produtoId + uma cópia de nome/valor, não uma
// referência viva — ver `PrevisaoItem` em types/domain.ts) ou em
// faturamento/histórico. Pra PostgreSQL, a recomendação é substituir por
// soft-delete (`ativo=false`, que já existe via alternarProdutoAtivo, ou um
// `deleted_at`), preservando a linha pra manter a integridade referencial
// do que já foi lançado. Preservado como hard-delete nesta etapa.
export function removerProduto(produtos: Produto[], id: string): Produto[] {
  return produtos.filter((p) => p.id !== id);
}

// ---- listagem ----
// Produtos com roteiro cadastrado vêm primeiro, ordenados pelo maior
// lucro/hora (é o que vale mais priorizar produzir). Sem roteiro, não dá
// pra calcular lucro/hora — ficam depois, ordenados por nome. `getLucroHora`
// vem de fora (features/custo-hora) pra não duplicar a fórmula de margem
// aqui — este arquivo não conhece custo/hora, só ordena.
export function ordenarProdutosPorLucroHora(produtos: Produto[], getLucroHora: (p: Produto) => number): Produto[] {
  const comRoteiro = produtos.filter((p) => (p.roteiro || []).length > 0);
  const semRoteiro = produtos.filter((p) => !(p.roteiro || []).length);
  comRoteiro.sort((a, b) => getLucroHora(b) - getLucroHora(a));
  semRoteiro.sort((a, b) => a.nome.localeCompare(b.nome));
  return [...comRoteiro, ...semRoteiro];
}

export function produtoTemRoteiro(produto: Pick<Produto, "roteiro">): boolean {
  return (produto.roteiro || []).length > 0;
}

// ---- integridade referencial em memória (Etapa 15) ----
// Nada aqui bloqueia cadastro ou cálculo — é só uma leitura do estado atual
// dos dados, pra tornar visível o que hoje já pode acontecer silenciosamente
// (ex.: excluir uma máquina não limpa as referências em produto.roteiro).
export function analisarIntegridadeRoteiro(roteiro: RoteiroEtapa[], maquinas: Maquina[]): EtapaIntegridade[] {
  return (roteiro || []).map((etapa) => {
    const maquinasIds = etapa.maquinasIds || [];
    const maquinasInexistentes = maquinasIds.filter((id) => !maquinas.some((m) => m.id === id));
    const maquinasInativas = maquinasIds.filter((id) => {
      const m = maquinas.find((mm) => mm.id === id);
      return m !== undefined && !m.ativo;
    });
    const maquinasOperacaoDivergente = maquinasIds.filter((id) => {
      const m = maquinas.find((mm) => mm.id === id);
      return m !== undefined && m.ativo && m.operacao !== etapa.operacao;
    });
    return {
      etapaId: etapa.id,
      operacao: etapa.operacao,
      semOperacao: !etapa.operacao,
      semMaquinas: maquinasIds.length === 0,
      maquinasInexistentes,
      maquinasInativas,
      maquinasOperacaoDivergente,
    };
  });
}
