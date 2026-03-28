import { loadCommittedPlan, loadGroceryExtras, saveGroceryExtras } from './firebase.js';
import { getRecipeByUid } from './recipes.js';
import { getWeekKey, getWeekLabel } from './planner.js';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

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
  for (const day of DAYS) {
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

const PREP_WORDS = /\b(finely|roughly|thinly|freshly|lightly|well)?\s*-?\s*(diced|chopped|minced|sliced|grated|shredded|crushed|julienned|cubed|halved|quartered|trimmed|peeled|seeded|deveined|deboned|thawed|frozen|fresh|dried|ground|cooked|uncooked|warm|warmed|cold|softened|melted|room temperature|to taste|optional|divided|packed|sifted|beaten|whisked|juiced|zested|squeezed|rinsed|drained|pitted|cored|stemmed|cleaned|washed|torn|cut into.*|about|toasted|roasted|unsalted|low-sodium|low sodium|reduced-sodium|boneless|skinless|skin-on|bone-in|thin-cut|thick-cut|store-bought|good-quality|pickled|smoked)\b/gi;

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
    .replace(/,?\s*for\s+(serving|garnish|topping|dipping|drizzling)s?$/i, '')  // "for serving" etc.
    .replace(/,?\s*and\s+more\s+for\s+.*$/i, '')  // "and more for serving"
    .replace(/,?\s*plus\s+more\s+.*$/i, '')        // "plus more for drizzling"
    .replace(/,?\s*or\s+to\s+taste$/i, '')         // "or to taste"
    .replace(/,?\s*as\s+needed$/i, '')             // "as needed"
    .replace(/\s+or\s+other\s+[\w\s]+$/i, '')      // "or other sweetener"
    .replace(/\s+or\s+[\w\s]{2,}$/i, '')           // "or tamari", "or fish sauce" — strip alternatives (2+ chars to avoid stripping single words that are the ingredient)
    .replace(/,?\s*and\s*$/i, '')                  // trailing ", and" or "and"
    .replace(/,?\s*plus\s+\d.*$/i, '')             // "plus 2 tablespoons adobo sauce"
    .replace(/,?\s*plus\s+additional.*$/i, '')     // "plus additional"
    .replace(/,\s*,/g, ',')       // collapse double commas
    .replace(/^[,\s]+/, '')        // leading commas/spaces
    .replace(/[,\s]+$/, '')        // trailing commas/spaces
    .replace(/\s+/g, ' ')
    .trim();

  // Build a normalized key (lowercase, no punctuation)
  const key = name.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();

  return { qty, unit, name, key };
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
        if (isSaltOrPepper(parsed.key)) continue;
        addToMap(ingredientMap, parsed.key, parsed.name, parsed.qty, parsed.unit, m.recipe.name, m.servings || 1);
      }
    }

    // Process sides (e.g. "rice, salad, bread")
    if (m.sides) {
      const sideItems = m.sides.split(',').map(s => s.trim()).filter(Boolean);
      const mealLabel = `${m.recipe.name} (${m.day})`;
      for (const side of sideItems) {
        const key = side.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
        if (!key) continue;
        addToMap(ingredientMap, key, side, null, '', mealLabel);
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
    const section = categorizeIngredient(entry.name);
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

function buildDisplayText(entry, suppressQty = false) {
  const { name, quantities } = entry;
  if (suppressQty) return name;

  // Group quantities by unit
  const byUnit = new Map();
  for (const q of quantities) {
    const u = q.unit || '';
    if (!byUnit.has(u)) byUnit.set(u, []);
    byUnit.get(u).push(q.qty);
  }

  const parts = [];
  for (const [unit, qtys] of byUnit) {
    const validQtys = qtys.filter(q => q !== null);
    if (validQtys.length === 0) {
      // No quantities at all for this unit group — skip the quantity
      continue;
    }
    const total = validQtys.reduce((sum, q) => sum + q, 0);
    const formatted = formatQuantity(total);
    if (unit) {
      // Pluralize unit if needed
      const displayUnit = total > 1 ? pluralizeUnit(unit) : unit;
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

// Salt and pepper are always in the house — never add to grocery list
function isSaltOrPepper(key) {
  // Any form of just salt or pepper
  if (/^(kosher |sea |flaky |table |fine |coarse |seasoning )?salt\b/.test(key)) return true;
  if (/^(black |white |cracked |ground |freshly ground )?pepper$/.test(key)) return true;
  // Combined "salt and pepper" in any form
  if (/salt\s+and\s+(black\s+)?pepper/.test(key)) return true;
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
    ['peanut butter', 'pantry'], ['almond butter', 'pantry'],
    ['soy sauce', 'pantry'], ['fish sauce', 'pantry'], ['hot sauce', 'pantry'], ['chili-garlic sauce', 'pantry'], ['chili garlic sauce', 'pantry'],
    ['hamburger bun', 'pantry'], ['hot dog bun', 'pantry'],
    ['red pepper flake', 'spices'],
    ['provolone', 'dairy'], ['pecorino', 'dairy'], ['romano', 'dairy'],
    ['sesame seed', 'pantry'], ['sesame seeds', 'pantry'], ['peanut', 'pantry'], ['peanuts', 'pantry'],
    ['mixed greens', 'produce'], ['greens', 'produce'],
    ['sriracha', 'pantry'], ['molasses', 'pantry'], ['maple syrup', 'pantry'],
    ['chipotle', 'pantry'], ['adobo', 'pantry'],
    ['cornstarch', 'pantry'],
  ];
  for (const [phrase, cat] of overrides) {
    if (lower.includes(phrase)) return cat;
  }

  const meatWords = ['chicken', 'beef', 'pork', 'sausage', 'salmon', 'fish', 'bacon', 'turkey', 'shrimp', 'cod', 'tilapia', 'hot dog', 'meatball', 'ground beef', 'stew meat', 'pepperoni', 'ham', 'steak', 'tofu', 'tempeh', 'seitan', 'lamb', 'veal', 'brisket', 'ribs', 'flank', 'sirloin', 'tenderloin', 'mahi', 'halibut', 'tuna', 'crab', 'lobster', 'scallop', 'clam', 'mussel', 'anchov', 'prosciutto', 'chorizo', 'bratwurst', 'kielbasa'];
  const dairyWords = ['cheese', 'milk', 'butter', 'cream', 'egg', 'eggs', 'yogurt', 'sour cream', 'mozzarella', 'parmesan', 'cheddar', 'gruyere', 'ricotta', 'fontina', 'provolone', 'pecorino', 'romano'];
  const produceWords = ['lettuce', 'tomato', 'onion', 'garlic', 'pepper', 'broccoli', 'broccolini', 'carrot', 'celery', 'spinach', 'basil', 'cilantro', 'parsley', 'lime', 'lemon', 'avocado', 'potato', 'mushroom', 'corn', 'peas', 'snap pea', 'green onion', 'ginger', 'romaine', 'cherry tomato', 'bell pepper', 'jalape', 'zucchini', 'cucumber', 'cabbage', 'kale', 'arugula', 'scallion', 'shallot', 'sweet potato', 'asparagus', 'coleslaw'];
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

  // Grocery list (respect edits and deletes)
  const editsKey = `grocery_edits_${currentWeekKey}`;
  const edits = JSON.parse(localStorage.getItem(editsKey) || '{}');
  const deletesKey = `grocery_deletes_${currentWeekKey}`;
  const deletes = JSON.parse(localStorage.getItem(deletesKey) || '{}');

  lines.push('GROCERY LIST');
  lines.push('-'.repeat(30));
  for (const [category, items] of groups) {
    const visible = items.filter(item => !deletes[item.key]);
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

  // Extra items
  if (extraItems.length) {
    lines.push('');
    lines.push('EXTRA ITEMS');
    for (const item of extraItems) {
      lines.push(`[ ] ${item}`);
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
