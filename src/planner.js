import { getRecipes, getRecipeByUid } from './recipes.js';
import { getAllPreferences } from './preferences.js';
import { savePlan, loadPlan } from './firebase.js';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

let currentWeekStart = getMonday(new Date());

export function getCurrentWeekStart() {
  return currentWeekStart;
}

export function setWeek(date) {
  currentWeekStart = getMonday(date);
}

export function shiftWeek(delta) {
  const d = new Date(currentWeekStart);
  d.setDate(d.getDate() + delta * 7);
  currentWeekStart = d;
}

export function getWeekKey(date) {
  const d = date || currentWeekStart;
  return d.toISOString().slice(0, 10);
}

export function getWeekLabel(date) {
  const d = date || currentWeekStart;
  const end = new Date(d);
  end.setDate(end.getDate() + 6);
  return `${formatDate(d)} - ${formatDate(end)}`;
}

function getMonday(d) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  date.setDate(diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

function formatDate(d) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// === Protein detection for variety ===

const PROTEIN_PATTERNS = {
  chicken: /\bchicken\b/i,
  beef: /\b(beef|steak|chuck|short rib|ground beef|bulgogi)\b/i,
  pork: /\b(pork|bacon|ham|sausage|chorizo|prosciutto)\b/i,
  fish: /\b(fish|salmon|tuna|cod|tilapia|halibut|mahi|shrimp|prawn|crab|lobster|seafood|clam|mussel|scallop)\b/i,
  turkey: /\bturkey\b/i,
  lamb: /\blamb\b/i,
  tofu: /\b(tofu|tempeh)\b/i,
  beans: /\b(bean|lentil|chickpea|black bean|white bean)\b/i,
  pasta: /\b(pasta|spaghetti|penne|rigatoni|linguine|fettuccine|macaroni|noodle)\b/i,
};

function detectProtein(recipe) {
  const text = `${recipe.name} ${recipe.ingredients || ''}`.toLowerCase();
  const found = [];
  for (const [protein, regex] of Object.entries(PROTEIN_PATTERNS)) {
    if (regex.test(text)) found.push(protein);
  }
  return found;
}

// === Load recent weeks for overlap avoidance ===

async function getRecentRecipeUids(weeksBack = 3) {
  const uids = new Set();
  for (let w = 1; w <= weeksBack; w++) {
    const d = new Date(currentWeekStart);
    d.setDate(d.getDate() - w * 7);
    const key = getWeekKey(d);
    const plan = await loadPlan(key);
    if (plan?.days) {
      for (const day of DAYS) {
        if (plan.days[day]?.recipeUid) uids.add(plan.days[day].recipeUid);
      }
    }
  }
  return uids;
}

// === Render planner — two-step: constraints first, then suggest ===

export async function renderPlanner(container, members) {
  const weekKey = getWeekKey();
  const plan = await loadPlan(weekKey) || { days: {} };
  const recipes = getRecipes();

  const plannerMembers = members;

  container.innerHTML = '';

  // Step 1: Constraint cards for each day
  for (let i = 0; i < 7; i++) {
    const dayDate = new Date(currentWeekStart);
    dayDate.setDate(dayDate.getDate() + i);
    const dayName = DAYS[i];
    const dayData = plan.days[dayName] || {};

    const whoHome = dayData.whoHome || [...plannerMembers];

    const dayEl = document.createElement('div');
    dayEl.className = 'planner-day';
    dayEl.dataset.day = dayName;

    dayEl.innerHTML = `
      <div class="planner-day-header">
        <h3>${dayName} <small style="color:var(--text-light);font-weight:normal">${formatDate(dayDate)}</small></h3>
        <div class="who-home">
          Home:
          ${plannerMembers.map(m => `
            <label><input type="checkbox" data-member="${escAttr(m)}" ${whoHome.includes(m) ? 'checked' : ''}> ${escHtml(m)}</label>
          `).join('')}
        </div>
        <label><input type="checkbox" class="make-ahead" ${dayData.makeAhead ? 'checked' : ''}> Make ahead</label>
        <label><input type="checkbox" class="skip-day" ${dayData.skip ? 'checked' : ''}> Skip</label>
      </div>
      <div class="planner-day-meal">
        <select class="meal-select">
          <option value="">-- Select meal --</option>
          ${recipes.map(r => `<option value="${escAttr(r.uid)}" ${dayData.recipeUid === r.uid ? 'selected' : ''}>${escHtml(r.name)}</option>`).join('')}
        </select>
        <button class="suggest-btn">Re-suggest</button>
        <button class="clear-btn">Clear</button>
      </div>
      <div class="planner-day-sides">
        <input type="text" class="sides-input" placeholder="Sides (e.g. rice, salad, bread)" value="${escAttr(dayData.sides || '')}">
      </div>
    `;

    // Auto-save on any change
    const saveDay = () => saveDayData(weekKey, dayName, dayEl, members, plan);

    dayEl.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.addEventListener('change', saveDay));
    dayEl.querySelector('.meal-select').addEventListener('change', saveDay);
    dayEl.querySelector('.sides-input').addEventListener('change', saveDay);

    // Single-day re-suggest
    dayEl.querySelector('.suggest-btn').addEventListener('click', async () => {
      const recentUids = await getRecentRecipeUids();
      const assigned = collectAssignedThisWeek(plan, dayName);
      const assignedProteins = collectAssignedProteins(plan, dayName);
      const suggested = suggestMealForDay(dayEl, members, recentUids, assigned, assignedProteins);
      if (suggested) {
        dayEl.querySelector('.meal-select').value = suggested.uid;
        plan.days[dayName] = getDayDataFromEl(dayEl, members);
        plan.days[dayName].recipeUid = suggested.uid;
        plan.weekKey = weekKey;
        plan.updated = Date.now();
        await savePlan(weekKey, plan);
      }
    });

    dayEl.querySelector('.clear-btn').addEventListener('click', () => {
      dayEl.querySelector('.meal-select').value = '';
      saveDay();
    });

    container.appendChild(dayEl);
  }
}

function getDayDataFromEl(dayEl, members) {
  const whoHome = [];
  dayEl.querySelectorAll('.who-home input[type="checkbox"]').forEach(cb => {
    if (cb.checked) whoHome.push(cb.dataset.member);
  });
  return {
    whoHome,
    makeAhead: dayEl.querySelector('.make-ahead')?.checked || false,
    skip: dayEl.querySelector('.skip-day')?.checked || false,
    recipeUid: dayEl.querySelector('.meal-select')?.value || '',
    sides: dayEl.querySelector('.sides-input')?.value || '',
  };
}

async function saveDayData(weekKey, dayName, dayEl, members, plan) {
  plan.days[dayName] = getDayDataFromEl(dayEl, members);
  plan.weekKey = weekKey;
  plan.updated = Date.now();
  await savePlan(weekKey, plan);
}

// === Collect what's already assigned this week (excluding a given day) ===

function collectAssignedThisWeek(plan, excludeDay) {
  const uids = new Set();
  for (const d of DAYS) {
    if (d === excludeDay) continue;
    if (plan.days[d]?.recipeUid) uids.add(plan.days[d].recipeUid);
  }
  return uids;
}

function collectAssignedProteins(plan, excludeDay) {
  const proteins = [];
  const recipes = getRecipes();
  for (const d of DAYS) {
    if (d === excludeDay) continue;
    const uid = plan.days[d]?.recipeUid;
    if (uid) {
      const r = getRecipeByUid(uid);
      if (r) proteins.push(...detectProtein(r));
    }
  }
  return proteins;
}

// === Core suggestion logic for one day ===

function suggestMealForDay(dayEl, members, recentUids, assignedThisWeek, assignedProteins) {
  const dayData = getDayDataFromEl(dayEl, members);
  if (dayData.skip) return null;

  const recipes = getRecipes();
  const prefs = getAllPreferences();

  const scored = [];
  for (const recipe of recipes) {
    // Don't repeat within the same week
    if (assignedThisWeek.has(recipe.uid)) continue;

    // Check constraints
    if (dayData.makeAhead) {
      const hasMakeAhead = Object.entries(prefs).some(([key, val]) =>
        key.startsWith(recipe.uid + '_') && val.flags?.makeAhead
      );
      if (!hasMakeAhead) continue;
    }

    // Check acceptability for everyone home
    // Default: all meals acceptable unless someone rates "unacceptable"
    let score = 0;
    let acceptable = true;
    let hasFavorite = false;
    for (const member of dayData.whoHome) {
      const pref = prefs[`${recipe.uid}_${member}`];
      if (pref?.flags?.favorite) hasFavorite = true;
      if (!pref || !pref.rating || pref.rating === 'unknown') {
        // No rating or "don't know" — treat as acceptable (default assumption)
        score += 2;
        continue;
      }
      if (pref.rating === 'unacceptable') {
        acceptable = false;
        break;
      }
      score += { love: 4, like: 3, acceptable: 2 }[pref.rating] || 2;
    }
    if (!acceptable) continue;

    // Boost favorited recipes
    if (hasFavorite) score += 3;

    // Protein variety bonus/penalty
    const recipeProteins = detectProtein(recipe);
    let proteinPenalty = 0;
    for (const p of recipeProteins) {
      const count = assignedProteins.filter(ap => ap === p).length;
      // Penalize if this protein already appears 1+ times this week
      if (count >= 2) proteinPenalty += 3;
      else if (count >= 1) proteinPenalty += 1;
    }
    score -= proteinPenalty;

    // Penalize if used in recent weeks (but don't exclude entirely)
    if (recentUids.has(recipe.uid)) {
      score -= 2;
    }

    scored.push({ recipe, score });
  }

  if (!scored.length) return null;

  // Sort by score descending, pick randomly from the top tier
  scored.sort((a, b) => b.score - a.score);
  const topScore = scored[0].score;
  const topTier = scored.filter(s => s.score >= topScore - 1);
  return topTier[Math.floor(Math.random() * topTier.length)].recipe;
}

// === Suggest full week menu ===

export async function suggestAllMeals(container, members) {
  const weekKey = getWeekKey();
  const plan = await loadPlan(weekKey) || { days: {} };
  const recentUids = await getRecentRecipeUids();

  const dayEls = container.querySelectorAll('.planner-day');

  // Process days sequentially so each day's pick informs the next
  for (let i = 0; i < dayEls.length; i++) {
    const dayEl = dayEls[i];
    const dayName = DAYS[i];
    const currentMeal = dayEl.querySelector('.meal-select').value;
    const isSkip = dayEl.querySelector('.skip-day')?.checked;

    if (!currentMeal && !isSkip) {
      const assignedThisWeek = collectAssignedThisWeek(plan, dayName);
      const assignedProteins = collectAssignedProteins(plan, dayName);
      const suggested = suggestMealForDay(dayEl, members, recentUids, assignedThisWeek, assignedProteins);
      if (suggested) {
        plan.days[dayName] = getDayDataFromEl(dayEl, members);
        plan.days[dayName].recipeUid = suggested.uid;
      }
    }
  }

  plan.weekKey = weekKey;
  plan.updated = Date.now();
  await savePlan(weekKey, plan);
}

function escHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

function escAttr(str) {
  return (str || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
