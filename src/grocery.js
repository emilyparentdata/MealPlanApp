import { loadCommittedPlan } from './firebase.js';
import { getRecipeByUid } from './recipes.js';
import { getWeekKey, getWeekLabel } from './planner.js';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export async function renderGroceryList(container, weekLabelEl) {
  const weekKey = getWeekKey();
  weekLabelEl.textContent = getWeekLabel();

  const plan = await loadCommittedPlan(weekKey);
  container.innerHTML = '';

  if (!plan || !plan.days) {
    container.innerHTML = '<p style="color:var(--text-light);">No committed plan for this week.</p>';
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
    container.innerHTML = '<p style="color:var(--text-light);">No meals planned this week.</p>';
    return;
  }

  // Render day-by-day with ingredients
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
          ? `<ul class="grocery-ingredients">${ingredients.map((ing, idx) =>
              `<li><label class="grocery-check"><input type="checkbox" data-day="${m.day}" data-idx="${idx}"><span>${escHtml(ing)}</span></label></li>`
            ).join('')}</ul>`
          : '<p class="grocery-no-ingredients">No ingredient list available</p>'}
      </div>`;
    }
  }

  container.innerHTML = html;

  // Restore checked state from sessionStorage
  const checkedKey = `grocery_checked_${weekKey}`;
  const checked = JSON.parse(sessionStorage.getItem(checkedKey) || '{}');
  container.querySelectorAll('.grocery-check input').forEach(cb => {
    const key = `${cb.dataset.day}_${cb.dataset.idx}`;
    if (checked[key]) {
      cb.checked = true;
      cb.closest('label').classList.add('checked');
    }
    cb.addEventListener('change', () => {
      cb.closest('label').classList.toggle('checked', cb.checked);
      const state = JSON.parse(sessionStorage.getItem(checkedKey) || '{}');
      const k = `${cb.dataset.day}_${cb.dataset.idx}`;
      if (cb.checked) { state[k] = true; } else { delete state[k]; }
      sessionStorage.setItem(checkedKey, JSON.stringify(state));
    });
  });

  // Store text version for copy/email
  container.dataset.fullText = buildFullText(meals);
}

function buildFullText(meals) {
  const lines = [];
  for (const m of meals) {
    if (m.type === 'skip') {
      lines.push(`${m.day}: Skipped`);
    } else {
      let header = `${m.day}: ${m.recipe.name}`;
      if (m.sides) header += ` + ${m.sides}`;
      lines.push(header);
      if (m.recipe.ingredients) {
        const ingredients = m.recipe.ingredients.split('\n').map(l => l.trim()).filter(Boolean);
        for (const i of ingredients) {
          lines.push(`  - ${i}`);
        }
      }
      lines.push('');
    }
  }
  return lines.join('\n');
}

export function getGroceryText() {
  const container = document.getElementById('grocery-list');
  return container.dataset.fullText || '';
}

export function getPlanSummary() {
  return getGroceryText();
}

function escHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}
