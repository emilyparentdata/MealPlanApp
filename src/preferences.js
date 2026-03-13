import { savePreference, loadAllPreferences } from './firebase.js';
import { getRecipes } from './recipes.js';

let preferences = {}; // keyed by "recipeUid_memberName"

export async function initPreferences() {
  preferences = await loadAllPreferences();
}

export function getPreference(recipeUid, memberName) {
  return preferences[`${recipeUid}_${memberName}`] || null;
}

export function getAllPreferences() {
  return preferences;
}

export function getRecipePreferences(recipeUid) {
  const result = {};
  for (const [key, val] of Object.entries(preferences)) {
    if (key.startsWith(recipeUid + '_')) {
      const member = key.slice(recipeUid.length + 1);
      result[member] = val;
    }
  }
  return result;
}

export function renderPreferenceList(container, recipes, currentMember, searchQuery, showUnratedOnly) {
  container.innerHTML = '';

  if (!currentMember) {
    container.innerHTML = '<p style="color:var(--text-light);padding:2rem;">Please select your name above to rate recipes.</p>';
    return;
  }

  let filtered = recipes;
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    filtered = filtered.filter(r =>
      r.name.toLowerCase().includes(q) ||
      (r.categories || []).some(c => c.toLowerCase().includes(q))
    );
  }
  if (showUnratedOnly) {
    filtered = filtered.filter(r => !getPreference(r.uid, currentMember));
  }

  if (!filtered.length) {
    container.innerHTML = '<p style="color:var(--text-light);padding:2rem;">No recipes to show.</p>';
    return;
  }

  for (const r of filtered) {
    const pref = getPreference(r.uid, currentMember);
    const currentRating = pref?.rating || '';
    const flags = pref?.flags || {};

    const row = document.createElement('div');
    row.className = 'pref-row';
    row.innerHTML = `
      <span class="recipe-name">${escHtml(r.name)}</span>
      <div class="rating-btns">
        ${['love', 'like', 'acceptable', 'unacceptable', 'unknown'].map(rating =>
          `<button class="rating-btn ${currentRating === rating ? 'selected' : ''}" data-rating="${rating}">${ratingLabel(rating)}</button>`
        ).join('')}
      </div>
      <div class="flag-btns">
        <button class="flag-btn ${flags.makeAhead ? 'active' : ''}" data-flag="makeAhead">Make Ahead</button>
        <button class="flag-btn ${flags.dadCanMake ? 'active' : ''}" data-flag="dadCanMake">Dad Can Make</button>
      </div>
    `;

    // Rating button clicks
    row.querySelectorAll('.rating-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const rating = btn.dataset.rating;
        const currentPref = getPreference(r.uid, currentMember);
        const currentFlags = currentPref?.flags || {};
        await setPreference(r.uid, currentMember, rating, currentFlags);
        // Update UI
        row.querySelectorAll('.rating-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
      });
    });

    // Flag button clicks
    row.querySelectorAll('.flag-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const flag = btn.dataset.flag;
        const currentPref = getPreference(r.uid, currentMember);
        const currentRating = currentPref?.rating || 'acceptable';
        const currentFlags = { ...(currentPref?.flags || {}) };
        currentFlags[flag] = !currentFlags[flag];
        await setPreference(r.uid, currentMember, currentRating, currentFlags);
        btn.classList.toggle('active');
      });
    });

    container.appendChild(row);
  }
}

async function setPreference(recipeUid, memberName, rating, flags) {
  const key = `${recipeUid}_${memberName}`;
  preferences[key] = { rating, flags, updated: Date.now() };
  await savePreference(recipeUid, memberName, rating, flags);
}

function ratingLabel(rating) {
  return { love: 'Love It', like: 'Like It', acceptable: 'Acceptable', unknown: "Don't Know", unacceptable: 'Unacceptable' }[rating] || rating;
}

export async function toggleFavorite(recipeUid, memberName) {
  const pref = getPreference(recipeUid, memberName);
  const rating = pref?.rating || 'unknown';
  const flags = { ...(pref?.flags || {}) };
  flags.favorite = !flags.favorite;
  await setPreference(recipeUid, memberName, rating, flags);
  return flags.favorite;
}

export function isFavorite(recipeUid, memberName) {
  const pref = getPreference(recipeUid, memberName);
  return !!(pref?.flags?.favorite);
}

function escHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}
