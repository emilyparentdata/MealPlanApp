# Dinner, Planned — Technical Overview

**Live site:** dinnerdata.org
**Firebase project:** mealplanapp-ad277

---

## Architecture at a Glance

Vanilla JavaScript app (ES modules, no framework) hosted on Firebase Hosting with Firebase Auth, Cloud Firestore, and two Cloud Functions. The app runs entirely client-side except for recipe import (URL scraping and photo scanning), which use server-side Cloud Functions.

```
index.html              Single-page app shell (tab-based navigation)
src/
  main.js               App initialization, auth flow, page routing, UI wiring
  firebase.js           Firebase config, Firestore CRUD, auth, localStorage fallbacks
  planner.js            Weekly meal planner UI and suggestion algorithm
  recipes.js            Recipe list rendering, search, display
  grocery.js            Grocery list generation, ingredient parsing, aggregation
  preferences.js        Recipe preferences (favorites, won't-eat, make-ahead)
  plan-view.js          Read-only view of committed weekly plan
  feedback.js           Post-meal feedback UI
  email.js              EmailJS stub (not yet active)
  style.css             All styles
guide.html              User-facing "How It Works" documentation
data/starter-packs.json Bundled starter recipe packs
functions/
  index.js              Cloud Functions (scrapeRecipe, scanRecipe)
```

---

## Firebase Integration

### Authentication

Three sign-in methods:

- **Google OAuth** — popup-based via `firebase.auth().signInWithPopup()`
- **Email/password** — `createUserWithEmailAndPassword()` / `signInWithEmailAndPassword()`
- **Beta gate** — new accounts must enter a hardcoded beta code (`MEALS2026` in main.js) before sign-up is allowed

On auth state change, the app loads the user's household from Firestore and initializes the UI.

### Firestore Data Model

All app data is scoped under a household. Users are linked to households via their user document.

```
users/{uid}
  ├── householdId: string
  ├── email: string
  └── displayName: string

households/{householdId}
  ├── name: string
  ├── members: [string]          # family member names
  ├── inviteCode: string         # 6-char code (A-Z, 2-9) for joining
  ├── createdBy: uid
  ├── createdAt: timestamp
  │
  ├── recipes/{recipeUid}        # user-owned recipes
  │     ├── name, ingredients, directions, prep_time, cook_time
  │     ├── servings, categories, source, source_url, image_url
  │     ├── description, notes
  │     └── archived: boolean    # soft delete
  │
  ├── preferences/{recipeUid}    # per-recipe household preferences
  │     ├── favorite: boolean
  │     ├── makeAhead: boolean
  │     ├── doesntEat: [memberName]
  │     └── updated: timestamp
  │
  ├── weeklyPlans/{weekKey}      # draft plans (weekKey = Monday YYYY-MM-DD)
  │     └── days: {
  │           Monday: { recipeUid, sides, servings, whoHome[], makeAhead, skip }
  │           ...
  │         }
  │
  ├── committedPlans/{weekKey}   # published plans
  │     └── (same as weeklyPlans + committed: true, committedAt: timestamp)
  │
  ├── comments/{auto-id}         # household discussion
  │     ├── weekKey, memberName, text, timestamp
  │
  ├── settings/
  │     ├── groceryExtras        # { items: [string] }
  │     └── repeatWindow         # { weeks: number }
  │
  └── useUpItems/{weekKey}       # ingredients to prioritize
        └── { items: [string], updated: timestamp }
```

### Household System

- **Create household** generates a 6-character invite code and writes to `households/` and `users/{uid}`
- **Join household** looks up the invite code, links the user's doc to that household
- All subsequent reads/writes use a `col(name)` helper that returns `households/{householdId}/{name}`

### Offline / localStorage Fallbacks

Every Firestore read/write checks `firebaseEnabled && householdId`. If either is falsy (no auth, no household, or Firebase not configured), data falls back to localStorage keys:

| Firestore path | localStorage key |
|---|---|
| `recipes/` | `custom_recipes` |
| `preferences/{uid}` | `rpref_{uid}` |
| `weeklyPlans/{wk}` | `plan_{wk}` |
| `committedPlans/{wk}` | `committed_{wk}` |
| `settings/groceryExtras` | `grocery_extras` |
| `settings/repeatWindow` | `repeat_window` |
| `useUpItems/{wk}` | `useup_{wk}` |
| `comments/{wk}` | `comments_{wk}` |

---

## Cloud Functions

Two HTTPS callable functions in `functions/index.js`. Node 22 runtime.

### `scrapeRecipe({ url })`

Extracts a recipe from a web URL using three strategies in order:

1. **JSON-LD** — parses `<script type="application/ld+json">` for `schema.org/Recipe`
2. **Microdata** — looks for `itemtype="http://schema.org/Recipe"` attributes
3. **Fallback** — scans HTML headings for "Ingredients"/"Directions" patterns

Uses **Cheerio** for HTML parsing. Returns a normalized recipe object (name, ingredients, directions, times, servings, categories, source URL).

### `scanRecipe({ imageBase64, mimeType })`

Extracts a recipe from a photo of a cookbook or recipe card using Claude vision.

- **Model:** `claude-haiku-4-5-20251001`
- **Max tokens:** 2048
- **Input:** base64-encoded image (up to ~7.5 MB)
- **Auth:** `ANTHROPIC_API_KEY` configured as a Cloud Functions secret
- **Output:** structured recipe JSON

The prompt asks Claude to return JSON with: name, ingredients (newline-separated), directions (numbered), servings, prep_time, cook_time, categories, notes.

---

## Meal Planning Algorithm

The suggestion engine lives in `planner.js` → `suggestMealForDay()`. For each empty day in the week, it scores every non-archived recipe and picks randomly from the top tier.

### Scoring

| Factor | Points | Details |
|---|---|---|
| Base | +2 per member home | More people home = higher base score |
| Favorite | +3 | Recipe marked as favorite |
| Use-up ingredient match | +5 per match | Ingredient appears in use-up list |
| Protein already used 1x this week | -1 | Reduces same-protein clustering |
| Protein already used 2x+ this week | -3 | Stronger penalty |
| Used in recent weeks | -2 | Within the configurable repeat window |

### Constraints (hard filters)

- **Same-week duplicate** — recipe already assigned to another day this week → skip entirely
- **Won't eat** — any member who's home has this recipe flagged → skip
- **Make-ahead days** — only suggest recipes with the make-ahead flag
- **Skip/leftovers days** — no suggestion needed

### Selection

After scoring, recipes are sorted by score. The "top tier" is all recipes within 1 point of the best score. One is picked at random from this tier. This adds variety while still favoring high-scoring recipes.

### Repeat Window

The repeat window controls how many previous weeks to check for recently-used recipes. Configurable from 1 week to 8 weeks, or "no limit" (checks 52 weeks). Default is 3 weeks. Stored as a household setting.

### Protein Detection

Regex patterns detect 9 protein categories from recipe name + ingredients: chicken, beef, pork, fish, turkey, lamb, tofu, beans, pasta. Used to penalize same-protein clustering within a week.

---

## Grocery List

Generated from the committed plan for the current week (`grocery.js`).

### Ingredient Parsing Pipeline

1. Split each recipe's ingredients by newline
2. Extract quantity (supports fractions, unicode ½ ¼ ¾), unit, and ingredient name
3. Strip prep words (diced, chopped, minced, sliced, etc.) and parenthetical notes
4. Normalize synonyms ("garlic cloves" → "garlic", "all-purpose flour" → "flour")
5. Normalize units (tablespoon → tbsp, pound → lb, etc.)
6. Group by normalized ingredient name across all recipes
7. Sum quantities where units match; show separately where they don't

### Categories

Ingredients are auto-categorized into sections for store layout:

- **Produce** — vegetables, fruits, fresh herbs
- **Meat & Seafood** — proteins including tofu/tempeh
- **Dairy & Eggs** — cheese, milk, butter, cream, eggs, yogurt
- **Pantry** — oils, sauces, grains, pasta, canned goods, bread
- **Spices & Seasonings** — dry spices (quantities suppressed)
- **Other** — anything unmatched

### Extras

Users can add manual items (eggs, milk, etc.) that persist across weeks via `settings/groceryExtras`.

### Export

"Share" button generates a plain-text grocery list grouped by category, with the meal plan summary at the top. Copies to clipboard or opens the system share sheet on mobile.

---

## Recipe Import

Four methods available on the Manage Recipes page:

| Method | How it works |
|---|---|
| **Scan Photo** | Upload up to 10 photos → each sent to `scanRecipe` Cloud Function → Claude extracts recipe → review/edit cards → bulk save |
| **From URL** | Paste URL → `scrapeRecipe` Cloud Function → JSON-LD/microdata extraction → edit before saving |
| **Manual** | Fill in form fields directly |
| **Import File** | Upload JSON, CSV, or Paprika `.paprikarecipes` file → parsed client-side → bulk save (batches of 450) |

Paprika import: the `.paprikarecipes` format is a zip of gzipped recipe files. These are extracted and parsed client-side.

---

## UI & Navigation

Single-page app with tab-based navigation. No router library — tabs are shown/hidden via CSS classes (`hidden`). Four main pages:

| Tab | Section ID | Description |
|---|---|---|
| This Week | `#page-plan-view` | View committed plan, open recipes, give feedback |
| Manage Recipes | `#page-manage` | Add/import/edit/delete recipes, starter packs |
| Plan Week | `#page-planner` | Set constraints, suggest meals, commit plan |
| Grocery List | `#page-grocery` | Auto-generated checklist with share |

Modals for recipe detail, editing, feedback, and delete confirmation.

---

## Hosting & Deployment

- **Firebase Hosting** serves the root directory as static files
- **Custom domain:** dinnerdata.org (CNAME)
- **No build step in production** — vanilla ES modules loaded directly
- **Deploy commands:**
  - `firebase deploy --only hosting` — static files
  - `firebase deploy --only functions` — Cloud Functions
  - `firebase deploy` — both

### Files Excluded from Hosting

Per `firebase.json` ignore list: `firebase.json`, `functions/`, `README.md`, `.git`

### Git Ignored

`Inputs/`, `.claude/`, `functions/node_modules/`, `dist/`, `.firebase/`, `.vite/`
