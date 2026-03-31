import { getRecipes, getRecipeByUid, filterRecipes } from './recipes.js';
import { getAllPreferences } from './preferences.js';
import { savePlan, loadPlan, loadUseUpItems, saveUseUpItems, loadRepeatWindow } from './firebase.js';

export const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

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

async function getRecentRecipeUids(weeksBack) {
  if (weeksBack === undefined) weeksBack = await loadRepeatWindow();
  if (weeksBack === 0) weeksBack = 52; // "no limit" checks a full year
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
  const useUpItems = await loadUseUpItems(weekKey);

  const plannerMembers = members;

  container.innerHTML = '';

  // Use-up items panel
  const useUpEl = document.createElement('div');
  useUpEl.className = 'use-up-panel';
  useUpEl.innerHTML = `
    <div class="use-up-header">
      <strong>Use up this week</strong>
      <span class="use-up-hint">Ingredients you already have — meals using these get priority</span>
    </div>
    <div class="use-up-tags">${useUpItems.map(item => `<span class="use-up-tag">${escHtml(item)}<button class="use-up-remove" data-item="${escAttr(item)}">&times;</button></span>`).join('')}</div>
    <div class="use-up-add">
      <input type="text" class="use-up-input" placeholder="e.g. ricotta, leftover chicken...">
      <button class="btn use-up-add-btn">Add</button>
    </div>
  `;
  container.appendChild(useUpEl);

  // Use-up event handlers
  const addUseUpItem = async () => {
    const input = useUpEl.querySelector('.use-up-input');
    const val = input.value.trim();
    if (!val) return;
    // Support comma-separated entries
    const newItems = val.split(',').map(s => s.trim()).filter(Boolean);
    const current = await loadUseUpItems(weekKey);
    const merged = [...current, ...newItems.filter(n => !current.some(c => c.toLowerCase() === n.toLowerCase()))];
    await saveUseUpItems(weekKey, merged);
    input.value = '';
    renderPlanner(container, members);
  };

  useUpEl.querySelector('.use-up-add-btn').addEventListener('click', addUseUpItem);
  useUpEl.querySelector('.use-up-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addUseUpItem(); }
  });

  useUpEl.querySelectorAll('.use-up-remove').forEach(btn => {
    btn.addEventListener('click', async () => {
      const item = btn.dataset.item;
      const current = await loadUseUpItems(weekKey);
      await saveUseUpItems(weekKey, current.filter(i => i !== item));
      renderPlanner(container, members);
    });
  });

  // Step 1: Constraint cards for each day
  for (let i = 0; i < 7; i++) {
    const dayDate = new Date(currentWeekStart);
    dayDate.setDate(dayDate.getDate() + i);
    const dayName = DAYS[i];
    const dayData = plan.days[dayName] || {};

    const whoHome = dayData.whoHome || [...plannerMembers];

    const assignedThisWeek = collectAssignedThisWeek(plan, dayName);
    const selectedRecipe = dayData.recipeUid ? recipes.find(r => r.uid === dayData.recipeUid) : null;

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
        <select class="day-status-select">
          <option value="">Cooking</option>
          <option value="skip" ${dayData.skip === true || dayData.skip === 'skip' ? 'selected' : ''}>Skip</option>
          <option value="leftovers" ${dayData.skip === 'leftovers' ? 'selected' : ''}>Leftovers</option>
        </select>
      </div>
      <div class="planner-day-meal">
        <div class="meal-combo" data-recipe-uid="${escAttr(dayData.recipeUid || '')}">
          <input type="text" class="meal-search" placeholder="Search recipes..." value="${escAttr(selectedRecipe ? selectedRecipe.name : '')}" autocomplete="off">
          <div class="meal-dropdown hidden"></div>
        </div>
        <button class="suggest-btn">Re-suggest</button>
        <button class="clear-btn">Clear</button>
      </div>
      <div class="planner-day-sides">
        <input type="text" class="sides-input" placeholder="Sides (e.g. rice, salad, bread)" value="${escAttr(dayData.sides || '')}">
        <select class="servings-select" title="Recipe multiplier">
          <option value="0.5" ${dayData.servings === 0.5 ? 'selected' : ''}>&frac12;x</option>
          <option value="1" ${!dayData.servings || dayData.servings === 1 ? 'selected' : ''}>1x</option>
          <option value="1.5" ${dayData.servings === 1.5 ? 'selected' : ''}>1&frac12;x</option>
          <option value="2" ${dayData.servings === 2 ? 'selected' : ''}>2x</option>
          <option value="3" ${dayData.servings === 3 ? 'selected' : ''}>3x</option>
        </select>
      </div>
    `;

    // Auto-save on any change
    const saveDay = () => {
      saveDayData(weekKey, dayName, dayEl, members, plan);
      refreshDropdownMarkers(container, plan, recipes);
    };

    dayEl.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.addEventListener('change', saveDay));
    dayEl.querySelector('.day-status-select').addEventListener('change', saveDay);
    dayEl.querySelector('.sides-input').addEventListener('change', saveDay);
    dayEl.querySelector('.servings-select').addEventListener('change', saveDay);

    // Searchable combo-box
    setupMealCombo(dayEl, recipes, assignedThisWeek, saveDay);

    // Single-day re-suggest
    dayEl.querySelector('.suggest-btn').addEventListener('click', async () => {
      const recentUids = await getRecentRecipeUids();
      const assigned = collectAssignedThisWeek(plan, dayName);
      const assignedProteins = collectAssignedProteins(plan, dayName);
      const suggested = suggestMealForDay(dayEl, members, recentUids, assigned, assignedProteins, useUpItems);
      if (suggested) {
        setComboValue(dayEl, suggested.uid, suggested.name);
        plan.days[dayName] = getDayDataFromEl(dayEl, members);
        plan.days[dayName].recipeUid = suggested.uid;
        plan.weekKey = weekKey;
        plan.updated = Date.now();
        await savePlan(weekKey, plan);
        refreshDropdownMarkers(container, plan, recipes);
      }
    });

    dayEl.querySelector('.clear-btn').addEventListener('click', () => {
      setComboValue(dayEl, '', '');
      saveDay();
    });

    container.appendChild(dayEl);
  }
}

function refreshDropdownMarkers(container, plan, recipes) {
  // No-op: combo-box handles display inline. Kept for API compat.
}

function setComboValue(dayEl, uid, name) {
  const combo = dayEl.querySelector('.meal-combo');
  const input = combo.querySelector('.meal-search');
  combo.dataset.recipeUid = uid || '';
  input.value = name || '';
}

function setupMealCombo(dayEl, recipes, assignedThisWeek, onSave) {
  const combo = dayEl.querySelector('.meal-combo');
  const input = combo.querySelector('.meal-search');
  const dropdown = combo.querySelector('.meal-dropdown');

  function renderOptions(query) {
    const q = (query || '').toLowerCase().trim();
    const currentUid = combo.dataset.recipeUid;
    const filtered = q ? filterRecipes(q) : recipes;

    dropdown.innerHTML = '';
    if (!filtered.length) {
      dropdown.innerHTML = '<div class="meal-dropdown-empty">No matches</div>';
      dropdown.classList.remove('hidden');
      return;
    }
    for (const r of filtered) {
      const opt = document.createElement('div');
      opt.className = 'meal-dropdown-item';
      if (assignedThisWeek.has(r.uid) && r.uid !== currentUid) {
        opt.classList.add('used-elsewhere');
      }
      opt.dataset.uid = r.uid;
      opt.textContent = r.name;
      opt.addEventListener('mousedown', (e) => {
        e.preventDefault(); // prevent blur
        combo.dataset.recipeUid = r.uid;
        input.value = r.name;
        dropdown.classList.add('hidden');
        onSave();
      });
      dropdown.appendChild(opt);
    }
    dropdown.classList.remove('hidden');
  }

  input.addEventListener('focus', () => {
    input.select();
    renderOptions(input.value);
  });

  input.addEventListener('input', () => {
    // If user edits text, clear the selection until they pick again
    combo.dataset.recipeUid = '';
    renderOptions(input.value);
  });

  input.addEventListener('blur', () => {
    // Delay to allow mousedown on dropdown item
    setTimeout(() => {
      dropdown.classList.add('hidden');
      // If no valid selection, restore previous or clear
      const uid = combo.dataset.recipeUid;
      if (uid) {
        const r = recipes.find(rec => rec.uid === uid);
        if (r) input.value = r.name;
      } else {
        input.value = '';
        onSave();
      }
    }, 150);
  });

  // Keyboard navigation
  input.addEventListener('keydown', (e) => {
    const items = dropdown.querySelectorAll('.meal-dropdown-item');
    const active = dropdown.querySelector('.meal-dropdown-item.active');
    let idx = Array.from(items).indexOf(active);

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (active) active.classList.remove('active');
      idx = Math.min(idx + 1, items.length - 1);
      items[idx]?.classList.add('active');
      items[idx]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (active) active.classList.remove('active');
      idx = Math.max(idx - 1, 0);
      items[idx]?.classList.add('active');
      items[idx]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (active) {
        active.dispatchEvent(new MouseEvent('mousedown'));
      }
    } else if (e.key === 'Escape') {
      dropdown.classList.add('hidden');
      input.blur();
    }
  });
}

function getDayDataFromEl(dayEl, members) {
  const whoHome = [];
  dayEl.querySelectorAll('.who-home input[type="checkbox"]').forEach(cb => {
    if (cb.checked) whoHome.push(cb.dataset.member);
  });
  return {
    whoHome,
    makeAhead: dayEl.querySelector('.make-ahead')?.checked || false,
    skip: dayEl.querySelector('.day-status-select')?.value || false,
    recipeUid: dayEl.querySelector('.meal-combo')?.dataset.recipeUid || '',
    sides: dayEl.querySelector('.sides-input')?.value || '',
    servings: parseFloat(dayEl.querySelector('.servings-select')?.value) || 1,
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

function suggestMealForDay(dayEl, members, recentUids, assignedThisWeek, assignedProteins, useUpItems = []) {
  const dayData = getDayDataFromEl(dayEl, members);
  if (dayData.skip === true || dayData.skip === 'skip' || dayData.skip === 'leftovers') return null;

  const recipes = getRecipes();
  const prefs = getAllPreferences();

  const scored = [];
  for (const recipe of recipes) {
    // Don't repeat within the same week
    if (assignedThisWeek.has(recipe.uid)) continue;

    const recipePref = prefs[recipe.uid] || {};

    // Check constraints
    if (dayData.makeAhead && !recipePref.makeAhead) continue;

    // Skip if anyone home doesn't eat this
    const doesntEat = recipePref.doesntEat || [];
    const blocked = dayData.whoHome.some(member => doesntEat.includes(member));
    if (blocked) continue;

    // Base score: everyone home can eat it
    let score = dayData.whoHome.length * 2;

    // Boost favorited recipes
    if (recipePref.favorite) score += 3;

    // Boost recipes that use ingredients the user wants to use up
    if (useUpItems.length > 0) {
      const recipeText = `${recipe.name} ${recipe.ingredients || ''}`.toLowerCase();
      for (const item of useUpItems) {
        if (recipeText.includes(item.toLowerCase())) {
          score += 5;
        }
      }
    }

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
  const useUpItems = await loadUseUpItems(weekKey);

  const dayEls = container.querySelectorAll('.planner-day');

  // Process days sequentially so each day's pick informs the next
  for (let i = 0; i < dayEls.length; i++) {
    const dayEl = dayEls[i];
    const dayName = DAYS[i];
    const currentMeal = dayEl.querySelector('.meal-combo')?.dataset.recipeUid;
    const isSkip = dayEl.querySelector('.day-status-select')?.value;

    if (!currentMeal && !isSkip) {
      const assignedThisWeek = collectAssignedThisWeek(plan, dayName);
      const assignedProteins = collectAssignedProteins(plan, dayName);
      const suggested = suggestMealForDay(dayEl, members, recentUids, assignedThisWeek, assignedProteins, useUpItems);
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
