import { getArchivedRecipes, getCustomRecipes } from './firebase.js';
import { isSlowCooker, isInstantPot, getRecipeTotalMinutes } from './convenience.js';
import { getUserTagDefinitions, addUserTagDefinition, toggleRecipeUserTag, getRecipeUserTags } from './userTags.js';
import { linkifyTimeReferences } from './timer.js';

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
  const { onEdit, onDelete, onToggleFavorite, onAddToPlan, onToggleDoesntEat, onToggleMakeAhead, onToggleSlowCooker, onToggleInstantPot, members, restrictions } = callbacks;

  for (const r of recipes) {
    const card = document.createElement('div');
    card.dataset.uid = r.uid;

    const pref = preferences?.[r.uid] || {};
    card.className = 'recipe-card' + (pref.favorite ? ' is-favorite' : '');
    const isFav = pref.favorite;
    const isMakeAhead = pref.makeAhead;
    const doesntEat = pref.doesntEat || [];

    // Method tags (auto-detected, can be overridden)
    const slowCookerOn = isSlowCooker(r, pref);
    const instantPotOn = isInstantPot(r, pref);
    const slowCookerOverridden = pref.slowCooker === true || pref.slowCooker === false;
    const instantPotOverridden = pref.instantPot === true || pref.instantPot === false;

    // Time chip (read-only)
    const totalMinutes = getRecipeTotalMinutes(r);
    let timeChipHtml = '';
    if (totalMinutes !== null && totalMinutes <= 30) {
      const label = totalMinutes <= 20 ? 'Quick \u226420 min' : 'Quick \u226430 min';
      timeChipHtml = `<span class="time-chip" title="Derived from prep + cook time">${label}</span>`;
    }

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

    // Convenience chips (only shown when active/detected) — green styling
    const convenienceChips = [];
    if (timeChipHtml) convenienceChips.push(timeChipHtml);
    if (slowCookerOn) convenienceChips.push(`<span class="time-chip" title="${slowCookerOverridden ? 'Manual override' : 'Auto-detected'}">Slow Cooker${slowCookerOverridden ? '' : ' \u2728'}</span>`);
    if (instantPotOn) convenienceChips.push(`<span class="time-chip" title="${instantPotOverridden ? 'Manual override' : 'Auto-detected'}">Instant Pot${instantPotOverridden ? '' : ' \u2728'}</span>`);
    if (isMakeAhead) convenienceChips.push(`<span class="time-chip">Make Ahead</span>`);

    // User tag chips (custom user-defined labels) — purple styling
    const userTagsList = (pref.userTags || []);
    const userTagChips = userTagsList.map(t => `<span class="user-tag-chip">${esc(t)}</span>`).join('');

    const allChips = allergenChips + dietChips + convenienceChips.join('') + userTagChips;

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
        <summary>Edit Tags</summary>
        <div class="card-detail-body">
          <p class="tags-edit-hint">Click a tag to turn it on or off. \u2728 means auto-detected.</p>
          <button class="pref-flag-btn toggle-pill make-ahead-btn${isMakeAhead ? ' active' : ''}">Make Ahead</button>
          <button class="pref-flag-btn toggle-pill slow-cooker-btn${slowCookerOn ? ' active' : ''}" title="${slowCookerOverridden ? 'Manual override' : 'Auto-detected'}">Slow Cooker${slowCookerOverridden ? '' : ' \u2728'}</button>
          <button class="pref-flag-btn toggle-pill instant-pot-btn${instantPotOn ? ' active' : ''}" title="${instantPotOverridden ? 'Manual override' : 'Auto-detected'}">Instant Pot${instantPotOverridden ? '' : ' \u2728'}</button>
          <div class="user-tags-editor" data-uid="${esc(r.uid)}">
            <p class="tags-edit-hint" style="margin-top:0.75rem">Your tags:</p>
            <div class="user-tags-pills"></div>
            <div class="user-tags-add">
              <input type="text" class="user-tag-input" placeholder="New tag\u2026" maxlength="40">
              <button class="user-tag-add-btn" type="button">Add</button>
            </div>
          </div>
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

    // Refresh the chip strip from current pref state (called after a toggle).
    function refreshConvenienceChips() {
      const chipsContainer = card.querySelector('.allergen-chips');
      const updatedPref = preferences[r.uid] || {};
      const sc = isSlowCooker(r, updatedPref);
      const ip = isInstantPot(r, updatedPref);
      const ma = updatedPref.makeAhead;
      const scOver = updatedPref.slowCooker === true || updatedPref.slowCooker === false;
      const ipOver = updatedPref.instantPot === true || updatedPref.instantPot === false;

      const newChips = [];
      if (timeChipHtml) newChips.push(timeChipHtml);
      if (sc) newChips.push(`<span class="time-chip" title="${scOver ? 'Manual override' : 'Auto-detected'}">Slow Cooker${scOver ? '' : ' \u2728'}</span>`);
      if (ip) newChips.push(`<span class="time-chip" title="${ipOver ? 'Manual override' : 'Auto-detected'}">Instant Pot${ipOver ? '' : ' \u2728'}</span>`);
      if (ma) newChips.push(`<span class="time-chip">Make Ahead</span>`);

      const updatedTags = (updatedPref.userTags || []);
      const userChipsHtml = updatedTags.map(t => `<span class="user-tag-chip">${esc(t)}</span>`).join('');

      const newAllChips = allergenChips + dietChips + newChips.join('') + userChipsHtml;
      if (chipsContainer) {
        chipsContainer.innerHTML = newAllChips;
      } else if (newAllChips) {
        // Chips area didn't exist before — insert it after the name
        const div = document.createElement('div');
        div.className = 'allergen-chips';
        div.innerHTML = newAllChips;
        card.querySelector('.recipe-card-name').after(div);
      }
    }

    // Make Ahead
    card.querySelector('.make-ahead-btn').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (onToggleMakeAhead) {
        await onToggleMakeAhead(r.uid);
        // Update local preferences cache so refreshConvenienceChips sees the change
        preferences[r.uid] = { ...(preferences[r.uid] || {}), makeAhead: !(preferences[r.uid]?.makeAhead) };
        e.target.classList.toggle('active');
        refreshConvenienceChips();
      }
    });

    // Slow Cooker (auto-detected, can be overridden)
    card.querySelector('.slow-cooker-btn').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (onToggleSlowCooker) {
        const newState = await onToggleSlowCooker(r.uid, r);
        // Mirror the override into the local preferences cache so chip refresh is correct
        const auto = isSlowCooker(r, {}); // auto-detect with no override
        preferences[r.uid] = { ...(preferences[r.uid] || {}) };
        if (newState === auto) delete preferences[r.uid].slowCooker;
        else preferences[r.uid].slowCooker = newState;

        e.target.classList.toggle('active', newState);
        const overridden = preferences[r.uid].slowCooker === true || preferences[r.uid].slowCooker === false;
        e.target.title = overridden ? 'Manual override' : 'Auto-detected';
        e.target.textContent = `Slow Cooker${overridden ? '' : ' \u2728'}`;
        refreshConvenienceChips();
      }
    });

    // Instant Pot (auto-detected, can be overridden)
    card.querySelector('.instant-pot-btn').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (onToggleInstantPot) {
        const newState = await onToggleInstantPot(r.uid, r);
        const auto = isInstantPot(r, {});
        preferences[r.uid] = { ...(preferences[r.uid] || {}) };
        if (newState === auto) delete preferences[r.uid].instantPot;
        else preferences[r.uid].instantPot = newState;

        e.target.classList.toggle('active', newState);
        const overridden = preferences[r.uid].instantPot === true || preferences[r.uid].instantPot === false;
        e.target.title = overridden ? 'Manual override' : 'Auto-detected';
        e.target.textContent = `Instant Pot${overridden ? '' : ' \u2728'}`;
        refreshConvenienceChips();
      }
    });

    // === User tag editor ===
    const tagEditor = card.querySelector('.user-tags-editor');
    const pillsEl = tagEditor.querySelector('.user-tags-pills');
    const tagInput = tagEditor.querySelector('.user-tag-input');
    const tagAddBtn = tagEditor.querySelector('.user-tag-add-btn');

    function renderTagPills() {
      const defs = getUserTagDefinitions();
      const assigned = new Set((preferences[r.uid]?.userTags || []).map(t => t.toLowerCase()));
      if (!defs.length) {
        pillsEl.innerHTML = '<span class="tags-edit-hint" style="font-style:italic">No tags yet \u2014 add one below.</span>';
        return;
      }
      pillsEl.innerHTML = defs.map(t => {
        const active = assigned.has(t.toLowerCase()) ? ' active' : '';
        return `<button type="button" class="pref-flag-btn toggle-pill user-tag-pill${active}" data-tag="${escAttr(t)}">${esc(t)}</button>`;
      }).join('');
      pillsEl.querySelectorAll('.user-tag-pill').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const tag = btn.dataset.tag;
          const newList = await toggleRecipeUserTag(r.uid, tag);
          preferences[r.uid] = { ...(preferences[r.uid] || {}), userTags: newList };
          btn.classList.toggle('active');
          refreshConvenienceChips();
        });
      });
    }

    async function handleAddTag() {
      const name = tagInput.value.trim();
      if (!name) return;
      const created = await addUserTagDefinition(name);
      tagInput.value = '';
      if (created) {
        // Auto-assign new tag to this recipe so the user sees the result.
        const newList = await toggleRecipeUserTag(r.uid, name);
        preferences[r.uid] = { ...(preferences[r.uid] || {}), userTags: newList };
        refreshConvenienceChips();
      }
      renderTagPills();
    }

    tagAddBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      handleAddTag();
    });
    tagInput.addEventListener('click', (e) => e.stopPropagation());
    tagInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        handleAddTag();
      }
    });

    renderTagPills();

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
    sections.push(`<div class="detail-section"><h4>Directions</h4><pre>${linkifyTimeReferences(esc(recipe.directions))}</pre></div>`);
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

function escAttr(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function filterRecipes(query) {
  const q = query.toLowerCase().trim();
  if (!q) return allRecipes;
  return allRecipes.filter(r => {
    if (r.name.toLowerCase().includes(q)) return true;
    if ((r.categories || []).some(c => c.toLowerCase().includes(q))) return true;
    if ((r.ingredients || '').toLowerCase().includes(q)) return true;
    const tags = getRecipeUserTags(r.uid);
    if (tags.some(t => t.toLowerCase().includes(q))) return true;
    return false;
  });
}
