// User-defined custom tags (e.g., "BLW", "kid favorite", "date night").
//
// Two pieces of state:
//   - definitions: a household-scoped canonical list of tag names. This is
//     what powers the planner filter dropdown and the tag picker on cards.
//   - per-recipe assignment: stored on the existing preferences[uid] doc as
//     a `userTags` array of tag names, so it piggybacks on saveRecipePrefs.
//
// Tag names are stored as the user typed them (display form). Equality and
// dedup use a normalized lower-case form.

import { loadUserTagDefinitions, saveUserTagDefinitions } from './firebase.js';
import { getRecipePrefs, updateRecipePrefs } from './preferences.js';

let definitions = []; // array of tag names (display form)

export async function initUserTags() {
  definitions = await loadUserTagDefinitions();
}

export function getUserTagDefinitions() {
  return definitions.slice();
}

// Slug-form so "one pot", "one-pot-meal", and "One Pot Meal" all collapse
// to the same key. We keep display form as-typed; only equality uses this.
function normalize(name) {
  return (name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export async function addUserTagDefinition(name) {
  const trimmed = (name || '').trim();
  if (!trimmed) return false;
  const norm = normalize(trimmed);
  if (definitions.some(t => normalize(t) === norm)) return false;
  definitions = [...definitions, trimmed];
  definitions.sort((a, b) => a.localeCompare(b));
  await saveUserTagDefinitions(definitions);
  return true;
}

export async function removeUserTagDefinition(name) {
  const norm = normalize(name);
  definitions = definitions.filter(t => normalize(t) !== norm);
  await saveUserTagDefinitions(definitions);
}

export async function renameUserTagDefinition(oldName, newName) {
  const trimmed = (newName || '').trim();
  if (!trimmed) return false;
  const oldNorm = normalize(oldName);
  const newNorm = normalize(trimmed);
  // Update definition list
  definitions = definitions.map(t => normalize(t) === oldNorm ? trimmed : t);
  // If newName already exists as a separate entry, deduplicate
  const seen = new Set();
  definitions = definitions.filter(t => {
    const n = normalize(t);
    if (seen.has(n)) return false;
    seen.add(n);
    return true;
  });
  definitions.sort((a, b) => a.localeCompare(b));
  await saveUserTagDefinitions(definitions);
  return true;
}

// Per-recipe assignment helpers — operate on the existing preferences doc.

export function getRecipeUserTags(recipeUid) {
  return (getRecipePrefs(recipeUid).userTags || []).slice();
}

export async function toggleRecipeUserTag(recipeUid, tagName) {
  const current = getRecipePrefs(recipeUid);
  const list = (current.userTags || []).slice();
  const norm = normalize(tagName);
  const idx = list.findIndex(t => normalize(t) === norm);
  if (idx >= 0) {
    list.splice(idx, 1);
  } else {
    list.push(tagName);
  }
  await updateRecipePrefs(recipeUid, { ...current, userTags: list });
  return list;
}

export function recipeHasUserTag(recipeUid, tagName) {
  const norm = normalize(tagName);
  return getRecipeUserTags(recipeUid).some(t => normalize(t) === norm);
}

// One-way migration: fold a recipe's free-text `categories` into the
// household tag bank + the recipe's per-user tags, then clear the field.
// Called from save paths so existing users see their setup gradually
// consolidate as they touch each recipe. Mutates `recipe` in place.
export async function migrateRecipeCategoriesToUserTags(recipe) {
  const cats = recipe?.categories || [];
  if (!cats.length) return recipe;

  // Add each category to the household definitions (no-op if already present).
  for (const c of cats) {
    const trimmed = (c || '').trim();
    if (trimmed) await addUserTagDefinition(trimmed);
  }

  // Merge into per-recipe userTags, deduped by slug-form so we don't create
  // ["Buddha Bowl", "buddha-bowl"] sitting side by side on the recipe.
  const current = getRecipePrefs(recipe.uid);
  const existing = (current.userTags || []).slice();
  const seen = new Set(existing.map(normalize));
  for (const c of cats) {
    const trimmed = (c || '').trim();
    if (!trimmed) continue;
    const key = normalize(trimmed);
    if (!seen.has(key)) {
      existing.push(trimmed);
      seen.add(key);
    }
  }
  await updateRecipePrefs(recipe.uid, { ...current, userTags: existing });

  recipe.categories = [];
  return recipe;
}

// Need addUserTagDefinition reference since the helper above uses it.
// (Defined above; export already in place.)

// Filter helper used by the planner suggestion logic.
// Checks user tags on preferences AND dietCategories on the recipe object.
export function recipeMatchesUserTag(recipePref, tagName, recipe) {
  if (!tagName) return true;
  const norm = normalize(tagName);
  if ((recipePref?.userTags || []).some(t => normalize(t) === norm)) return true;
  if (recipe && (recipe.dietCategories || []).some(t => normalize(t) === norm)) return true;
  return false;
}
