import { loadCommittedPlan, loadComments, addComment } from './firebase.js';
import { getRecipeByUid } from './recipes.js';
import { getWeekKey, getWeekLabel, getCurrentWeekStart } from './planner.js';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export async function renderPlanView(gridContainer, commentsListEl, weekLabelEl, weekKeyOverride, weekLabelOverride) {
  const weekKey = weekKeyOverride || getWeekKey();
  weekLabelEl.textContent = weekLabelOverride || getWeekLabel();

  const plan = await loadCommittedPlan(weekKey);
  gridContainer.innerHTML = '';

  if (!plan || !plan.days) {
    gridContainer.innerHTML = '<p style="color:var(--text-light);padding:2rem;">No committed plan for this week. Go to "Plan Week", set it up, and hit "Commit This Plan".</p>';
    commentsListEl.innerHTML = '';
    return;
  }

  // Derive Monday from the weekKey
  const monday = new Date(weekKey + 'T00:00:00');

  for (let i = 0; i < 7; i++) {
    const dayDate = new Date(monday);
    dayDate.setDate(dayDate.getDate() + i);
    const dayName = DAYS[i];
    const dayData = plan.days[dayName] || {};

    const card = document.createElement('div');
    card.className = `plan-day-card${dayData.skip || dayData.leftover ? ' skip' : ''}`;

    const recipe = dayData.recipeUid ? getRecipeByUid(dayData.recipeUid) : null;
    const mealName = dayData.skip ? 'Skipped'
      : dayData.leftover ? 'Leftover/Choice'
      : (recipe ? recipe.name : 'No meal planned');

    const flags = [];
    if (dayData.dadCooks) flags.push('Dad cooks');
    if (dayData.makeAhead) flags.push('Make ahead');

    const sides = dayData.sides ? `<span class="meal-sides">+ ${escHtml(dayData.sides)}</span>` : '';

    card.innerHTML = `
      <span class="day-name">${dayName}</span>
      <span class="meal-name">${escHtml(mealName)}${sides}</span>
      <div class="meal-flags">
        ${flags.map(f => `<span class="flag-chip">${f}</span>`).join('')}
      </div>
    `;
    gridContainer.appendChild(card);
  }

  // Load comments
  await renderComments(weekKey, commentsListEl);
}

async function renderComments(weekKey, container) {
  const comments = await loadComments(weekKey);
  container.innerHTML = '';

  if (!comments.length) {
    container.innerHTML = '<p style="color:var(--text-light);">No comments yet.</p>';
    return;
  }

  for (const c of comments) {
    const el = document.createElement('div');
    el.className = 'comment';
    el.innerHTML = `
      <div class="comment-header">
        <strong>${escHtml(c.memberName)}</strong>
        <span>${new Date(c.timestamp).toLocaleString()}</span>
      </div>
      <div class="comment-body">${escHtml(c.text)}</div>
    `;
    container.appendChild(el);
  }
}

export async function handleAddComment(weekKey, memberName, text, commentsListEl) {
  if (!memberName || !text.trim()) return;
  await addComment(weekKey, memberName, text.trim());
  await renderComments(weekKey, commentsListEl);
}

function escHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}
