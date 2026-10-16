/* Surreal · conexão com o Supabase (projeto próprio na org renanfortes-onespot).
   A chave abaixo é a PUBLICÁVEL: sozinha não lê nada — os dados só abrem para
   quem faz login e está ativo em sg_usuarios (RLS).
   No localhost o app roda a DEMO local; para testar o remoto aqui:
   localStorage.setItem('sg_modo','remoto') */
window.SG_REMOTO = { url: 'https://xloleeetomjlhzerarxr.supabase.co', key: 'sb_publishable_gYi6oahqHvQCjJuLCBfBCA_pyc7sI9f' };
