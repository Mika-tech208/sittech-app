"use client";

// Sessão de autenticação (temporária — ver lib/auth.ts e o briefing, Etapa 9:
// isso é hash client-side, não autenticação de verdade, e será substituído
// por Supabase Auth numa fase futura). Extraído pra ser usado tanto pelo
// app legado quanto pelas novas rotas, sem duplicar handleLogin/troca de
// senha em cada lugar que precisa de um gate de login.

import { useState } from "react";
import { hashSenha, gerarSalt } from "@/lib/auth";
import { uid } from "@/lib/id";
import type { Usuario, AuditoriaEntry } from "@/types/domain";
import type { SittechStorageOverrides } from "@/hooks/useSittechStorage";

export interface UseAuthSessionParams {
  usuarios: Usuario[];
  setUsuarios: (usuarios: Usuario[]) => void;
  auditoria: AuditoriaEntry[];
  persist: (overrides?: SittechStorageOverrides) => Promise<void>;
}

export function useAuthSession({ usuarios, setUsuarios, auditoria, persist }: UseAuthSessionParams) {
  const [autenticado, setAutenticado] = useState(false);
  const [loginUsuario, setLoginUsuario] = useState("");
  const [loginSenha, setLoginSenha] = useState("");
  const [loginErro, setLoginErro] = useState("");
  const [loginCarregando, setLoginCarregando] = useState(false);

  const usuarioLogado = usuarios.find((u) => u.login.toLowerCase() === loginUsuario.trim().toLowerCase()) || null;

  async function handleLogin() {
    setLoginCarregando(true);
    const candidato = usuarios.find((u) => u.login.toLowerCase() === loginUsuario.trim().toLowerCase() && u.ativo);
    if (!candidato) {
      setLoginErro("Usuário ou senha incorretos.");
      setLoginCarregando(false);
      return;
    }
    const hashDigitado = await hashSenha(loginSenha, candidato.senhaSalt);
    if (hashDigitado === candidato.senhaHash) {
      setAutenticado(true);
      setLoginErro("");
      setLoginSenha("");
      const usuariosAtualizados = usuarios.map((u) => (u.id === candidato.id ? { ...u, ultimoAcesso: new Date().toISOString() } : u));
      setUsuarios(usuariosAtualizados);
      try {
        await persist({ usuarios: usuariosAtualizados });
      } catch {
        // não bloqueia o login se isso falhar
      }
    } else {
      setLoginErro("Usuário ou senha incorretos.");
    }
    setLoginCarregando(false);
  }

  function registrarAuditoria(acao: string, usuarioAfetado?: string | null) {
    const entrada: AuditoriaEntry = {
      id: uid(), quando: new Date().toISOString(), quem: usuarioLogado?.nome || loginUsuario,
      acao, usuarioAfetado: usuarioAfetado || null,
    };
    const novaAuditoria = [entrada, ...auditoria].slice(0, 200);
    persist({ auditoria: novaAuditoria });
  }

  // ---- "Minha conta": trocar a própria senha ----
  const [minhaContaAberta, setMinhaContaAberta] = useState(false);
  const [minhaSenhaAtual, setMinhaSenhaAtual] = useState("");
  const [minhaSenhaNova, setMinhaSenhaNova] = useState("");
  const [minhaSenhaConfirma, setMinhaSenhaConfirma] = useState("");
  const [minhaContaMsg, setMinhaContaMsg] = useState("");

  function abrirMinhaConta() {
    setMinhaContaAberta(true);
    setMinhaContaMsg("");
  }

  async function alterarMinhaSenha() {
    if (!usuarioLogado) return;
    const hashAtual = await hashSenha(minhaSenhaAtual, usuarioLogado.senhaSalt);
    if (hashAtual !== usuarioLogado.senhaHash) {
      setMinhaContaMsg("Senha atual incorreta.");
      return;
    }
    if (!minhaSenhaNova || minhaSenhaNova.length < 4) {
      setMinhaContaMsg("A nova senha precisa ter pelo menos 4 caracteres.");
      return;
    }
    if (minhaSenhaNova !== minhaSenhaConfirma) {
      setMinhaContaMsg("As senhas novas não coincidem.");
      return;
    }
    const salt = gerarSalt();
    const hash = await hashSenha(minhaSenhaNova, salt);
    const atualizados = usuarios.map((u) => (u.id === usuarioLogado.id ? { ...u, senhaHash: hash, senhaSalt: salt } : u));
    await persist({ usuarios: atualizados });
    registrarAuditoria("Alterou a própria senha", usuarioLogado.nome);
    setMinhaSenhaAtual("");
    setMinhaSenhaNova("");
    setMinhaSenhaConfirma("");
    setMinhaContaMsg("Senha alterada com sucesso.");
  }

  return {
    autenticado, setAutenticado, usuarioLogado,
    loginUsuario, setLoginUsuario, loginSenha, setLoginSenha, loginErro, loginCarregando, handleLogin,
    registrarAuditoria,
    minhaContaAberta, setMinhaContaAberta, abrirMinhaConta,
    minhaSenhaAtual, setMinhaSenhaAtual, minhaSenhaNova, setMinhaSenhaNova,
    minhaSenhaConfirma, setMinhaSenhaConfirma, minhaContaMsg, alterarMinhaSenha,
  };
}

export type AuthSession = ReturnType<typeof useAuthSession>;
