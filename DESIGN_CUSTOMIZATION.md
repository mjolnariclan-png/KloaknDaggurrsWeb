# Design Customization Guide

This guide helps you customize the visual design of your Klandestine website.

## Navigation Updates ✅

**Updated Navigation:**
- Factions → Factions (unchanged)
- The Hoard → The Arsenal
- Wars → Wars (new tab)
- Vault → The Archive
- Whispers → Whispers (unchanged)
- Learn → Lore
- The Forge → The Forge (unchanged)

## Page Structure Changes ✅

**Factions Page:**
- Hollow End now appears at the top as "THE TERMINUS"
- Series 1 factions displayed below with war information
- Layout: Hollow End → War Pairs (Ash vs First, etc.)

**Wars Page:**
- Dedicated page for all war information
- Shows war cards with faction names and conflict details
- Classified wars show "CONFLICT CLASSIFIED" until both factions revealed

## Visual Customization Guide

### 1. Faction Cards (`.faction-tile`)

**Current Style:**
```css
.faction-tile {
  min-height: 300px;
  border: 1px solid var(--line);
  background: radial-gradient(circle at 50% 24%, color-mix(in srgb, var(--accent) 17%, transparent), transparent 35%), linear-gradient(145deg, #110d18, #09070c);
  /* Box shadow and 3D effects */
}
```

**To Customize:**
- **Change card size:** Modify `min-height: 300px`
- **Change border:** Modify `border: 1px solid var(--line)`
- **Change background:** Adjust the gradient or use solid colors
- **Remove effects:** Remove `box-shadow` and `transform` properties

### 2. Color Variables

**Main Colors (found in `:root`):**
```css
--purple: #7d43ff;
--purple2: #9370db;
--line: #33283e;
--panel: #120c1a;
--muted: #8f8399;
```

**To Change Colors:**
1. Open `assets/css/style.css`
2. Find the `:root` section at the top
3. Modify any color value
4. Example: Change `--purple: #7d43ff` to your preferred color

### 3. Faction Accent Colors

Each faction has its own accent color:
- Ash Cycle: `#9b57cb` (purple)
- First Light: `#ffd700` (gold)
- Golden Flow: `#b58a42` (bronze)
- Crimson Oath: `#7794bf` (blue)
- Etched Power: `#8b4513` (brown)
- Tangled Weave: `#4a90e2` (blue)
- Eternal Reach: `#9370db` (purple)
- Hidden Truth: `#2f4f4f` (dark gray)
- Hollow End: `#800080` (purple)

**To Change Faction Colors:**
1. **Database:** Run SQL to update `accent` column in `factions` table
2. **JSON:** Update `accent` field in `assets/data/site-data.json`

### 4. Card/Box Styling

**General Card Style:**
```css
/* Remove border and background for cleaner look */
.faction-tile {
  border: none;
  background: transparent;
  box-shadow: none;
  transform: none;
}

/* Add custom styling */
.faction-tile {
  border-radius: 20px;
  background: linear-gradient(135deg, rgba(125,67,255,0.1), rgba(125,67,255,0.05));
  backdrop-filter: blur(10px);
}
```

### 5. War Cards (`.war-card`)

**Current Style:**
```css
.war-card {
  border: 1px solid var(--line);
  background: var(--panel);
  padding: 25px;
  min-height: 200px;
}
```

**To Customize:**
- Make them more prominent: Increase padding, add colored borders
- Make them subtler: Remove borders, reduce padding
- Add hover effects: Add `:hover` pseudo-class

### 6. Hollow End Section

**Special Styling:**
```css
.hollow-end-section {
  border: 2px solid #800080;
  background: radial-gradient(circle at 50% 0%, rgba(128,0,128,.15), transparent 50%);
}
```

**To Customize:**
- Change the purple color scheme
- Modify the gradient intensity
- Adjust border thickness

### 7. Font Customization

**Current Fonts:**
- Display (headers): `Cinzel` (fantasy/medieval style)
- Body text: `Inter` (clean sans-serif)

**To Change Fonts:**
1. Add new Google Fonts in `index.html`
2. Update CSS font-family properties

### 8. Layout Grid Changes

**Faction Grid:**
```css
.faction-grid {
  grid-template-columns: repeat(4, 1fr); /* 4 columns */
  gap: 13px;
}
```

**To Change Layout:**
- More columns: `repeat(5, 1fr)` or `repeat(6, 1fr)`
- Fewer columns: `repeat(3, 1fr)` or `repeat(2, 1fr)`
- Responsive: Already handles mobile automatically

## Quick Customization Examples

### Example 1: Remove Box Effects
```css
.faction-tile {
  box-shadow: none;
  transform: none;
  --rx: 0;
  --ry: 0;
}
```

### Example 2: Make Cards Transparent
```css
.faction-tile {
  background: rgba(18, 12, 26, 0.8);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(125, 67, 255, 0.3);
}
```

### Example 3: Change Faction Card Size
```css
.faction-tile {
  min-height: 400px; /* Taller cards */
  padding: 35px; /* More internal spacing */
}
```

### Example 4: Custom War Card Style
```css
.war-card {
  background: linear-gradient(135deg, var(--panel), rgba(125,67,255,0.1));
  border-left: 4px solid var(--accent);
  border-radius: 12px;
}
```

## File Locations

- **CSS Styles:** `assets/css/style.css`
- **Page Layout:** `assets/js/app.js` (individual page functions)
- **Colors/Content:** `assets/data/site-data.json` or database
- **Navigation:** `index.html`

## Testing Changes

1. Save your CSS changes
2. Refresh your browser (Ctrl+R or Cmd+R)
3. Check different pages to see effects
4. Test on mobile responsiveness

## Need More Help?

If you want to change something specific but aren't sure how, ask about:
- Specific element (faction cards, navigation, war cards)
- Desired effect (color change, layout change, animation)
- Reference (can you show me what you want it to look like?)