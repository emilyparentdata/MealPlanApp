import { loadCommittedPlan } from './firebase.js';
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
    checklistContainer.innerHTML = '<p style="color:var(--text-light);padding:1rem;">No committed plan for this week.</p>';
    return;
  }

  // Collect meals for each day
  const meals = [];
  for (const day of DAYS) {
    const dayData = plan.days[day];
    if (!dayData) continue;
    if (dayData.skip) {
      meals.push({ day, type: 'skip' });
    } else if (dayData.recipeUid) {
      const recipe = getRecipeByUid(dayData.recipeUid);
      if (recipe) {
        meals.push({ day, type: 'meal', recipe, sides: dayData.sides || '' });
      }
    }
  }

  if (!meals.filter(m => m.type === 'meal').length) {
    checklistContainer.innerHTML = '<p style="color:var(--text-light);padding:1rem;">No meals planned this week.</p>';
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

  let html = '';
  for (const [category, items] of groups) {
    html += `<div class="grocery-category">`;
    if (category) {
      html += `<h3 class="grocery-category-label">${escHtml(category)}</h3>`;
    }
    html += `<ul class="grocery-checklist-items">`;
    for (const item of items) {
      const key = item.key;
      const isChecked = checked[key] ? 'checked' : '';
      const checkedClass = checked[key] ? ' checked' : '';
      const mealNote = item.meals.length > 1 ? `<span class="grocery-meal-note">${item.meals.map(escHtml).join(', ')}</span>` : '';
      html += `<li>
        <label class="grocery-check${checkedClass}">
          <input type="checkbox" data-key="${escAttr(key)}" ${isChecked}>
          <span class="grocery-item-text">${escHtml(item.display)}</span>
          ${mealNote}
        </label>
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
    } else {
      const sides = m.sides ? `<span class="meal-sides">+ ${escHtml(m.sides)}</span>` : '';
      const ingredients = m.recipe.ingredients
        ? m.recipe.ingredients.split('\n').map(l => l.trim()).filter(Boolean)
        : [];

      html += `<div class="grocery-day">
        <h3>${m.day}</h3>
        <div class="grocery-meal-name">${escHtml(m.recipe.name)}${sides}</div>
        ${ingredients.length
          ? `<ul class="grocery-ingredients">${ingredients.map(i => `<li>${escHtml(i)}</li>`).join('')}</ul>`
          : '<p class="grocery-no-ingredients">No ingredient list available</p>'}
      </div>`;
    }
  }
  container.innerHTML = html;
}

// === Ingredient aggregation ===

function aggregateIngredients(meals) {
  const ingredientMap = new Map(); // normalized key -> { display, meals[], key }

  for (const m of meals) {
    if (m.type !== 'meal' || !m.recipe.ingredients) continue;
    const ingredients = m.recipe.ingredients.split('\n').map(l => l.trim()).filter(Boolean);
    for (const ing of ingredients) {
      const norm = normalizeIngredient(ing);
      if (ingredientMap.has(norm)) {
        const entry = ingredientMap.get(norm);
        if (!entry.meals.includes(m.recipe.name)) {
          entry.meals.push(m.recipe.name);
        }
      } else {
        ingredientMap.set(norm, {
          display: ing,
          meals: [m.recipe.name],
          key: norm,
        });
      }
    }
  }

  // Group by rough category based on common grocery store sections
  const produce = [];
  const dairy = [];
  const meat = [];
  const pantry = [];
  const other = [];

  for (const [, item] of ingredientMap) {
    const section = categorizeIngredient(item.display);
    if (section === 'produce') produce.push(item);
    else if (section === 'dairy') dairy.push(item);
    else if (section === 'meat') meat.push(item);
    else if (section === 'pantry') pantry.push(item);
    else other.push(item);
  }

  const groups = [];
  if (produce.length) groups.push(['Produce', produce]);
  if (meat.length) groups.push(['Meat & Seafood', meat]);
  if (dairy.length) groups.push(['Dairy & Eggs', dairy]);
  if (pantry.length) groups.push(['Pantry', pantry]);
  if (other.length) groups.push(['Other', other]);

  // If we couldn't categorize well (everything in 'other'), just show one flat list
  if (groups.length === 1 && groups[0][0] === 'Other') {
    return [['', other]];
  }

  return groups;
}

function normalizeIngredient(ing) {
  return ing
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/^\s*[\d\s\/\.]+/, '')
    .replace(/^(cups?|tbsp|tsp|tablespoons?|teaspoons?|oz|ounces?|lbs?|pounds?|cloves?|cans?|packages?|packets?|slices?|heads?|stalks?|sprigs?|pinch(es)?|bunch(es)?|handful|large|medium|small|of)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function categorizeIngredient(ing) {
  const lower = ing.toLowerCase();
  const produceWords = ['lettuce', 'tomato', 'onion', 'garlic', 'pepper', 'broccoli', 'carrot', 'celery', 'spinach', 'basil', 'cilantro', 'parsley', 'lime', 'lemon', 'avocado', 'potato', 'mushroom', 'corn', 'peas', 'snap pea', 'green onion', 'ginger', 'romaine', 'cherry tomato', 'bell pepper', 'jalape'];
  const dairyWords = ['cheese', 'milk', 'butter', 'cream', 'egg', 'eggs', 'yogurt', 'sour cream', 'mozzarella', 'parmesan', 'cheddar', 'gruyere', 'ricotta', 'fontina'];
  const meatWords = ['chicken', 'beef', 'pork', 'sausage', 'salmon', 'fish', 'bacon', 'turkey', 'shrimp', 'cod', 'tilapia', 'hot dog', 'meatball', 'ground beef', 'stew meat', 'pepperoni', 'ham'];
  const pantryWords = ['flour', 'sugar', 'oil', 'vinegar', 'sauce', 'broth', 'stock', 'salt', 'pepper', 'seasoning', 'spice', 'cumin', 'paprika', 'thyme', 'oregano', 'cinnamon', 'soy sauce', 'honey', 'mustard', 'ketchup', 'mayo', 'pasta', 'rice', 'noodle', 'bread', 'tortilla', 'can ', 'canned', 'beans', 'tomato paste', 'tomato sauce', 'diced tomato', 'crushed tomato', 'panko', 'breadcrumb', 'cornstarch', 'baking', 'worcestershire', 'ranch', 'enchilada sauce', 'pizza sauce', 'marinara', 'pesto', 'bbq', 'taco seasoning', 'chili powder', 'italian seasoning', 'garam masala', 'turmeric', 'cayenne', 'bay leaves', 'naan', 'flatbread', 'crescent roll', 'pie crust', 'pizza dough', 'cornmeal'];

  for (const word of meatWords) {
    if (lower.includes(word)) return 'meat';
  }
  for (const word of dairyWords) {
    if (lower.includes(word)) return 'dairy';
  }
  for (const word of produceWords) {
    if (lower.includes(word)) return 'produce';
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
    } else {
      let line = `${m.day}: ${m.recipe.name}`;
      if (m.sides) line += ` + ${m.sides}`;
      lines.push(line);
    }
  }
  lines.push('');

  // Grocery list
  lines.push('GROCERY LIST');
  lines.push('-'.repeat(30));
  for (const [category, items] of groups) {
    if (category) {
      lines.push('');
      lines.push(category.toUpperCase());
    }
    for (const item of items) {
      let line = `[ ] ${item.display}`;
      if (item.meals.length > 1) {
        line += `  (${item.meals.join(', ')})`;
      }
      lines.push(line);
    }
  }

  return lines.join('\n');
}

export function getGroceryText() {
  if (!lastMeals) return '';
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

function escHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

function escAttr(str) {
  return (str || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
