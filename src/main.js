import { initFirebase, getMembers, saveRecipeToFirebase, archiveRecipe, bulkSaveRecipes, savePlan, loadPlan, commitPlan, loadCommittedPlan, onAuthStateChanged, signInWithGoogle, signInWithEmail, signUpWithEmail, sendPasswordReset, signOut, getCurrentUser, loadUserHousehold, createHousehold, joinHousehold, getHouseholdMembers, getHouseholdInfo, loadHouseholdRecipes, loadRepeatWindow, saveRepeatWindow, updateHouseholdMembers, loadRestrictions, getRestrictions, saveRestrictions, loadWeekStartDay, getWeekStartDay, saveWeekStartDay } from './firebase.js';
import { loadRecipes, getRecipes, getRecipeByUid, renderRecipeList, renderRecipeDetail, filterRecipes } from './recipes.js';
import { initPreferences, getAllPreferences, toggleFavorite, toggleDoesntEat, toggleMakeAhead, toggleSlowCooker, toggleInstantPot, getRecipePrefs, updateRecipePrefs } from './preferences.js';
import { initUserTags, getUserTagDefinitions, addUserTagDefinition, toggleRecipeUserTag } from './userTags.js';
import { renderPlanner, suggestAllMeals, shiftWeek, setWeek, getWeekLabel, getWeekKey, getDAYS, getCurrentWeekStart, resetWeekStart, getWeekStart } from './planner.js';
import { renderPlanView } from './plan-view.js';
import { renderGroceryList, getGroceryText, clearChecked, loadAndRenderExtras, addExtraItem } from './grocery.js';
import { getConvenienceLabel, getRecipeTotalMinutes, isSlowCooker, isInstantPot } from './convenience.js';
import { initTimerWidget } from './timer.js';

// === State ===
const BETA_CODE = 'MEALS2026';
const ALLERGENS = ['Dairy', 'Gluten', 'Tree Nuts', 'Peanuts', 'Eggs', 'Soy', 'Shellfish', 'Fish', 'Sesame'];
const DIET_CATEGORIES = ['Vegetarian', 'Vegan'];
let members = [];
let appInitialized = false;

// === Init ===
async function init() {
  initFirebase();
  setupLoginPage();
  setupHouseholdPage();

  // Listen for auth state changes
  onAuthStateChanged(async (user) => {
    hideAll();
    appInitialized = false;

    if (!user) {
      document.getElementById('login-screen').classList.remove('hidden');
      return;
    }

    // User is signed in — check if they have a household
    try {
      const household = await loadUserHousehold();
      if (household) {
        await showApp(user, household);
      } else {
        document.getElementById('household-setup').classList.remove('hidden');
      }
    } catch (e) {
      console.error('Failed to load app:', e);
      document.getElementById('login-screen').classList.remove('hidden');
      showLoginError('Something went wrong loading your data. Please try signing in again.');
    }
  });
}

function hideAll() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('household-setup').classList.add('hidden');
  document.getElementById('app-container').classList.add('hidden');
}

async function showApp(user, household) {
  hideAll();
  document.getElementById('app-container').classList.remove('hidden');
  document.getElementById('user-display-name').textContent = user.displayName || user.email;

  if (!appInitialized) {
    await initApp(household);
  }
}

async function initApp(household) {
  // Load household-scoped data from Firestore
  await loadWeekStartDay();
  resetWeekStart(); // recalculate now that we know the start day
  await loadHouseholdRecipes();
  await loadRecipes();
  await initPreferences();
  await initUserTags();

  // Get members and restrictions from household
  members = await getHouseholdMembers();
  await loadRestrictions();
  setupNavigation();
  setupPlannerPage();
  setupPlanViewPage();
  setupGroceryPage();
  setupManagePage();
  setupFeedbackModal();

  setupSignOut();
  setupEditModal();
  setupHouseholdSettings();
  initTimerWidget();

  // Show household name + invite code in header
  if (household) {
    document.getElementById('user-display-name').textContent = household.name;
    const inviteBtn = document.getElementById('invite-code-btn');
    document.getElementById('invite-code-display').textContent = household.inviteCode;
    inviteBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(household.inviteCode);
        showToast(`Invite code "${household.inviteCode}" copied! Share it with your partner to join this household.`);
      } catch {
        showToast(`Invite code: ${household.inviteCode}`);
      }
    });
  }

  showPage('plan-view');
  appInitialized = true;
}

// === Login Page ===
function setupLoginPage() {
  document.getElementById('google-signin-btn').addEventListener('click', async () => {
    try {
      await signInWithGoogle();
    } catch (e) {
      showLoginError(e.message);
    }
  });

  document.getElementById('email-signin-btn').addEventListener('click', async () => {
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    if (!email || !password) {
      showLoginError('Please enter email and password.');
      return;
    }
    try {
      await signInWithEmail(email, password);
    } catch (e) {
      showLoginError(friendlyAuthError(e.code));
    }
  });

  document.getElementById('email-signup-btn').addEventListener('click', async () => {
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const betaCode = document.getElementById('beta-code').value.trim();
    if (!betaCode) {
      showLoginError('Please enter a beta access code to create an account.');
      return;
    }
    if (betaCode.toUpperCase() !== BETA_CODE) {
      showLoginError('Invalid beta access code.');
      return;
    }
    if (!email || !password) {
      showLoginError('Please enter email and password.');
      return;
    }
    if (password.length < 6) {
      showLoginError('Password must be at least 6 characters.');
      return;
    }
    try {
      await signUpWithEmail(email, password);
    } catch (e) {
      showLoginError(friendlyAuthError(e.code));
    }
  });

  document.getElementById('forgot-password-btn').addEventListener('click', async () => {
    const email = document.getElementById('login-email').value.trim();
    if (!email) {
      showLoginError('Enter your email address above, then tap "Forgot password?"');
      return;
    }
    try {
      await sendPasswordReset(email);
      showLoginError('Password reset email sent! Check your inbox.');
    } catch (e) {
      showLoginError(friendlyAuthError(e.code));
    }
  });

  // Allow Enter key to submit
  document.getElementById('login-password').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('email-signin-btn').click();
  });
}

function showLoginError(msg) {
  const el = document.getElementById('login-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}

function friendlyAuthError(code) {
  const messages = {
    'auth/user-not-found': 'No account found with that email. Click "Create Account" to sign up.',
    'auth/wrong-password': 'Incorrect password.',
    'auth/invalid-email': 'Please enter a valid email address.',
    'auth/email-already-in-use': 'An account with that email already exists. Try signing in.',
    'auth/weak-password': 'Password must be at least 6 characters.',
    'auth/too-many-requests': 'Too many attempts. Please try again later.',
    'auth/invalid-credential': 'Incorrect email or password.',
  };
  return messages[code] || 'Sign in failed. Please try again.';
}

// === Household Setup ===
let starterPackData = null;

async function ensureStarterPackData() {
  if (starterPackData) return starterPackData;
  try {
    const resp = await fetch('data/starter-packs.json');
    starterPackData = await resp.json();
    return starterPackData;
  } catch (e) {
    console.warn('Could not load starter packs:', e);
    return null;
  }
}

function renderStarterPackOptions(container, existingRecipeUids) {
  if (!starterPackData) {
    container.innerHTML = '<p class="section-help">Could not load starter packs.</p>';
    return;
  }
  container.innerHTML = starterPackData.packs.map(pack => {
    const alreadyHave = pack.recipes.filter(r => existingRecipeUids.has(r.uid)).length;
    const suffix = alreadyHave ? ` \u2014 ${alreadyHave} already added` : '';
    return `
      <label class="starter-pack-option">
        <input type="checkbox" value="${pack.id}" ${alreadyHave === pack.recipes.length ? 'disabled' : 'checked'}>
        <span class="starter-pack-info">
          <span class="starter-pack-name">${pack.icon} ${pack.name}</span>
          <span class="starter-pack-desc">${pack.description} (${pack.recipes.length} recipes${suffix})</span>
        </span>
      </label>
    `;
  }).join('');
}

function getSelectedStarterRecipes(containerSelector, existingRecipeUids) {
  if (!starterPackData) return [];
  const checked = document.querySelectorAll(`${containerSelector} input:checked`);
  const selectedIds = new Set([...checked].map(cb => cb.value));
  const recipes = [];
  for (const pack of starterPackData.packs) {
    if (selectedIds.has(pack.id)) {
      for (const r of pack.recipes) {
        if (existingRecipeUids && existingRecipeUids.has(r.uid)) continue;
        recipes.push({
          ...r,
          rating: 0,
          source_url: '',
          notes: r.notes || '',
          image_url: '',
        });
      }
    }
  }
  return recipes;
}

function setupHouseholdPage() {
  document.getElementById('create-household-btn').addEventListener('click', async () => {
    const name = document.getElementById('household-name').value.trim();
    const membersStr = document.getElementById('household-members').value.trim();
    if (!name) {
      showHouseholdError('Please enter a household name.');
      return;
    }
    const memberNames = membersStr
      ? membersStr.split(',').map(s => s.trim()).filter(Boolean)
      : [];
    if (!memberNames.length) {
      showHouseholdError('Please enter at least one family member name.');
      return;
    }
    try {
      const { inviteCode } = await createHousehold(name, memberNames);
      const weekDay = Number(document.getElementById('setup-week-start').value);
      await saveWeekStartDay(weekDay);
      showToast(`Household created! Invite code: ${inviteCode}`);
      const household = await getHouseholdInfo();
      const user = (await import('./firebase.js')).getCurrentUser();
      await showApp(user, household);
    } catch (e) {
      showHouseholdError(e.message);
    }
  });

  document.getElementById('join-household-btn').addEventListener('click', async () => {
    const code = document.getElementById('join-invite-code').value.trim();
    if (!code) {
      showHouseholdError('Please enter an invite code.');
      return;
    }
    try {
      const { name } = await joinHousehold(code);
      showToast(`Joined "${name}"!`);
      const household = await getHouseholdInfo();
      const user = (await import('./firebase.js')).getCurrentUser();
      await showApp(user, household);
    } catch (e) {
      showHouseholdError(e.message);
    }
  });

  document.getElementById('household-signout-btn').addEventListener('click', async () => {
    await signOut();
  });
}

function showHouseholdError(msg) {
  const el = document.getElementById('household-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}

function setupSignOut() {
  document.getElementById('sign-out-btn').addEventListener('click', async () => {
    await signOut();
  });
}

// === Household Settings ===
function setupHouseholdSettings() {
  const modal = document.getElementById('household-settings-modal');
  const memberList = document.getElementById('household-member-list');
  const restrictionsList = document.getElementById('household-restrictions-list');
  const newInput = document.getElementById('new-member-input');

  const weekStartSelect = document.getElementById('week-start-day-select');

  document.getElementById('household-settings-btn').addEventListener('click', () => {
    renderMemberList();
    renderRestrictions();
    weekStartSelect.value = String(getWeekStartDay());
    modal.classList.remove('hidden');
  });

  weekStartSelect.addEventListener('change', async () => {
    const newDay = Number(weekStartSelect.value);
    await saveWeekStartDay(newDay);
    resetWeekStart();
    showPage(currentPage || 'plan-view');
    const dayName = weekStartSelect.options[weekStartSelect.selectedIndex].text;
    showToast(`Week now starts on ${dayName}`);
  });

  document.querySelector('.household-settings-close').addEventListener('click', () => {
    modal.classList.add('hidden');
  });
  modal.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) e.currentTarget.classList.add('hidden');
  });

  function renderMemberList() {
    memberList.innerHTML = '';
    for (const m of members) {
      const row = document.createElement('div');
      row.className = 'member-row';
      row.innerHTML = `
        <span class="member-name">${escManage(m)}</span>
        <button class="member-remove-btn" title="Remove ${escManage(m)}">&times;</button>
      `;
      row.querySelector('.member-remove-btn').addEventListener('click', async () => {
        if (!confirm(`Remove "${m}" from your household? This won't delete their recipe preferences.`)) return;
        members = members.filter(n => n !== m);
        await updateHouseholdMembers(members);
        renderMemberList();
        renderRestrictions();
        showToast(`"${m}" removed from household.`);
      });
      memberList.appendChild(row);
    }
  }

  function renderRestrictions() {
    const restrictions = getRestrictions();
    restrictionsList.innerHTML = '';
    for (const m of members) {
      const memberRestrictions = restrictions[m] || [];
      const block = document.createElement('div');
      block.className = 'restriction-block';
      block.innerHTML = `
        <span class="restriction-member-name">${escManage(m)}</span>
        <div class="restriction-pills">
          ${ALLERGENS.map(a => {
            const key = a.toLowerCase();
            const active = memberRestrictions.includes(key) ? ' active' : '';
            return `<button class="restriction-pill${active}" data-allergen="${escAttr(key)}">${escManage(a)}-free</button>`;
          }).join('')}
          ${DIET_CATEGORIES.map(a => {
            const key = a.toLowerCase();
            const active = memberRestrictions.includes(key) ? ' active' : '';
            return `<button class="restriction-pill diet${active}" data-allergen="${escAttr(key)}">${escManage(a)}</button>`;
          }).join('')}
        </div>
      `;
      block.querySelectorAll('.restriction-pill').forEach(pill => {
        pill.addEventListener('click', async () => {
          const allergen = pill.dataset.allergen;
          const current = restrictions[m] || [];
          if (current.includes(allergen)) {
            restrictions[m] = current.filter(a => a !== allergen);
          } else {
            restrictions[m] = [...current, allergen];
          }
          if (restrictions[m].length === 0) delete restrictions[m];
          await saveRestrictions(restrictions);
          pill.classList.toggle('active');
        });
      });
      restrictionsList.appendChild(block);
    }
  }

  document.getElementById('add-member-btn').addEventListener('click', addMember);
  newInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addMember();
  });

  async function addMember() {
    const name = newInput.value.trim();
    if (!name) return;
    if (members.some(m => m.toLowerCase() === name.toLowerCase())) {
      showToast(`"${name}" is already in your household.`);
      return;
    }
    members.push(name);
    await updateHouseholdMembers(members);
    newInput.value = '';
    renderMemberList();
    renderRestrictions();
    showToast(`"${name}" added to household.`);
  }
}

// === Navigation ===
function setupNavigation() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => showPage(btn.dataset.page));
  });
  document.getElementById('home-link').addEventListener('click', () => showPage('plan-view'));

  // Global navigation handler for [data-navigate] links/buttons in empty states etc.
  document.addEventListener('click', (e) => {
    const navEl = e.target.closest('[data-navigate]');
    if (navEl) {
      e.preventDefault();
      showPage(navEl.dataset.navigate);
    }
  });
}

let currentPage = 'plan-view';
function showPage(pageId) {
  currentPage = pageId;
  document.querySelectorAll('.page').forEach(p => {
    p.classList.remove('active');
    p.classList.add('hidden');
  });
  const page = document.getElementById(`page-${pageId}`);
  if (page) {
    page.classList.remove('hidden');
    page.classList.add('active');
  }
  document.querySelectorAll('.nav-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.page === pageId);
  });

  // Sync planner week to match the week being viewed on This Week
  if (pageId === 'planner') {
    setWeek(getViewWeekStart());
  }
  // Refresh page content on show
  if (pageId === 'planner') refreshPlanner();
  if (pageId === 'plan-view') refreshPlanView();
  if (pageId === 'grocery') refreshGrocery();
  if (pageId === 'manage') refreshManageRecipeList();
}



// === Planner Page ===
function setupPlannerPage() {
  document.getElementById('prev-week').addEventListener('click', () => {
    shiftWeek(-1);
    refreshPlanner();
  });
  document.getElementById('next-week').addEventListener('click', () => {
    shiftWeek(1);
    refreshPlanner();
  });
  // Load saved repeat window setting
  const repeatSelect = document.getElementById('repeat-window');
  loadRepeatWindow().then(val => { repeatSelect.value = String(val); });
  repeatSelect.addEventListener('change', () => {
    saveRepeatWindow(parseInt(repeatSelect.value, 10));
  });

  document.getElementById('suggest-all-btn').addEventListener('click', async () => {
    const result = await suggestAllMeals(document.getElementById('planner-grid'), members);
    refreshPlanner();

    const convBlanks = (result?.unfilled || []).filter(u => u.reason === 'no-convenience-matches');
    if (convBlanks.length) {
      // Group by which convenience filter blocked them, so the toast can name each one
      const byFilter = {};
      for (const u of convBlanks) {
        (byFilter[u.convenience] ||= []).push(u.day);
      }
      const parts = Object.entries(byFilter).map(([conv, days]) =>
        `${days.join(', ')} (no recipes match "${getConvenienceLabel(conv)}")`
      );
      showToast(`Left blank: ${parts.join('; ')}. Adjust filters or tag recipes in Recipes → Preferences.`, 9000);
    } else {
      showToast('Menu suggested! Avoids repeated proteins and recent meals.');
    }
  });
  document.getElementById('clear-all-btn').addEventListener('click', async () => {
    const { savePlan: sp, loadPlan: lp } = await import('./firebase.js');
    const { getWeekKey: gk } = await import('./planner.js');
    const weekKey = gk();
    const plan = await lp(weekKey) || { days: {} };
    for (const day of Object.keys(plan.days)) {
      if (plan.days[day]) plan.days[day].recipeUid = '';
    }
    plan.updated = Date.now();
    await sp(weekKey, plan);
    refreshPlanner();
    showToast('All meals cleared.');
  });
  document.getElementById('commit-plan-btn').addEventListener('click', async () => {
    const weekKey = getWeekKey();
    const plan = await loadPlan(weekKey);
    if (!plan || !plan.days) {
      showToast('Nothing to commit — plan the week first.');
      return;
    }
    await commitPlan(weekKey, plan);
    updateCommitStatus(weekKey);
    showToast('Plan committed!');
    // Navigate to This Week, synced to the committed week
    const committedStart = new Date(weekKey + 'T00:00:00');
    const thisWeekStart = getWeekStart(new Date());
    viewWeekOffset = Math.round((committedStart - thisWeekStart) / (7 * 24 * 60 * 60 * 1000));
    showPage('plan-view');
  });
}

async function updateCommitStatus(weekKey) {
  const el = document.getElementById('commit-status');
  const committed = await loadCommittedPlan(weekKey);
  if (committed?.committedAt) {
    el.textContent = `Last committed: ${new Date(committed.committedAt).toLocaleString()}`;
  } else {
    el.textContent = 'Not yet committed — "This Week" won\'t show this plan until you commit.';
  }
}

function refreshPlanner() {
  const weekKey = getWeekKey();
  document.getElementById('week-label').textContent = getWeekLabel();
  const grid = document.getElementById('planner-grid');
  if (getRecipes().length === 0) {
    grid.innerHTML = `
      <div class="empty-state-card">
        <p>Add some recipes first to start planning meals.</p>
        <button class="btn primary" data-navigate="manage">Add Recipes</button>
      </div>
    `;
    return;
  }
  renderPlanner(grid, members, {
    onViewRecipe: (recipe) => {
      currentDetailRecipe = recipe;
      renderRecipeDetail(document.getElementById('recipe-detail'), recipe);
      document.getElementById('recipe-modal').classList.remove('hidden');
    },
  });
  updateCommitStatus(weekKey);
}

// === Plan View Page ===
let viewWeekOffset = 0;

function getViewWeekStart() {
  const d = getWeekStart(new Date());
  d.setDate(d.getDate() + viewWeekOffset * 7);
  return d;
}

function getViewWeekKey() {
  return getViewWeekStart().toISOString().slice(0, 10);
}

function getViewWeekLabel() {
  const d = getViewWeekStart();
  const end = new Date(d);
  end.setDate(end.getDate() + 6);
  const fmt = d2 => d2.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${fmt(d)} - ${fmt(end)}`;
}

function setupPlanViewPage() {
  document.getElementById('view-prev-week').addEventListener('click', () => {
    viewWeekOffset--;
    refreshPlanView();
  });
  document.getElementById('view-next-week').addEventListener('click', () => {
    viewWeekOffset++;
    refreshPlanView();
  });
}

function refreshPlanView() {
  // Welcome card for new users with zero recipes
  const welcomeEl = document.getElementById('plan-view-welcome');
  if (getRecipes().length === 0) {
    welcomeEl.innerHTML = `
      <div class="welcome-card">
        <h3>Welcome to Meal Plan!</h3>
        <p>Here's how it works:</p>
        <div class="welcome-steps">
          <div class="welcome-step"><span class="welcome-step-num">1</span> Add your family's recipes</div>
          <div class="welcome-step"><span class="welcome-step-num">2</span> Plan your week</div>
          <div class="welcome-step"><span class="welcome-step-num">3</span> Get your grocery list</div>
        </div>
        <div class="welcome-actions">
          <button class="btn primary" data-navigate="manage">Add Your First Recipes</button>
          <a href="guide.html" target="_blank" class="btn">Learn More</a>
        </div>
      </div>
    `;
  } else {
    welcomeEl.innerHTML = '';
  }

  renderPlanView(
    document.getElementById('plan-view-grid'),
    document.getElementById('view-week-label'),
    getViewWeekKey(),
    getViewWeekLabel(),
    (recipe) => {
      currentDetailRecipe = recipe;
      renderRecipeDetail(document.getElementById('recipe-detail'), recipe);
      document.getElementById('recipe-modal').classList.remove('hidden');
    },
    (recipe) => {
      openFeedbackModal(recipe);
    }
  );
}

// === Grocery Page ===
function setupGroceryPage() {
  document.getElementById('grocery-prev-week').addEventListener('click', () => {
    shiftWeek(-1);
    refreshGrocery();
  });
  document.getElementById('grocery-next-week').addEventListener('click', () => {
    shiftWeek(1);
    refreshGrocery();
  });

  async function copyTextToClipboard(text) {
    // Try the modern async API first
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        // fall through to legacy fallback
      }
    }
    // Legacy fallback: hidden textarea + execCommand('copy')
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '0';
      ta.style.left = '0';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }

  document.getElementById('copy-grocery-btn').addEventListener('click', async () => {
    if (groceryLoading) await groceryLoading;
    const text = getGroceryText();
    if (!text) {
      showToast('Nothing to copy — no meals planned this week.');
      return;
    }
    const ok = await copyTextToClipboard(text);
    showToast(ok ? 'Grocery list copied to clipboard!' : 'Could not copy — try selecting and copying manually.');
  });

  document.getElementById('share-grocery-btn').addEventListener('click', async () => {
    if (groceryLoading) await groceryLoading;
    const text = getGroceryText();
    if (!text) {
      showToast('Nothing to share — no meals planned this week.');
      return;
    }
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Grocery List', text });
        return;
      } catch (e) {
        if (e.name === 'AbortError') return;
        // fall through to clipboard fallback
      }
    }
    // Desktop / no Web Share API: copy to clipboard
    const ok = await copyTextToClipboard(text);
    showToast(ok ? 'Grocery list copied to clipboard!' : 'Could not share — try the Copy button.');
  });

  // Extra items
  const extrasContainer = document.getElementById('grocery-extras-list');
  const extraInput = document.getElementById('grocery-extra-input');

  document.getElementById('add-extra-btn').addEventListener('click', async () => {
    await addExtraItem(extraInput.value, extrasContainer);
    extraInput.value = '';
    extraInput.focus();
  });
  extraInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('add-extra-btn').click();
  });

  document.getElementById('clear-checked-btn').addEventListener('click', () => {
    clearChecked();
    refreshGrocery();
    showToast('All items unchecked.');
  });
}

let groceryLoading = null;
function refreshGrocery() {
  document.getElementById('grocery-week-label').textContent = getWeekLabel();
  loadAndRenderExtras(document.getElementById('grocery-extras-list'));
  groceryLoading = renderGroceryList(
    document.getElementById('grocery-checklist'),
    document.getElementById('grocery-list'),
    document.getElementById('grocery-week-label')
  );
}

// === Inline Preference Controls (used in Manage Recipes + Feedback Modal) ===

function buildInlinePreferenceControls(recipeUid, { onUpdate, onEdit, onDelete } = {}) {
  const prefs = getRecipePrefs(recipeUid);
  const recipe = getRecipeByUid(recipeUid);
  const el = document.createElement('div');
  el.className = 'inline-pref-controls';

  const favActive = prefs.favorite ? ' active' : '';

  // Top row: Favorite, Edit, Delete
  let topButtons = `<button class="pref-flag-btn fav-flag-btn${favActive}">${prefs.favorite ? '\u2764' : '\u2661'} Favorite</button>`;
  if (onEdit) topButtons += `<button class="btn edit-btn">Edit</button>`;
  if (onDelete) topButtons += `<button class="btn delete-btn">Delete</button>`;

  // Bottom row: Won't eat + Make ahead
  const doesntEatHtml = members.map(m => {
    const active = (prefs.doesntEat || []).includes(m) ? ' active' : '';
    return `<button class="pref-member-btn${active}" data-member="${escAttr(m)}">${escManage(m)}</button>`;
  }).join('');
  const makeAheadActive = prefs.makeAhead ? ' active' : '';

  // Method tags (auto-detected, can be overridden)
  const slowCookerOn = recipe ? isSlowCooker(recipe, prefs) : false;
  const instantPotOn = recipe ? isInstantPot(recipe, prefs) : false;
  const slowCookerOverridden = prefs.slowCooker === true || prefs.slowCooker === false;
  const instantPotOverridden = prefs.instantPot === true || prefs.instantPot === false;

  // Time chip (read-only, derived from prep+cook)
  const totalMinutes = recipe ? getRecipeTotalMinutes(recipe) : null;
  let timeChipHtml = '';
  if (totalMinutes !== null && totalMinutes <= 30) {
    const label = totalMinutes <= 20 ? 'Quick \u226420 min' : 'Quick \u226430 min';
    timeChipHtml = `<span class="time-chip" title="Derived from prep + cook time">${label}</span>`;
  }

  // Chip strip showing currently active convenience tags (read-only display)
  function buildChipStrip() {
    const p = getRecipePrefs(recipeUid);
    const sc = recipe ? isSlowCooker(recipe, p) : false;
    const ip = recipe ? isInstantPot(recipe, p) : false;
    const scOver = p.slowCooker === true || p.slowCooker === false;
    const ipOver = p.instantPot === true || p.instantPot === false;
    const chips = [];
    if (timeChipHtml) chips.push(timeChipHtml);
    if (sc) chips.push(`<span class="time-chip" title="${scOver ? 'Manual override' : 'Auto-detected'}">Slow Cooker${scOver ? '' : ' \u2728'}</span>`);
    if (ip) chips.push(`<span class="time-chip" title="${ipOver ? 'Manual override' : 'Auto-detected'}">Instant Pot${ipOver ? '' : ' \u2728'}</span>`);
    if (p.makeAhead) chips.push(`<span class="time-chip">Make Ahead</span>`);
    return chips.join('');
  }

  el.innerHTML = `
    <div class="pref-row-inline pref-top-actions">${topButtons}</div>
    <div class="pref-row-inline">
      <span class="pref-label">Won't eat:</span>
      <div class="pref-member-btns">${doesntEatHtml}</div>
    </div>
    <div class="convenience-chip-strip allergen-chips">${buildChipStrip()}</div>
    <div class="pref-row-inline pref-method-row">
      <span class="pref-label">Edit tags:</span>
      <button class="pref-flag-btn toggle-pill make-ahead-btn${makeAheadActive}">Make Ahead</button>
      <button class="pref-flag-btn toggle-pill slow-cooker-btn${slowCookerOn ? ' active' : ''}" title="${slowCookerOverridden ? 'Manual override' : 'Auto-detected'}">Slow Cooker${slowCookerOverridden ? '' : ' \u2728'}</button>
      <button class="pref-flag-btn toggle-pill instant-pot-btn${instantPotOn ? ' active' : ''}" title="${instantPotOverridden ? 'Manual override' : 'Auto-detected'}">Instant Pot${instantPotOverridden ? '' : ' \u2728'}</button>
    </div>
  `;

  function refreshChipStrip() {
    const strip = el.querySelector('.convenience-chip-strip');
    if (strip) strip.innerHTML = buildChipStrip();
  }

  // Wire favorite
  el.querySelector('.fav-flag-btn').addEventListener('click', async (e) => {
    e.stopPropagation();
    const nowFav = await toggleFavorite(recipeUid);
    e.target.classList.toggle('active', nowFav);
    e.target.textContent = (nowFav ? '\u2764' : '\u2661') + ' Favorite';
    if (onUpdate) onUpdate();
  });

  // Wire edit/delete if provided
  if (onEdit) {
    el.querySelector('.edit-btn').addEventListener('click', (e) => { e.stopPropagation(); onEdit(); });
  }
  if (onDelete) {
    el.querySelector('.delete-btn').addEventListener('click', (e) => { e.stopPropagation(); onDelete(); });
  }

  // Wire doesntEat buttons
  el.querySelectorAll('.pref-member-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await toggleDoesntEat(recipeUid, btn.dataset.member);
      btn.classList.toggle('active');
      if (onUpdate) onUpdate();
    });
  });

  // Wire make-ahead
  el.querySelector('.make-ahead-btn').addEventListener('click', async (e) => {
    e.stopPropagation();
    await toggleMakeAhead(recipeUid);
    e.target.classList.toggle('active');
    refreshChipStrip();
    if (onUpdate) onUpdate();
  });

  // Wire slow cooker / instant pot (auto-detected with manual override)
  if (recipe) {
    el.querySelector('.slow-cooker-btn').addEventListener('click', async (e) => {
      e.stopPropagation();
      const newState = await toggleSlowCooker(recipeUid, recipe);
      e.target.classList.toggle('active', newState);
      const updated = getRecipePrefs(recipeUid);
      const overridden = updated.slowCooker === true || updated.slowCooker === false;
      e.target.title = overridden ? 'Manual override' : 'Auto-detected';
      e.target.textContent = `Slow Cooker${overridden ? '' : ' \u2728'}`;
      refreshChipStrip();
      if (onUpdate) onUpdate();
    });

    el.querySelector('.instant-pot-btn').addEventListener('click', async (e) => {
      e.stopPropagation();
      const newState = await toggleInstantPot(recipeUid, recipe);
      e.target.classList.toggle('active', newState);
      const updated = getRecipePrefs(recipeUid);
      const overridden = updated.instantPot === true || updated.instantPot === false;
      e.target.title = overridden ? 'Manual override' : 'Auto-detected';
      e.target.textContent = `Instant Pot${overridden ? '' : ' \u2728'}`;
      refreshChipStrip();
      if (onUpdate) onUpdate();
    });
  }

  return el;
}

// === Feedback Modal ===

function setupFeedbackModal() {
  document.querySelector('.feedback-modal-close').addEventListener('click', () => {
    document.getElementById('feedback-modal').classList.add('hidden');
  });
  document.getElementById('feedback-modal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) e.currentTarget.classList.add('hidden');
  });

  // Also set up recipe detail modal close (was in setupRecipesPage)
  document.querySelector('.modal-close').addEventListener('click', () => {
    document.getElementById('recipe-modal').classList.add('hidden');
  });
  document.getElementById('recipe-modal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) e.currentTarget.classList.add('hidden');
  });
}

function openFeedbackModal(recipe) {
  const modal = document.getElementById('feedback-modal');
  document.getElementById('feedback-modal-title').textContent = recipe.name;
  const body = document.getElementById('feedback-modal-body');
  body.innerHTML = '';
  body.appendChild(buildInlinePreferenceControls(recipe.uid));
  modal.classList.remove('hidden');
}

// === Starter Packs on Manage Page ===
async function setupStarterPacksOnManage() {
  await ensureStarterPackData();
  const container = document.getElementById('manage-starter-packs');
  if (!starterPackData) {
    return;
  }

  const existingUids = new Set(getRecipes().map(r => r.uid));
  renderStarterPackOptions(container, existingUids);

  // Check if all packs are fully added already
  const allAdded = starterPackData.packs.every(pack =>
    pack.recipes.every(r => existingUids.has(r.uid))
  );
  if (allAdded) {
    document.getElementById('add-starter-btn').style.display = 'none';
    return;
  }

  document.getElementById('add-starter-btn').addEventListener('click', async () => {
    const btn = document.getElementById('add-starter-btn');
    const currentUids = new Set(getRecipes().map(r => r.uid));
    const recipes = getSelectedStarterRecipes('#manage-starter-packs', currentUids);
    if (!recipes.length) {
      showToast('No new recipes to add \u2014 you already have the selected packs.');
      return;
    }
    btn.textContent = 'Adding...';
    btn.disabled = true;
    try {
      await bulkSaveRecipes(recipes);
      await loadHouseholdRecipes();
      await loadRecipes();
      showToast(`Added ${recipes.length} starter recipes!`);
      refreshManageRecipeList();
      // Re-render pack options to show updated state
      const updatedUids = new Set(getRecipes().map(r => r.uid));
      renderStarterPackOptions(container, updatedUids);
    } catch (e) {
      showToast('Failed to add recipes: ' + e.message);
    } finally {
      btn.textContent = 'Add Selected Recipes';
      btn.disabled = false;
    }
  });
}

// === Manage Page ===
let pendingImport = [];

function setupManagePage() {
  // Toggle "Add Recipes" section
  document.getElementById('toggle-add-recipes').addEventListener('click', () => {
    const btn = document.getElementById('toggle-add-recipes');
    const body = document.getElementById('add-recipes-body');
    btn.classList.toggle('open');
    body.classList.toggle('hidden');
  });

  // Toggle "Your Recipes" section
  document.getElementById('toggle-recipe-list').addEventListener('click', () => {
    const btn = document.getElementById('toggle-recipe-list');
    const body = document.getElementById('recipe-list-body');
    btn.classList.toggle('open');
    body.classList.toggle('hidden');
  });

  // Add recipe tabs
  document.querySelectorAll('.add-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.add-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.add-tab-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(tab.dataset.tab).classList.add('active');
    });
  });

  // Starter recipe packs
  setupStarterPacksOnManage();

  // Single recipe add
  document.getElementById('save-recipe-btn').addEventListener('click', async () => {
    const name = document.getElementById('new-recipe-name').value.trim();
    if (!name) {
      showToast('Recipe name is required.');
      return;
    }

    const recipe = {
      uid: 'custom_' + Date.now(),
      name,
      ingredients: document.getElementById('new-recipe-ingredients').value,
      directions: document.getElementById('new-recipe-directions').value,
      servings: document.getElementById('new-recipe-servings').value,
      prep_time: document.getElementById('new-recipe-prep').value,
      cook_time: document.getElementById('new-recipe-cook').value,
      total_time: '',
      categories: document.getElementById('new-recipe-categories').value
        .split(',').map(s => s.trim()).filter(Boolean),
      source: document.getElementById('new-recipe-source').value,
      source_url: '',
      description: '',
      notes: document.getElementById('new-recipe-notes').value,
      rating: 0,
      image_url: '',
    };

    await saveRecipeToFirebase(recipe);
    await loadHouseholdRecipes();
    await loadRecipes();
    refreshManageRecipeList();
    showToast(`"${name}" saved!`);

    // Clear form
    document.getElementById('new-recipe-name').value = '';
    document.getElementById('new-recipe-ingredients').value = '';
    document.getElementById('new-recipe-directions').value = '';
    document.getElementById('new-recipe-servings').value = '';
    document.getElementById('new-recipe-prep').value = '';
    document.getElementById('new-recipe-cook').value = '';
    document.getElementById('new-recipe-categories').value = '';
    document.getElementById('new-recipe-source').value = '';
    document.getElementById('new-recipe-notes').value = '';
  });

  document.getElementById('manage-search').addEventListener('input', () => refreshManageRecipeList());

  // Export all recipes
  document.getElementById('export-all-btn').addEventListener('click', () => {
    const recipes = getRecipes();
    if (!recipes.length) {
      showToast('No recipes to export.');
      return;
    }
    exportRecipesToFile(recipes, 'my-recipes.json');
    showToast(`Exported ${recipes.length} recipes!`);
  });

  // Import file handling
  const fileInput = document.getElementById('import-file');
  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    document.getElementById('import-file-name').textContent = file.name;

    try {
      let recipes;
      if (file.name.endsWith('.paprikarecipes')) {
        recipes = await parsePaprika(file);
      } else {
        const text = await file.text();
        if (file.name.endsWith('.csv')) {
          recipes = parseCSV(text);
        } else {
          recipes = parseJSON(text);
        }
      }

      if (!recipes.length) {
        showToast('No recipes found in file.');
        return;
      }

      pendingImport = recipes;
      showImportPreview(recipes);
    } catch (err) {
      showToast('Could not read file: ' + err.message);
    }
  });

  document.getElementById('import-confirm-btn').addEventListener('click', async () => {
    if (!pendingImport.length) return;
    const btn = document.getElementById('import-confirm-btn');
    btn.textContent = 'Importing...';
    btn.disabled = true;

    try {
      await bulkSaveRecipes(pendingImport);
      await loadHouseholdRecipes();
      await loadRecipes();
      showToast(`Imported ${pendingImport.length} recipes!`);
      pendingImport = [];
      document.getElementById('import-preview').classList.add('hidden');
      document.getElementById('import-file').value = '';
      document.getElementById('import-file-name').textContent = 'No file chosen';
      refreshManageRecipeList();
    } catch (err) {
      showToast('Import failed: ' + err.message);
    } finally {
      btn.textContent = 'Import All';
      btn.disabled = false;
    }
  });

  document.getElementById('import-cancel-btn').addEventListener('click', () => {
    pendingImport = [];
    document.getElementById('import-preview').classList.add('hidden');
    document.getElementById('import-file').value = '';
    document.getElementById('import-file-name').textContent = 'No file chosen';
  });

  // URL import
  setupUrlImport();

  // Paste text
  setupPasteImport();

  // Photo scan
  setupScanImport();

  // Shared packs
  setupSharedPacks();
}

// === URL Import ===

let pendingUrlRecipe = null;

function setupUrlImport() {
  const input = document.getElementById('url-import-input');
  const fetchBtn = document.getElementById('url-import-btn');
  const preview = document.getElementById('url-import-preview');
  const result = document.getElementById('url-import-result');
  const errorEl = document.getElementById('url-import-error');

  // Allow Enter key to submit
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') fetchBtn.click();
  });

  fetchBtn.addEventListener('click', async () => {
    const url = input.value.trim();
    if (!url) {
      showToast('Please enter a URL.');
      return;
    }

    errorEl.classList.add('hidden');
    preview.classList.add('hidden');
    fetchBtn.textContent = 'Fetching...';
    fetchBtn.disabled = true;

    try {
      const scrapeRecipe = firebase.functions().httpsCallable('scrapeRecipe');
      const response = await scrapeRecipe({ url });
      const recipe = response.data;

      if (!recipe || !recipe.name) {
        throw new Error('No recipe found on that page.');
      }

      // If partial, pre-fill the manual form instead
      if (recipe.partial) {
        document.getElementById('new-recipe-name').value = recipe.name || '';
        document.getElementById('new-recipe-source').value = url;
        document.getElementById('new-recipe-ingredients').value = recipe.ingredients || '';
        document.getElementById('new-recipe-directions').value = recipe.directions || '';
        document.getElementById('new-recipe-notes').value = recipe.notes || '';
        input.value = '';
        showToast('Couldn\'t extract full recipe data — form pre-filled with what we found. Add the details manually.');
        // Scroll to the form
        document.getElementById('add-recipe-form').scrollIntoView({ behavior: 'smooth' });
        return;
      }

      pendingUrlRecipe = {
        uid: 'url_' + Date.now(),
        name: recipe.name || '',
        ingredients: recipe.ingredients || '',
        directions: recipe.directions || '',
        description: recipe.description || '',
        servings: recipe.servings || '',
        prep_time: recipe.prep_time || '',
        cook_time: recipe.cook_time || '',
        total_time: recipe.total_time || '',
        categories: recipe.categories || [],
        source: recipe.source || '',
        source_url: recipe.source_url || url,
        notes: recipe.notes || '',
        image_url: recipe.image_url || '',
        rating: 0,
      };

      // Show preview
      result.innerHTML = `
        <div class="url-recipe-preview">
          <h4>${escManage(recipe.name)}</h4>
          ${recipe.description ? `<p class="preview-field">${escManage(recipe.description)}</p>` : ''}
          <div class="preview-field">
            <strong>Source:</strong> ${escManage(recipe.source || '')}
            ${recipe.prep_time ? ` &middot; Prep: ${escManage(recipe.prep_time)}` : ''}
            ${recipe.cook_time ? ` &middot; Cook: ${escManage(recipe.cook_time)}` : ''}
            ${recipe.servings ? ` &middot; Serves: ${escManage(recipe.servings)}` : ''}
          </div>
          ${recipe.ingredients ? `<div class="preview-field"><strong>Ingredients</strong><div class="preview-content">${escManage(recipe.ingredients)}</div></div>` : ''}
          ${recipe.directions ? `<div class="preview-field"><strong>Directions</strong><div class="preview-content">${escManage(recipe.directions)}</div></div>` : ''}
        </div>
      `;
      preview.classList.remove('hidden');
    } catch (err) {
      const msg = err.message || 'Failed to fetch recipe.';
      errorEl.textContent = msg;
      errorEl.classList.remove('hidden');
    } finally {
      fetchBtn.textContent = 'Fetch Recipe';
      fetchBtn.disabled = false;
    }
  });

  document.getElementById('url-import-save-btn').addEventListener('click', async () => {
    if (!pendingUrlRecipe) return;
    const saveBtn = document.getElementById('url-import-save-btn');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
    try {
      await saveRecipeToFirebase(pendingUrlRecipe);
      await loadHouseholdRecipes();
      await loadRecipes();
      refreshManageRecipeList();
      showToast(`"${pendingUrlRecipe.name}" saved!`);
      pendingUrlRecipe = null;
      input.value = '';
      preview.classList.add('hidden');
    } catch (err) {
      showToast('Save failed: ' + err.message);
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save This Recipe';
    }
  });

  document.getElementById('url-import-cancel-btn').addEventListener('click', () => {
    pendingUrlRecipe = null;
    document.getElementById('url-import-preview').classList.add('hidden');
  });
}

// === Paste Text Import ===

let pendingPasteRecipe = null;

function setupPasteImport() {
  const textInput = document.getElementById('paste-text-input');
  const parseBtn = document.getElementById('paste-parse-btn');
  const preview = document.getElementById('paste-preview');
  const result = document.getElementById('paste-result');
  const statusEl = document.getElementById('paste-status');
  const errorEl = document.getElementById('paste-error');

  textInput.addEventListener('focus', () => {
    statusEl.classList.add('hidden');
  });

  parseBtn.addEventListener('click', async () => {
    const text = textInput.value.trim();
    if (!text) {
      showToast('Please paste some recipe text first.');
      return;
    }

    errorEl.classList.add('hidden');
    preview.classList.add('hidden');
    statusEl.classList.remove('hidden');
    parseBtn.disabled = true;

    try {
      const parseRecipeText = firebase.functions().httpsCallable('parseRecipeText');
      const response = await parseRecipeText({ text });
      const recipe = response.data;

      if (!recipe || !recipe.name) {
        throw new Error("Couldn't find a recipe in that text.");
      }

      pendingPasteRecipe = {
        uid: 'paste_' + Date.now(),
        name: recipe.name || '',
        ingredients: recipe.ingredients || '',
        directions: recipe.directions || '',
        servings: recipe.servings || '',
        prep_time: recipe.prep_time || '',
        cook_time: recipe.cook_time || '',
        categories: recipe.categories || [],
        source: recipe.source || 'Pasted text',
        notes: recipe.notes || '',
        rating: 0,
      };

      result.innerHTML = `
        <div class="url-recipe-preview">
          <h4>${escManage(recipe.name)}</h4>
          <div class="preview-field">
            ${recipe.prep_time ? `Prep: ${escManage(recipe.prep_time)}` : ''}
            ${recipe.cook_time ? ` &middot; Cook: ${escManage(recipe.cook_time)}` : ''}
            ${recipe.servings ? ` &middot; Serves: ${escManage(recipe.servings)}` : ''}
          </div>
          ${recipe.ingredients ? `<div class="preview-field"><strong>Ingredients</strong><div class="preview-content">${escManage(recipe.ingredients)}</div></div>` : ''}
          ${recipe.directions ? `<div class="preview-field"><strong>Directions</strong><div class="preview-content">${escManage(recipe.directions)}</div></div>` : ''}
        </div>
      `;

      preview.classList.remove('hidden');
    } catch (err) {
      errorEl.textContent = err.message || 'Failed to parse recipe.';
      errorEl.classList.remove('hidden');
    } finally {
      statusEl.classList.add('hidden');
      parseBtn.disabled = false;
    }
  });

  document.getElementById('paste-save-btn').addEventListener('click', async () => {
    if (!pendingPasteRecipe) return;
    const saveBtn = document.getElementById('paste-save-btn');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
    try {
      await saveRecipeToFirebase(pendingPasteRecipe);
      await loadHouseholdRecipes();
      await loadRecipes();
      refreshManageRecipeList();
      showToast(`"${pendingPasteRecipe.name}" saved!`);
      pendingPasteRecipe = null;
      textInput.value = '';
      preview.classList.add('hidden');
    } catch (err) {
      showToast('Save failed: ' + err.message);
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save This Recipe';
    }
  });

  document.getElementById('paste-edit-btn').addEventListener('click', () => {
    if (!pendingPasteRecipe) return;
    document.getElementById('new-recipe-name').value = pendingPasteRecipe.name || '';
    document.getElementById('new-recipe-ingredients').value = pendingPasteRecipe.ingredients || '';
    document.getElementById('new-recipe-directions').value = pendingPasteRecipe.directions || '';
    document.getElementById('new-recipe-servings').value = pendingPasteRecipe.servings || '';
    document.getElementById('new-recipe-prep').value = pendingPasteRecipe.prep_time || '';
    document.getElementById('new-recipe-cook').value = pendingPasteRecipe.cook_time || '';
    document.getElementById('new-recipe-categories').value = (pendingPasteRecipe.categories || []).join(', ');
    document.getElementById('new-recipe-source').value = pendingPasteRecipe.source || '';
    document.getElementById('new-recipe-notes').value = pendingPasteRecipe.notes || '';

    // Switch to manual tab
    document.querySelectorAll('.add-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.add-tab-content').forEach(c => c.classList.remove('active'));
    document.querySelector('[data-tab="tab-manual"]').classList.add('active');
    document.getElementById('tab-manual').classList.add('active');

    pendingPasteRecipe = null;
    textInput.value = '';
    preview.classList.add('hidden');
    showToast('Recipe moved to the "Manual" tab above — edit and hit Save.');
    document.getElementById('tab-manual').scrollIntoView({ behavior: 'smooth' });
  });

  document.getElementById('paste-cancel-btn').addEventListener('click', () => {
    pendingPasteRecipe = null;
    preview.classList.add('hidden');
  });
}

// === Shared Recipe Packs ===

function setupSharedPacks() {
  const codeInput = document.getElementById('shared-code-input');
  const loadBtn = document.getElementById('shared-load-btn');
  const previewEl = document.getElementById('shared-preview');
  const previewContent = document.getElementById('shared-preview-content');
  const errorEl = document.getElementById('shared-import-error');
  const searchInput = document.getElementById('shared-search');
  const selectGrid = document.getElementById('shared-recipe-select');
  const selectCount = document.getElementById('shared-select-count');
  const createBtn = document.getElementById('shared-create-btn');
  const createResult = document.getElementById('shared-create-result');
  const packNameInput = document.getElementById('shared-pack-name');

  let loadedPack = null;
  let selectedUids = new Set();
  let selectedImportUids = new Set();

  function renderImportPreview() {
    if (!loadedPack) return;
    const existingNames = new Set(getRecipes().map(r => r.name.trim().toLowerCase()));
    const count = selectedImportUids.size;
    previewContent.innerHTML = `
      <h4>${escManage(loadedPack.name)}</h4>
      <p>${loadedPack.recipes.length} recipe${loadedPack.recipes.length === 1 ? '' : 's'} in this pack.
        Select the ones you want to import.</p>
      <p class="shared-import-note">Imported recipes become your own editable copies — edits and notes you add stay on your version and don't affect anyone else.</p>
      <div class="shared-select-actions">
        <button class="btn shared-select-all">Select All</button>
        <button class="btn shared-select-none">Select None</button>
        <span class="shared-select-count">${count} selected</span>
      </div>
      <ul class="shared-recipe-list">
        ${loadedPack.recipes.map((r, i) => {
          const checked = selectedImportUids.has(i) ? 'checked' : '';
          const isDupe = existingNames.has(r.name.trim().toLowerCase());
          const meta = [r.prep_time ? `Prep: ${r.prep_time}` : '', r.cook_time ? `Cook: ${r.cook_time}` : '', r.servings ? `Serves: ${r.servings}` : ''].filter(Boolean).join(' · ');
          return `<li>
            <div class="shared-recipe-row">
              <label class="shared-recipe-check">
                <input type="checkbox" data-idx="${i}" ${checked}>
                <span>${escManage(r.name)}</span>
                ${isDupe ? '<span class="shared-dupe-tag">already have</span>' : ''}
              </label>
              <button class="shared-preview-toggle btn" data-idx="${i}">Preview</button>
            </div>
            <div class="shared-recipe-detail hidden" data-detail="${i}">
              ${meta ? `<div class="shared-detail-meta">${escManage(meta)}</div>` : ''}
              ${r.ingredients ? `<div class="shared-detail-section"><strong>Ingredients</strong><pre>${escManage(r.ingredients)}</pre></div>` : ''}
              ${r.directions ? `<div class="shared-detail-section"><strong>Directions</strong><pre>${escManage(r.directions)}</pre></div>` : ''}
              ${r.notes ? `<div class="shared-detail-section"><strong>Notes</strong><pre>${escManage(r.notes)}</pre></div>` : ''}
            </div>
          </li>`;
        }).join('')}
      </ul>
    `;

    previewContent.querySelector('.shared-select-all').addEventListener('click', () => {
      selectedImportUids = new Set(loadedPack.recipes.map((_, i) => i));
      renderImportPreview();
    });
    previewContent.querySelector('.shared-select-none').addEventListener('click', () => {
      selectedImportUids = new Set();
      renderImportPreview();
    });
    previewContent.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.addEventListener('change', () => {
        const idx = parseInt(cb.dataset.idx);
        if (cb.checked) selectedImportUids.add(idx);
        else selectedImportUids.delete(idx);
        previewContent.querySelector('.shared-select-count').textContent = selectedImportUids.size + ' selected';
      });
    });
    previewContent.querySelectorAll('.shared-preview-toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        const detail = previewContent.querySelector(`.shared-recipe-detail[data-detail="${btn.dataset.idx}"]`);
        const isHidden = detail.classList.contains('hidden');
        detail.classList.toggle('hidden');
        btn.textContent = isHidden ? 'Hide' : 'Preview';
      });
    });
  }

  // --- Import side ---

  codeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') loadBtn.click();
  });

  loadBtn.addEventListener('click', async () => {
    const code = codeInput.value.trim();
    if (!code) { showToast('Enter a share code.'); return; }

    errorEl.classList.add('hidden');
    previewEl.classList.add('hidden');
    loadBtn.textContent = 'Loading...';
    loadBtn.disabled = true;

    try {
      const { loadSharedPack } = await import('./firebase.js');
      loadedPack = await loadSharedPack(code);

      // Pre-select recipes that aren't already in the collection
      const existingNames = new Set(getRecipes().map(r => r.name.trim().toLowerCase()));
      selectedImportUids = new Set();
      loadedPack.recipes.forEach((r, i) => {
        if (!existingNames.has(r.name.trim().toLowerCase())) {
          selectedImportUids.add(i);
        }
      });
      renderImportPreview();
      previewEl.classList.remove('hidden');
    } catch (err) {
      errorEl.textContent = err.message || 'Failed to load pack.';
      errorEl.classList.remove('hidden');
    } finally {
      loadBtn.textContent = 'Load Pack';
      loadBtn.disabled = false;
    }
  });

  document.getElementById('shared-import-btn').addEventListener('click', async () => {
    if (!loadedPack) return;
    if (selectedImportUids.size === 0) {
      showToast('Select at least one recipe to import.');
      return;
    }

    const selected = loadedPack.recipes.filter((_, i) => selectedImportUids.has(i));
    await doSharedImport(selected, loadedPack.name);

    loadedPack = null;
    selectedImportUids = new Set();
    codeInput.value = '';
    previewEl.classList.add('hidden');
  });

  async function doSharedImport(recipesToImport, packName) {
    const recipes = recipesToImport.map(r => ({
      ...r,
      uid: 'shared_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    }));
    await bulkSaveRecipes(recipes);
    await loadHouseholdRecipes();
    await loadRecipes();
    refreshManageRecipeList();
    await showSharedImportModal(
      'Import complete!',
      `${recipes.length} recipe${recipes.length === 1 ? '' : 's'} from "${packName}" added to your collection.`,
      [{ label: 'OK', value: 'ok', primary: true }]
    );
  }

  document.getElementById('shared-cancel-btn').addEventListener('click', () => {
    loadedPack = null;
    previewEl.classList.add('hidden');
  });

  // --- Share side ---

  function renderShareableRecipes(query) {
    const recipes = filterRecipes(query || '');
    selectGrid.innerHTML = recipes.map(r => `
      <label class="shared-recipe-item ${selectedUids.has(r.uid) ? 'selected' : ''}">
        <input type="checkbox" data-uid="${r.uid}" ${selectedUids.has(r.uid) ? 'checked' : ''}>
        <span>${escManage(r.name)}</span>
      </label>
    `).join('');

    selectGrid.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.addEventListener('change', () => {
        if (cb.checked) selectedUids.add(cb.dataset.uid);
        else selectedUids.delete(cb.dataset.uid);
        cb.closest('.shared-recipe-item').classList.toggle('selected', cb.checked);
        selectCount.textContent = `${selectedUids.size} selected`;
      });
    });

    selectCount.textContent = `${selectedUids.size} selected`;
  }

  // Initial render
  renderShareableRecipes('');
  searchInput.addEventListener('input', () => renderShareableRecipes(searchInput.value));

  createBtn.addEventListener('click', async () => {
    const packName = packNameInput.value.trim();
    if (!packName) { showToast('Give your pack a name.'); return; }
    if (selectedUids.size === 0) { showToast('Select at least one recipe.'); return; }

    createBtn.disabled = true;
    createBtn.textContent = 'Creating...';

    try {
      const allRecipes = getRecipes();
      const selected = allRecipes.filter(r => selectedUids.has(r.uid));
      const { createSharedPack, recordCreatedPack } = await import('./firebase.js');
      const code = await createSharedPack(packName, selected);
      await recordCreatedPack({
        code,
        name: packName,
        recipeCount: selected.length,
        createdAt: Date.now(),
      });
      renderCreatedPacksList();

      createResult.innerHTML = `
        <div class="shared-code-result">
          <p>Pack created! Share this code:</p>
          <div class="shared-code-display">
            <strong>${code}</strong>
            <button class="btn shared-copy-btn">Copy</button>
          </div>
          <p class="section-help">${selected.length} recipe${selected.length === 1 ? '' : 's'} in "${escManage(packName)}"</p>
        </div>
      `;
      createResult.classList.remove('hidden');

      createResult.querySelector('.shared-copy-btn').addEventListener('click', () => {
        navigator.clipboard.writeText(code);
        showToast('Code copied!');
      });

      // Reset selection
      selectedUids.clear();
      packNameInput.value = '';
      renderShareableRecipes('');
    } catch (err) {
      showToast('Failed to create pack: ' + err.message);
    } finally {
      createBtn.disabled = false;
      createBtn.textContent = 'Create Shared Pack';
    }
  });

  // --- Your Packs (history of packs created by this household) ---

  async function renderCreatedPacksList() {
    const listEl = document.getElementById('created-packs-list');
    if (!listEl) return;
    const { loadCreatedPacks } = await import('./firebase.js');
    const packs = await loadCreatedPacks();
    if (!packs.length) {
      listEl.innerHTML = '<p class="section-help" style="font-style:italic">You haven\'t created any packs yet.</p>';
      return;
    }
    listEl.innerHTML = packs.map(p => {
      const date = new Date(p.createdAt).toLocaleDateString();
      return `
        <div class="created-pack-wrap" data-code="${escAttr(p.code)}">
          <div class="created-pack-row">
            <div class="created-pack-info">
              <strong>${escManage(p.name)}</strong>
              <span class="section-help">${p.recipeCount} recipe${p.recipeCount === 1 ? '' : 's'} \u00b7 ${date}</span>
            </div>
            <div class="created-pack-actions">
              <code class="created-pack-code">${escManage(p.code)}</code>
              <button class="btn created-pack-view" type="button">View</button>
              <button class="btn created-pack-copy" type="button">Copy</button>
              <button class="btn created-pack-remove" type="button" title="Remove from list">&times;</button>
            </div>
          </div>
          <div class="created-pack-detail hidden"></div>
        </div>
      `;
    }).join('');

    listEl.querySelectorAll('.created-pack-copy').forEach(btn => {
      btn.addEventListener('click', () => {
        const code = btn.closest('.created-pack-wrap').dataset.code;
        navigator.clipboard.writeText(code);
        showToast('Code copied!');
      });
    });
    listEl.querySelectorAll('.created-pack-remove').forEach(btn => {
      btn.addEventListener('click', async () => {
        const code = btn.closest('.created-pack-wrap').dataset.code;
        const { removeCreatedPack } = await import('./firebase.js');
        await removeCreatedPack(code);
        renderCreatedPacksList();
      });
    });
    listEl.querySelectorAll('.created-pack-view').forEach(btn => {
      btn.addEventListener('click', async () => {
        const wrap = btn.closest('.created-pack-wrap');
        const detail = wrap.querySelector('.created-pack-detail');
        // Toggle closed if already open
        if (!detail.classList.contains('hidden')) {
          detail.classList.add('hidden');
          btn.textContent = 'View';
          return;
        }
        const code = wrap.dataset.code;
        btn.disabled = true;
        btn.textContent = 'Loading\u2026';
        try {
          const { loadSharedPack } = await import('./firebase.js');
          const pack = await loadSharedPack(code);
          const items = (pack.recipes || []).map(r => {
            const meta = [
              r.prep_time ? `Prep: ${escManage(r.prep_time)}` : '',
              r.cook_time ? `Cook: ${escManage(r.cook_time)}` : '',
              r.servings ? `Serves: ${escManage(r.servings)}` : '',
            ].filter(Boolean).join(' \u00b7 ');
            return `<li><div class="created-pack-recipe-name">${escManage(r.name || '(untitled)')}</div>${meta ? `<div class="section-help" style="margin:0">${meta}</div>` : ''}</li>`;
          }).join('');
          detail.innerHTML = items
            ? `<ul class="created-pack-recipe-list">${items}</ul>`
            : '<p class="section-help" style="font-style:italic">This pack is empty.</p>';
          detail.classList.remove('hidden');
          btn.textContent = 'Hide';
        } catch (err) {
          detail.innerHTML = `<p class="section-help" style="color:#a05a00">Could not load pack: ${escManage(err.message || 'unknown error')}</p>`;
          detail.classList.remove('hidden');
          btn.textContent = 'View';
        } finally {
          btn.disabled = false;
        }
      });
    });
  }

  // Initial render so the list shows on first navigation to the share tab.
  renderCreatedPacksList();
}

// === Photo Scan Import ===

let pendingScanRecipe = null;
let pendingBulkRecipes = [];

const BULK_SCAN_LIMIT = 10;

function setupScanImport() {
  const fileInput = document.getElementById('scan-file');
  const fileNameEl = document.getElementById('scan-file-name');
  const preview = document.getElementById('scan-preview');
  const imagePreview = document.getElementById('scan-image-preview');
  const result = document.getElementById('scan-result');
  const status = document.getElementById('scan-status');
  const statusText = document.getElementById('scan-status-text');
  const errorEl = document.getElementById('scan-error');
  const bulkEl = document.getElementById('scan-bulk');
  const bulkProgress = document.getElementById('scan-bulk-progress');
  const bulkResults = document.getElementById('scan-bulk-results');
  const bulkActions = document.getElementById('scan-bulk-actions');

  fileInput.addEventListener('change', async () => {
    const files = Array.from(fileInput.files);
    if (!files.length) return;

    errorEl.classList.add('hidden');
    preview.classList.add('hidden');
    bulkEl.classList.add('hidden');

    if (files.length > BULK_SCAN_LIMIT) {
      errorEl.textContent = `You can scan up to ${BULK_SCAN_LIMIT} photos at a time. You selected ${files.length}.`;
      errorEl.classList.remove('hidden');
      fileInput.value = '';
      return;
    }

    // Single file — use original flow
    if (files.length === 1) {
      await scanSingleFile(files[0]);
      return;
    }

    // Bulk flow
    await scanBulkFiles(files);
  });

  async function scanSingleFile(file) {
    fileNameEl.textContent = file.name;
    statusText.textContent = 'Reading recipe from photo...';
    status.classList.remove('hidden');

    const thumbUrl = URL.createObjectURL(file);
    imagePreview.innerHTML = `<img src="${thumbUrl}" class="scan-image-thumb" alt="Recipe photo">`;

    try {
      const { base64, mimeType } = await prepareImageForScan(file);
      const scanRecipe = firebase.functions().httpsCallable('scanRecipe');
      const response = await scanRecipe({
        imageBase64: base64,
        mimeType,
      });

      const recipe = response.data;
      if (!recipe || !recipe.name) {
        throw new Error('Couldn\'t read a recipe from this image.');
      }

      pendingScanRecipe = {
        uid: 'scan_' + Date.now(),
        name: recipe.name || '',
        ingredients: recipe.ingredients || '',
        directions: recipe.directions || '',
        servings: recipe.servings || '',
        prep_time: recipe.prep_time || '',
        cook_time: recipe.cook_time || '',
        categories: recipe.categories || [],
        source: recipe.source || 'Photo scan',
        notes: recipe.notes || '',
        rating: 0,
      };

      result.innerHTML = `
        <div class="url-recipe-preview">
          <h4>${escManage(recipe.name)}</h4>
          <div class="preview-field">
            ${recipe.prep_time ? `Prep: ${escManage(recipe.prep_time)}` : ''}
            ${recipe.cook_time ? ` &middot; Cook: ${escManage(recipe.cook_time)}` : ''}
            ${recipe.servings ? ` &middot; Serves: ${escManage(recipe.servings)}` : ''}
          </div>
          ${recipe.ingredients ? `<div class="preview-field"><strong>Ingredients</strong><div class="preview-content">${escManage(recipe.ingredients)}</div></div>` : ''}
          ${recipe.directions ? `<div class="preview-field"><strong>Directions</strong><div class="preview-content">${escManage(recipe.directions)}</div></div>` : ''}
        </div>
      `;
      preview.classList.remove('hidden');
    } catch (err) {
      errorEl.textContent = err.message || 'Failed to scan recipe.';
      errorEl.classList.remove('hidden');
    } finally {
      status.classList.add('hidden');
    }
  }

  async function scanBulkFiles(files) {
    fileNameEl.textContent = `${files.length} photos selected`;
    pendingBulkRecipes = [];

    // Show bulk UI with progress
    bulkEl.classList.remove('hidden');
    bulkActions.classList.add('hidden');
    bulkResults.innerHTML = '';

    // Build progress items
    bulkProgress.innerHTML = files.map((f, i) =>
      `<div class="scan-bulk-item" id="scan-bulk-item-${i}">
        <span class="scan-bulk-status">pending</span>
        <span class="scan-bulk-name">${escManage(f.name)}</span>
      </div>`
    ).join('');

    const scanRecipe = firebase.functions().httpsCallable('scanRecipe');

    for (let i = 0; i < files.length; i++) {
      const itemEl = document.getElementById(`scan-bulk-item-${i}`);
      const statusEl = itemEl.querySelector('.scan-bulk-status');
      statusEl.textContent = 'scanning...';
      statusEl.className = 'scan-bulk-status active';

      try {
        const { base64, mimeType } = await prepareImageForScan(files[i]);
        const response = await scanRecipe({
          imageBase64: base64,
          mimeType,
        });

        const recipe = response.data;
        if (!recipe || !recipe.name) {
          throw new Error('Couldn\'t read a recipe.');
        }

        const recipeObj = {
          uid: 'scan_' + Date.now() + '_' + i,
          name: recipe.name || '',
          ingredients: recipe.ingredients || '',
          directions: recipe.directions || '',
          servings: recipe.servings || '',
          prep_time: recipe.prep_time || '',
          cook_time: recipe.cook_time || '',
          categories: recipe.categories || [],
          source: recipe.source || 'Photo scan',
          notes: recipe.notes || '',
          rating: 0,
        };

        pendingBulkRecipes.push(recipeObj);
        statusEl.textContent = 'done';
        statusEl.className = 'scan-bulk-status done';
        itemEl.querySelector('.scan-bulk-name').textContent = escManage(recipe.name);
      } catch (err) {
        statusEl.textContent = 'failed';
        statusEl.className = 'scan-bulk-status failed';
      }
    }

    // Replace progress list with expandable review cards
    bulkProgress.innerHTML = '';
    if (pendingBulkRecipes.length > 0) {
      bulkResults.innerHTML =
        `<p class="scan-bulk-summary">${pendingBulkRecipes.length} of ${files.length} recipes read successfully. Review and edit below.</p>` +
        pendingBulkRecipes.map((r, i) => renderBulkCard(r, i)).join('');
      bulkActions.classList.remove('hidden');
    } else {
      bulkResults.innerHTML = `<p class="scan-bulk-summary">No recipes could be read from the selected photos.</p>`;
    }
  }

  function renderBulkCard(recipe, idx) {
    return `
      <div class="scan-bulk-card" id="scan-bulk-card-${idx}">
        <button class="scan-bulk-card-header" type="button" onclick="this.parentElement.classList.toggle('expanded')">
          <span class="scan-bulk-card-title">${escManage(recipe.name)}</span>
          <span class="scan-bulk-card-meta">
            ${recipe.servings ? `Serves ${escManage(recipe.servings)}` : ''}
          </span>
          <span class="scan-bulk-card-chevron"></span>
        </button>
        <div class="scan-bulk-card-body">
          <label>Name
            <input type="text" class="bulk-field" data-idx="${idx}" data-field="name" value="${escAttr(recipe.name)}">
          </label>
          <label>Ingredients
            <textarea class="bulk-field" data-idx="${idx}" data-field="ingredients" rows="4">${escManage(recipe.ingredients)}</textarea>
          </label>
          <label>Directions
            <textarea class="bulk-field" data-idx="${idx}" data-field="directions" rows="4">${escManage(recipe.directions)}</textarea>
          </label>
          <div class="bulk-field-row">
            <label>Servings
              <input type="text" class="bulk-field" data-idx="${idx}" data-field="servings" value="${escAttr(recipe.servings)}">
            </label>
            <label>Prep Time
              <input type="text" class="bulk-field" data-idx="${idx}" data-field="prep_time" value="${escAttr(recipe.prep_time)}">
            </label>
            <label>Cook Time
              <input type="text" class="bulk-field" data-idx="${idx}" data-field="cook_time" value="${escAttr(recipe.cook_time)}">
            </label>
          </div>
          <label>Notes
            <textarea class="bulk-field" data-idx="${idx}" data-field="notes" rows="2">${escManage(recipe.notes)}</textarea>
          </label>
          <button class="btn scan-bulk-remove" type="button" onclick="removeBulkRecipe(${idx})">Remove</button>
        </div>
      </div>`;
  }

  // Sync edits back to pendingBulkRecipes
  bulkResults.addEventListener('input', (e) => {
    const field = e.target.dataset && e.target.dataset.field;
    const idx = e.target.dataset && e.target.dataset.idx;
    if (field && idx != null && pendingBulkRecipes[idx]) {
      pendingBulkRecipes[idx][field] = e.target.value;
      // Update card header title when name changes
      if (field === 'name') {
        const card = document.getElementById(`scan-bulk-card-${idx}`);
        if (card) card.querySelector('.scan-bulk-card-title').textContent = e.target.value;
      }
    }
  });

  // Expose remove function globally (called from onclick)
  window.removeBulkRecipe = function(idx) {
    pendingBulkRecipes[idx] = null;
    const card = document.getElementById(`scan-bulk-card-${idx}`);
    if (card) card.remove();
    const remaining = pendingBulkRecipes.filter(Boolean);
    if (remaining.length === 0) {
      bulkActions.classList.add('hidden');
      bulkResults.innerHTML = `<p class="scan-bulk-summary">All recipes removed.</p>`;
    }
  };

  // Save directly (single)
  document.getElementById('scan-save-btn').addEventListener('click', async () => {
    if (!pendingScanRecipe) return;
    const saveBtn = document.getElementById('scan-save-btn');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
    try {
      await saveRecipeToFirebase(pendingScanRecipe);
      await loadHouseholdRecipes();
      await loadRecipes();
      refreshManageRecipeList();
      showToast(`"${pendingScanRecipe.name}" saved!`);
      resetScan();
    } catch (err) {
      showToast('Save failed: ' + err.message);
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save This Recipe';
    }
  });

  // Edit first — pre-fill the manual form (single only)
  document.getElementById('scan-edit-btn').addEventListener('click', () => {
    if (!pendingScanRecipe) return;
    document.getElementById('new-recipe-name').value = pendingScanRecipe.name || '';
    document.getElementById('new-recipe-ingredients').value = pendingScanRecipe.ingredients || '';
    document.getElementById('new-recipe-directions').value = pendingScanRecipe.directions || '';
    document.getElementById('new-recipe-notes').value = pendingScanRecipe.notes || '';
    resetScan();
    // Switch to manual tab
    document.querySelectorAll('.add-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.add-tab-content').forEach(c => c.classList.remove('active'));
    document.querySelector('[data-tab="tab-manual"]').classList.add('active');
    document.getElementById('tab-manual').classList.add('active');
    showToast('Recipe moved to the "Manual" tab — edit and hit Save.');
    document.getElementById('tab-manual').scrollIntoView({ behavior: 'smooth' });
  });

  // Cancel (single)
  document.getElementById('scan-cancel-btn').addEventListener('click', resetScan);

  // Save all (bulk) — skip removed (null) entries
  document.getElementById('scan-bulk-save-btn').addEventListener('click', async () => {
    const toSave = pendingBulkRecipes.filter(Boolean);
    if (!toSave.length) return;
    const btn = document.getElementById('scan-bulk-save-btn');
    btn.disabled = true;
    btn.textContent = 'Saving...';

    for (const recipe of toSave) {
      await saveRecipeToFirebase(recipe);
    }

    await loadHouseholdRecipes();
    await loadRecipes();
    refreshManageRecipeList();
    showToast(`${toSave.length} recipe${toSave.length === 1 ? '' : 's'} saved!`);
    resetScan();
  });

  // Cancel (bulk)
  document.getElementById('scan-bulk-cancel-btn').addEventListener('click', resetScan);

  function resetScan() {
    pendingScanRecipe = null;
    pendingBulkRecipes = [];
    fileInput.value = '';
    fileNameEl.textContent = 'No photos chosen';
    preview.classList.add('hidden');
    imagePreview.innerHTML = '';
    errorEl.classList.add('hidden');
    bulkEl.classList.add('hidden');
    bulkProgress.innerHTML = '';
    bulkResults.innerHTML = '';
    const btn = document.getElementById('scan-bulk-save-btn');
    btn.disabled = false;
    btn.textContent = 'Save All Recipes';
  }
}

// Downscale + re-encode an image so it fits comfortably under the
// scanRecipe Cloud Function's 10MB base64 limit. iPhone screenshots
// (especially with food photos) routinely exceed that at native res.
// Returns { base64, mimeType }.
async function prepareImageForScan(file) {
  const MAX_DIMENSION = 1600;
  const JPEG_QUALITY = 0.85;

  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = dataUrl;
  });

  let { width, height } = img;
  const longest = Math.max(width, height);
  const needsResize = longest > MAX_DIMENSION;

  if (needsResize) {
    const scale = MAX_DIMENSION / longest;
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }

  // If the image is already small AND its base64 is well under the limit,
  // skip the canvas re-encode to preserve original quality.
  if (!needsResize) {
    const base64 = dataUrl.split(',')[1];
    if (base64.length < 8 * 1024 * 1024) {
      return { base64, mimeType: file.type || 'image/jpeg' };
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, width, height);

  const resizedDataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
  return {
    base64: resizedDataUrl.split(',')[1],
    mimeType: 'image/jpeg',
  };
}

// === Import Parsing ===

async function parsePaprika(file) {
  // .paprikarecipes is a zip of gzipped JSON files
  const zip = await loadZipEntries(file);
  const recipes = [];

  for (const entry of zip) {
    if (!entry.name.endsWith('.paprikarecipe')) continue;
    try {
      const decompressed = await decompressStream(entry.data, 'gzip');
      const text = new TextDecoder().decode(decompressed);
      const obj = JSON.parse(text);
      const recipe = normalizeRecipe(obj);
      if (recipe.name) recipes.push(recipe);
    } catch {
      // Skip entries that fail to parse
    }
  }

  return recipes;
}

async function loadZipEntries(file) {
  const buffer = await file.arrayBuffer();
  const view = new DataView(buffer);
  const entries = [];

  // Read zip central directory
  // Find end of central directory record (search from end)
  let eocdOffset = -1;
  for (let i = buffer.byteLength - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) throw new Error('Not a valid zip file');

  const cdOffset = view.getUint32(eocdOffset + 16, true);
  const cdEntries = view.getUint16(eocdOffset + 10, true);

  let pos = cdOffset;
  for (let i = 0; i < cdEntries; i++) {
    if (view.getUint32(pos, true) !== 0x02014b50) break;

    const compMethod = view.getUint16(pos + 10, true);
    const compSize = view.getUint32(pos + 20, true);
    const nameLen = view.getUint16(pos + 28, true);
    const extraLen = view.getUint16(pos + 30, true);
    const commentLen = view.getUint16(pos + 32, true);
    const localHeaderOffset = view.getUint32(pos + 42, true);

    const nameBytes = new Uint8Array(buffer, pos + 46, nameLen);
    const name = new TextDecoder().decode(nameBytes);

    // Read local file header to find data offset
    const localNameLen = view.getUint16(localHeaderOffset + 26, true);
    const localExtraLen = view.getUint16(localHeaderOffset + 28, true);
    const dataOffset = localHeaderOffset + 30 + localNameLen + localExtraLen;

    const compressedData = new Uint8Array(buffer, dataOffset, compSize);

    let data;
    if (compMethod === 0) {
      data = compressedData;
    } else if (compMethod === 8) {
      // Deflate — the inner .paprikarecipe files are gzipped JSON,
      // so we need to inflate the zip's deflate layer first.
      // Use the uncompressed size from the central directory to
      // allocate output, then inflate via tiny built-in inflater.
      const uncompSize = view.getUint32(pos + 24, true);
      data = inflateRaw(compressedData, uncompSize);
    } else {
      data = compressedData;
    }

    entries.push({ name, data });
    pos += 46 + nameLen + extraLen + commentLen;
  }

  return entries;
}

// Minimal raw deflate inflater (no dependencies, no DecompressionStream needed for zip layer)
function inflateRaw(src, outSize) {
  const out = new Uint8Array(outSize || src.length * 4);
  let p = 0;  // src position (bit-level)
  let op = 0; // output position

  function bits(n) {
    let v = 0;
    for (let i = 0; i < n; i++) {
      v |= ((src[p >> 3] >> (p & 7)) & 1) << i;
      p++;
    }
    return v;
  }

  function huf(lengths) {
    const max = Math.max(...lengths);
    const counts = new Uint16Array(max + 1);
    for (const l of lengths) if (l) counts[l]++;
    const offsets = new Uint16Array(max + 1);
    for (let i = 1; i <= max; i++) offsets[i] = offsets[i - 1] + counts[i - 1];
    const table = new Uint16Array(lengths.length);
    for (let i = 0; i < lengths.length; i++) {
      if (lengths[i]) { table[offsets[lengths[i]]++] = i; }
    }
    return { counts, table, max };
  }

  function decode(h) {
    let code = 0, first = 0, idx = 0;
    for (let len = 1; len <= h.max; len++) {
      code |= bits(1);
      const count = h.counts[len];
      if (code < first + count) return h.table[idx + (code - first)];
      idx += count;
      first = (first + count) << 1;
      code <<= 1;
    }
    return -1;
  }

  const LENS_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

  // Fixed Huffman tables
  const fixedLit = new Uint8Array(288);
  for (let i = 0; i <= 143; i++) fixedLit[i] = 8;
  for (let i = 144; i <= 255; i++) fixedLit[i] = 9;
  for (let i = 256; i <= 279; i++) fixedLit[i] = 7;
  for (let i = 280; i <= 287; i++) fixedLit[i] = 8;
  const fixedDist = new Uint8Array(32).fill(5);

  let bfinal = 0;
  while (!bfinal) {
    bfinal = bits(1);
    const btype = bits(2);

    if (btype === 0) {
      // Stored
      p = (p + 7) & ~7; // byte-align
      const len = src[p >> 3] | (src[(p >> 3) + 1] << 8);
      p += 32; // skip len and nlen
      for (let i = 0; i < len; i++) out[op++] = src[p >> 3], p += 8;
    } else {
      let litH, distH;
      if (btype === 1) {
        litH = huf(fixedLit);
        distH = huf(fixedDist);
      } else {
        const hlit = bits(5) + 257;
        const hdist = bits(5) + 1;
        const hclen = bits(4) + 4;
        const clens = new Uint8Array(19);
        for (let i = 0; i < hclen; i++) clens[LENS_ORDER[i]] = bits(3);
        const clH = huf(clens);

        const allLens = new Uint8Array(hlit + hdist);
        let ai = 0;
        while (ai < hlit + hdist) {
          const sym = decode(clH);
          if (sym < 16) { allLens[ai++] = sym; }
          else if (sym === 16) { const r = bits(2) + 3; const v = allLens[ai - 1]; for (let j = 0; j < r; j++) allLens[ai++] = v; }
          else if (sym === 17) { ai += bits(3) + 3; }
          else { ai += bits(7) + 11; }
        }
        litH = huf(allLens.subarray(0, hlit));
        distH = huf(allLens.subarray(hlit));
      }

      const lenBase = [3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258];
      const lenExtra = [0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0];
      const distBase = [1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577];
      const distExtra = [0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];

      while (true) {
        const sym = decode(litH);
        if (sym === 256) break;
        if (sym < 256) {
          out[op++] = sym;
        } else {
          const li = sym - 257;
          const length = lenBase[li] + bits(lenExtra[li]);
          const di = decode(distH);
          const dist = distBase[di] + bits(distExtra[di]);
          for (let i = 0; i < length; i++) { out[op] = out[op - dist]; op++; }
        }
      }
    }
  }

  return out.subarray(0, op);
}

async function decompressStream(data, format) {
  const ds = new DecompressionStream(format);
  const writer = ds.writable.getWriter();
  writer.write(data);
  writer.close();
  const reader = ds.readable.getReader();
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const totalLen = chunks.reduce((sum, c) => sum + c.length, 0);
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function parseJSON(text) {
  const data = JSON.parse(text);
  const arr = Array.isArray(data) ? data : (data.recipes || data.items || [data]);
  return arr.map(normalizeRecipe).filter(r => r.name);
}

function parseCSV(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];

  const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase().trim());
  const recipes = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = values[idx] || ''; });
    const recipe = normalizeRecipe(obj);
    if (recipe.name) recipes.push(recipe);
  }
  return recipes;
}

function parseCSVLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  values.push(current.trim());
  return values;
}

function normalizeRecipe(obj) {
  // Handle various field name conventions
  const get = (...keys) => {
    for (const k of keys) {
      const val = obj[k] || obj[k.toLowerCase()] || obj[k.replace(/_/g, ' ')];
      if (val !== undefined && val !== null && val !== '') return String(val);
    }
    return '';
  };

  const name = get('name', 'title', 'recipe_name', 'recipeName', 'Name', 'Title');
  if (!name) return { name: '' };

  let categories = obj.categories || obj.Categories || obj.category || obj.Category || [];
  if (typeof categories === 'string') {
    categories = categories.split(/[,;]/).map(s => s.trim()).filter(Boolean);
  }

  return {
    uid: obj.uid || obj.id || obj.uid || ('import_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)),
    name,
    ingredients: get('ingredients', 'Ingredients', 'ingredient_list'),
    directions: get('directions', 'Directions', 'instructions', 'Instructions', 'steps', 'Steps', 'method'),
    servings: get('servings', 'Servings', 'serves', 'yield'),
    prep_time: get('prep_time', 'prepTime', 'prep', 'Prep Time', 'prep time'),
    cook_time: get('cook_time', 'cookTime', 'cook', 'Cook Time', 'cook time'),
    total_time: get('total_time', 'totalTime', 'Total Time', 'total time'),
    categories,
    source: get('source', 'Source', 'author', 'Author'),
    source_url: get('source_url', 'sourceUrl', 'url', 'URL', 'link'),
    description: get('description', 'Description', 'summary'),
    notes: get('notes', 'Notes', 'note'),
    rating: 0,
    image_url: get('image_url', 'imageUrl', 'image', 'photo'),
  };
}

function showImportPreview(recipes) {
  const preview = document.getElementById('import-preview');
  const summary = document.getElementById('import-summary');
  const sample = document.getElementById('import-sample');

  summary.innerHTML = `<strong>${recipes.length} recipes</strong> found. Sample:`;

  const sampleRecipes = recipes.slice(0, 5);
  sample.innerHTML = sampleRecipes.map(r => {
    const meta = [];
    if (r.ingredients) meta.push('has ingredients');
    if (r.directions) meta.push('has directions');
    if (r.categories?.length) meta.push(r.categories.join(', '));
    return `<div class="import-sample-row">
      <strong>${escManage(r.name)}</strong>
      ${meta.length ? `<span class="import-sample-meta">${escManage(meta.join(' \u00b7 '))}</span>` : ''}
    </div>`;
  }).join('') + (recipes.length > 5 ? `<div class="import-sample-more">...and ${recipes.length - 5} more</div>` : '');

  preview.classList.remove('hidden');
}

function refreshManageRecipeList() {
  const container = document.getElementById('manage-recipe-list');
  const query = document.getElementById('manage-search').value;
  const recipes = filterRecipes(query);
  const prefs = getAllPreferences();

  // Sort favorites to the top, preserving alphabetical order within each group
  recipes.sort((a, b) => {
    const aFav = prefs[a.uid]?.favorite ? 1 : 0;
    const bFav = prefs[b.uid]?.favorite ? 1 : 0;
    if (aFav !== bFav) return bFav - aFav;
    return a.name.localeCompare(b.name);
  });

  document.getElementById('manage-recipe-count').textContent = `(${getRecipes().length})`;

  renderRecipeList(container, recipes, (recipe) => {
    currentDetailRecipe = recipe;
    renderRecipeDetail(document.getElementById('recipe-detail'), recipe);
    document.getElementById('recipe-modal').classList.remove('hidden');
  }, prefs, {
    members,
    restrictions: getRestrictions(),
    onEdit: (recipe) => openEditModal(recipe),
    onDelete: async (recipe) => {
      if (!await confirmDelete(recipe.name)) return;
      await archiveRecipe(recipe.uid);
      await loadHouseholdRecipes();
      await loadRecipes();
      refreshManageRecipeList();
      showToast(`"${recipe.name}" deleted.`);
    },
    onToggleFavorite: async (recipeUid) => {
      return await toggleFavorite(recipeUid);
    },
    onAddToPlan: (recipe) => {
      const card = container.querySelector(`[data-uid="${recipe.uid}"]`);
      const btn = card?.querySelector('.plan-btn');
      if (btn) showDayPicker(recipe, btn);
    },
    onToggleDoesntEat: async (recipeUid, member) => {
      await toggleDoesntEat(recipeUid, member);
    },
    onToggleMakeAhead: async (recipeUid) => {
      await toggleMakeAhead(recipeUid);
    },
    onToggleSlowCooker: async (recipeUid, recipe) => {
      return await toggleSlowCooker(recipeUid, recipe);
    },
    onToggleInstantPot: async (recipeUid, recipe) => {
      return await toggleInstantPot(recipeUid, recipe);
    },
  });
}

function escManage(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

function escAttr(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// === Edit Recipe Modal ===
let currentDetailRecipe = null;
let currentEditRecipe = null;

function setupEditModal() {
  // Close buttons
  document.querySelector('.edit-modal-close').addEventListener('click', closeEditModal);
  document.getElementById('edit-recipe-modal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeEditModal();
  });
  document.getElementById('cancel-edit-btn').addEventListener('click', closeEditModal);

  // Save
  document.getElementById('save-edit-btn').addEventListener('click', async () => {
    if (!currentEditRecipe) return;
    const name = document.getElementById('edit-recipe-name').value.trim();
    if (!name) {
      showToast('Recipe name is required.');
      return;
    }

    // Collect active allergen and diet toggles
    const allergens = [...document.querySelectorAll('#edit-recipe-allergens .allergen-toggle.active')]
      .map(btn => btn.dataset.allergen);
    const dietCategories = [...document.querySelectorAll('#edit-recipe-diet .allergen-toggle.active')]
      .map(btn => btn.dataset.diet);

    const updated = {
      ...currentEditRecipe,
      name,
      ingredients: document.getElementById('edit-recipe-ingredients').value,
      directions: document.getElementById('edit-recipe-directions').value,
      servings: document.getElementById('edit-recipe-servings').value,
      prep_time: document.getElementById('edit-recipe-prep').value,
      cook_time: document.getElementById('edit-recipe-cook').value,
      categories: document.getElementById('edit-recipe-categories').value
        .split(',').map(s => s.trim()).filter(Boolean),
      source: document.getElementById('edit-recipe-source').value,
      notes: document.getElementById('edit-recipe-notes').value,
      allergens,
      dietCategories,
    };

    await saveRecipeToFirebase(updated);

    // Persist user tag assignments. Walk the definitions to recover the
    // display-cased tag names from the lowercased working set, then merge
    // into the recipe's preferences doc.
    const finalUserTags = getUserTagDefinitions().filter(t => editModalUserTags.has(t.toLowerCase()));
    const currentPrefs = getRecipePrefs(currentEditRecipe.uid);
    await updateRecipePrefs(currentEditRecipe.uid, { ...currentPrefs, userTags: finalUserTags });

    await loadHouseholdRecipes();
    await loadRecipes();
    closeEditModal();
    refreshManageRecipeList();
    showToast(`"${name}" updated.`);
  });

  // "Add Tag" button — creates a new tag definition and toggles it on
  // for this recipe (will be persisted on Save Changes).
  document.getElementById('edit-recipe-add-tag-btn').addEventListener('click', async () => {
    const input = document.getElementById('edit-recipe-new-tag');
    const name = input.value.trim();
    if (!name) return;
    await addUserTagDefinition(name);
    editModalUserTags.add(name.toLowerCase());
    input.value = '';
    // Re-render the pill list, but preserve the working set we just added to.
    const container = document.getElementById('edit-recipe-user-tags');
    const defs = getUserTagDefinitions();
    container.innerHTML = defs.map(t => {
      const active = editModalUserTags.has(t.toLowerCase()) ? ' active' : '';
      return `<button type="button" class="allergen-toggle${active}" data-user-tag="${escAttr(t)}">${escManage(t)}</button>`;
    }).join('');
    container.querySelectorAll('.allergen-toggle').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const tag = btn.dataset.userTag;
        const key = tag.toLowerCase();
        if (editModalUserTags.has(key)) {
          editModalUserTags.delete(key);
          btn.classList.remove('active');
        } else {
          editModalUserTags.add(key);
          btn.classList.add('active');
        }
      });
    });
  });
  document.getElementById('edit-recipe-new-tag').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      document.getElementById('edit-recipe-add-tag-btn').click();
    }
  });

  // Delete from edit modal
  document.getElementById('delete-from-edit-btn').addEventListener('click', async () => {
    if (!currentEditRecipe) return;
    const name = currentEditRecipe.name;
    if (!await confirmDelete(name)) return;
    await archiveRecipe(currentEditRecipe.uid);
    await loadHouseholdRecipes();
    await loadRecipes();
    closeEditModal();
    refreshManageRecipeList();
    showToast(`"${name}" deleted.`);
  });

  // Edit from detail modal
  document.getElementById('edit-from-detail-btn').addEventListener('click', () => {
    if (!currentDetailRecipe) return;
    document.getElementById('recipe-modal').classList.add('hidden');
    openEditModal(currentDetailRecipe);
  });

  // Export from detail modal
  document.getElementById('export-from-detail-btn').addEventListener('click', () => {
    if (!currentDetailRecipe) return;
    const safeName = currentDetailRecipe.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    exportRecipesToFile([currentDetailRecipe], `${safeName}.json`);
    showToast(`"${currentDetailRecipe.name}" exported!`);
  });

  // Add to Plan from detail modal
  setupAddToPlan();
}

async function showDayPicker(recipe, anchorEl, onDone) {
  // Use a single shared picker appended to body to avoid card click propagation issues
  let picker = document.getElementById('global-day-picker');
  if (!picker) {
    picker = document.createElement('div');
    picker.id = 'global-day-picker';
    picker.className = 'day-picker hidden';
    picker.addEventListener('click', (e) => e.stopPropagation());
    document.body.appendChild(picker);
  }

  // Track which week is shown; start from the planner's current week
  let pickerWeekStart = new Date(getCurrentWeekStart());

  async function renderPickerWeek() {
    const weekKey = getWeekKey(pickerWeekStart);
    const plan = await loadPlan(weekKey) || { days: {} };

    picker.innerHTML = '';

    // Week navigation header
    const nav = document.createElement('div');
    nav.className = 'day-picker-nav';
    nav.innerHTML = `<button class="day-picker-prev">&laquo;</button><span class="day-picker-week-label">${getWeekLabel(pickerWeekStart)}</span><button class="day-picker-next">&raquo;</button>`;
    nav.querySelector('.day-picker-prev').addEventListener('click', (e) => {
      e.stopPropagation();
      pickerWeekStart.setDate(pickerWeekStart.getDate() - 7);
      renderPickerWeek();
    });
    nav.querySelector('.day-picker-next').addEventListener('click', (e) => {
      e.stopPropagation();
      pickerWeekStart.setDate(pickerWeekStart.getDate() + 7);
      renderPickerWeek();
    });
    picker.appendChild(nav);

    // Day buttons
    for (let i = 0; i < 7; i++) {
      const dayName = getDAYS()[i];
      const dayDate = new Date(pickerWeekStart);
      dayDate.setDate(dayDate.getDate() + i);
      const shortDate = dayDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const existingUid = plan.days[dayName]?.recipeUid;
      const existingRecipe = existingUid ? getRecipes().find(r => r.uid === existingUid) : null;

      const dayBtn = document.createElement('button');
      dayBtn.className = 'day-picker-btn';
      if (existingRecipe) {
        dayBtn.innerHTML = `<span class="day-picker-day">${dayName} <small>${shortDate}</small></span><span class="day-picker-current">${escManage(existingRecipe.name)}</span>`;
      } else {
        dayBtn.innerHTML = `<span class="day-picker-day">${dayName} <small>${shortDate}</small></span><span class="day-picker-current empty">No meal planned</span>`;
      }

      dayBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          if (!plan.days[dayName]) plan.days[dayName] = {};
          plan.days[dayName].recipeUid = recipe.uid;
          plan.weekKey = weekKey;
          plan.updated = Date.now();
          await savePlan(weekKey, plan);
          picker.classList.add('hidden');
          showToast(`"${recipe.name}" added to ${dayName}!`);
          if (onDone) onDone();
        } catch (err) {
          showToast('Failed to add to plan: ' + err.message);
        }
      });

      picker.appendChild(dayBtn);
    }
  }

  // If already visible, toggle off
  if (!picker.classList.contains('hidden')) {
    picker.classList.add('hidden');
    return;
  }

  await renderPickerWeek();

  // Position near the anchor button
  const rect = anchorEl.getBoundingClientRect();
  picker.style.position = 'fixed';
  picker.style.left = rect.left + 'px';
  picker.style.top = (rect.bottom + 4) + 'px';
  picker.classList.remove('hidden');
}

function setupAddToPlan() {
  const btn = document.getElementById('add-to-plan-btn');

  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!currentDetailRecipe) return;
    await showDayPicker(currentDetailRecipe, btn, () => {
      document.getElementById('recipe-modal').classList.add('hidden');
    });
  });

  // Close day picker when clicking outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.add-to-plan-wrap') && !e.target.closest('.day-picker') && !e.target.closest('#global-day-picker') && !e.target.closest('.plan-btn')) {
      document.querySelectorAll('.day-picker').forEach(p => p.classList.add('hidden'));
    }
  });
}

function openEditModal(recipe) {
  currentEditRecipe = recipe;
  document.getElementById('edit-recipe-uid').value = recipe.uid;
  document.getElementById('edit-recipe-name').value = recipe.name || '';
  document.getElementById('edit-recipe-ingredients').value = recipe.ingredients || '';
  document.getElementById('edit-recipe-directions').value = recipe.directions || '';
  document.getElementById('edit-recipe-servings').value = recipe.servings || '';
  document.getElementById('edit-recipe-prep').value = recipe.prep_time || '';
  document.getElementById('edit-recipe-cook').value = recipe.cook_time || '';
  document.getElementById('edit-recipe-categories').value = (recipe.categories || []).join(', ');
  document.getElementById('edit-recipe-source').value = recipe.source || '';
  document.getElementById('edit-recipe-notes').value = recipe.notes || '';

  // Allergen toggles
  const allergensContainer = document.getElementById('edit-recipe-allergens');
  const recipeAllergens = recipe.allergens || [];
  allergensContainer.innerHTML = ALLERGENS.map(a => {
    const key = a.toLowerCase();
    const active = recipeAllergens.includes(key) ? ' active' : '';
    return `<button type="button" class="allergen-toggle${active}" data-allergen="${escAttr(key)}">${escManage(a)}</button>`;
  }).join('');
  allergensContainer.querySelectorAll('.allergen-toggle').forEach(btn => {
    btn.addEventListener('click', (e) => { e.preventDefault(); btn.classList.toggle('active'); });
  });

  // Dietary category toggles
  const dietContainer = document.getElementById('edit-recipe-diet');
  const recipeDiet = recipe.dietCategories || [];
  dietContainer.innerHTML = DIET_CATEGORIES.map(a => {
    const key = a.toLowerCase();
    const active = recipeDiet.includes(key) ? ' active' : '';
    return `<button type="button" class="allergen-toggle${active}" data-diet="${escAttr(key)}">${escManage(a)}</button>`;
  }).join('');
  dietContainer.querySelectorAll('.allergen-toggle').forEach(btn => {
    btn.addEventListener('click', (e) => { e.preventDefault(); btn.classList.toggle('active'); });
  });

  // User tag toggles (custom user-defined labels)
  renderEditModalUserTags(recipe.uid);

  document.getElementById('edit-recipe-modal').classList.remove('hidden');
}

// Editor working state — tracks which user tags are toggled on while the
// edit modal is open, so the Save button can persist them in one go.
let editModalUserTags = new Set();

function renderEditModalUserTags(recipeUid) {
  const container = document.getElementById('edit-recipe-user-tags');
  // Seed working state from the recipe's current assignments (lower-cased keys).
  const assigned = (getRecipePrefs(recipeUid).userTags || []).map(t => t.toLowerCase());
  editModalUserTags = new Set(assigned);

  const defs = getUserTagDefinitions();
  if (!defs.length) {
    container.innerHTML = '<span class="tags-edit-hint" style="font-style:italic">No tags yet \u2014 add one below.</span>';
    return;
  }
  container.innerHTML = defs.map(t => {
    const active = editModalUserTags.has(t.toLowerCase()) ? ' active' : '';
    return `<button type="button" class="allergen-toggle${active}" data-user-tag="${escAttr(t)}">${escManage(t)}</button>`;
  }).join('');
  container.querySelectorAll('.allergen-toggle').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const tag = btn.dataset.userTag;
      const key = tag.toLowerCase();
      if (editModalUserTags.has(key)) {
        editModalUserTags.delete(key);
        btn.classList.remove('active');
      } else {
        editModalUserTags.add(key);
        btn.classList.add('active');
      }
    });
  });
}

function closeEditModal() {
  document.getElementById('edit-recipe-modal').classList.add('hidden');
  currentEditRecipe = null;
}

// === Confirm Delete Modal ===
function confirmDelete(recipeName) {
  return new Promise(resolve => {
    const modal = document.getElementById('confirm-delete-modal');
    const msg = document.getElementById('confirm-delete-msg');
    const yesBtn = document.getElementById('confirm-delete-yes');
    const noBtn = document.getElementById('confirm-delete-no');

    msg.textContent = `"${recipeName}" will be removed. This can't be undone.`;
    modal.classList.remove('hidden');

    function cleanup(result) {
      modal.classList.add('hidden');
      yesBtn.removeEventListener('click', onYes);
      noBtn.removeEventListener('click', onNo);
      modal.removeEventListener('click', onBackdrop);
      resolve(result);
    }
    function onYes() { cleanup(true); }
    function onNo() { cleanup(false); }
    function onBackdrop(e) { if (e.target === modal) cleanup(false); }

    yesBtn.addEventListener('click', onYes);
    noBtn.addEventListener('click', onNo);
    modal.addEventListener('click', onBackdrop);
  });
}

// === Shared Import Modal ===
function showSharedImportModal(title, message, buttons) {
  return new Promise(resolve => {
    const modal = document.getElementById('shared-import-modal');
    document.getElementById('shared-import-modal-title').textContent = title;
    document.getElementById('shared-import-modal-msg').textContent = message;
    const actionsEl = document.getElementById('shared-import-modal-actions');
    actionsEl.innerHTML = buttons.map(b =>
      `<button class="btn${b.primary ? ' primary' : ''}" data-value="${b.value}">${b.label}</button>`
    ).join('');
    modal.classList.remove('hidden');

    function cleanup(value) {
      modal.classList.add('hidden');
      actionsEl.removeEventListener('click', onClick);
      modal.removeEventListener('click', onBackdrop);
      resolve(value);
    }
    function onClick(e) {
      const btn = e.target.closest('[data-value]');
      if (btn) cleanup(btn.dataset.value);
    }
    function onBackdrop(e) { if (e.target === modal) cleanup('cancel'); }

    actionsEl.addEventListener('click', onClick);
    modal.addEventListener('click', onBackdrop);
  });
}

// === Export Recipes ===
function exportRecipesToFile(recipes, filename) {
  const exportData = recipes.map(r => ({
    name: r.name,
    ingredients: r.ingredients,
    directions: r.directions,
    servings: r.servings,
    prep_time: r.prep_time,
    cook_time: r.cook_time,
    total_time: r.total_time,
    categories: r.categories,
    source: r.source,
    source_url: r.source_url,
    description: r.description,
    notes: r.notes,
    image_url: r.image_url,
  }));

  const json = JSON.stringify(exportData, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// === Toast ===
function showToast(msg, durationMs = 3000) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.remove('hidden');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.add('hidden'), durationMs);
}

// === Start ===
init().catch(err => {
  console.error('Init failed:', err);
  document.body.innerHTML = `<p style="padding:2rem;color:red;">Failed to load: ${err.message}</p>`;
});
