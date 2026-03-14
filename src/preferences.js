import { saveRecipePrefs, loadAllPreferences, getMembers } from './firebase.js';
import { getRecipes } from './recipes.js';

// Keyed by recipeUid: { doesntEat: [...members], makeAhead: bool, favorite: bool }
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
          <button class="flag-btn fav-flag ${prefs.favorite ? 'active' : ''}" data-action="favorite">\u2764 Favorite</button>
        </div>
      </div>
    `;

    // "Doesn't eat" toggles
    row.querySelectorAll('.doesnt-eat-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        await toggleDoesntEat(r.uid, btn.dataset.member);
        btn.classList.toggle('active');
      });
    });

    // Make ahead toggle
    row.querySelector('[data-action="makeAhead"]').addEventListener('click', async (e) => {
      await toggleMakeAhead(r.uid);
      e.target.classList.toggle('active');
    });

    // Favorite toggle
    row.querySelector('[data-action="favorite"]').addEventListener('click', async (e) => {
      await toggleFavorite(r.uid);
      e.target.classList.toggle('active');
    });

    container.appendChild(row);
  }
}

function escHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

function escAttr(str) {
  return (str || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
