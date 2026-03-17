import { loadCommittedPlan, archiveRecipe, getMembers } from './firebase.js';
import { getRecipeByUid, loadRecipes } from './recipes.js';
import { getRecipePrefs, toggleDoesntEat, toggleFavorite } from './preferences.js';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function confirmDelete(recipeName) {
  return new Promise(resolve => {
    const modal = document.getElementById('confirm-delete-modal');
    const msg = document.getElementById('confirm-delete-msg');
    const yesBtn = document.getElementById('confirm-delete-yes');
    const noBtn = document.getElementById('confirm-delete-no');

    msg.textContent = `"${recipeName}" will be removed. This can't be undone.`;
    modal.classList.remove('hidden');

    function cleanup(result) {
      modal.classList.add('hidden');
      yesBtn.removeEventListener('click', onYes);
      noBtn.removeEventListener('click', onNo);
      modal.removeEventListener('click', onBackdrop);
      resolve(result);
    }
    function onYes() { cleanup(true); }
    function onNo() { cleanup(false); }
    function onBackdrop(e) { if (e.target === modal) cleanup(false); }

    yesBtn.addEventListener('click', onYes);
    noBtn.addEventListener('click', onNo);
    modal.addEventListener('click', onBackdrop);
  });
}

function getCurrentWeekKey() {
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(now);
  monday.setDate(diff);
  monday.setHours(0, 0, 0, 0);
  return monday.toISOString().slice(0, 10);
}

function getPreviousWeekKey() {
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1);
  const thisMonday = new Date(now);
  thisMonday.setDate(diff);
  thisMonday.setHours(0, 0, 0, 0);
  const prevMonday = new Date(thisMonday);
  prevMonday.setDate(prevMonday.getDate() - 7);
  return prevMonday.toISOString().slice(0, 10);
}

function getWeekLabel(weekKey) {
  const d = new Date(weekKey + 'T00:00:00');
  const end = new Date(d);
  end.setDate(end.getDate() + 6);
  const fmt = d2 => d2.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${fmt(d)} - ${fmt(end)}`;
}

export async function renderFeedbackPage(container) {
  container.innerHTML = '<p style="color:var(--text-light);">Loading feedback...</p>';

  const currentWeekKey = getCurrentWeekKey();
  const prevWeekKey = getPreviousWeekKey();

  const [currentPlan, prevPlan] = await Promise.all([
    loadCommittedPlan(currentWeekKey),
    loadCommittedPlan(prevWeekKey),
  ]);

  container.innerHTML = '';

  let hasContent = false;

  // Render current week
  if (currentPlan?.days) {
    const meals = collectMeals(currentPlan);
    if (meals.length) {
      hasContent = true;
      renderWeekSection(container, 'This Week', currentWeekKey, meals);
    }
  }

  // Render previous week
  if (prevPlan?.days) {
    const meals = collectMeals(prevPlan);
    if (meals.length) {
      hasContent = true;
      renderWeekSection(container, 'Last Week', prevWeekKey, meals);
    }
  }

  if (!hasContent) {
    container.innerHTML += '<p style="color:var(--text-light);padding:1rem;">No committed plans found for this week or last week.</p>';
  }
}

function collectMeals(plan) {
  const meals = [];
  for (const day of DAYS) {
    const dayData = plan.days[day];
    if (!dayData?.recipeUid) continue;
    if (dayData.skip) continue;
    if (meals.some(m => m.recipeUid === dayData.recipeUid)) continue;
    const recipe = getRecipeByUid(dayData.recipeUid);
    meals.push({
      recipeUid: dayData.recipeUid,
      name: recipe?.name || dayData.recipeUid,
      day,
    });
  }
  return meals;
}

function renderWeekSection(container, title, weekKey, meals) {
  const section = document.createElement('div');
  section.className = 'feedback-week-section';

  const header = document.createElement('h3');
  header.className = 'feedback-week-label';
  header.textContent = `${title} \u2014 ${getWeekLabel(weekKey)}`;
  section.appendChild(header);

  for (const meal of meals) {
    section.appendChild(createMealCard(meal, container));
  }

  container.appendChild(section);
}

function createMealCard(meal, pageContainer) {
  const card = document.createElement('div');
  card.className = 'feedback-card';

  const members = getMembers();
  const prefs = getRecipePrefs(meal.recipeUid);
  const doesntEat = prefs.doesntEat || [];

  card.innerHTML = `
    <div class="feedback-card-header">
      <strong>${escHtml(meal.name)}</strong>
      <span class="feedback-day">${meal.day}</span>
    </div>
    <div class="feedback-controls">
      <div class="doesnt-eat-btns">
        <span class="pref-label">Doesn't eat:</span>
        ${members.map(m => `
          <button class="flag-btn doesnt-eat-btn ${doesntEat.includes(m) ? 'active' : ''}" data-member="${escAttr(m)}">${escHtml(m)}</button>
        `).join('')}
      </div>
      <div class="pref-flags">
        <button class="flag-btn fav-flag ${prefs.favorite ? 'active' : ''}" data-action="favorite">\u2764 Favorite</button>
        <button class="flag-btn delete-flag" data-action="delete">\u{1F5D1} Remove Recipe</button>
      </div>
    </div>
  `;

  // "Doesn't eat" toggles
  card.querySelectorAll('.doesnt-eat-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      await toggleDoesntEat(meal.recipeUid, btn.dataset.member);
      btn.classList.toggle('active');
    });
  });

  // Favorite toggle
  card.querySelector('[data-action="favorite"]').addEventListener('click', async (e) => {
    await toggleFavorite(meal.recipeUid);
    e.target.classList.toggle('active');
  });

  // Delete recipe
  card.querySelector('[data-action="delete"]').addEventListener('click', async () => {
    if (!await confirmDelete(meal.name)) return;
    await archiveRecipe(meal.recipeUid);
    await loadRecipes();
    showToast(`"${meal.name}" removed.`);
    renderFeedbackPage(pageContainer);
  });

  return card;
}

function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.remove('hidden');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.add('hidden'), 3000);
}

function escHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

function escAttr(str) {
  return (str || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
