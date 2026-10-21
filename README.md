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
