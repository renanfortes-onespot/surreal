-- ============================================================
-- SURREAL · gelato artesanal — banco (Supabase)
-- Modelo "documento por registro": cada item do app (um pedido, uma compra,
-- uma receita…) é uma linha em sg_registros (coleção + id + JSON). Assim o
-- celular dela e o PC dele editam ao mesmo tempo sem um apagar o do outro:
-- a sincronia é por item, e exclusão é lógica (apagado = true).
-- Acesso: só usuários autenticados e ATIVOS em sg_usuarios (RLS).
-- ============================================================

create table if not exists public.sg_usuarios (
  id         uuid primary key references auth.users on delete cascade,
  email      text,
  nome       text not null,
  ativo      boolean not null default true,
  criado_em  timestamptz not null default now()
);

create table if not exists public.sg_registros (
  colecao        text not null,
  id             text not null,
  dados          jsonb not null,
  apagado        boolean not null default false,
  atualizado_em  timestamptz not null default clock_timestamp(),
  por            uuid default auth.uid(),
  primary key (colecao, id)
);
create index if not exists sg_registros_atualizado on public.sg_registros (atualizado_em);

-- usuário logado e ativo? (security definer: não esbarra no RLS de sg_usuarios)
create or replace function public.sg_ativo() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.sg_usuarios where id = auth.uid() and ativo);
$$;

-- carimbo do servidor: hora e autor de cada gravação (o relógio do celular não manda)
create or replace function public.sg_carimbo() returns trigger
language plpgsql set search_path = public as $$
begin
  new.atualizado_em := clock_timestamp();
  new.por := coalesce(auth.uid(), new.por);
  return new;
end $$;
drop trigger if exists sg_registros_carimbo on public.sg_registros;
create trigger sg_registros_carimbo before insert or update on public.sg_registros
  for each row execute function public.sg_carimbo();

alter table public.sg_usuarios  enable row level security;
alter table public.sg_registros enable row level security;

drop policy if exists sg_usuarios_ler on public.sg_usuarios;
create policy sg_usuarios_ler on public.sg_usuarios for select to authenticated
  using (id = auth.uid() or public.sg_ativo());

drop policy if exists sg_registros_ler on public.sg_registros;
create policy sg_registros_ler on public.sg_registros for select to authenticated using (public.sg_ativo());
drop policy if exists sg_registros_criar on public.sg_registros;
create policy sg_registros_criar on public.sg_registros for insert to authenticated with check (public.sg_ativo());
drop policy if exists sg_registros_alterar on public.sg_registros;
create policy sg_registros_alterar on public.sg_registros for update to authenticated
  using (public.sg_ativo()) with check (public.sg_ativo());
-- sem policy de DELETE: nada some de verdade pelo app (só apagado = true)

revoke all on public.sg_registros, public.sg_usuarios from anon;
grant select, insert, update on public.sg_registros to authenticated;
grant select on public.sg_usuarios to authenticated;
grant execute on function public.sg_ativo() to authenticated;

-- keep-alive (GitHub Action a cada 2 dias): única coisa que a chave pública faz sem login
create or replace function public.sg_ping() returns integer language sql stable as $$ select 1 $$;
grant execute on function public.sg_ping() to anon;
