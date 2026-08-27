-- FIRST:
-- 1) Sign up on the K&D website using the email you want as the owner.
-- 2) Confirm the email if Supabase email confirmation is enabled.
-- 3) Replace YOUR_EMAIL_HERE below, then run this SQL.

update public.profiles
set role='owner', active=true
where lower(email)=lower('YOUR_EMAIL_HERE');

select id,email,display_name,role,active
from public.profiles
order by created_at;
