import { initFirebase, getMembers, saveRecipeToFirebase, archiveRecipe, bulkSaveRecipes, loadPlan, commitPlan, loadCommittedPlan, onAuthStateChanged, signInWithGoogle, signInWithEmail, signUpWithEmail, signOut, getCurrentUser, loadUserHousehold, createHousehold, joinHousehold, getHouseholdMembers, getHouseholdInfo, loadHouseholdRecipes } from './firebase.js';
import { loadRecipes, getRecipes, renderRecipeList, renderRecipeDetail, filterRecipes } from './recipes.js';
import { initPreferences, renderPreferenceList, getAllPreferences, toggleFavorite } from './preferences.js';
import { renderPlanner, suggestAllMeals, shiftWeek, getWeekLabel, getWeekKey } from './planner.js';
import { renderPlanView } from './plan-view.js';
import { renderGroceryList, getGroceryText, clearChecked, loadAndRenderExtras, addExtraItem } from './grocery.js';
import { renderFeedbackPage } from './feedback.js';

// === State ===
const BETA_CODE = 'MEALS2026';
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
    const household = await loadUserHousehold();
    if (household) {
      await showApp(user, household);
    } else {
      document.getElementById('household-setup').classList.remove('hidden');
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
  await loadHouseholdRecipes();
  await loadRecipes();
  await initPreferences();

  // Get members from household
  members = await getHouseholdMembers();
  setupNavigation();
  setupRecipesPage();
  setupPreferencesPage();
  setupPlannerPage();
  setupPlanViewPage();
  setupGroceryPage();
  setupManagePage();

  setupHomePage();
  setupSignOut();
  setupEditModal();

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

  showPage('home');
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
  ensureStarterPackData().then(() => {
    renderStarterPackOptions(document.getElementById('starter-pack-options'), new Set());
  });

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

      // Import selected starter pack recipes
      const starterRecipes = getSelectedStarterRecipes('#starter-pack-options', new Set());
      if (starterRecipes.length) {
        await bulkSaveRecipes(starterRecipes);
      }

      showToast(`Household created with ${starterRecipes.length} starter recipes! Invite code: ${inviteCode}`);
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

// === Navigation ===
function setupNavigation() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => showPage(btn.dataset.page));
  });
  document.getElementById('home-link').addEventListener('click', () => showPage('home'));
}

function showPage(pageId) {
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

  // Refresh page content on show
  if (pageId === 'recipes') refreshRecipes();
  if (pageId === 'preferences') refreshPreferences();
  if (pageId === 'planner') refreshPlanner();
  if (pageId === 'plan-view') refreshPlanView();
  if (pageId === 'grocery') refreshGrocery();
  if (pageId === 'feedback') refreshFeedback();
  if (pageId === 'manage') refreshManageRecipeList();
}


// === Home Page ===
function setupHomePage() {
  document.querySelectorAll('.home-card').forEach(card => {
    card.addEventListener('click', () => showPage(card.dataset.page));
  });
}

// === Recipes Page ===
function setupRecipesPage() {
  const search = document.getElementById('recipe-search');
  search.addEventListener('input', () => refreshRecipes());

  document.querySelector('.modal-close').addEventListener('click', () => {
    document.getElementById('recipe-modal').classList.add('hidden');
  });
  document.getElementById('recipe-modal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) e.currentTarget.classList.add('hidden');
  });
}

function refreshRecipes() {
  const query = document.getElementById('recipe-search').value;
  const recipes = filterRecipes(query);
  const prefs = getAllPreferences();
  renderRecipeList(document.getElementById('recipe-list'), recipes, (recipe) => {
    currentDetailRecipe = recipe;
    renderRecipeDetail(document.getElementById('recipe-detail'), recipe);
    document.getElementById('recipe-modal').classList.remove('hidden');
  }, prefs, {
    onToggleFavorite: async (recipeUid) => {
      return await toggleFavorite(recipeUid);
    }
  });
}

// === Preferences Page ===
function setupPreferencesPage() {
  document.getElementById('pref-search').addEventListener('input', () => refreshPreferences());
  document.getElementById('pref-filter-unrated').addEventListener('change', () => refreshPreferences());
}

function refreshPreferences() {
  const query = document.getElementById('pref-search').value;
  const unratedOnly = document.getElementById('pref-filter-unrated').checked;
  renderPreferenceList(
    document.getElementById('pref-list'),
    getRecipes(),
    query,
    unratedOnly
  );
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
  document.getElementById('suggest-all-btn').addEventListener('click', async () => {
    await suggestAllMeals(document.getElementById('planner-grid'), members);
    refreshPlanner();
    showToast('Menu suggested! Avoids repeated proteins and recent meals.');
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
    showToast('Plan committed! It\'s now visible on "This Week\'s Plan".');
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
  renderPlanner(document.getElementById('planner-grid'), members);
  updateCommitStatus(weekKey);
}

// === Plan View Page ===
let viewWeekOffset = 0;

function getViewWeekStart() {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff + viewWeekOffset * 7);
  d.setHours(0, 0, 0, 0);
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
  renderPlanView(
    document.getElementById('plan-view-grid'),
    document.getElementById('view-week-label'),
    getViewWeekKey(),
    getViewWeekLabel(),
    (recipe) => {
      currentDetailRecipe = recipe;
      renderRecipeDetail(document.getElementById('recipe-detail'), recipe);
      document.getElementById('recipe-modal').classList.remove('hidden');
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

  document.getElementById('copy-grocery-btn').addEventListener('click', async () => {
    if (groceryLoading) await groceryLoading;
    const text = getGroceryText();
    if (!text) {
      showToast('Nothing to copy — no meals planned this week.');
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      showToast('Grocery list copied to clipboard!');
    } catch {
      showToast('Could not copy — try selecting and copying manually.');
    }
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
      } catch (e) {
        if (e.name !== 'AbortError') {
          showToast('Could not share.');
        }
      }
    } else {
      // Fallback to clipboard on desktop
      try {
        await navigator.clipboard.writeText(text);
        showToast('Grocery list copied to clipboard!');
      } catch {
        showToast('Could not share — try the Copy button.');
      }
    }
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

// === Feedback Page ===
function refreshFeedback() {
  renderFeedbackPage(document.getElementById('feedback-list'));
}

// === Starter Packs on Manage Page ===
async function setupStarterPacksOnManage() {
  await ensureStarterPackData();
  const container = document.getElementById('manage-starter-packs');
  const section = document.getElementById('starter-recipe-section');
  if (!starterPackData) {
    section.style.display = 'none';
    return;
  }

  const existingUids = new Set(getRecipes().map(r => r.uid));
  renderStarterPackOptions(container, existingUids);

  // Check if all packs are fully added already
  const allAdded = starterPackData.packs.every(pack =>
    pack.recipes.every(r => existingUids.has(r.uid))
  );
  if (allAdded) {
    section.querySelector('.section-help').textContent = 'All starter recipes have been added!';
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

  // Photo scan
  setupScanImport();
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

    await saveRecipeToFirebase(pendingUrlRecipe);
    await loadHouseholdRecipes();
    await loadRecipes();
    refreshManageRecipeList();
    showToast(`"${pendingUrlRecipe.name}" saved!`);

    // Reset
    pendingUrlRecipe = null;
    input.value = '';
    preview.classList.add('hidden');
  });

  document.getElementById('url-import-cancel-btn').addEventListener('click', () => {
    pendingUrlRecipe = null;
    document.getElementById('url-import-preview').classList.add('hidden');
  });
}

// === Photo Scan Import ===

let pendingScanRecipe = null;

function setupScanImport() {
  const fileInput = document.getElementById('scan-file');
  const fileNameEl = document.getElementById('scan-file-name');
  const preview = document.getElementById('scan-preview');
  const imagePreview = document.getElementById('scan-image-preview');
  const result = document.getElementById('scan-result');
  const status = document.getElementById('scan-status');
  const errorEl = document.getElementById('scan-error');

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;

    fileNameEl.textContent = file.name;
    errorEl.classList.add('hidden');
    preview.classList.add('hidden');
    status.classList.remove('hidden');

    // Show thumbnail
    const thumbUrl = URL.createObjectURL(file);
    imagePreview.innerHTML = `<img src="${thumbUrl}" class="scan-image-thumb" alt="Recipe photo">`;

    try {
      // Read file as base64
      const base64 = await fileToBase64(file);

      const scanRecipe = firebase.functions().httpsCallable('scanRecipe');
      const response = await scanRecipe({
        imageBase64: base64,
        mimeType: file.type || 'image/jpeg',
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

      // Show preview
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
      const msg = err.message || 'Failed to scan recipe.';
      errorEl.textContent = msg;
      errorEl.classList.remove('hidden');
    } finally {
      status.classList.add('hidden');
    }
  });

  // Save directly
  document.getElementById('scan-save-btn').addEventListener('click', async () => {
    if (!pendingScanRecipe) return;
    await saveRecipeToFirebase(pendingScanRecipe);
    await loadHouseholdRecipes();
    await loadRecipes();
    refreshManageRecipeList();
    showToast(`"${pendingScanRecipe.name}" saved!`);
    resetScan();
  });

  // Edit first — pre-fill the manual form
  document.getElementById('scan-edit-btn').addEventListener('click', () => {
    if (!pendingScanRecipe) return;
    document.getElementById('new-recipe-name').value = pendingScanRecipe.name || '';
    document.getElementById('new-recipe-ingredients').value = pendingScanRecipe.ingredients || '';
    document.getElementById('new-recipe-directions').value = pendingScanRecipe.directions || '';
    document.getElementById('new-recipe-notes').value = pendingScanRecipe.notes || '';
    resetScan();
    showToast('Recipe loaded into form — review and save.');
    document.getElementById('add-recipe-form').scrollIntoView({ behavior: 'smooth' });
  });

  // Cancel
  document.getElementById('scan-cancel-btn').addEventListener('click', resetScan);

  function resetScan() {
    pendingScanRecipe = null;
    fileInput.value = '';
    fileNameEl.textContent = 'No photo chosen';
    preview.classList.add('hidden');
    imagePreview.innerHTML = '';
    errorEl.classList.add('hidden');
  }
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      // Strip the data URL prefix (data:image/jpeg;base64,)
      const base64 = reader.result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// === Import Parsing ===

async function parsePaprika(file) {
  // .paprikarecipes is a zip of gzipped JSON files
  const zip = await loadZipEntries(file);
  const recipes = [];

  for (const entry of zip) {
    if (!entry.name.endsWith('.paprikarecipe')) continue;
    try {
      const decompressed = await decompressGzip(entry.data);
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
      // Deflate — use DecompressionStream
      const ds = new DecompressionStream('raw');
      const writer = ds.writable.getWriter();
      writer.write(compressedData);
      writer.close();
      const reader = ds.readable.getReader();
      const chunks = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
      const totalLen = chunks.reduce((sum, c) => sum + c.length, 0);
      data = new Uint8Array(totalLen);
      let offset = 0;
      for (const chunk of chunks) {
        data.set(chunk, offset);
        offset += chunk.length;
      }
    } else {
      data = compressedData; // unsupported method, try anyway
    }

    entries.push({ name, data });
    pos += 46 + nameLen + extraLen + commentLen;
  }

  return entries;
}

async function decompressGzip(data) {
  const ds = new DecompressionStream('gzip');
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
  const query = document.getElementById('manage-search').value.toLowerCase().trim();
  let recipes = getRecipes();

  document.getElementById('manage-recipe-count').textContent = `(${recipes.length})`;

  if (query) {
    recipes = recipes.filter(r =>
      r.name.toLowerCase().includes(query) ||
      (r.categories || []).some(c => c.toLowerCase().includes(query))
    );
  }

  container.innerHTML = '';
  if (!recipes.length) {
    container.innerHTML = '<p class="section-help">No recipes yet. Import a file or add one above.</p>';
    return;
  }
  for (const r of recipes) {
    const row = document.createElement('div');
    row.className = 'manage-recipe-row';
    row.innerHTML = `
      <span class="manage-recipe-name">${escManage(r.name)}</span>
      <span class="manage-recipe-cats">${(r.categories || []).join(', ')}</span>
      <button class="btn edit-btn">Edit</button>
      <button class="btn delete-btn">Delete</button>
    `;
    row.querySelector('.edit-btn').addEventListener('click', () => openEditModal(r));
    row.querySelector('.delete-btn').addEventListener('click', async () => {
      if (!await confirmDelete(r.name)) return;
      await archiveRecipe(r.uid);
      await loadHouseholdRecipes();
      await loadRecipes();
      refreshManageRecipeList();
      showToast(`"${r.name}" deleted.`);
    });
    container.appendChild(row);
  }
}

function escManage(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
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
    };

    await saveRecipeToFirebase(updated);
    await loadHouseholdRecipes();
    await loadRecipes();
    closeEditModal();
    refreshManageRecipeList();
    showToast(`"${name}" updated.`);
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
  document.getElementById('edit-recipe-modal').classList.remove('hidden');
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

// === Toast ===
function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.remove('hidden');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.add('hidden'), 3000);
}

// === Start ===
init().catch(err => {
  console.error('Init failed:', err);
  document.body.innerHTML = `<p style="padding:2rem;color:red;">Failed to load: ${err.message}</p>`;
});
