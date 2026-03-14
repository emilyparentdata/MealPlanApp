import { loadCommittedPlan, saveFeedbackVote, loadFeedbackForWeek, savePreference, loadAllPreferences, archiveRecipe } from './firebase.js';
import { getRecipeByUid, loadRecipes } from './recipes.js';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const VOTE_OPTIONS = [
  { value: 'great', label: 'Great Success', icon: '&#11088;', class: 'vote-great' },
  { value: 'fine', label: 'Still Fine', icon: '&#128077;', class: 'vote-fine' },
  { value: 'downgrade', label: 'Downgrade', icon: '&#128078;', class: 'vote-downgrade' },
  { value: 'delete', label: 'Delete', icon: '&#128465;', class: 'vote-delete' },
];

// Map feedback votes to preference rating adjustments
const VOTE_TO_RATING = {
  great: 'love',
  fine: 'like',
  downgrade: 'acceptable',
  delete: 'unacceptable',
};

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

export async function renderFeedbackPage(container, currentMember) {
  container.innerHTML = '<p style="color:var(--text-light);">Loading feedback...</p>';

  const currentWeekKey = getCurrentWeekKey();
  const prevWeekKey = getPreviousWeekKey();

  // Load both weeks in parallel
  const [currentPlan, prevPlan, currentVotes, prevVotes] = await Promise.all([
    loadCommittedPlan(currentWeekKey),
    loadCommittedPlan(prevWeekKey),
    loadFeedbackForWeek(currentWeekKey),
    loadFeedbackForWeek(prevWeekKey),
  ]);

  container.innerHTML = '';

  if (!currentMember) {
    const notice = document.createElement('p');
    notice.style.cssText = 'color:var(--text-light);padding:0 0 1rem;';
    notice.textContent = 'Select your name at the top to vote.';
    container.appendChild(notice);
  }

  let hasContent = false;

  // Render current week
  if (currentPlan?.days) {
    const meals = collectMeals(currentPlan);
    if (meals.length) {
      hasContent = true;
      renderWeekSection(container, 'This Week', currentWeekKey, meals, currentVotes, currentMember);
    }
  }

  // Render previous week
  if (prevPlan?.days) {
    const meals = collectMeals(prevPlan);
    if (meals.length) {
      hasContent = true;
      renderWeekSection(container, 'Last Week', prevWeekKey, meals, prevVotes, currentMember);
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

function renderWeekSection(container, title, weekKey, meals, votes, currentMember) {
  const section = document.createElement('div');
  section.className = 'feedback-week-section';

  const header = document.createElement('h3');
  header.className = 'feedback-week-label';
  header.textContent = `${title} \u2014 ${getWeekLabel(weekKey)}`;
  section.appendChild(header);

  for (const meal of meals) {
    section.appendChild(createMealCard(weekKey, meal, votes, currentMember, container));
  }

  container.appendChild(section);
}

function createMealCard(weekKey, meal, votes, currentMember, pageContainer) {
  const card = document.createElement('div');
  card.className = 'feedback-card';

  // Check existing vote for this member
  const voteKey = `${weekKey}_${meal.recipeUid}_${currentMember}`;
  const existingVote = votes[voteKey]?.vote || null;

  // Collect all votes for this meal
  const mealVotes = [];
  for (const [, v] of Object.entries(votes)) {
    if (v.recipeUid === meal.recipeUid) {
      mealVotes.push(v);
    }
  }

  const voteSummary = mealVotes.length
    ? mealVotes.map(v => {
        const opt = VOTE_OPTIONS.find(o => o.value === v.vote);
        return `<span class="vote-chip ${opt?.class || ''}" title="${escHtml(v.memberName)}">${opt?.icon || ''} ${escHtml(v.memberName)}</span>`;
      }).join('')
    : '<span style="color:var(--text-light);font-size:0.8rem;">No votes yet</span>';

  card.innerHTML = `
    <div class="feedback-card-header">
      <strong>${escHtml(meal.name)}</strong>
      <span class="feedback-day">${meal.day}</span>
    </div>
    <div class="feedback-votes-summary">${voteSummary}</div>
    <div class="feedback-vote-buttons">
      ${VOTE_OPTIONS.map(opt => `
        <button class="btn vote-btn ${opt.class} ${existingVote === opt.value ? 'selected' : ''}"
                data-vote="${opt.value}"
                ${!currentMember ? 'disabled' : ''}>
          ${opt.icon} ${opt.label}
        </button>
      `).join('')}
    </div>
  `;

  // Wire up vote buttons
  card.querySelectorAll('.vote-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!currentMember) return;
      const vote = btn.dataset.vote;

      // Save the vote
      await saveFeedbackVote(weekKey, meal.recipeUid, currentMember, vote);

      // Update the preference rating based on vote
      const prefs = await loadAllPreferences();
      const prefKey = `${meal.recipeUid}_${currentMember}`;
      const existing = prefs[prefKey] || {};
      const newRating = VOTE_TO_RATING[vote];
      await savePreference(meal.recipeUid, currentMember, newRating, existing.flags || {});

      // If "delete" vote, check if majority voted delete
      if (vote === 'delete') {
        const updatedVotes = await loadFeedbackForWeek(weekKey);
        const deleteVotes = Object.values(updatedVotes)
          .filter(v => v.recipeUid === meal.recipeUid && v.vote === 'delete');
        if (deleteVotes.length >= 2) {
          await archiveRecipe(meal.recipeUid);
          await loadRecipes();
          showToast(`"${meal.name}" has been removed by popular vote.`);
        }
      }

      showToast(`Vote recorded! Your rating for "${meal.name}" updated to "${newRating}".`);
      renderFeedbackPage(pageContainer, currentMember);
    });
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
