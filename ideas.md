# Ideas

Parking lot for feature ideas — not committed, not scheduled.

## Recipe snooze

Let users temporarily hide a recipe from suggestions/rotation without deleting or unfavoriting it. Snooze for a chosen duration (e.g. 2 weeks, 1 month, 3 months, until manually un-snoozed) after which it reappears automatically.

**Why it's useful:**
- Pregnancy aversions (e.g. can't stand red meat right now even though normally a favorite)
- Kids burning out on a recipe they previously loved and need a break from
- Seasonal recipes (snooze heavy soups in summer, grilling recipes in winter)
- Avoiding "I just made this last week" without losing the recipe

**Open questions / things to think about:**
- Where the snooze control lives (recipe detail page? long-press on recipe card?)
- Whether snoozed recipes still appear in browse/search but with a visual indicator, or are fully hidden
- Whether to surface a list of currently-snoozed recipes so users can un-snooze early
- Interaction with shared packs — does snooze apply per-user or per-household?

## Drag-and-drop day reordering on the planner

After meals are suggested, let the user drag a recipe from one weekday to another to swap or move it, instead of having to delete and re-search.

**Why it's useful:**
- Same parameters for two days but external context differs (e.g. wanting the cozy soup on the colder/rainier day)
- Quickly rebalancing prep effort across the week
- Faster than the current "search the recipe in the new day's slot" workaround

**Open questions:**
- Touch/mobile support — drag-and-drop is fragile on phones; may need a long-press "move to..." menu as an alternative
- What happens to grocery aggregation while dragging (probably just recompute on drop)
- How this interacts with locked-in / make-ahead / leftover days

## Smarter "make ahead" semantics

Today, "Make ahead" on a day is a *filter* that only suggests recipes the user has tagged as make-ahead-friendly. Users intuitively read it as "this day eats leftovers from a meal cooked earlier in the week" — which is a different and arguably more useful concept.

**Possible model:**
- Mark Tuesday as "leftovers from Monday"
- Planner sizes Monday's recipe up (extra servings) and leaves Tuesday auto-filled with a leftovers placeholder
- Grocery list reflects the larger Monday batch

**Why it's useful:**
- Matches how people actually meal-plan around batch cooking
- Removes the dependency on users having pre-tagged recipes as make-ahead
- Could coexist with the current filter (rename current behavior to "Prep ahead" or similar)

## Lunches / extra meal slots alongside dinners

The app is dinner-focused, but many people meal-prep lunches on the weekend and want to plan them in the same flow — buying ingredients on the same trip, fitting them into the same week. Today the workaround is to use a day slot you'd otherwise skip and put the lunch recipe there, which works fine for one user but doesn't scale.

**Possible models:**
- A separate "Lunch" row per day (parallel to the dinner row), each with its own optional recipe slot
- A single "Extra meals this week" panel where users can pin 1–3 prep recipes that aren't tied to a specific day, and that still feed into the grocery list
- A meal-type toggle on each day so a slot can represent dinner OR lunch OR breakfast

**Why it's useful:**
- One grocery list for the full week's planned meals, not just dinners
- Encourages weekend batch-prep workflows
- Reduces the "I forgot to buy lunch stuff" miss

**Open questions:**
- Does the suggestion engine treat lunch recipes differently (lighter, faster, more leftover-friendly), or are they drawn from the same pool?
- Should users tag recipes as "lunch-appropriate" or is it free-for-all?
- How does the convenience filter interact (Quick filter is probably more relevant for lunches)?
- Visual weight on the planner — adding a parallel row per day doubles the page height

## Parse recipe ingredients once at save/import time (structured form)

Today, ingredient parsing happens lazily, every time the grocery list is built, against the raw `recipe.ingredients` text blob in `src/grocery.js:259` (`parseIngredient`). This is the root cause of most grocery-list quality issues — every parser bug recurs on every list, users have no place to fix bad parses, and each new edge case adds another regex tweak to a fragile pile.

**The pivot:** parse ingredients once at save/import time into a structured form stored on the recipe.

```js
recipe.ingredients_parsed = [
  { name: 'garlic', qty: 5, unit: 'clove', prep: 'minced', original: '5 cloves garlic, minced' },
  { name: 'ground beef', qty: 1, unit: 'lb', original: '1 lb ground beef' },
  { name: 'black beans', qty: 1, unit: 'can', size: '15 oz', original: '1 (15 oz) can black beans, drained' },
  ...
]
```

**What this unlocks:**
1. The recipe edit UI can show the parsed view as editable rows. Users fix mistakes at the source and the fix sticks for every future grocery list — turns one-off corrections into permanent improvements.
2. Aggregation logic operates on clean structured data instead of fighting the parser regexes.
3. Optionally use the LLM already used for `scanRecipe` to do parsing on import — much more accurate than regex, especially for messy real-world recipes.
4. Eliminates the "canned" / "1 (15 oz) can" / parenthetical-sizing class of bugs entirely.

**What's involved (rough scope):**
- Recipe schema gets a new `ingredients_parsed` array field; old recipes keep the raw `ingredients` text and get parsed lazily-then-cached on first edit
- Import paths (URL scrape, photo scan, manual entry, shared pack) all need to populate the parsed form
  - URL scraper: regex parser as today, but run once and store
  - Photo scan: ask the LLM to return structured ingredients alongside the raw text
  - Manual entry: regex parse on save with a "looks wrong? edit it" UI
  - Shared pack import: copy the parsed form along with the raw
- Recipe edit modal grows a new ingredients editor showing structured rows (name / qty / unit / prep / size) with the original text below for reference
- `aggregateIngredients` in `src/grocery.js` switches to reading `ingredients_parsed` when present, falling back to live parsing for un-migrated recipes
- Migration: lazy. No batch backfill needed; recipes get parsed on next edit, or on first grocery-list build, and the result is cached.

**Open questions:**
- Should the edit UI show structured rows by default or keep the raw text editor as the primary interface with structured rows in a "review parsed" panel?
- LLM cost on import — bulk scan currently makes one call per photo; would adding ingredient parsing add cost per recipe or could it ride along on the same call (yes, prompt engineering)?
- How aggressive should the migration be when reading old recipes — parse on every grocery list build, or parse-and-store on first read?
- What does "edit" do to a recipe imported from a shared pack? Already addressed (it's an editable copy) but worth confirming the parsed form follows the same rule.

This is a meaningful refactor — touches recipe schema, all four import paths, the recipe edit UI, and the grocery aggregation. But it pays back across the entire grocery-list surface area instead of plugging individual holes one at a time. Worth doing once the immediate cheap fixes (PREP_WORDS cleanup + unit conversion table) are in place and we have a clearer picture of what the residual bugs look like.

## "Canned" parser edge case

Investigation parking spot. A user reported a grocery item showing up as just "canned" with no actual ingredient. Likely the parser at `src/grocery.js:259` is mis-extracting a line like `1 (15 oz) can black beans, drained` and keeping the wrong token.

**Next steps when it recurs:**
- Capture the source recipe line that produced the bad item
- Add a parser test for that exact input
- Fix `parseIngredient` to skip parenthetical sizing and properly handle "can <ingredient>" patterns
