"use client";

// Camada de dados compartilhada entre o app legado (SittechApp.tsx) e as
// novas rotas (ex: /previsao, /capacidade). O sistema ainda salva TUDO como
// um único blob JSON sob uma chave (ver docs/legacy/briefing, Parte 2) — não
// migramos a persistência nesta etapa, só extraímos o load/save pra um hook
// único, pra qualquer tela que precise dos dados usar exatamente a mesma
// lógica (sem duplicar o efeito de carregamento/migração de usuários).
//
// Todo acesso a dados passa por aqui -> storageService -> localStorage.
// Nenhum componente novo deve chamar storageService ou localStorage direto.

import { useEffect, useState } from "react";
import { STORAGE_KEY, CATEGORIAS, OPERACOES, PERIODOS_PADRAO, USUARIOS_SEED } from "@/lib/constants";
import { gerarSalt, hashSenha } from "@/lib/auth";
import { uid } from "@/lib/id";
import { storageService } from "@/services/storage-service";
import type {
  FixedCost, VariableEntry, Funcionario, Periodo, Faturamento, Produto, Maquina, Previsao, Usuario, AuditoriaEntry,
} from "@/types/domain";

export interface SittechStorageOverrides {
  fixedCosts?: FixedCost[];
  variableEntries?: VariableEntry[];
  categorias?: string[];
  operacoes?: string[];
  funcionarios?: Funcionario[];
  periodos?: Periodo[];
  diasUteis?: string | number;
  diasUteisSemana?: string | number;
  faturamentos?: Faturamento[];
  produtos?: Produto[];
  maquinas?: Maquina[];
  previsoes?: Previsao[];
  usuarios?: Usuario[];
  auditoria?: AuditoriaEntry[];
}

export function useSittechStorage() {
  const [fixedCosts, setFixedCosts] = useState<FixedCost[]>([]);
  const [variableEntries, setVariableEntries] = useState<VariableEntry[]>([]);
  const [categorias, setCategorias] = useState<string[]>(CATEGORIAS);
  const [operacoes, setOperacoes] = useState<string[]>(OPERACOES);
  const [funcionarios, setFuncionarios] = useState<Funcionario[]>([]);
  const [periodos, setPeriodos] = useState<Periodo[]>(PERIODOS_PADRAO);
  const [diasUteis, setDiasUteis] = useState("22");
  const [diasUteisSemana, setDiasUteisSemana] = useState("5");
  const [faturamentos, setFaturamentos] = useState<Faturamento[]>([]);
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [maquinas, setMaquinas] = useState<Maquina[]>([]);
  const [previsoes, setPrevisoes] = useState<Previsao[]>([]);
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [auditoria, setAuditoria] = useState<AuditoriaEntry[]>([]);

  const [loading, setLoading] = useState(true);
  const [saveError, setSaveError] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await storageService.get(STORAGE_KEY, true);
        if (res && res.value) {
          const parsed = JSON.parse(res.value);
          if (Array.isArray(parsed)) {
            setVariableEntries(
              parsed.map((e) => ({
                id: e.id, mes: e.mes, descricao: e.descricao, categoria: e.categoria, valor: e.valor,
              }))
            );
          } else {
            setFixedCosts(parsed.fixedCosts || []);
            setVariableEntries(parsed.variableEntries || []);
            if (parsed.categorias && parsed.categorias.length) setCategorias(parsed.categorias);
            if (parsed.operacoes && parsed.operacoes.length) setOperacoes(parsed.operacoes);
            setFuncionarios(
              (parsed.funcionarios || []).map((f: Funcionario) => ({
                ...f,
                salarioBase: f.salarioBase !== undefined ? f.salarioBase : 0,
              }))
            );
            if (parsed.periodos !== undefined) setPeriodos(parsed.periodos);
            if (parsed.diasUteis !== undefined) setDiasUteis(String(parsed.diasUteis));
            setFaturamentos(parsed.faturamentos || []);
            setProdutos(parsed.produtos || []);
            setMaquinas(parsed.maquinas || []);
            if (parsed.diasUteisSemana !== undefined) setDiasUteisSemana(String(parsed.diasUteisSemana));
            setPrevisoes(parsed.previsoes || []);
            setAuditoria(parsed.auditoria || []);

            if (parsed.usuarios && parsed.usuarios.length) {
              setUsuarios(parsed.usuarios);
            } else {
              // migração única: primeira vez que esse formato roda — converte a lista antiga
              // (senha em texto puro, fixa no código) pro formato novo, com senha em hash + salt.
              const migrados = await Promise.all(
                USUARIOS_SEED.map(async (u) => {
                  const salt = gerarSalt();
                  const hash = await hashSenha(u.senha, salt);
                  return {
                    id: uid(), nome: u.nome, login: u.usuario, senhaHash: hash, senhaSalt: salt,
                    papel: "admin" as const, ativo: true, criadoEm: new Date().toISOString(), ultimoAcesso: null,
                  };
                })
              );
              setUsuarios(migrados);
              try {
                await storageService.set(STORAGE_KEY, JSON.stringify({ ...parsed, usuarios: migrados }), true);
              } catch {
                // segue mesmo se não conseguir salvar a migração agora
              }
            }
          }
        } else {
          // storage vazio de verdade — mesma migração, garantindo que sempre existam usuários pra logar
          const migrados = await Promise.all(
            USUARIOS_SEED.map(async (u) => {
              const salt = gerarSalt();
              const hash = await hashSenha(u.senha, salt);
              return {
                id: uid(), nome: u.nome, login: u.usuario, senhaHash: hash, senhaSalt: salt,
                papel: "admin" as const, ativo: true, criadoEm: new Date().toISOString(), ultimoAcesso: null,
              };
            })
          );
          setUsuarios(migrados);
        }
      } catch {
        // chave ainda não existe — começa vazio (use a aba "Importar dados" > Restaurar backup pra repor os dados)
        const migrados = await Promise.all(
          USUARIOS_SEED.map(async (u) => {
            const salt = gerarSalt();
            const hash = await hashSenha(u.senha, salt);
            return {
              id: uid(), nome: u.nome, login: u.usuario, senhaHash: hash, senhaSalt: salt,
              papel: "admin" as const, ativo: true, criadoEm: new Date().toISOString(), ultimoAcesso: null,
            };
          })
        );
        setUsuarios(migrados);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function persist(overrides: SittechStorageOverrides = {}) {
    if (loading) return; // proteção: nunca escreve enquanto o carregamento inicial não terminar
    const next = {
      fixedCosts, variableEntries, categorias, operacoes, funcionarios, periodos, diasUteis, diasUteisSemana, faturamentos, produtos, maquinas, previsoes,
      usuarios, auditoria,
      ...overrides,
    };
    setFixedCosts(next.fixedCosts);
    setVariableEntries(next.variableEntries);
    setCategorias(next.categorias);
    setOperacoes(next.operacoes);
    setFuncionarios(next.funcionarios);
    setPeriodos(next.periodos);
    setDiasUteis(String(next.diasUteis));
    setDiasUteisSemana(String(next.diasUteisSemana));
    setFaturamentos(next.faturamentos);
    setProdutos(next.produtos);
    setMaquinas(next.maquinas);
    setPrevisoes(next.previsoes);
    setUsuarios(next.usuarios);
    setAuditoria(next.auditoria);
    try {
      const res = await storageService.set(STORAGE_KEY, JSON.stringify(next), true);
      setSaveError(!res);
    } catch {
      setSaveError(true);
    }
  }

  return {
    fixedCosts, variableEntries, categorias, operacoes, funcionarios, periodos, diasUteis, diasUteisSemana,
    faturamentos, produtos, maquinas, previsoes, usuarios, setUsuarios, auditoria, setAuditoria,
    loading, saveError, persist,
  };
}

export type SittechStorage = ReturnType<typeof useSittechStorage>;
