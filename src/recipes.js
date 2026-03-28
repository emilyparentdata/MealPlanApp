import { getArchivedRecipes, getCustomRecipes } from './firebase.js';

let allRecipes = [];

export async function loadRecipes() {
  // All recipes come from the household's Firestore collection
  let all = getCustomRecipes();

  // Filter out archived
  const archived = new Set(getArchivedRecipes());
  all = all.filter(r => !archived.has(r.uid));

  allRecipes = all;
  allRecipes.sort((a, b) => a.name.localeCompare(b.name));
  return allRecipes;
}

export function getRecipes() {
  return allRecipes;
}

export function getRecipeByUid(uid) {
  return allRecipes.find(r => r.uid === uid);
}

export function renderRecipeList(container, recipes, onClick, preferences, { onToggleFavorite, onRenderCard } = {}) {
  container.innerHTML = '';
  if (!recipes.length) {
    container.innerHTML = '<p style="color:var(--text-light);padding:2rem;">No recipes found.</p>';
    return;
  }
  for (const r of recipes) {
    const card = document.createElement('div');
    card.className = 'recipe-card';
    card.dataset.uid = r.uid;

    const meta = [];
    if (r.prep_time) meta.push(`Prep: ${r.prep_time}`);
    if (r.cook_time) meta.push(`Cook: ${r.cook_time}`);
    if (r.total_time) meta.push(`Total: ${r.total_time}`);
    if (r.servings) meta.push(`Serves: ${r.servings}`);

    const cats = (r.categories || [])
      .map(c => `<span class="category-tag">${esc(c)}</span>`).join('');

    // Build status summary from preferences
    const statusHtml = buildStatusSummary(r.uid, preferences);

    // Favorite button
    const pref = preferences?.[r.uid];
    const isFav = pref?.favorite;
    const favHtml = `<button class="fav-btn ${isFav ? 'active' : ''}" title="${isFav ? 'Remove from favorites' : 'Add to favorites'}">${isFav ? '\u2764' : '\u2661'}</button>`;

    card.innerHTML = `
      <div class="recipe-card-top">
        <h3>${esc(r.name)}</h3>
        ${favHtml}
      </div>
      <div class="recipe-meta">${meta.map(m => `<span>${esc(m)}</span>`).join('')}</div>
      ${statusHtml}
      ${cats ? `<div class="recipe-categories">${cats}</div>` : ''}
    `;

    // Favorite toggle
    const favBtn = card.querySelector('.fav-btn');
    if (favBtn && onToggleFavorite) {
      favBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const nowFav = await onToggleFavorite(r.uid);
        favBtn.textContent = nowFav ? '\u2764' : '\u2661';
        favBtn.classList.toggle('active', nowFav);
        favBtn.title = nowFav ? 'Remove from favorites' : 'Add to favorites';
      });
    }

    if (onRenderCard) onRenderCard(card, r);

    card.addEventListener('click', () => onClick(r));
    container.appendChild(card);
  }
}

export function buildStatusSummary(recipeUid, preferences) {
  if (!preferences) return '';
  const pref = preferences[recipeUid];
  if (!pref) return '';

  const chips = [];

  if (pref.favorite) {
    chips.push('<span class="status-chip favorite">\u2764 Favorite</span>');
  }
  if (pref.makeAhead) {
    chips.push('<span class="status-chip make-ahead">Make Ahead</span>');
  }
  if (pref.doesntEat?.length) {
    for (const m of pref.doesntEat) {
      chips.push(`<span class="status-chip doesnt-eat">${esc(m)} won't eat</span>`);
    }
  }

  if (!chips.length) return '';
  return `<div class="recipe-status">${chips.join('')}</div>`;
}

export function renderRecipeDetail(container, recipe) {
  const sections = [];

  if (recipe.description) {
    sections.push(`<div class="detail-section"><h4>Description</h4><pre>${esc(recipe.description)}</pre></div>`);
  }
  if (recipe.ingredients) {
    sections.push(`<div class="detail-section"><h4>Ingredients</h4><pre>${esc(recipe.ingredients)}</pre></div>`);
  }
  if (recipe.directions) {
    sections.push(`<div class="detail-section"><h4>Directions</h4><pre>${esc(recipe.directions)}</pre></div>`);
  }
  if (recipe.notes) {
    sections.push(`<div class="detail-section"><h4>Notes</h4><pre>${esc(recipe.notes)}</pre></div>`);
  }

  const meta = [];
  if (recipe.prep_time) meta.push(`Prep: ${recipe.prep_time}`);
  if (recipe.cook_time) meta.push(`Cook: ${recipe.cook_time}`);
  if (recipe.total_time) meta.push(`Total: ${recipe.total_time}`);
  if (recipe.servings) meta.push(`Servings: ${recipe.servings}`);
  if (recipe.source) meta.push(`Source: ${recipe.source}`);

  container.innerHTML = `
    <h2>${esc(recipe.name)}</h2>
    ${meta.length ? `<div class="recipe-meta" style="margin-bottom:1rem">${meta.map(m => `<span>${esc(m)}</span>`).join('')}</div>` : ''}
    ${recipe.categories?.length ? `<div class="recipe-categories" style="margin-bottom:1rem">${recipe.categories.map(c => `<span class="category-tag">${esc(c)}</span>`).join('')}</div>` : ''}
    ${sections.join('')}
    ${recipe.source_url ? `<p style="margin-top:1rem"><a href="${esc(recipe.source_url)}" target="_blank" rel="noopener">View original recipe</a></p>` : ''}
  `;
}

function esc(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

export function filterRecipes(query) {
  const q = query.toLowerCase().trim();
  if (!q) return allRecipes;
  return allRecipes.filter(r =>
    r.name.toLowerCase().includes(q) ||
    (r.categories || []).some(c => c.toLowerCase().includes(q)) ||
    (r.ingredients || '').toLowerCase().includes(q)
  );
}
