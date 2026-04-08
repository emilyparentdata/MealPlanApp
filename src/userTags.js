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

function normalize(name) {
  return (name || '').trim().toLowerCase();
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

// Filter helper used by the planner suggestion logic.
export function recipeMatchesUserTag(recipePref, tagName) {
  if (!tagName) return true;
  const norm = normalize(tagName);
  return (recipePref?.userTags || []).some(t => normalize(t) === norm);
}
