import { saveRecipePrefs, loadAllPreferences, getMembers } from './firebase.js';
import { getRecipes } from './recipes.js';
import { isSlowCooker, isInstantPot, autoDetectSlowCooker, autoDetectInstantPot } from './convenience.js';

// Keyed by recipeUid: { doesntEat: [...members], makeAhead: bool, favorite: bool,
//                       slowCooker: bool|undefined, instantPot: bool|undefined }
// For slowCooker/instantPot: undefined = auto-detect from recipe text,
//                            true/false = manual override.
let preferences = {};

export async function initPreferences() {
  preferences = await loadAllPreferences();
}

export function getRecipePrefs(recipeUid) {
  return preferences[recipeUid] || { doesntEat: [], makeAhead: false, favorite: false };
}

export function getAllPreferences() {
  return preferences;
}

export async function updateRecipePrefs(recipeUid, prefs) {
  preferences[recipeUid] = { ...prefs };
  await saveRecipePrefs(recipeUid, prefs);
}

export async function toggleFavorite(recipeUid) {
  const current = getRecipePrefs(recipeUid);
  current.favorite = !current.favorite;
  await updateRecipePrefs(recipeUid, current);
  return current.favorite;
}

export async function toggleDoesntEat(recipeUid, memberName) {
  const current = getRecipePrefs(recipeUid);
  const list = current.doesntEat || [];
  if (list.includes(memberName)) {
    current.doesntEat = list.filter(m => m !== memberName);
  } else {
    current.doesntEat = [...list, memberName];
  }
  await updateRecipePrefs(recipeUid, current);
  return current.doesntEat;
}

export async function toggleMakeAhead(recipeUid) {
  const current = getRecipePrefs(recipeUid);
  current.makeAhead = !current.makeAhead;
  await updateRecipePrefs(recipeUid, current);
  return current.makeAhead;
}

// Toggles a method tag (slowCooker / instantPot). The button shows the current
// effective state. Clicking flips it. If the new state matches auto-detection,
// the override is cleared (field deleted); otherwise the override is stored.
async function toggleMethodTag(recipeUid, recipe, field, autoDetectFn) {
  const current = getRecipePrefs(recipeUid);
  const auto = autoDetectFn(recipe);
  const overridden = current[field] === true || current[field] === false;
  const effective = overridden ? current[field] : auto;
  const newEffective = !effective;
  if (newEffective === auto) {
    delete current[field];
  } else {
    current[field] = newEffective;
  }
  await updateRecipePrefs(recipeUid, current);
  return newEffective;
}

export async function toggleSlowCooker(recipeUid, recipe) {
  return toggleMethodTag(recipeUid, recipe, 'slowCooker', autoDetectSlowCooker);
}

export async function toggleInstantPot(recipeUid, recipe) {
  return toggleMethodTag(recipeUid, recipe, 'instantPot', autoDetectInstantPot);
}

export function renderPreferenceList(container, recipes, searchQuery, showUnratedOnly) {
  container.innerHTML = '';
  const members = getMembers();

  let filtered = recipes;
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    filtered = filtered.filter(r =>
      r.name.toLowerCase().includes(q) ||
      (r.categories || []).some(c => c.toLowerCase().includes(q))
    );
  }
  if (showUnratedOnly) {
    filtered = filtered.filter(r => !preferences[r.uid]);
  }

  if (!filtered.length) {
    container.innerHTML = '<p style="color:var(--text-light);padding:2rem;">No recipes to show.</p>';
    return;
  }

  for (const r of filtered) {
    const prefs = getRecipePrefs(r.uid);
    const slowCookerOn = isSlowCooker(r, prefs);
    const instantPotOn = isInstantPot(r, prefs);
    const slowCookerOverridden = prefs.slowCooker === true || prefs.slowCooker === false;
    const instantPotOverridden = prefs.instantPot === true || prefs.instantPot === false;

    const row = document.createElement('div');
    row.className = 'pref-row';
    row.innerHTML = `
      <span class="recipe-name">${escHtml(r.name)}</span>
      <div class="pref-controls">
        <div class="doesnt-eat-btns">
          <span class="pref-label">Doesn't eat:</span>
          ${members.map(m => `
            <button class="flag-btn doesnt-eat-btn ${(prefs.doesntEat || []).includes(m) ? 'active' : ''}" data-member="${escAttr(m)}">${escHtml(m)}</button>
          `).join('')}
        </div>
        <div class="pref-flags">
          <button class="flag-btn ${prefs.makeAhead ? 'active' : ''}" data-action="makeAhead">Make Ahead</button>
          <button class="flag-btn ${slowCookerOn ? 'active' : ''}" data-action="slowCooker" title="${slowCookerOverridden ? 'Manual override' : 'Auto-detected'}">Slow Cooker${slowCookerOverridden ? '' : ' \u2728'}</button>
          <button class="flag-btn ${instantPotOn ? 'active' : ''}" data-action="instantPot" title="${instantPotOverridden ? 'Manual override' : 'Auto-detected'}">Instant Pot${instantPotOverridden ? '' : ' \u2728'}</button>
          <button class="flag-btn fav-flag ${prefs.favorite ? 'active' : ''}" data-action="favorite">\u2764 Favorite</button>
        </div>
      </div>
    `;

    // "Doesn't eat" toggles
    row.querySelectorAll('.doesnt-eat-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        await toggleDoesntEat(r.uid, btn.dataset.member);
        btn.classList.toggle('active');
        showToast('Saved');
      });
    });

    // Make ahead toggle
    row.querySelector('[data-action="makeAhead"]').addEventListener('click', async (e) => {
      await toggleMakeAhead(r.uid);
      e.target.classList.toggle('active');
      showToast('Saved');
    });

    // Slow cooker toggle (auto-detected, can be overridden)
    row.querySelector('[data-action="slowCooker"]').addEventListener('click', async (e) => {
      const newState = await toggleSlowCooker(r.uid, r);
      e.target.classList.toggle('active', newState);
      const updatedPrefs = getRecipePrefs(r.uid);
      const overridden = updatedPrefs.slowCooker === true || updatedPrefs.slowCooker === false;
      e.target.title = overridden ? 'Manual override' : 'Auto-detected';
      e.target.textContent = `Slow Cooker${overridden ? '' : ' \u2728'}`;
      showToast('Saved');
    });

    // Instant pot toggle (auto-detected, can be overridden)
    row.querySelector('[data-action="instantPot"]').addEventListener('click', async (e) => {
      const newState = await toggleInstantPot(r.uid, r);
      e.target.classList.toggle('active', newState);
      const updatedPrefs = getRecipePrefs(r.uid);
      const overridden = updatedPrefs.instantPot === true || updatedPrefs.instantPot === false;
      e.target.title = overridden ? 'Manual override' : 'Auto-detected';
      e.target.textContent = `Instant Pot${overridden ? '' : ' \u2728'}`;
      showToast('Saved');
    });

    // Favorite toggle
    row.querySelector('[data-action="favorite"]').addEventListener('click', async (e) => {
      await toggleFavorite(r.uid);
      e.target.classList.toggle('active');
      showToast('Saved');
    });

    container.appendChild(row);
  }
}

function showToast(msg) {
  const toast = document.getElementById('toast');
  if (!toast) return;
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
