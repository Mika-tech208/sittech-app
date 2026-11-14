-- Remove a RPC da TV de metas. Nada mais depende dela além da tela /escala-producao/tv nova.
drop function if exists public.tv_metas_producao(date);
