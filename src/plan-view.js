import { loadCommittedPlan } from './firebase.js';
import { getRecipeByUid } from './recipes.js';
import { getWeekKey, getWeekLabel } from './planner.js';
import { getConvenienceLabel } from './convenience.js';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function isCurrentWeek(weekKey) {
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(now.getFullYear(), now.getMonth(), diff);
  return weekKey === monday.toISOString().slice(0, 10);
}

function isPastWeek(weekKey) {
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(now.getFullYear(), now.getMonth(), diff);
  return new Date(weekKey + 'T00:00:00') < monday;
}

export async function renderPlanView(gridContainer, weekLabelEl, weekKeyOverride, weekLabelOverride, onMealClick, onFeedbackClick) {
  const weekKey = weekKeyOverride || getWeekKey();
  weekLabelEl.textContent = weekLabelOverride || getWeekLabel();

  const plan = await loadCommittedPlan(weekKey);
  gridContainer.innerHTML = '';

  if (!plan || !plan.days) {
    const current = isCurrentWeek(weekKey);
    const past = isPastWeek(weekKey);

    if (current) {
      gridContainer.innerHTML = `
        <div class="smart-landing">
          <h3>This week's meals aren't planned yet</h3>
          <p>Set up your dinners for the week — it only takes a minute.</p>
          <button class="btn primary large" data-navigate="planner">Plan This Week</button>
        </div>
      `;
    } else if (past) {
      gridContainer.innerHTML = `
        <div class="empty-state-card">
          <p>No meal plan was saved for this week.</p>
        </div>
      `;
    } else {
      gridContainer.innerHTML = `
        <div class="empty-state-card">
          <p>No meal plan for this week yet.</p>
          <button class="btn primary" data-navigate="planner">Plan This Week</button>
        </div>
      `;
    }
    return;
  }

  const monday = new Date(weekKey + 'T00:00:00');

  for (let i = 0; i < 7; i++) {
    const dayDate = new Date(monday);
    dayDate.setDate(dayDate.getDate() + i);
    const dayName = DAYS[i];
    const dayData = plan.days[dayName] || {};

    const card = document.createElement('div');
    const isSkip = dayData.skip === true || dayData.skip === 'skip';
    const isLeftovers = dayData.skip === 'leftovers';
    card.className = `plan-day-card${isSkip ? ' skip' : ''}${isLeftovers ? ' leftovers' : ''}`;

    const recipe = dayData.recipeUid ? getRecipeByUid(dayData.recipeUid) : null;
    const mealName = isSkip ? 'Skipped'
      : isLeftovers ? 'Leftovers'
      : (recipe ? recipe.name : 'No meal planned');

    const flags = [];
    // Back-compat: old plans had a boolean makeAhead field; new plans use convenience.
    const conv = dayData.convenience || (dayData.makeAhead ? 'make-ahead' : '');
    if (conv) flags.push(getConvenienceLabel(conv));

    const sides = dayData.sides ? `<span class="meal-sides">+ ${escHtml(dayData.sides)}</span>` : '';

    card.innerHTML = `
      <span class="day-name">${dayName}</span>
      <span class="meal-name">${escHtml(mealName)}${sides}</span>
      <div class="meal-flags">
        ${flags.map(f => `<span class="flag-chip">${f}</span>`).join('')}
      </div>
      ${recipe ? '<button class="feedback-btn">Notes</button>' : ''}
    `;

    if (recipe && onFeedbackClick) {
      const fbBtn = card.querySelector('.feedback-btn');
      if (fbBtn) {
        fbBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          onFeedbackClick(recipe, dayData);
        });
      }
    }

    if (recipe && onMealClick) {
      const nameEl = card.querySelector('.meal-name');
      nameEl.style.cursor = 'pointer';
      nameEl.style.color = 'var(--primary)';
      nameEl.addEventListener('mouseenter', () => nameEl.style.textDecoration = 'underline');
      nameEl.addEventListener('mouseleave', () => nameEl.style.textDecoration = 'none');
      nameEl.addEventListener('click', (e) => {
        e.stopPropagation();
        onMealClick(recipe);
      });
    }

    gridContainer.appendChild(card);
  }
}

function escHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}
