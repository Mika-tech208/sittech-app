-- T1: relatórios semanais da Escala — imutabilidade, hash conferido pelo banco, versões, parcial/final decididos pelo sistema, permissão própria, insumos consistentes. Tudo desfeito no final.
do $$
declare
  v_adm uuid; v_usr uuid; v_comum uuid; v_prev uuid;
  v_canon text := '{"codigo":"ESC-EXEC-2031-10-0001","nomes":["ação"],"v":1}';
  v_hash text; v_pdf bytea := '\x255044462d312e340a'::bytea; v_pdf_sha text;
  v_id1 uuid := gen_random_uuid(); v_id2 uuid := gen_random_uuid(); v_idp uuid := gen_random_uuid();
  v_prox jsonb; v_ok boolean; v_n int; v_j jsonb;
  SEM date := '2031-03-03'; -- segunda; ISO 2031-10
begin
  select auth_user_id, id into v_adm, v_usr from usuarios where papel = 'admin' and ativo order by id limit 1;
  select auth_user_id into v_comum from usuarios where papel <> 'admin' and ativo and id not in (select usuario_id from usuario_permissoes where permissao = 'escala_relatorios') order by id limit 1;
  v_hash := encode(sha256(convert_to(v_canon, 'utf8')), 'hex'); v_pdf_sha := encode(sha256(v_pdf), 'hex');
  -- o SHA-256 do banco = o da aplicação (vetor conhecido com acento)
  if encode(sha256(convert_to('ação 1,5', 'utf8')), 'hex') <> '0f85bcc5cb1471bf40ed22e07f8016d5a99122bfa60bdfb0f3d0bf377c1739e8' then raise exception 'FALHOU (0) sha256 do banco difere do vetor'; end if;
  insert into previsoes (id, semana_inicio) values (gen_random_uuid(), SEM) returning id into v_prev;

  -- (1) próximo código/versão: família nova = v1; código distingue o TIPO
  v_prox := public.escala_relatorio_proximo(SEM, 'executada');
  if v_prox->>'codigo' <> 'ESC-EXEC-2031-10-0001' or (v_prox->>'versao')::int <> 1 then raise exception 'FALHOU (1) próximo: %', v_prox; end if;
  if public.escala_relatorio_proximo(SEM, 'planejada')->>'codigo' <> 'ESC-PLAN-2031-10-0001' then raise exception 'FALHOU (1) código planejado'; end if;

  -- (2) o banco CONFERE hash do conteúdo, hash do PDF e relógio
  begin perform public.escala_relatorio_registrar(v_id1, SEM, 'executada', 1, 'ESC-EXEC-2031-10-0001', 'parcial', now(), now() + interval '1 day', now(), v_usr, 1, v_canon, repeat('0', 64), repeat('1', 64), '[]'::jsonb, v_pdf, v_pdf_sha); v_ok := false;
  exception when others then v_ok := position('ESCALA_RELATORIO_HASH' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (2) hash do conteúdo errado deveria ser recusado'; end if;
  begin perform public.escala_relatorio_registrar(v_id1, SEM, 'executada', 1, 'ESC-EXEC-2031-10-0001', 'parcial', now(), now() + interval '1 day', now(), v_usr, 1, v_canon, v_hash, repeat('1', 64), '[]'::jsonb, v_pdf, repeat('2', 64)); v_ok := false;
  exception when others then v_ok := position('ESCALA_RELATORIO_PDF_HASH' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (2) hash do PDF errado'; end if;
  begin perform public.escala_relatorio_registrar(v_id1, SEM, 'executada', 1, 'ESC-EXEC-2031-10-0001', 'parcial', now(), now() + interval '1 day', now() - interval '1 hour', v_usr, 1, v_canon, v_hash, repeat('1', 64), '[]'::jsonb, v_pdf, v_pdf_sha); v_ok := false;
  exception when others then v_ok := position('ESCALA_RELATORIO_RELOGIO' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (2) gerado_em fora do relógio do servidor'; end if;
  -- FINAL antes de elegível é recusado (o sistema decide)
  begin perform public.escala_relatorio_registrar(v_id1, SEM, 'executada', 1, 'ESC-EXEC-2031-10-0001', 'final', now(), now() + interval '1 day', now(), v_usr, 1, v_canon, v_hash, repeat('1', 64), '[]'::jsonb, v_pdf, v_pdf_sha); v_ok := false;
  exception when others then v_ok := position('escala_relatorio_final_elegivel' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (2) final antes do horário deveria ser recusado'; end if;

  -- (3) v1 parcial registra; v2 da MESMA família; v1 não muda
  perform public.escala_relatorio_registrar(v_id1, SEM, 'executada', 1, 'ESC-EXEC-2031-10-0001', 'parcial', now(), now() + interval '1 day', now(), v_usr, 1, v_canon, v_hash, repeat('1', 64), '["2031-03-03|m1"]'::jsonb, v_pdf, v_pdf_sha);
  v_prox := public.escala_relatorio_proximo(SEM, 'executada');
  if v_prox->>'codigo' <> 'ESC-EXEC-2031-10-0001' or (v_prox->>'versao')::int <> 2 or (v_prox->>'familiaExistente')::boolean is not true then raise exception 'FALHOU (3) próximo após v1: %', v_prox; end if;
  begin perform public.escala_relatorio_registrar(gen_random_uuid(), SEM, 'executada', 1, 'ESC-EXEC-2031-10-0001', 'parcial', now(), now() + interval '1 day', now(), v_usr, 1, v_canon, v_hash, repeat('1', 64), '[]'::jsonb, v_pdf, v_pdf_sha); v_ok := false;
  exception when others then v_ok := position('ESCALA_RELATORIO_VERSAO_CONFLITO' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (3) versão repetida'; end if;
  perform public.escala_relatorio_registrar(v_id2, SEM, 'executada', 2, 'ESC-EXEC-2031-10-0001', 'final', now(), now() - interval '1 hour', now(), v_usr, 1, v_canon, v_hash, repeat('3', 64), '[]'::jsonb, v_pdf, v_pdf_sha);
  perform public.escala_relatorio_registrar(v_idp, SEM, 'planejada', 1, 'ESC-PLAN-2031-10-0001', 'parcial', now(), now() + interval '1 day', now(), v_usr, 1, v_canon, v_hash, repeat('4', 64), '[]'::jsonb, v_pdf, v_pdf_sha);
  select count(*) into v_n from escala_relatorios where semana_inicio = SEM;
  if v_n <> 3 then raise exception 'FALHOU (3) deveria ter 3 linhas (EXEC v1, EXEC v2, PLAN v1), tem %', v_n; end if;
  if (select status from escala_relatorios where id = v_id1) <> 'parcial' or (select fonte_digest from escala_relatorios where id = v_id1) <> repeat('1', 64) then raise exception 'FALHOU (3) a v1 não pode mudar'; end if;
  if (select codigo from escala_relatorios where id = v_idp) = (select codigo from escala_relatorios where id = v_id1) then raise exception 'FALHOU (3) planejado e executado não podem compartilhar família'; end if;

  -- (4) IMUTABILIDADE
  begin update escala_relatorios set status = 'final' where id = v_id1; v_ok := false; exception when others then v_ok := position('ESCALA_RELATORIO_IMUTAVEL' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (4) update do relatório'; end if;
  begin delete from escala_relatorios where id = v_id1; v_ok := false; exception when others then v_ok := position('ESCALA_RELATORIO_IMUTAVEL' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (4) delete do relatório'; end if;
  begin update escala_relatorio_pdfs set pdf = '\x00'::bytea where relatorio_id = v_id1; v_ok := false; exception when others then v_ok := position('ESCALA_RELATORIO_IMUTAVEL' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (4) update do pdf'; end if;
  begin delete from escala_relatorio_pdfs where relatorio_id = v_id1; v_ok := false; exception when others then v_ok := position('ESCALA_RELATORIO_IMUTAVEL' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (4) delete do pdf'; end if;
  -- a constraint do hash vale também para INSERT direto
  begin insert into escala_relatorios (codigo, semana_inicio, tipo, versao, status, consolidado_ate, elegivel_final_em, gerado_em, gerado_por, schema_versao, conteudo_canonico, conteudo, hash_sha256, fonte_digest, periodos_considerados, pdf_sha256, pdf_bytes)
    values ('ESC-EXEC-2031-10-0009', SEM, 'executada', 9, 'parcial', now(), now(), now(), v_usr, 1, v_canon, v_canon::jsonb, repeat('a', 64), repeat('1', 64), '[]', v_pdf_sha, 9); v_ok := false;
  exception when others then v_ok := position('escala_relatorio_hash_confere' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (4) INSERT direto com hash errado'; end if;

  -- (5) verificação pública (metadados + integridade pelo banco); versão posterior detectada
  v_j := public.escala_relatorio_verificar(v_id1);
  if (v_j->>'integridadeBanco')::boolean is not true or (v_j->>'existeVersaoPosterior')::boolean is not true or (v_j->>'versaoMaisRecente')::int <> 2 or v_j->>'hash' <> v_hash then raise exception 'FALHOU (5) verificar v1: %', v_j; end if;
  if (public.escala_relatorio_verificar(v_id2)->>'existeVersaoPosterior')::boolean then raise exception 'FALHOU (5) v2 é a mais recente'; end if;
  if public.escala_relatorio_verificar(gen_random_uuid()) is not null then raise exception 'FALHOU (5) id inexistente deveria devolver null'; end if;

  -- (6) permissão própria: sem ela, não lista e não lê as tabelas; administrador pode; as RPCs de escrita/insumos não são do navegador
  perform set_config('request.jwt.claims', json_build_object('sub', v_adm, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_j := public.escala_relatorio_listar(SEM);
  if jsonb_array_length(v_j) <> 3 then raise exception 'FALHOU (6) admin deveria listar 3: %', v_j; end if;
  select count(*) into v_n from escala_relatorios; if v_n < 3 then raise exception 'FALHOU (6) admin lê a tabela'; end if;
  begin perform public.escala_relatorio_fontes(SEM); v_ok := false; exception when others then v_ok := position('permission denied' in lower(sqlerrm)) > 0; end;
  if not v_ok then raise exception 'FALHOU (6) fontes não é chamável pelo navegador'; end if;
  begin perform public.escala_relatorio_registrar(gen_random_uuid(), SEM, 'executada', 3, 'ESC-EXEC-2031-10-0001', 'parcial', now(), now(), now(), v_usr, 1, v_canon, v_hash, repeat('1', 64), '[]'::jsonb, v_pdf, v_pdf_sha); v_ok := false;
  exception when others then v_ok := position('permission denied' in lower(sqlerrm)) > 0; end;
  if not v_ok then raise exception 'FALHOU (6) registrar não é chamável pelo navegador (conteúdo nunca vem do usuário)'; end if;
  reset role;
  if v_comum is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', v_comum, 'role', 'authenticated')::text, true);
    set local role authenticated;
    begin perform public.escala_relatorio_listar(SEM); v_ok := false; exception when others then v_ok := position('permissão' in sqlerrm) > 0; end;
    if not v_ok then raise exception 'FALHOU (6) sem a permissão não lista'; end if;
    select count(*) into v_n from escala_relatorios; if v_n <> 0 then raise exception 'FALHOU (6) sem a permissão a RLS esconde as linhas (%)', v_n; end if;
    reset role;
  end if;
  -- a permissão existe no CHECK
  insert into usuario_permissoes (usuario_id, permissao) select v_usr, 'escala_relatorios' where not exists (select 1 from usuario_permissoes where usuario_id = v_usr and permissao = 'escala_relatorios');

  -- (7) insumos: uma chamada devolve tudo (service_role); a semana sem Previsão é recusada
  set local role service_role;
  v_j := public.escala_relatorio_fontes(SEM);
  if not (v_j ? 'oficial' and v_j ? 'apontamentos' and v_j ? 'ausencias' and v_j ? 'situacaoFuncionarios' and v_j ? 'funcionarios' and v_j ? 'planoVersao' and v_j ? 'periodosPadrao') then raise exception 'FALHOU (7) chaves dos insumos: %', (select string_agg(k, ',') from jsonb_object_keys(v_j) k); end if;
  begin perform public.escala_relatorio_fontes('2031-06-02'); v_ok := false; exception when others then v_ok := position('ESCALA_RELATORIO_SEM_PREVISAO' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (7) semana sem Previsão'; end if;
  reset role;

  raise exception 'TESTE_OK T1 relatórios: hash/PDF conferidos pelo banco, versões v1/v2, família distinta por tipo, final só após elegível, imutável, verificação pública sem nomes, permissão própria, insumos consistentes';
end $$;
