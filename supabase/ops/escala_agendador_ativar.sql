-- ATIVAÇÃO do agendador (executar UMA vez por ambiente, depois da migration 20261105120000). O token é gerado AQUI, dentro do banco, e nunca é exibido.
--   URL de PROD abaixo (a URL não é segredo). Em outro ambiente, troque a URL antes de executar.
-- Para trocar a URL/rotacionar o token: vault.update_secret / delete + create. Para DESLIGAR: select vault.delete_secret(id) nos dois, ou cron.unschedule.
select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'escala_agendador_token', 'Token do agendador pg_cron da Escala (gerado no banco)')
 where not exists (select 1 from vault.secrets where name = 'escala_agendador_token');
select vault.create_secret('https://sittech-app.vercel.app/api/escala/drenar', 'escala_agendador_url', 'URL chamada pelo agendador pg_cron da Escala')
 where not exists (select 1 from vault.secrets where name = 'escala_agendador_url');
