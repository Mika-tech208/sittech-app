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
  // Chaves de usuario_permissoes concedidas a este usuário — vazio pra
  // admin (nunca precisa de linha própria, is_admin() já libera tudo na
  // RLS). Ver src/lib/permissoes.ts (temPermissao) pra checar isso.
  permissoes: string[];
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

    // Admin não tem linhas em usuario_permissoes (nunca precisa — is_admin()
    // já libera tudo na RLS); pra usuário comum, carrega as concedidas.
    let permissoes: string[] = [];
    if (data.papel !== "admin") {
      const { data: permData } = await supabase
        .from("usuario_permissoes")
        .select("permissao")
        .eq("usuario_id", data.id);
      permissoes = (permData || []).map((p) => p.permissao as string);
    }

    setUsuarioLogado({
      id: data.id, authUserId: data.auth_user_id, nome: data.nome, email: data.email,
      papel: data.papel, ativo: data.ativo, permissoes,
    });
    setAutenticado(true);
    return true;
  }

  // Link de recovery (troca de senha sem saber a atual) — ver bloco
  // "Recovery" mais abaixo.
  const [emModoRecovery, setEmModoRecovery] = useState(false);

  // Restaura a sessão no carregamento da página (refresh) — o client
  // Supabase já persiste a sessão sozinho (localStorage interno dele,
  // separado do blob do app); aqui só reagimos a ela existir ou não.
  useEffect(() => {
    let montado = true;
    (async () => {
      // Link de recovery inválido/expirado: o Supabase redireciona de volta
      // com o erro no hash da URL (#error=...&error_description=...), sem
      // sessão nenhuma — sem isso o usuário só veria a tela de login normal,
      // sem entender por quê. Mensagem única e genérica de propósito (não
      // depende de traduzir cada error_code do Supabase).
      if (window.location.hash.includes("error=")) {
        setLoginErro("Esse link de recuperação de senha é inválido ou expirou. Peça um novo.");
        window.history.replaceState(null, "", window.location.pathname + window.location.search);
      }

      // O client Supabase (singleton de módulo, detectSessionInUrl=true) começa
      // a processar a URL de retorno assim que é importado — antes do React
      // montar. O evento PASSWORD_RECOVERY dispara uma única vez, e o listener
      // onAuthStateChange abaixo só é registrado depois deste efeito rodar:
      // numa corrida, o evento passa despercebido e a sessão de recovery vira
      // um login comum. Checar a própria URL aqui, de forma síncrona, elimina
      // essa dependência de timing. sessionStorage sobrevive a um refresh da
      // aba (mas não a fechar/reabrir) — garante que um F5 no meio da
      // redefinição não solte a conta pro app normal antes da senha trocar.
      if (window.location.hash.includes("type=recovery") || sessionStorage.getItem("sb_recovery_pendente")) {
        sessionStorage.setItem("sb_recovery_pendente", "1");
        setEmModoRecovery(true);
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) await carregarPerfil(session.user.id);
      if (montado) setRestaurandoSessao(false);
    })();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        setAutenticado(false);
        setUsuarioLogado(null);
        setEmModoRecovery(false);
        sessionStorage.removeItem("sb_recovery_pendente");
      }
      if (event === "PASSWORD_RECOVERY") {
        setEmModoRecovery(true);
        sessionStorage.setItem("sb_recovery_pendente", "1");
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

  // ---- Recovery: definir nova senha a partir de um link de recuperação,
  // sem pedir a senha atual (o token do link já prova a identidade). O
  // Supabase estabelece a sessão sozinho ao abrir o link e dispara
  // PASSWORD_RECOVERY (capturado acima) — aqui só falta o formulário. ----
  const [novaSenhaRecovery, setNovaSenhaRecovery] = useState("");
  const [confirmarSenhaRecovery, setConfirmarSenhaRecovery] = useState("");
  const [recoveryMsg, setRecoveryMsg] = useState("");
  const [recoverySalvando, setRecoverySalvando] = useState(false);
  const [recoverySucesso, setRecoverySucesso] = useState(false);

  async function definirNovaSenhaRecovery() {
    setRecoveryMsg("");
    if (!novaSenhaRecovery || novaSenhaRecovery.length < 6) {
      setRecoveryMsg("A senha precisa ter pelo menos 6 caracteres.");
      return;
    }
    if (novaSenhaRecovery !== confirmarSenhaRecovery) {
      setRecoveryMsg("As senhas não coincidem.");
      return;
    }
    setRecoverySalvando(true);
    const { error } = await supabase.auth.updateUser({ password: novaSenhaRecovery });
    if (error) {
      setRecoveryMsg("Não foi possível definir a senha agora. Peça um novo link e tente de novo.");
      setRecoverySalvando(false);
      return;
    }
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) await carregarPerfil(session.user.id);
    setNovaSenhaRecovery("");
    setConfirmarSenhaRecovery("");
    setRecoverySalvando(false);
    setRecoverySucesso(true);
  }

  // Chamado pelo botão "Continuar" da tela de sucesso — só então sai do
  // modo recovery e libera a tela normal do sistema.
  function concluirRecovery() {
    setRecoverySucesso(false);
    setEmModoRecovery(false);
    sessionStorage.removeItem("sb_recovery_pendente");
  }

  return {
    autenticado, setAutenticado, usuarioLogado, restaurandoSessao,
    loginUsuario, setLoginUsuario, loginSenha, setLoginSenha, loginErro, loginCarregando, handleLogin, handleLogout,
    registrarAuditoria,
    minhaContaAberta, setMinhaContaAberta, abrirMinhaConta,
    minhaSenhaAtual, setMinhaSenhaAtual, minhaSenhaNova, setMinhaSenhaNova,
    minhaSenhaConfirma, setMinhaSenhaConfirma, minhaContaMsg, alterarMinhaSenha,
    emModoRecovery, novaSenhaRecovery, setNovaSenhaRecovery, confirmarSenhaRecovery, setConfirmarSenhaRecovery,
    recoveryMsg, recoverySalvando, recoverySucesso, definirNovaSenhaRecovery, concluirRecovery,
  };
}

export type AuthSession = ReturnType<typeof useAuthSession>;
