\set ON_ERROR_STOP off
create or replace function pg_temp.ok(c boolean, nome text, det text default '') returns void language plpgsql as $f$
begin raise notice '%', case when coalesce(c,false) then 'PASS' else 'FAIL' end || ' · ' || nome || case when det <> '' then ' — ' || det else '' end; end $f$;
-- executa um comando que DEVE falhar com a mensagem (trecho) esperada; não deixa a transação abortada (savepoint implícito do bloco)
create or replace function pg_temp.falha(cmd text, trecho text, nome text) returns void language plpgsql as $f$
begin
  begin
    execute cmd;
    raise notice 'FAIL · % — o comando deveria ter falhado', nome;
  exception when others then
    if sqlerrm like '%' || trecho || '%' then raise notice 'PASS · % — %', nome, left(sqlerrm, 90);
    else raise notice 'FAIL · % — erro inesperado: %', nome, left(sqlerrm, 160); end if;
  end;
end $f$;
