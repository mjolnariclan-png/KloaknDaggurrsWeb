# Kloak & Daggurrs V5 — GitHub + Supabase

Frontend:
`https://www.kloakndaggurrs.com`

GitHub repository:
`mjolnariclan-png/KloaknDaggurrsWeb`

Supabase project:
`https://egpujmjpmeuhiostfrnu.supabase.co`

## Architecture

GitHub Pages still hosts the website. Supabase now provides the real backend:

- PostgreSQL database
- player authentication
- cloud collections
- Forge orders
- order status
- reviews and approval
- contact inbox
- factions/cards/Whispers
- secure Vault-code validation
- owner/admin roles
- media storage foundation

The browser uses only the Supabase **publishable** key. Owner permissions are
enforced by PostgreSQL Row Level Security (RLS).

## STEP 1 — Install the database

In Supabase:

**SQL Editor → New query**

Open:

`supabase/01_schema_and_seed.sql`

Copy the entire file into the SQL Editor and click **Run**.

It creates and secures the database and seeds the current K&D content.

Then optionally run:

`supabase/03_verify_install.sql`

You should see approximately:

- 13 factions
- 24 cards
- 2 Whispers
- 3 Vault entries

## STEP 2 — Configure Supabase Auth URLs

In Supabase open the Authentication URL configuration.

Set the Site URL to:

`https://www.kloakndaggurrs.com`

Add redirect URLs for:

`https://www.kloakndaggurrs.com/**`

For testing through the raw GitHub Pages address, also add:

`https://mjolnariclan-png.github.io/KloaknDaggurrsWeb/**`

## STEP 3 — Put V5 into the GitHub repository

Extract this package over:

`C:\Users\caspe\GitHub\KloaknDaggurrsWeb`

The important files that change are:

- `index.html`
- `assets/js/config.js`
- `assets/js/app.js`
- `assets/css/style.css`
- `assets/data/site-data.json`
- `supabase/*.sql`
- `deploy.cmd`

The repository is designed to keep using GitHub Pages:

**Deploy from a branch → main → /(root)**

No Python, Flask, WSGI, or virtualenv is required.

## STEP 4 — Commit and push

From Command Prompt:

```cmd
cd C:\Users\caspe\GitHub\KloaknDaggurrsWeb

git add -A
git status
git commit -m "K&D Supabase V5 database integration"
git push origin main
```

Or:

```cmd
deploy.cmd "K&D Supabase V5 database integration"
```

## STEP 5 — Create the owner account

After the site deploys, open:

`https://www.kloakndaggurrs.com/#/signup`

Create the account you want to use as the owner.

If email confirmation is enabled, confirm the email.

Then open:

`supabase/02_make_me_owner.sql`

Replace:

`YOUR_EMAIL_HERE`

with that owner's email and run it in Supabase SQL Editor.

After that, sign out and sign back in.

The navigation will change from **My Archive** to **Command**, and this route
will become available:

`https://www.kloakndaggurrs.com/#/admin`

## What is live after setup

### Players

- create account
- sign in
- keep a cloud card collection
- collection syncs across browsers/devices after login
- submit Forge orders
- view their own Forge orders/status
- submit reviews
- submit contact messages
- unlock secret Vault files with codes

### Owner/Admin

The Command Center can currently:

- see all Forge orders
- update Forge status
- write a customer-visible status message
- edit card name, rarity, type, ability and lore
- reveal cards immediately or on a schedule
- edit faction name/tagline/lore/doctrine
- reveal factions immediately or on a schedule
- approve customer reviews
- read contact messages
- mark contact messages read
- view users
- promote/demote users between player/admin/owner
- disable/reactivate accounts

### Security

The public website does **not** receive the secret/service-role key.

Hidden Vault access codes are no longer present in
`assets/data/site-data.json`. They are checked by a database function.

Unrevealed card/faction lore is sanitized by database views before it reaches a
visitor.

RLS limits player records to the signed-in user and reserves owner operations
for `owner` / `admin` profiles.

## Fallback mode

`assets/data/site-data.json` remains in the repository as an emergency public
fallback. If Supabase is temporarily unavailable, public K&D content can still
render.

The homepage shows:

- `● LIVE DATABASE` when Supabase is connected
- `● STATIC FALLBACK` when the database could not be reached

Accounts/orders obviously require the live database.

## Database files

`supabase/01_schema_and_seed.sql`
Creates the full database, RLS policies, safe public views, Vault functions,
Storage bucket and initial content.

`supabase/02_make_me_owner.sql`
Promotes your first signed-up account to owner.

`supabase/03_verify_install.sql`
Quick database verification queries.

## Important

Never commit a Supabase `sb_secret_...` key or `service_role` key to GitHub.

Only the browser-safe publishable key belongs in `assets/js/config.js`.
