import { loadCommittedPlan, loadGroceryExtras, saveGroceryExtras } from './firebase.js';
import { getRecipeByUid } from './recipes.js';
import { getWeekKey, getWeekLabel, getDAYS } from './planner.js';

let lastMeals = null;
let currentWeekKey = null;

export async function renderGroceryList(checklistContainer, breakdownContainer, weekLabelEl) {
  currentWeekKey = getWeekKey();
  weekLabelEl.textContent = getWeekLabel();

  const plan = await loadCommittedPlan(currentWeekKey);
  checklistContainer.innerHTML = '';
  breakdownContainer.innerHTML = '';
  lastMeals = null;

  if (!plan || !plan.days) {
    checklistContainer.innerHTML = `
      <div class="empty-state-card">
        <p>No grocery list yet — commit a meal plan first.</p>
        <button class="btn primary" data-navigate="planner">Go to Plan Week</button>
      </div>
    `;
    return;
  }

  // Collect meals for each day
  const meals = [];
  for (const day of getDAYS()) {
    const dayData = plan.days[day];
    if (!dayData) continue;
    if (dayData.skip === true || dayData.skip === 'skip') {
      meals.push({ day, type: 'skip' });
    } else if (dayData.skip === 'leftovers') {
      meals.push({ day, type: 'leftovers' });
    } else if (dayData.recipeUid) {
      const recipe = getRecipeByUid(dayData.recipeUid);
      if (recipe) {
        meals.push({ day, type: 'meal', recipe, sides: dayData.sides || '', servings: dayData.servings || 1 });
      }
    }
  }

  if (!meals.filter(m => m.type === 'meal').length) {
    checklistContainer.innerHTML = `
      <div class="empty-state-card">
        <p>No meals planned this week — only skipped or leftover days.</p>
        <button class="btn primary" data-navigate="planner">Go to Plan Week</button>
      </div>
    `;
    return;
  }

  lastMeals = meals;

  // === Aggregated checklist ===
  renderChecklist(checklistContainer, meals);

  // === Per-meal breakdown ===
  renderBreakdown(breakdownContainer, meals);
}

function renderChecklist(container, meals) {
  const groups = aggregateIngredients(meals);
  const storageKey = `grocery_checked_${currentWeekKey}`;
  const checked = JSON.parse(localStorage.getItem(storageKey) || '{}');
  const editsKey = `grocery_edits_${currentWeekKey}`;
  const edits = JSON.parse(localStorage.getItem(editsKey) || '{}');
  const deletesKey = `grocery_deletes_${currentWeekKey}`;
  const deletes = JSON.parse(localStorage.getItem(deletesKey) || '{}');

  let html = '';
  for (const [category, items] of groups) {
    const visibleItems = items.filter(item => !deletes[item.key]);
    if (!visibleItems.length) continue;
    html += `<div class="grocery-category">`;
    if (category) {
      html += `<h3 class="grocery-category-label">${escHtml(category)}</h3>`;
    }
    html += `<ul class="grocery-checklist-items">`;
    for (const item of visibleItems) {
      const key = item.key;
      const displayText = edits[key] || item.display;
      const isChecked = checked[key] ? 'checked' : '';
      const checkedClass = checked[key] ? ' checked' : '';
      const mealNote = `<span class="grocery-meal-note">${item.meals.map(escHtml).join(', ')}</span>`;
      html += `<li>
        <label class="grocery-check${checkedClass}">
          <input type="checkbox" data-key="${escAttr(key)}" ${isChecked}>
          <span class="grocery-item-text">${escHtml(displayText)}</span>
          ${mealNote}
        </label>
        <div class="grocery-item-actions">
          <button class="grocery-edit-btn" data-key="${escAttr(key)}" data-display="${escAttr(displayText)}" title="Edit">&#9998;</button>
          <button class="grocery-delete-btn" data-key="${escAttr(key)}" title="Remove">&times;</button>
        </div>
      </li>`;
    }
    html += `</ul></div>`;
  }

  container.innerHTML = html;

  // Wire up checkboxes
  container.querySelectorAll('.grocery-check input').forEach(cb => {
    cb.addEventListener('change', () => {
      cb.closest('label').classList.toggle('checked', cb.checked);
      const state = JSON.parse(localStorage.getItem(storageKey) || '{}');
      if (cb.checked) { state[cb.dataset.key] = true; } else { delete state[cb.dataset.key]; }
      localStorage.setItem(storageKey, JSON.stringify(state));
      updateProgress(container);
    });
  });

  // Wire up edit buttons
  container.querySelectorAll('.grocery-edit-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const li = btn.closest('li');
      const textEl = li.querySelector('.grocery-item-text');
      const currentText = btn.dataset.display;

      // Replace text with an input
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'grocery-edit-input';
      input.value = currentText;
      textEl.replaceWith(input);
      input.focus();
      input.select();

      // Hide actions while editing
      li.querySelector('.grocery-item-actions').style.display = 'none';

      const save = () => {
        const newText = input.value.trim();
        if (newText && newText !== currentText) {
          const allEdits = JSON.parse(localStorage.getItem(editsKey) || '{}');
          allEdits[btn.dataset.key] = newText;
          localStorage.setItem(editsKey, JSON.stringify(allEdits));
        }
        renderChecklist(container, meals);
      };

      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') save();
        if (ev.key === 'Escape') renderChecklist(container, meals);
      });
      input.addEventListener('blur', save);
    });
  });

  // Wire up delete buttons
  container.querySelectorAll('.grocery-delete-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const allDeletes = JSON.parse(localStorage.getItem(deletesKey) || '{}');
      allDeletes[btn.dataset.key] = true;
      localStorage.setItem(deletesKey, JSON.stringify(allDeletes));
      renderChecklist(container, meals);
    });
  });

  updateProgress(container);
}

function updateProgress(container) {
  const total = container.querySelectorAll('.grocery-check input').length;
  const done = container.querySelectorAll('.grocery-check input:checked').length;
  let bar = container.querySelector('.grocery-progress');
  if (!bar) {
    bar = document.createElement('div');
    bar.className = 'grocery-progress';
    container.insertBefore(bar, container.firstChild);
  }
  if (total === 0) {
    bar.innerHTML = '';
    return;
  }
  const pct = Math.round((done / total) * 100);
  bar.innerHTML = `
    <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
    <span class="progress-text">${done} of ${total} items checked</span>
  `;
}

function renderBreakdown(container, meals) {
  let html = '';
  for (const m of meals) {
    if (m.type === 'skip') {
      html += `<div class="grocery-day"><h3>${m.day}</h3><p class="grocery-skip">Skipped</p></div>`;
    } else if (m.type === 'leftovers') {
      html += `<div class="grocery-day"><h3>${m.day}</h3><p class="grocery-skip">Leftovers</p></div>`;
    } else {
      const sides = m.sides ? `<span class="meal-sides">+ ${escHtml(m.sides)}</span>` : '';
      const mult = m.servings && m.servings !== 1 ? `<span class="meal-multiplier">${m.servings}x</span>` : '';
      const ingredients = m.recipe.ingredients
        ? m.recipe.ingredients.split('\n').map(l => l.trim()).filter(Boolean)
        : [];

      html += `<div class="grocery-day">
        <h3>${m.day}</h3>
        <div class="grocery-meal-name">${escHtml(m.recipe.name)}${mult}${sides}</div>
        ${ingredients.length
          ? `<ul class="grocery-ingredients">${ingredients.map(i => `<li>${escHtml(i)}</li>`).join('')}</ul>`
          : '<p class="grocery-no-ingredients">No ingredient list available</p>'}
      </div>`;
    }
  }
  container.innerHTML = html;
}

// === Ingredient parsing and aggregation ===

const UNITS = ['cups?', 'tbsp', 'tsp', 'tablespoons?', 'teaspoons?', 'oz', 'ounces?', 'lbs?', 'pounds?',
  'cloves?', 'cans?', 'packages?', 'packets?', 'slices?', 'heads?', 'stalks?', 'sprigs?',
  'pinch(?:es)?', 'bunch(?:es)?', 'handfuls?', 'sticks?', 'bags?', 'bottles?', 'jars?', 'pieces?'];
const UNIT_RE = new RegExp(`^(${UNITS.join('|')})\\b\\.?\\s*(?:of\\s+)?`, 'i');

// Words that describe how an ingredient is prepared but don't change which
// product you buy at the store — safe to strip from the ingredient name.
//
// IMPORTANT: do NOT add words here that change the SKU. Things like "ground"
// (ground beef vs beef), "smoked" (smoked paprika vs paprika), "unsalted"
// (unsalted butter vs salted butter), "fresh"/"dried" (fresh basil vs dried
// basil), "boneless"/"skinless", "low-sodium", "sun-dried", "oil-packed",
// "toasted", "roasted", "pickled", "frozen" — these are all things you
// pick at the store, not in the kitchen, so they must stay in the name.
const PREP_WORDS = /\b(finely|roughly|thinly|freshly|lightly|well|coarsely)?\s*-?\s*(diced|chopped|minced|sliced|grated|shredded|crushed|julienned|cubed|halved|quartered|trimmed|peeled|seeded|deveined|deboned|thawed|warm|warmed|cold|softened|melted|room temperature|to taste|optional|divided|packed|sifted|beaten|whisked|juiced|zested|squeezed|rinsed|drained|pitted|cored|stemmed|cleaned|washed|torn|cut into.*|about|jarred|opened|fine|finely|roughly|thinly|freshly|lightly|coarsely)\b/gi;

function parseFraction(s) {
  s = s.trim();
  // Unicode fractions
  const unicodeFracs = { '\u00BC': 0.25, '\u00BD': 0.5, '\u00BE': 0.75, '\u2153': 1/3, '\u2154': 2/3, '\u215B': 0.125 };
  for (const [ch, val] of Object.entries(unicodeFracs)) {
    if (s.includes(ch)) {
      const rest = s.replace(ch, '').trim();
      return rest ? parseFloat(rest) + val : val;
    }
  }
  // "1 1/2" or "1/2"
  const mixed = s.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/);
  if (mixed) return parseInt(mixed[1]) + parseInt(mixed[2]) / parseInt(mixed[3]);
  const frac = s.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (frac) return parseInt(frac[1]) / parseInt(frac[2]);
  const num = parseFloat(s);
  return isNaN(num) ? null : num;
}

function formatQuantity(n) {
  if (n === null || n === undefined) return '';
  // Common fractions
  const fracs = [[0.25, '\u00BC'], [0.5, '\u00BD'], [0.75, '\u00BE'], [0.333, '\u2153'], [0.667, '\u2154'], [0.125, '\u215B']];
  const whole = Math.floor(n);
  const remainder = n - whole;
  if (remainder < 0.01) return String(whole);
  for (const [val, ch] of fracs) {
    if (Math.abs(remainder - val) < 0.05) {
      return whole > 0 ? `${whole} ${ch}` : ch;
    }
  }
  // Fall back to one decimal
  return n % 1 === 0 ? String(n) : n.toFixed(1);
}

function parseIngredient(line) {
  let s = line.trim();
  // Strip leading bullet/dash
  s = s.replace(/^[-•*]\s*/, '');

  // Extract quantity (number at start, possibly fraction like "1 1/2")
  let qty = null;
  const qtyMatch = s.match(/^([\d\u00BC\u00BD\u00BE\u2153\u2154\u215B]+(?:\s*\/\s*\d+)?(?:\s+[\d\u00BC\u00BD\u00BE\u2153\u2154\u215B]+(?:\s*\/\s*\d+)?)?)\s+/);
  if (qtyMatch) {
    qty = parseFraction(qtyMatch[1]);
    s = s.slice(qtyMatch[0].length);
  }

  // Extract unit
  let unit = '';
  const unitMatch = s.match(UNIT_RE);
  if (unitMatch) {
    unit = unitMatch[1].toLowerCase().replace(/\.$/, '');
    s = s.slice(unitMatch[0].length);
  }

  // Normalize unit to singular
  unit = unit.replace(/s$/, '').replace(/^ounce$/, 'oz').replace(/^pound$/, 'lb')
    .replace(/^tablespoon$/, 'tbsp').replace(/^teaspoon$/, 'tsp');

  // Strip leading "or " (from alternative ingredients like "or avocado")
  s = s.replace(/^or\s+/i, '');

  // Handle "zest, then juice, of 1/2 lemon" → "lemon"
  s = s.replace(/^(zest|juice|zest\s*,?\s*then\s*juice|zest\s+and\s+juice|juice\s+and\s+zest)\s*,?\s*(?:of\s+)?/i, '');

  // Strip prep words and parenthetical notes
  let name = s
    .replace(/\(.*?\)/g, '')       // remove parenthetical notes
    .replace(PREP_WORDS, '')       // remove prep descriptors
    .replace(/,?\s*for\s+(serving|garnish|topping|dipping|drizzling)s?/i, '')  // "for serving" etc. (anywhere, not just end)
    .replace(/,?\s*and\s+more\s+for\s+.*$/i, '')  // "and more for serving"
    .replace(/,?\s*plus\s+(more|extra)\b.*$/i, '')  // "plus more for drizzling", "plus extra"
    .replace(/,?\s*or\s+to\s+taste$/i, '')         // "or to taste"
    .replace(/,?\s*as\s+needed$/i, '')             // "as needed"
    .replace(/\s+or\s+other\s+[\w\s]+$/i, '')      // "or other sweetener"
    .replace(/\s+or\s+[\w\s]{2,}$/i, '')           // "or tamari", "or fish sauce" — strip alternatives (2+ chars to avoid stripping single words that are the ingredient)
    .replace(/,?\s*and\s*$/i, '')                  // trailing ", and" or "and"
    .replace(/,?\s*plus\s+\d.*$/i, '')             // "plus 2 tablespoons adobo sauce"
    .replace(/,\s*,/g, ',')       // collapse double commas
    .replace(/^[,\s]+/, '')        // leading commas/spaces
    .replace(/[,\s]+$/, '')        // trailing commas/spaces
    .replace(/\s+/g, ' ')
    .trim();

  // Build a normalized key (lowercase, no punctuation)
  let key = name.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();

  // Normalize synonyms so variants merge
  key = normalizeKey(key);

  return { qty, unit, name, key };
}

// Normalize ingredient keys so that common variants merge into one entry.
// Order matters: more specific patterns first.
function normalizeKey(key) {
  // Strip size/color adjectives that don't change what you buy
  key = key.replace(/\b(large|medium|small|extra-large|extra large|big)\b/g, '').trim();

  // "garlic cloves" / "clove garlic" / "cloves garlic" → "garlic"
  key = key.replace(/\bgarlic\s+cloves?\b/, 'garlic').replace(/\bcloves?\s+(?:of\s+)?garlic\b/, 'garlic');

  // "basil leaves" → "basil"
  key = key.replace(/\bbasil\s+leaves?\b/, 'basil');

  // "parmesan cheese" / "parmigiano reggiano" → "parmesan"
  key = key.replace(/\bparmesan\s+cheese\b/, 'parmesan').replace(/\bparmigiano[\s-]+reggiano\b/, 'parmesan');

  // "all-purpose flour" / "allpurpose flour" / "ap flour" → "flour"
  key = key.replace(/\b(all[\s-]?purpose|ap)\s+flour\b/, 'flour');

  // "yellow onions" / "white onions" / "sweet onions" → "onions" (but not "green onion")
  key = key.replace(/\b(yellow|white|sweet|red|vidalia|spanish)\s+onions?\b/, 'onion');

  // Collapse trailing "s" plurals for common produce
  key = key.replace(/\bonions\b/, 'onion').replace(/\bpotatoes\b/, 'potato').replace(/\btomatoes\b/, 'tomato');

  // "flat leaf parsley" / "flat-leaf parsley" / "italian parsley" → "parsley"
  key = key.replace(/\b(flat[\s-]?leaf|italian|curly)\s+parsley\b/, 'parsley');

  // "hungarian sweet paprika" / "hungarian hot paprika" are distinct, but bare "hungarian paprika" → "hungarian sweet paprika"
  // (sweet is the default)
  if (key === 'hungarian paprika') key = 'hungarian sweet paprika';

  // Final cleanup
  key = key.replace(/\s+/g, ' ').trim();
  return key;
}

function isNotIngredient(line) {
  const s = line.trim();
  // Section headers: "FOR THE TOFU", "FOR THE SAUCE:", etc.
  if (/^for\s+the\s+/i.test(s)) return true;
  // All-caps headers: "SAUCE", "TOPPING", "FOR THE BROCCOLI"
  if (/^[A-Z\s:]+$/.test(s) && s.length > 2) return true;
  // Headers ending with colon: "Sauce:", "Marinade:", "Dressing:"
  if (/^[A-Za-z\s]+:\s*$/.test(s)) return true;
  // Pure instructions (verbs with no food nouns): "mix ingredients", "combine well", "set aside"
  if (/^(mix|combine|stir|whisk|blend|toss|fold|set aside|serve|cook|bake|preheat|let|place|arrange|layer|repeat|note|optional|garnish|drizzle|heat|bring|add|pour|spread|top with|prepare|make|meanwhile|season|adjust|transfer|remove)\b/i.test(s)
      && !/\d/.test(s)) return true;
  // Lines that are just a dash, asterisk, or number
  if (/^[-—*#]+$/.test(s)) return true;
  // Non-food labels
  if (/^(toppings?|for serving|for garnish|for topping|special equipment|equipment)\b/i.test(s)) return true;
  return false;
}

function addToMap(map, key, name, qty, unit, mealLabel, multiplier = 1) {
  const adjustedQty = qty !== null ? qty * multiplier : null;
  if (map.has(key)) {
    const entry = map.get(key);
    entry.quantities.push({ qty: adjustedQty, unit });
    if (!entry.meals.includes(mealLabel)) {
      entry.meals.push(mealLabel);
    }
  } else {
    map.set(key, {
      name,
      quantities: [{ qty: adjustedQty, unit }],
      meals: [mealLabel],
      key,
    });
  }
}

function aggregateIngredients(meals) {
  const ingredientMap = new Map(); // key -> { name, quantities: [{qty, unit}], meals[] }

  for (const m of meals) {
    if (m.type !== 'meal') continue;

    // Process recipe ingredients
    if (m.recipe.ingredients) {
      const ingredients = m.recipe.ingredients.split('\n').map(l => l.trim()).filter(Boolean);
      for (const line of ingredients) {
        if (isNotIngredient(line)) continue;
        const parsed = parseIngredient(line);
        if (!parsed.key) continue;
        if (isAlwaysOnHand(parsed.key)) continue;
        addToMap(ingredientMap, parsed.key, parsed.name, parsed.qty, parsed.unit, m.recipe.name, m.servings || 1);
      }
    }

    // Process sides (e.g. "rice, salad, bread")
    if (m.sides) {
      const sideItems = m.sides.split(',').map(s => s.trim()).filter(Boolean);
      for (const side of sideItems) {
        const key = side.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
        if (!key) continue;
        addToMap(ingredientMap, key, side, null, '', m.recipe.name);
      }
    }
  }

  // Categorize first, then build display (category affects whether quantities show)
  const produce = [];
  const dairy = [];
  const meat = [];
  const pantry = [];
  const spices = [];
  const other = [];

  for (const [, entry] of ingredientMap) {
    // If the unit is "can" or "jar", it's a pantry item regardless of ingredient name
    const hasShelfUnit = entry.quantities.some(q => /^(can|jar|bottle|bag|package|packet|box)$/.test(q.unit));
    const section = hasShelfUnit ? 'pantry' : categorizeIngredient(entry.name);
    const suppressQty = section === 'pantry' || section === 'spices' || isStapleDairy(entry.name);
    const display = buildDisplayText(entry, suppressQty);
    const item = { display, meals: entry.meals, key: entry.key, name: entry.name };
    if (section === 'produce') produce.push(item);
    else if (section === 'dairy') dairy.push(item);
    else if (section === 'meat') meat.push(item);
    else if (section === 'pantry') pantry.push(item);
    else if (section === 'spices') spices.push(item);
    else other.push(item);
  }

  const groups = [];
  if (produce.length) groups.push(['Produce', produce]);
  if (meat.length) groups.push(['Meat & Seafood', meat]);
  if (dairy.length) groups.push(['Dairy & Eggs', dairy]);
  if (pantry.length) groups.push(['Pantry', pantry]);
  if (spices.length) groups.push(['Spices & Seasonings', spices]);
  if (other.length) groups.push(['Other', other]);

  if (groups.length === 1 && groups[0][0] === 'Other') {
    return [['', other]];
  }

  return groups;
}

const STAPLE_DAIRY = ['milk', 'butter', 'cream', 'sour cream', 'heavy cream', 'half and half', 'cream cheese'];

function isStapleDairy(name) {
  const lower = name.toLowerCase();
  return STAPLE_DAIRY.some(s => lower === s || lower.startsWith(s + ' ') || lower.endsWith(' ' + s));
}

// Unit conversions used to merge cross-unit quantities for the same
// ingredient before display. Each rule says: N of `smaller` = 1 of `larger`.
// `upConvert(total)` returns the larger-unit amount if conversion gives a
// "clean" result, or null to leave the quantity in the smaller unit.
//
// e.g. "1 head garlic" + "5 cloves garlic" → 15 cloves total → 1.5 heads.
//      "11 cloves + 5 cloves" → 16 cloves → 1.5 heads.
//      "8 cloves" → stays as "8 cloves" (less than a full head).
//      "6 tbsp + 4 tbsp" → 10 tbsp (not a clean cup fraction → stays).
//      "6 tbsp + 6 tbsp" → 12 tbsp → 3/4 cup (clean).
const UNIT_CONVERSIONS = [
  {
    smaller: 'tsp', larger: 'tbsp', ratio: 3,
    // Only when the total is a clean multiple of 3 tsp
    upConvert: (total) => (total >= 3 && total % 3 === 0) ? total / 3 : null,
  },
  {
    smaller: 'tbsp', larger: 'cup', ratio: 16,
    // Only at half-cup or larger AND a clean quarter-cup multiple
    upConvert: (total) => (total >= 8 && total % 4 === 0) ? total / 16 : null,
  },
  {
    smaller: 'oz', larger: 'lb', ratio: 16,
    // Only at one pound or more AND a clean half-pound multiple
    upConvert: (total) => (total >= 16 && total % 8 === 0) ? total / 16 : null,
  },
  {
    smaller: 'clove', larger: 'head', ratio: 10,
    // At 10+ cloves, round to the nearest half-head — what shoppers buy
    upConvert: (total) => total >= 10 ? Math.round(total * 2 / 10) / 2 : null,
  },
];

// Take a list of {qty, unit} pairs (possibly across different units for the
// same ingredient) and return a simplified list with cross-unit quantities
// merged via UNIT_CONVERSIONS, plus optional up-conversion to a larger unit.
// Quantities with qty === null are passed through untouched.
function harmonizeQuantities(quantities) {
  // Step 1: split into "measured" (qty != null) and "unmeasured" (qty == null)
  let measured = quantities.filter(q => q.qty !== null).map(q => ({ ...q }));
  const unmeasured = quantities.filter(q => q.qty === null);

  // Step 2: down-convert larger units to smaller for any rule where both
  // units are present, so summing is meaningful.
  for (const conv of UNIT_CONVERSIONS) {
    const hasSmaller = measured.some(q => q.unit === conv.smaller);
    const hasLarger = measured.some(q => q.unit === conv.larger);
    if (hasSmaller && hasLarger) {
      measured = measured.map(q =>
        q.unit === conv.larger ? { qty: q.qty * conv.ratio, unit: conv.smaller } : q
      );
    }
  }

  // Step 3: sum within each unit
  const totals = new Map(); // unit -> total qty
  for (const q of measured) {
    totals.set(q.unit, (totals.get(q.unit) || 0) + q.qty);
  }

  // Step 4: up-convert when the total is a "clean" amount in the larger unit
  for (const conv of UNIT_CONVERSIONS) {
    const total = totals.get(conv.smaller);
    if (total == null) continue;
    const largerQty = conv.upConvert(total);
    if (largerQty != null) {
      totals.delete(conv.smaller);
      totals.set(conv.larger, (totals.get(conv.larger) || 0) + largerQty);
    }
  }

  // Step 5: return as a quantities array
  const result = Array.from(totals.entries()).map(([unit, qty]) => ({ qty, unit }));
  // Preserve unmeasured entries so the display still notes them somehow
  return [...result, ...unmeasured];
}

function buildDisplayText(entry, suppressQty = false) {
  const { name, quantities } = entry;
  if (suppressQty) return name;

  // Harmonize cross-unit quantities (e.g. cloves + heads → heads)
  const harmonized = harmonizeQuantities(quantities);

  const parts = [];
  for (const q of harmonized) {
    if (q.qty === null) continue; // unmeasured entries don't add a quantity to the display
    const total = q.qty;
    const formatted = formatQuantity(total);
    if (q.unit) {
      const displayUnit = total > 1 ? pluralizeUnit(q.unit) : q.unit;
      parts.push(`${formatted} ${displayUnit}`);
    } else {
      parts.push(formatted);
    }
  }

  if (parts.length === 0) return name;
  return `${parts.join(' + ')} ${name}`;
}

function pluralizeUnit(unit) {
  if (unit === 'oz' || unit === 'tbsp' || unit === 'tsp' || unit === 'lb') return unit;
  return unit + 's';
}

// Items always on hand — never add to grocery list
function isAlwaysOnHand(key) {
  // Salt in any form
  if (/^(kosher |sea |flaky |table |fine |coarse |seasoning )?salt\b/.test(key)) return true;
  // Pepper in any form
  if (/^(black |white |cracked |ground |freshly ground )?pepper$/.test(key)) return true;
  // Combined "salt and pepper"
  if (/salt\s+and\s+(black\s+)?pepper/.test(key)) return true;
  // Water
  if (/^(warm |cold |hot |ice |boiling |room temperature )?water$/.test(key)) return true;
  return false;
}

function categorizeIngredient(ing) {
  const lower = ing.toLowerCase();

  // Check multi-word overrides first (resolves conflicts like "garlic bread" → pantry not produce)
  const overrides = [
    ['garlic bread', 'pantry'], ['garlic salt', 'spices'], ['garlic powder', 'spices'],
    ['onion powder', 'spices'], ['onion ring', 'pantry'],
    ['tomato paste', 'pantry'], ['tomato sauce', 'pantry'], ['diced tomato', 'pantry'], ['crushed tomato', 'pantry'],
    ['coconut milk', 'pantry'], ['coconut oil', 'pantry'], ['coconut cream', 'pantry'],
    ['lemon juice', 'pantry'], ['lime juice', 'pantry'],
    ['cream of mushroom', 'pantry'], ['cream of chicken', 'pantry'],
    ['chicken stock', 'pantry'], ['chicken broth', 'pantry'], ['beef stock', 'pantry'], ['beef broth', 'pantry'],
    ['vegetable stock', 'pantry'], ['vegetable broth', 'pantry'],
    ['peanut butter', 'pantry'], ['almond butter', 'pantry'],
    ['soy sauce', 'pantry'], ['fish sauce', 'pantry'], ['hot sauce', 'pantry'], ['chili-garlic sauce', 'pantry'], ['chili garlic sauce', 'pantry'],
    ['hamburger bun', 'pantry'], ['hot dog bun', 'pantry'],
    ['red pepper flake', 'spices'], ['red-pepper flake', 'spices'],
    ['provolone', 'dairy'], ['pecorino', 'dairy'], ['romano', 'dairy'],
    ['sesame seed', 'pantry'], ['sesame seeds', 'pantry'], ['peanut', 'pantry'], ['peanuts', 'pantry'],
    ['walnut', 'pantry'], ['walnuts', 'pantry'], ['almond', 'pantry'], ['almonds', 'pantry'], ['pecan', 'pantry'], ['pecans', 'pantry'], ['cashew', 'pantry'], ['pine nut', 'pantry'],
    ['mixed greens', 'produce'], ['greens', 'produce'],
    ['sriracha', 'pantry'], ['molasses', 'pantry'], ['maple syrup', 'pantry'],
    ['chipotle', 'pantry'], ['adobo', 'pantry'],
    ['cornstarch', 'pantry'],
    ['lard', 'pantry'], ['shortening', 'pantry'],
    ['white wine', 'pantry'], ['red wine', 'pantry'], ['cooking wine', 'pantry'], ['wine', 'pantry'],
  ];
  for (const [phrase, cat] of overrides) {
    if (lower.includes(phrase)) return cat;
  }

  const meatWords = ['chicken', 'beef', 'pork', 'sausage', 'salmon', 'fish', 'bacon', 'turkey', 'shrimp', 'cod', 'tilapia', 'hot dog', 'meatball', 'ground beef', 'stew meat', 'pepperoni', 'ham', 'steak', 'tofu', 'tempeh', 'seitan', 'lamb', 'veal', 'brisket', 'ribs', 'flank', 'sirloin', 'tenderloin', 'mahi', 'halibut', 'tuna', 'crab', 'lobster', 'scallop', 'clam', 'mussel', 'anchov', 'prosciutto', 'chorizo', 'bratwurst', 'kielbasa'];
  const dairyWords = ['cheese', 'milk', 'butter', 'cream', 'egg', 'eggs', 'yogurt', 'sour cream', 'mozzarella', 'parmesan', 'cheddar', 'gruyere', 'ricotta', 'fontina', 'provolone', 'pecorino', 'romano'];
  const produceWords = ['lettuce', 'tomato', 'onion', 'garlic', 'pepper', 'broccoli', 'broccolini', 'carrot', 'celery', 'spinach', 'basil', 'cilantro', 'parsley', 'lime', 'lemon', 'avocado', 'potato', 'mushroom', 'corn', 'peas', 'snap pea', 'green onion', 'ginger', 'romaine', 'cherry tomato', 'bell pepper', 'jalape', 'zucchini', 'cucumber', 'cabbage', 'kale', 'arugula', 'scallion', 'shallot', 'sweet potato', 'asparagus', 'coleslaw', 'chive', 'cauliflower', 'fennel', 'radish', 'turnip', 'beet', 'bok choy', 'watercress', 'endive', 'leek'];
  const spiceWords = ['cumin', 'paprika', 'thyme', 'oregano', 'cinnamon', 'seasoning', 'spice', 'taco seasoning', 'chili powder', 'italian seasoning', 'garam masala', 'turmeric', 'cayenne', 'bay leaves', 'nutmeg', 'coriander', 'cardamom', 'cloves', 'allspice', 'curry powder', 'red pepper flake', 'smoked paprika', 'dried basil', 'dried parsley', 'rosemary', 'dill'];
  const pantryWords = ['flour', 'sugar', 'oil', 'vinegar', 'sauce', 'broth', 'stock', 'soy sauce', 'honey', 'mustard', 'ketchup', 'mayo', 'mayonnaise', 'pasta', 'rice', 'noodle', 'bread', 'tortilla', 'can ', 'canned', 'beans', 'panko', 'breadcrumb', 'cornstarch', 'baking', 'worcestershire', 'ranch', 'enchilada sauce', 'pizza sauce', 'marinara', 'pesto', 'bbq', 'naan', 'flatbread', 'crescent roll', 'pie crust', 'pizza dough', 'cornmeal', 'molasses', 'maple syrup', 'sriracha', 'bun', 'taco shell'];

  for (const word of meatWords) {
    if (lower.includes(word)) return 'meat';
  }
  for (const word of dairyWords) {
    if (lower.includes(word)) return 'dairy';
  }
  for (const word of produceWords) {
    if (lower.includes(word)) return 'produce';
  }
  for (const word of spiceWords) {
    if (lower.includes(word)) return 'spices';
  }
  for (const word of pantryWords) {
    if (lower.includes(word)) return 'pantry';
  }
  return 'other';
}

// === Text output for copy/share ===

function buildGroceryText(meals) {
  const groups = aggregateIngredients(meals);
  const lines = [];

  // Meal plan summary
  lines.push('MEAL PLAN');
  lines.push('-'.repeat(30));
  for (const m of meals) {
    if (m.type === 'skip') {
      lines.push(`${m.day}: Skipped`);
    } else if (m.type === 'leftovers') {
      lines.push(`${m.day}: Leftovers`);
    } else {
      let line = `${m.day}: ${m.recipe.name}`;
      if (m.sides) line += ` + ${m.sides}`;
      lines.push(line);
    }
  }
  lines.push('');

  // Grocery list (respect edits, deletes, and checks)
  // Checked items are treated as "I already have this" and excluded
  // from the copied output, matching how deletes already work.
  const editsKey = `grocery_edits_${currentWeekKey}`;
  const edits = JSON.parse(localStorage.getItem(editsKey) || '{}');
  const deletesKey = `grocery_deletes_${currentWeekKey}`;
  const deletes = JSON.parse(localStorage.getItem(deletesKey) || '{}');
  const checkedKey = `grocery_checked_${currentWeekKey}`;
  const checked = JSON.parse(localStorage.getItem(checkedKey) || '{}');

  lines.push('GROCERY LIST');
  lines.push('-'.repeat(30));
  for (const [category, items] of groups) {
    const visible = items.filter(item => !deletes[item.key] && !checked[item.key]);
    if (!visible.length) continue;
    if (category) {
      lines.push('');
      lines.push(category.toUpperCase());
    }
    for (const item of visible) {
      const displayText = edits[item.key] || item.display;
      let line = `[ ] ${displayText}  (${item.meals.join(', ')})`;
      lines.push(line);
    }
  }

  // Extra items (also exclude checked)
  if (extraItems.length) {
    const extrasCheckedKey = currentWeekKey ? `grocery_extras_checked_${currentWeekKey}` : 'grocery_extras_checked';
    const extrasChecked = JSON.parse(localStorage.getItem(extrasCheckedKey) || '{}');
    const visibleExtras = extraItems.filter((_, idx) => !extrasChecked[idx]);
    if (visibleExtras.length) {
      lines.push('');
      lines.push('EXTRA ITEMS');
      for (const item of visibleExtras) {
        lines.push(`[ ] ${item}`);
      }
    }
  }

  return lines.join('\n');
}

export function getGroceryText() {
  if (!lastMeals && !extraItems.length) return '';
  if (!lastMeals) {
    return extraItems.length
      ? 'EXTRA ITEMS\n' + extraItems.map(i => `[ ] ${i}`).join('\n')
      : '';
  }
  return buildGroceryText(lastMeals);
}

export function getPlanSummary() {
  if (!lastMeals) return '';
  return lastMeals
    .filter(m => m.type === 'meal')
    .map(m => `${m.day}: ${m.recipe.name}${m.sides ? ' + ' + m.sides : ''}`)
    .join('\n');
}

export function clearChecked() {
  if (!currentWeekKey) return;
  localStorage.removeItem(`grocery_checked_${currentWeekKey}`);
}

// === Extra grocery items ===

let extraItems = [];

export async function loadAndRenderExtras(container) {
  extraItems = await loadGroceryExtras();
  renderExtras(container);
}

function renderExtras(container) {
  const storageKey = currentWeekKey ? `grocery_extras_checked_${currentWeekKey}` : 'grocery_extras_checked';
  const checked = JSON.parse(localStorage.getItem(storageKey) || '{}');

  if (!extraItems.length) {
    container.innerHTML = '<p class="grocery-extras-empty">No extra items yet. Add staples like eggs, milk, or bread.</p>';
    return;
  }

  container.innerHTML = `<ul class="grocery-checklist-items">${extraItems.map((item, idx) => {
    const isChecked = checked[idx] ? 'checked' : '';
    const checkedClass = checked[idx] ? ' checked' : '';
    return `<li>
      <label class="grocery-check${checkedClass}">
        <input type="checkbox" data-extra-idx="${idx}" ${isChecked}>
        <span class="grocery-item-text">${escHtml(item)}</span>
      </label>
      <button class="extra-remove-btn" data-extra-idx="${idx}" title="Remove">&times;</button>
    </li>`;
  }).join('')}</ul>`;

  // Checkboxes
  container.querySelectorAll('.grocery-check input').forEach(cb => {
    cb.addEventListener('change', () => {
      cb.closest('label').classList.toggle('checked', cb.checked);
      const state = JSON.parse(localStorage.getItem(storageKey) || '{}');
      if (cb.checked) { state[cb.dataset.extraIdx] = true; } else { delete state[cb.dataset.extraIdx]; }
      localStorage.setItem(storageKey, JSON.stringify(state));
    });
  });

  // Remove buttons
  container.querySelectorAll('.extra-remove-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      extraItems.splice(parseInt(btn.dataset.extraIdx), 1);
      await saveGroceryExtras(extraItems);
      renderExtras(container);
    });
  });
}

export async function addExtraItem(item, container) {
  if (!item.trim()) return;
  extraItems.push(item.trim());
  await saveGroceryExtras(extraItems);
  renderExtras(container);
}

export function getExtraItems() {
  return extraItems;
}

function escHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

function escAttr(str) {
  return (str || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
