create extension if not exists pgcrypto;
create table if not exists public.products(
 id uuid primary key default gen_random_uuid(), name text not null, description text default '',
 price_usd numeric(12,2) not null check(price_usd>=0), discount_enabled boolean default true,
 image_url text, active boolean default true, created_at timestamptz default now()
);
create table if not exists public.user_roles(user_id uuid primary key references auth.users(id) on delete cascade,is_admin boolean not null default false);
create table if not exists public.orders(
 id uuid primary key default gen_random_uuid(), customer_name text not null,email text not null,phone text not null,address text not null,
 country_code text not null,currency_code text not null,items jsonb not null,total_usd numeric(12,2) not null,status text default 'pending',
 created_at timestamptz default now()
);
alter table public.products enable row level security;
alter table public.user_roles enable row level security;
alter table public.orders enable row level security;
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.user_roles where user_id=auth.uid() and is_admin=true);
$$;
drop policy if exists "Public can read active products" on public.products;
create policy "Public can read active products" on public.products for select using(active=true or public.is_admin());
drop policy if exists "Admins manage products" on public.products;
create policy "Admins manage products" on public.products for all using(public.is_admin()) with check(public.is_admin());
drop policy if exists "Admins read roles" on public.user_roles;
create policy "Admins read roles" on public.user_roles for select using(public.is_admin());
drop policy if exists "Customers submit order requests" on public.orders;
create policy "Customers submit order requests" on public.orders for insert with check(status='pending');
drop policy if exists "Admins manage orders" on public.orders;
create policy "Admins manage orders" on public.orders for all using(public.is_admin()) with check(public.is_admin());
insert into storage.buckets(id,name,public) values('product-images','product-images',true) on conflict(id) do nothing;
drop policy if exists "Public read product images" on storage.objects;
create policy "Public read product images" on storage.objects for select using(bucket_id='product-images');
drop policy if exists "Admins upload product images" on storage.objects;
create policy "Admins upload product images" on storage.objects for insert with check(bucket_id='product-images' and public.is_admin());
drop policy if exists "Admins update product images" on storage.objects;
create policy "Admins update product images" on storage.objects for update using(bucket_id='product-images' and public.is_admin());
drop policy if exists "Admins delete product images" on storage.objects;
create policy "Admins delete product images" on storage.objects for delete using(bucket_id='product-images' and public.is_admin());
-- IMPORTANT: for a real launch, move order creation to a server-side Edge Function.
-- Never trust browser-submitted totals or item prices. Recalculate prices/discounts server-side.
