#!/usr/bin/env node
// Reads every "<Faction> manifest.json" under assets/img/cards/ and upserts the
// cards it describes into Supabase. Run this after dropping new manifests/images
// into assets/img/cards/<Faction>/... and committing them.
//
// Usage (PowerShell):
//   $env:SUPABASE_URL="https://xxxx.supabase.co"
//   $env:SUPABASE_SERVICE_ROLE_KEY="..."   # Service role key (Project Settings > API). Never commit this.
//   node supabase/sync-cards.js
//
// Requires: npm install @supabase/supabase-js
// Requires: run supabase/05_cards_upsert_constraint.sql once first (adds the unique key this script upserts on).

const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables first.");
  process.exit(1);
}

// Folder name under assets/img/cards -> factions.slug in the database.
const FACTION_SLUGS = {
  "Ash Cycle": "ash-cycle",
  "Crimson Oath": "crimson-oath",
  "Etched Power": "etched-power",
  "Eternal Reach": "eternal-reach",
  "First Light": "first-light",
  "Golden Flow": "golden-flow",
  "Hidden Truth": "hidden-truth",
  "Hollow End": "hollows-end",
  "Tangled Weave": "tangled-weave",
};

const CARDS_ROOT = path.join(__dirname, "..", "assets", "img", "cards");

function parseNum(v) {
  if (v == null) return null;
  const m = String(v).match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}

function sortKeyFrom(cardNumber) {
  const m = String(cardNumber || "").match(/^(\d+)/);
  return m ? Number(m[1]) * 10 : 0;
}

// Manifest entries use different field names depending on card type
// (e.g. Vigor cards use "vigor_type", Creature cards use "vigor").
function mapCard(raw, factionSlug, setName) {
  return {
    name: raw.name,
    card_number: raw.card_number,
    set_name: setName,
    faction_slug: factionSlug,
    type: raw.type,
    rarity: raw.rarity || null,
    vigor_type: raw.vigor_type || raw.vigor || null,
    vigor_cost: parseNum(raw.vigor_cost),
    class_name: raw.className || null,
    ap: parseNum(raw.ap),
    dp: parseNum(raw.dp),
    mana_card_cost: parseNum(raw["Mana Card Cost"]),
    strength_vigor: raw.strength?.Vigor || null,
    weakness_vigor: raw.weakness?.Vigor || null,
    attacks: raw.attacks || null,
    equipment_type: raw.equipment_type || null,
    attack_name: raw.attack_name || null,
    attack_description: raw.attack_description || null,
    revealed: true,
    reveal_at: null,
    sort_order: sortKeyFrom(raw.card_number),
  };
}

async function main() {
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  const factionDirs = fs.readdirSync(CARDS_ROOT, { withFileTypes: true }).filter(d => d.isDirectory());

  let total = 0;
  for (const dir of factionDirs) {
    const folder = dir.name;
    const slug = FACTION_SLUGS[folder];
    if (!slug) {
      console.warn(`Skipping "${folder}" — no known faction slug mapping (add it to FACTION_SLUGS).`);
      continue;
    }

    const manifestPath = path.join(CARDS_ROOT, folder, `${folder}_manifest.json`);
    if (!fs.existsSync(manifestPath)) {
      console.warn(`Skipping "${folder}" — no manifest file found at ${manifestPath}.`);
      continue;
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const rows = (manifest.cards || []).map(c => mapCard(c, slug, manifest.set_name || folder));

    for (let i = 0; i < rows.length; i += 200) {
      const batch = rows.slice(i, i + 200);
      const { error } = await sb.from("cards").upsert(batch, { onConflict: "faction_slug,card_number" });
      if (error) {
        console.error(`Failed to sync batch for "${folder}":`, error.message);
        process.exit(1);
      }
    }

    total += rows.length;
    console.log(`Synced ${rows.length} cards for "${folder}" (${slug}).`);
  }

  console.log(`Done. ${total} cards synced.`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
