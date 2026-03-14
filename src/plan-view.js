import { loadCommittedPlan } from './firebase.js';
import { getRecipeByUid } from './recipes.js';
import { getWeekKey, getWeekLabel } from './planner.js';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export async function renderPlanView(gridContainer, weekLabelEl, weekKeyOverride, weekLabelOverride, onMealClick) {
  const weekKey = weekKeyOverride || getWeekKey();
  weekLabelEl.textContent = weekLabelOverride || getWeekLabel();

  const plan = await loadCommittedPlan(weekKey);
  gridContainer.innerHTML = '';

  if (!plan || !plan.days) {
    gridContainer.innerHTML = '<p style="color:var(--text-light);padding:2rem;">No committed plan for this week. Go to "Plan Week", set it up, and hit "Commit This Plan".</p>';
    return;
  }

  const monday = new Date(weekKey + 'T00:00:00');

  for (let i = 0; i < 7; i++) {
    const dayDate = new Date(monday);
    dayDate.setDate(dayDate.getDate() + i);
    const dayName = DAYS[i];
    const dayData = plan.days[dayName] || {};

    const card = document.createElement('div');
    card.className = `plan-day-card${dayData.skip ? ' skip' : ''}`;

    const recipe = dayData.recipeUid ? getRecipeByUid(dayData.recipeUid) : null;
    const mealName = dayData.skip ? 'Skipped'
      : (recipe ? recipe.name : 'No meal planned');

    const flags = [];
    if (dayData.makeAhead) flags.push('Make ahead');

    const sides = dayData.sides ? `<span class="meal-sides">+ ${escHtml(dayData.sides)}</span>` : '';

    card.innerHTML = `
      <span class="day-name">${dayName}</span>
      <span class="meal-name">${recipe && onMealClick ? `<span class="meal-link" style="cursor:pointer;color:var(--primary);text-decoration:none;" onmouseenter="this.style.textDecoration='underline'" onmouseleave="this.style.textDecoration='none'">${escHtml(mealName)}</span>` : escHtml(mealName)}${sides}</span>
      <div class="meal-flags">
        ${flags.map(f => `<span class="flag-chip">${f}</span>`).join('')}
      </div>
    `;

    if (recipe && onMealClick) {
      card.querySelector('.meal-link').addEventListener('click', () => onMealClick(recipe));
    }

    gridContainer.appendChild(card);
  }
}

function escHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}
