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

export function renderRecipeList(container, recipes, onClick, preferences, callbacks = {}) {
  container.innerHTML = '';
  if (!recipes.length) {
    container.innerHTML = '<p style="color:var(--text-light);padding:2rem;">No recipes found.</p>';
    return;
  }
  const { onEdit, onDelete, onToggleFavorite, onAddToPlan, onToggleDoesntEat, onToggleMakeAhead, members, restrictions } = callbacks;

  for (const r of recipes) {
    const card = document.createElement('div');
    card.dataset.uid = r.uid;

    const pref = preferences?.[r.uid] || {};
    card.className = 'recipe-card' + (pref.favorite ? ' is-favorite' : '');
    const isFav = pref.favorite;
    const isMakeAhead = pref.makeAhead;
    const doesntEat = pref.doesntEat || [];

    // Action buttons row
    const actions = [];
    if (onEdit) actions.push(`<button class="card-action-btn edit-btn" title="Edit">Edit</button>`);
    actions.push(`<button class="card-action-btn fav-action-btn${isFav ? ' active' : ''}" title="${isFav ? 'Remove from favorites' : 'Add to favorites'}">${isFav ? '\u2764 Favorite' : '\u2661 Favorite'}</button>`);
    if (onAddToPlan) actions.push(`<button class="card-action-btn plan-btn" title="Add to Plan">Add to Plan</button>`);

    // Family Preferences dropdown
    const membersHtml = (members || []).map(m => {
      const active = doesntEat.includes(m) ? ' active' : '';
      return `<button class="pref-member-btn${active}" data-member="${esc(m)}">${esc(m)}</button>`;
    }).join('');

    // Allergen chips
    const allergenChips = (r.allergens || []).map(a => {
      const hasConflict = restrictions && Object.values(restrictions).some(arr => arr.includes(a));
      const label = a.charAt(0).toUpperCase() + a.slice(1);
      return `<span class="allergen-chip${hasConflict ? ' conflict' : ''}">${esc(label)}</span>`;
    }).join('');
    // Diet category chips
    const dietChips = (r.dietCategories || []).map(d => {
      const label = d.charAt(0).toUpperCase() + d.slice(1);
      return `<span class="allergen-chip diet">${esc(label)}</span>`;
    }).join('');
    const allChips = allergenChips + dietChips;

    card.innerHTML = `
      <h3 class="recipe-card-name">${esc(r.name)}</h3>
      ${allChips ? `<div class="allergen-chips">${allChips}</div>` : ''}
      <div class="card-actions">${actions.join('')}</div>
      <details class="card-detail family-prefs-detail">
        <summary>Family Preferences</summary>
        <div class="card-detail-body">
          <span class="pref-label">Won't eat:</span>
          <div class="pref-member-btns">${membersHtml || '<span class="pref-label">No members</span>'}</div>
        </div>
      </details>
      <details class="card-detail tags-detail">
        <summary>Tags</summary>
        <div class="card-detail-body">
          <button class="pref-flag-btn make-ahead-btn${isMakeAhead ? ' active' : ''}">Make Ahead</button>
        </div>
      </details>
      ${onDelete ? '<button class="card-trash-btn" title="Delete recipe">&#128465;</button>' : ''}
    `;

    // Wire actions — stop propagation so card click (view detail) doesn't fire
    if (onEdit) {
      card.querySelector('.edit-btn').addEventListener('click', (e) => { e.stopPropagation(); onEdit(r); });
    }
    if (onDelete) {
      card.querySelector('.card-trash-btn').addEventListener('click', (e) => { e.stopPropagation(); onDelete(r); });
    }

    // Favorite
    const favBtn = card.querySelector('.fav-action-btn');
    if (favBtn && onToggleFavorite) {
      favBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const nowFav = await onToggleFavorite(r.uid);
        favBtn.textContent = nowFav ? '\u2764 Favorite' : '\u2661 Favorite';
        favBtn.classList.toggle('active', nowFav);
        card.classList.toggle('is-favorite', nowFav);
      });
    }

    // Add to Plan
    if (onAddToPlan) {
      card.querySelector('.plan-btn').addEventListener('click', (e) => { e.stopPropagation(); onAddToPlan(r); });
    }

    // Won't eat member buttons
    card.querySelectorAll('.pref-member-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (onToggleDoesntEat) {
          await onToggleDoesntEat(r.uid, btn.dataset.member);
          btn.classList.toggle('active');
        }
      });
    });

    // Make Ahead
    card.querySelector('.make-ahead-btn').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (onToggleMakeAhead) {
        await onToggleMakeAhead(r.uid);
        e.target.classList.toggle('active');
      }
    });

    // Prevent detail toggles from triggering card click
    card.querySelectorAll('details, summary').forEach(el => {
      el.addEventListener('click', (e) => e.stopPropagation());
    });

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
