# Kloak & Daggurrs — GitHub Pages V4

Target URL:

`https://mjolnariclan-png.github.io/kloakndaggurrs/`

This conversion is designed to be uploaded directly to the **kloakndaggurrs**
repository and published by GitHub Pages.

## What changed from PythonAnywhere V3

There is no Flask, Python, WSGI, virtualenv, SQLite, or server routing in this
edition. The site is a static HTML/CSS/JavaScript application.

GitHub Pages hosts:

- cinematic Klandestine homepage
- thirteen-faction archive
- classified/revealed factions
- scheduled faction reveals
- The Hoard card archive
- card rarity/foil/tilt effects
- scheduled card reveals
- individual faction and card dossiers
- Vault terminal and game/easter-egg codes
- Whispers timeline
- Learn Klandestine
- The Forge
- Forge request builder
- gallery
- contact request builder
- browser-local player collection tracker
- Content Studio
- automatic GitHub Actions deployment

## First deployment

Place **everything in this ZIP at the root of the `kloakndaggurrs` repository**.

The repository should look like:

```text
kloakndaggurrs/
├── index.html
├── 404.html
├── .nojekyll
├── README.md
├── deploy.sh
├── assets/
│   ├── css/
│   ├── js/
│   ├── data/
│   └── img/
└── .github/
    └── workflows/
        └── pages.yml
```

Then on GitHub:

1. Open the `kloakndaggurrs` repository.
2. Open **Settings → Pages**.
3. Under **Build and deployment → Source**, choose **GitHub Actions**.
4. Push to `main`.

Every push to `main` will run the included Pages deployment workflow.

## Bash deployment

From a local clone:

```bash
chmod +x deploy.sh
./deploy.sh "K&D GitHub V4"
```

Or:

```bash
git add .
git commit -m "K&D GitHub V4"
git push origin main
```

## Content editing

The site content is in:

`assets/data/site-data.json`

This controls the hero, factions, cards, Vault files, Whispers, and Gallery.

You can also open:

`#/studio`

Example:

`https://mjolnariclan-png.github.io/kloakndaggurrs/#/studio`

The Content Studio loads the current JSON. Make your changes, click **Download
JSON**, replace `assets/data/site-data.json`, then commit and push.

## Scheduled reveals

Use an ISO timestamp:

```json
{
  "revealed": false,
  "reveal_at": "2026-09-18T20:00:00-05:00"
}
```

The site automatically displays a countdown and considers the record revealed
after that time.

## Real artwork

Replace the included generated placeholders with your real K&D assets.

For card art, place an image in `assets/img/` and change:

```json
"image": "assets/img/my-real-card.webp"
```

## My Archive

The GitHub-only edition stores a player's collection in browser `localStorage`.
It works immediately without a server, but the collection belongs to that
browser/device and is not a cloud account.

## Vault security

Vault codes in a completely static site are suitable for game unlocks and
easter eggs, but **not true confidential data**. A determined visitor can inspect
public site files. Real private validation requires a backend.

## Contact and Forge email

Edit:

`assets/js/config.js`

and set:

```js
contactEmail: "YOUR_EMAIL",
forgeEmail: "YOUR_EMAIL"
```

The site then creates a complete `mailto:` message for the visitor.

## Features that require a real external backend

GitHub Pages cannot securely provide a shared database by itself. These features
would require a service such as Supabase/Firebase/Cloudflare while keeping this
GitHub Pages frontend:

- true cloud player accounts
- synced collections across devices
- secure owner authentication
- database-backed Owner Command Center
- stored Forge orders
- online order tracking
- stored contact messages
- public review submission/approval
- private Vault code validation
- browser media uploads

The public K&D site does **not** need any of that to deploy and run now.
