// Convenience tags: time-based (auto-derived from prep+cook fields) and
// method-based (auto-detected from recipe text, with manual override).
//
// Used by the planner's per-day "Convenience" dropdown to filter
// suggestions, and by the Preferences page to surface/override the
// auto-detected method tags.

export const CONVENIENCE_OPTIONS = [
  { value: '',             label: 'No filter' },
  { value: 'quick-20',     label: 'Quick (\u226420 min)' },
  { value: 'quick-30',     label: 'Quick (\u226430 min)' },
  { value: 'slow-cooker',  label: 'Slow cooker' },
  { value: 'instant-pot',  label: 'Instant Pot' },
  { value: 'make-ahead',   label: 'Make ahead' },
];

export function getConvenienceLabel(value) {
  return CONVENIENCE_OPTIONS.find(o => o.value === value)?.label || value;
}

// === Time parsing ===

// Parse a single time string ("15 min", "1 hr 30 min", "1.5 hours", "1h30m")
// to a number of minutes, or null if unparseable.
export function parseTimeToMinutes(str) {
  if (!str) return null;
  const s = String(str).toLowerCase().trim();
  if (!s) return null;

  let total = 0;
  let matched = false;

  // Hours: "1 hr", "1 hour", "1.5 hours", "1h"
  // Use a non-letter lookahead instead of \b so "1h30m" splits correctly.
  const hourMatch = s.match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)(?![a-z])/);
  if (hourMatch) {
    total += parseFloat(hourMatch[1]) * 60;
    matched = true;
  }

  // Minutes: "30 min", "30 minutes", "30m"
  const minMatch = s.match(/(\d+(?:\.\d+)?)\s*(?:minutes?|mins?|m)(?![a-z])/);
  if (minMatch) {
    total += parseFloat(minMatch[1]);
    matched = true;
  }

  // Bare number with no unit — assume minutes ("15", "20")
  if (!matched) {
    const bareMatch = s.match(/^(\d+(?:\.\d+)?)\s*$/);
    if (bareMatch) {
      total = parseFloat(bareMatch[1]);
      matched = true;
    }
  }

  return matched ? Math.round(total) : null;
}

// Total active time for a recipe = prep + cook (where parseable).
// Returns null if both fields are missing/unparseable.
export function getRecipeTotalMinutes(recipe) {
  const prep = parseTimeToMinutes(recipe.prep_time);
  const cook = parseTimeToMinutes(recipe.cook_time);
  if (prep === null && cook === null) return null;
  return (prep || 0) + (cook || 0);
}

// === Method auto-detection ===

const SLOW_COOKER_RE = /\b(slow[\s-]?cook(?:er|ing)?|crock[\s-]?pot)\b/i;
const INSTANT_POT_RE = /\b(instant[\s-]?pot|insta[\s-]?pot|pressure[\s-]?cook(?:er|ing)?)\b/i;

function recipeText(recipe) {
  return [
    recipe.name || '',
    recipe.directions || '',
    (recipe.categories || []).join(' '),
  ].join(' ');
}

export function autoDetectSlowCooker(recipe) {
  return SLOW_COOKER_RE.test(recipeText(recipe));
}

export function autoDetectInstantPot(recipe) {
  return INSTANT_POT_RE.test(recipeText(recipe));
}

// Effective tag = manual override if set, otherwise auto-detection.
// Pref values: undefined/null = auto, true = forced on, false = forced off.
export function isSlowCooker(recipe, pref) {
  if (pref && (pref.slowCooker === true || pref.slowCooker === false)) return pref.slowCooker;
  return autoDetectSlowCooker(recipe);
}

export function isInstantPot(recipe, pref) {
  if (pref && (pref.instantPot === true || pref.instantPot === false)) return pref.instantPot;
  return autoDetectInstantPot(recipe);
}

// === Main filter ===

// Returns true if the recipe satisfies the chosen convenience constraint.
// Empty/missing constraint = always true.
export function recipeMatchesConvenience(recipe, pref, convenience) {
  if (!convenience) return true;
  switch (convenience) {
    case 'make-ahead':
      return !!(pref && pref.makeAhead);
    case 'slow-cooker':
      return isSlowCooker(recipe, pref);
    case 'instant-pot':
      return isInstantPot(recipe, pref);
    case 'quick-20': {
      const m = getRecipeTotalMinutes(recipe);
      return m !== null && m <= 20;
    }
    case 'quick-30': {
      const m = getRecipeTotalMinutes(recipe);
      return m !== null && m <= 30;
    }
    default:
      return true;
  }
}
