# Kloak & Daggurrs

## Current hosting setup

The public website is a static site deployed to GitHub Pages by
`.github/workflows/deploy-pages.yml` whenever changes are pushed to `main`.
The workflow publishes only `index.html`, `404.html`, `assets/`, and the game
offline notice. It does **not** publish or start the Node game server.

The Battle Arena is paused for now. Its source files remain in `game/`,
`server-production.js`, and `lib/` so development can continue later. The
public navigation no longer links to it, and requests for unpublished game
pages are sent to the offline notice.

The website can continue using Supabase directly from the browser with the
Supabase **publishable** key in `assets/js/config.js`. Keep Row Level Security
(RLS) enabled and never put a Supabase secret/service-role key in browser code.
Existing local images and public image URLs continue to load as website assets.

MongoDB and Cloudinary are **not connected directly to GitHub Pages**. Their
credentials and current integrations belong to the Node server. They remain
untouched, but features requiring that server are paused until it is hosted
again. Never put MongoDB credentials or Cloudinary API secrets in frontend
files.

## Enable GitHub Pages

1. Push this repository's `main` branch to GitHub.
2. In the repository, open **Settings → Pages**.
3. Under **Build and deployment**, select **GitHub Actions** as the source.
4. Open the **Actions** tab and wait for **Deploy static site to GitHub Pages**
   to finish successfully.
5. Visit the Pages URL shown in the workflow deployment.

To keep using `www.kloakndaggurrs.com`, add that custom domain in **Settings →
Pages**, then update the DNS records at HostGator to the exact records GitHub
Pages lists. DNS changes are separate from publishing and can take time to
propagate. Do not remove old DNS records until the Pages URL is working and
you are ready to move the custom domain.

For Supabase login to work on the Pages URL, add that exact URL to the
Supabase project's **Authentication → URL Configuration → Redirect URLs**.
Keep the existing `www.kloakndaggurrs.com` redirect entry too.

## Data and images

- Static public content and bundled images are in `assets/`.
- Authentication and user/database features already implemented in the
  website use Supabase.
- MongoDB and Cloudinary are used by the paused Node server; GitHub Pages
  cannot run server-side integrations or safely hold their secrets.
- The game server stores active match state in memory, so it must be run on
  an always-available Node host before multiplayer is enabled again.

## Local development

The static site can be previewed with any local static-file server. The
backend remains available for development with Node.js 20 or newer:

```sh
npm install
npm start
```

The backend requires its server-side environment variables from `.env.example`.
Do not commit a real `.env` file or share its values.

## Forge orders and email

The Forge order form stores orders in Supabase, uploads OBJ/STL/3MF files to
a private Supabase Storage bucket (maximum 25 MB per file, up to five files
per order), and sends email through a Supabase Edge Function. The Resend API
key must only be configured as a Supabase function secret; never put it in
`assets/js/config.js`, GitHub Pages, or a committed file.

To enable the updated form:

1. Run `supabase/forge_orders_upgrade.sql` in the Supabase SQL Editor. It adds
   order detail columns and private-storage policies.
2. Deploy `supabase/functions/forge-order-email` to the existing Supabase
   project with the Supabase CLI:

   ```sh
   supabase functions deploy forge-order-email --project-ref egpujmjpmeuhiostfrnu
   ```

3. In the Supabase Dashboard, open **Edge Functions → Secrets** and add
   `RESEND_API_KEY` using a newly rotated Resend key. Do not use a placeholder
   key; it cannot send email.
4. No custom sending domain is required for owner-only order alerts. The
   function defaults to Resend's `onboarding@resend.dev` sender. Remove any
   old `RESEND_FROM_EMAIL` secret if it points to an unverified domain. If your
   Resend account requires a different sender, set the optional
   `RESEND_FROM_EMAIL` function secret to a sender authorized for that account.
5. Publish the site changes through the GitHub Pages workflow and test an
   order. The function emails the owner at `mjolnariclan@gmail.com`; it does
   not send a confirmation to the customer. Resend's test sender may restrict
   recipients to your Resend account's verified email address. Replies to the
   owner notification are addressed to the customer's order email. The owner
   email includes private model download links that expire after seven days.
   Local testing on Live Server is allowed from `http://127.0.0.1:5500` and
   `http://localhost:5500`. If you set the optional `FORGE_ALLOWED_ORIGINS`
   function secret, include the exact website and local origins there as a
   comma-separated list.

The printed-by date is a requested print-completion date, not a shipping or
pickup promise. Pickup/mailing timing is a separate optional date. The
Command Center includes order contact details, size, colors, dates, brief,
source link, private model downloads, and status updates.
