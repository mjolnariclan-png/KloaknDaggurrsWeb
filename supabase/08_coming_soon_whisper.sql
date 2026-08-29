-- ============================================================
-- Adds a "coming soon" announcement whisper.
-- Edit the body/title below to taste, then run in Supabase SQL Editor.
-- ============================================================
insert into public.whispers(published_at,title,body,classified,image_url)
values (
  current_date,
  'THE SIGNAL STRENGTHENS',
  'Something is stirring beneath the Veil. The archive network detects movement across every faction line — the true beginning draws close. Stay watchful. It will not announce itself twice.',
  false,
  null
)
on conflict (title,published_at) do nothing;
