-- ============================================================
-- Remove promotional signup credit and rely on real balances only
-- ============================================================

alter table public.profiles
  alter column balance set default 0;

update public.profiles p
set balance = 0,
    updated_at = now()
where p.balance = 2.5000
  and coalesce(p.total_recharged, 0) = 0
  and coalesce(p.total_spent, 0) = 0
  and not exists (
    select 1
    from public.transactions t
    where t.user_id = p.id
  );
