do $$
declare v jsonb; f uuid;
begin
  select id into f from funcionarios order by nome limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub','a27f42df-54fe-4718-93a7-0085f5ed5a09','role','authenticated')::text, true);
  set local role authenticated;
  v := public.funcionario_resumo(f);
  reset role;
  if v->'funcionario'->>'nome' is null or jsonb_array_length(v->'candidatos') <> (select count(*) from funcionarios) - 1 or v->'vinculos' is null then raise exception 'FALHOU resumo: %', v; end if;
  raise exception 'TESTE_OK T5 resumo: % candidatos, vinculos=%', jsonb_array_length(v->'candidatos'), v->'vinculos';
end $$;
