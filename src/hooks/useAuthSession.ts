"use client";

// Sessão de autenticação — Supabase Auth (login, sessão, logout, troca da
// própria senha) usado por toda rota autenticada do app, incluindo o
// monólito legado (SittechApp.tsx, rota "/"). Sem parâmetros: nada aqui
// depende mais do blob local (useSittechStorage foi removido — ver etapa
// de limpeza de storage legado). registrarAuditoria grava direto em
// public.auditoria (Supabase).

import { useEffect, useState } from "react";
import { supabase } from "@/services/supabase-client";

export interface UsuarioLogado {
  id: string;
  authUserId: string;
  nome: string;
  email: string;
  papel: "admin" | "usuario";
  ativo: boolean;
}

export function useAuthSession() {
  const [autenticado, setAutenticado] = useState(false);
  const [usuarioLogado, setUsuarioLogado] = useState<UsuarioLogado | null>(null);
  const [restaurandoSessao, setRestaurandoSessao] = useState(true);

  // nomes mantidos (loginUsuario, não loginEmail) pra não precisar mexer em
  // LoginScreen.tsx nem nas 5 páginas que já passam essas props adiante —
  // o conteúdo agora é um e-mail, não mais um login/usuário.
  const [loginUsuario, setLoginUsuario] = useState("");
  const [loginSenha, setLoginSenha] = useState("");
  const [loginErro, setLoginErro] = useState("");
  const [loginCarregando, setLoginCarregando] = useState(false);

  // Busca o perfil em public.usuarios pro auth_user_id autenticado. Exige
  // perfil existente e ativo=true — se qualquer um falhar, desloga de novo
  // (não deixa uma sessão Supabase válida "pendurada" sem perfil utilizável).
  async function carregarPerfil(authUserId: string): Promise<boolean> {
    const { data, error } = await supabase
      .from("usuarios")
      .select("id, auth_user_id, nome, email, papel, ativo")
      .eq("auth_user_id", authUserId)
      .maybeSingle();

    if (error || !data) {
      setLoginErro("Não encontramos um perfil vinculado a essa conta.");
      await supabase.auth.signOut();
      setAutenticado(false);
      setUsuarioLogado(null);
      return false;
    }
    if (!data.ativo) {
      setLoginErro("Esse usuário está inativo.");
      await supabase.auth.signOut();
      setAutenticado(false);
      setUsuarioLogado(null);
      return false;
    }
    setUsuarioLogado({
      id: data.id, authUserId: data.auth_user_id, nome: data.nome, email: data.email,
      papel: data.papel, ativo: data.ativo,
    });
    setAutenticado(true);
    return true;
  }

  // Restaura a sessão no carregamento da página (refresh) — o client
  // Supabase já persiste a sessão sozinho (localStorage interno dele,
  // separado do blob do app); aqui só reagimos a ela existir ou não.
  useEffect(() => {
    let montado = true;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) await carregarPerfil(session.user.id);
      if (montado) setRestaurandoSessao(false);
    })();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        setAutenticado(false);
        setUsuarioLogado(null);
      }
    });
    return () => { montado = false; subscription.unsubscribe(); };
  }, []);

  async function handleLogin() {
    setLoginCarregando(true);
    setLoginErro("");
    const { data, error } = await supabase.auth.signInWithPassword({
      email: loginUsuario.trim(), password: loginSenha,
    });
    if (error || !data.session) {
      setLoginErro("E-mail ou senha incorretos.");
      setLoginCarregando(false);
      return;
    }
    const autorizado = await carregarPerfil(data.session.user.id);
    if (autorizado) setLoginSenha("");
    setLoginCarregando(false);
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    setAutenticado(false);
    setUsuarioLogado(null);
  }

  // Grava em public.auditoria (RLS: auditoria_insert_usuario_ativo permite
  // qualquer usuário ativo autenticado).
  async function registrarAuditoria(acao: string, usuarioAfetado?: string | null) {
    const { error } = await supabase
      .from("auditoria")
      .insert({ quem: usuarioLogado?.nome || loginUsuario, acao, usuario_afetado: usuarioAfetado || null });
    if (error) {
      console.error("Falha ao registrar auditoria:", error.message);
    }
  }

  // ---- "Minha conta": trocar a própria senha (agora via Supabase Auth) ----
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
    // reautentica com a senha atual antes de trocar — mesma checagem que
    // existia antes (contra senhaHash), agora contra o Supabase Auth de verdade.
    const { error: erroReauth } = await supabase.auth.signInWithPassword({
      email: usuarioLogado.email, password: minhaSenhaAtual,
    });
    if (erroReauth) {
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
    const { error } = await supabase.auth.updateUser({ password: minhaSenhaNova });
    if (error) {
      setMinhaContaMsg("Não foi possível trocar a senha agora. Tente de novo.");
      return;
    }
    registrarAuditoria("Alterou a própria senha", usuarioLogado.nome);
    setMinhaSenhaAtual("");
    setMinhaSenhaNova("");
    setMinhaSenhaConfirma("");
    setMinhaContaMsg("Senha alterada com sucesso.");
  }

  return {
    autenticado, setAutenticado, usuarioLogado, restaurandoSessao,
    loginUsuario, setLoginUsuario, loginSenha, setLoginSenha, loginErro, loginCarregando, handleLogin, handleLogout,
    registrarAuditoria,
    minhaContaAberta, setMinhaContaAberta, abrirMinhaConta,
    minhaSenhaAtual, setMinhaSenhaAtual, minhaSenhaNova, setMinhaSenhaNova,
    minhaSenhaConfirma, setMinhaSenhaConfirma, minhaContaMsg, alterarMinhaSenha,
  };
}

export type AuthSession = ReturnType<typeof useAuthSession>;
