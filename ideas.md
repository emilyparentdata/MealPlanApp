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

## "Canned" parser edge case

Investigation parking spot. A user reported a grocery item showing up as just "canned" with no actual ingredient. Likely the parser at `src/grocery.js:259` is mis-extracting a line like `1 (15 oz) can black beans, drained` and keeping the wrong token.

**Next steps when it recurs:**
- Capture the source recipe line that produced the bad item
- Add a parser test for that exact input
- Fix `parseIngredient` to skip parenthetical sizing and properly handle "can <ingredient>" patterns
