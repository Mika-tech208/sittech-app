# Testes SQL — exclusão/unificação de funcionário

Rodar SOMENTE no DEV (`supabase db query --linked -f <arquivo>`). Cada arquivo é um bloco `DO` que cria
dados sintéticos ("TESTE-UNIF …"), exercita as funções como administrador/não-administrador e termina
com `RAISE EXCEPTION 'TESTE_OK …'` (ou `FALHOU …`): a exceção final desfaz tudo, não sobra dado de teste.
O id de administrador (`v_auth`) e de usuário (`v_usr`) no topo precisam existir no ambiente.

- t1 unificação completa, permissões, pendências, decisões, assinatura, totais, histórico, log, DELETE direto
- t2 exclusão simples e bloqueio com apontamentos
- t3 bloqueios (apontamento sobreposto, ausência conflitante, mesmo registro, destino inexistente)
- t4 atomicidade (falha forçada e referência residual desfazem tudo)
- t5 resumo
- t6 ensaio com a forma dos dados reais das duas Luanas
