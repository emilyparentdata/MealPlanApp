// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyDVrgB99bUYlUfQzkI16bk335XLh_D00do",
  authDomain: "mealplanapp-ad277.firebaseapp.com",
  projectId: "mealplanapp-ad277",
  storageBucket: "mealplanapp-ad277.firebasestorage.app",
  messagingSenderId: "631553776828",
  appId: "1:631553776828:web:17d331913db00eba3c44b9"
};

let db = null;
let auth = null;
let firebaseEnabled = false;
let householdId = null;

export function initFirebase() {
  try {
    if (firebaseConfig.apiKey === "YOUR_API_KEY") {
      console.log("Firebase not configured — running in local-only mode.");
      return;
    }
    firebase.initializeApp(firebaseConfig);
    db = firebase.firestore();
    auth = firebase.auth();
    firebaseEnabled = true;
    console.log("Firebase connected.");
  } catch (e) {
    console.warn("Firebase init failed, running local-only:", e);
  }
}

export function isFirebaseEnabled() {
  return firebaseEnabled;
}

export function getDb() {
  return db;
}

// === Household-scoped collection helper ===

function col(name) {
  if (!householdId) throw new Error('No household set');
  return db.collection('households').doc(householdId).collection(name);
}

export function getHouseholdId() {
  return householdId;
}

// === Authentication ===

export function onAuthStateChanged(callback) {
  if (!auth) {
    callback(null);
    return;
  }
  auth.onAuthStateChanged(callback);
}

export async function signInWithGoogle() {
  const provider = new firebase.auth.GoogleAuthProvider();
  return auth.signInWithPopup(provider);
}

export async function signInWithEmail(email, password) {
  return auth.signInWithEmailAndPassword(email, password);
}

export async function signUpWithEmail(email, password) {
  return auth.createUserWithEmailAndPassword(email, password);
}

export async function signOut() {
  householdId = null;
  return auth.signOut();
}

export function getCurrentUser() {
  return auth?.currentUser || null;
}

// === Household Management ===

function generateInviteCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

export async function createHousehold(name, memberNames) {
  const user = getCurrentUser();
  if (!user) throw new Error('Not signed in');

  const inviteCode = generateInviteCode();
  const householdRef = await db.collection('households').add({
    name,
    members: memberNames,
    inviteCode,
    createdBy: user.uid,
    createdAt: Date.now(),
  });

  // Link user to household
  await db.collection('users').doc(user.uid).set({
    householdId: householdRef.id,
    email: user.email,
    displayName: user.displayName || user.email,
  });

  householdId = householdRef.id;
  return { householdId: householdRef.id, inviteCode };
}

export async function joinHousehold(inviteCode) {
  const user = getCurrentUser();
  if (!user) throw new Error('Not signed in');

  // Find household by invite code
  const snapshot = await db.collection('households')
    .where('inviteCode', '==', inviteCode.toUpperCase().trim())
    .get();

  if (snapshot.empty) throw new Error('Invalid invite code');

  const householdDoc = snapshot.docs[0];

  // Link user to household
  await db.collection('users').doc(user.uid).set({
    householdId: householdDoc.id,
    email: user.email,
    displayName: user.displayName || user.email,
  });

  householdId = householdDoc.id;
  return { householdId: householdDoc.id, name: householdDoc.data().name };
}

export async function loadUserHousehold() {
  const user = getCurrentUser();
  if (!user || !firebaseEnabled) return null;

  const userDoc = await db.collection('users').doc(user.uid).get();
  if (!userDoc.exists) return null;

  const data = userDoc.data();
  if (!data.householdId) return null;

  const householdDoc = await db.collection('households').doc(data.householdId).get();
  if (!householdDoc.exists) return null;

  householdId = data.householdId;
  return { id: data.householdId, ...householdDoc.data() };
}

export async function getHouseholdInfo() {
  if (!householdId || !firebaseEnabled) return null;
  const doc = await db.collection('households').doc(householdId).get();
  return doc.exists ? { id: householdId, ...doc.data() } : null;
}

// === Members (from household) ===

const DEFAULT_MEMBERS = [];

export function getMembers() {
  if (!firebaseEnabled) {
    const saved = localStorage.getItem("family_members");
    return saved ? JSON.parse(saved) : DEFAULT_MEMBERS;
  }
  // When using Firebase, members come from the household — loaded via getHouseholdMembers
  return _cachedMembers || DEFAULT_MEMBERS;
}

let _cachedMembers = null;

export async function getHouseholdMembers() {
  if (!householdId || !firebaseEnabled) return getMembers();
  const doc = await db.collection('households').doc(householdId).get();
  if (doc.exists) {
    _cachedMembers = doc.data().members || [];
    return _cachedMembers;
  }
  return DEFAULT_MEMBERS;
}

export async function updateHouseholdMembers(memberNames) {
  if (!householdId || !firebaseEnabled) {
    localStorage.setItem("family_members", JSON.stringify(memberNames));
    return;
  }
  await db.collection('households').doc(householdId).update({ members: memberNames });
  _cachedMembers = memberNames;
}

export function setMembers(members) {
  if (!firebaseEnabled) {
    localStorage.setItem("family_members", JSON.stringify(members));
    return;
  }
  updateHouseholdMembers(members);
}

// === Preferences (per recipe, not per member) ===

export async function saveRecipePrefs(recipeUid, prefs) {
  const data = { ...prefs, updated: Date.now() };
  if (!firebaseEnabled) {
    localStorage.setItem(`rpref_${recipeUid}`, JSON.stringify(data));
    return;
  }
  await col("preferences").doc(recipeUid).set(data);
}

export async function loadAllPreferences() {
  if (!firebaseEnabled) {
    const prefs = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key.startsWith("rpref_")) {
        prefs[key.slice(6)] = JSON.parse(localStorage.getItem(key));
      }
    }
    return prefs;
  }
  const snapshot = await col("preferences").get();
  const prefs = {};
  snapshot.forEach(doc => {
    prefs[doc.id] = doc.data();
  });
  return prefs;
}

// === Weekly Plans ===

export async function savePlan(weekKey, plan) {
  if (!firebaseEnabled) {
    localStorage.setItem(`plan_${weekKey}`, JSON.stringify(plan));
    return;
  }
  await col("weeklyPlans").doc(weekKey).set(plan);
}

export async function loadPlan(weekKey) {
  if (!firebaseEnabled) {
    const data = localStorage.getItem(`plan_${weekKey}`);
    return data ? JSON.parse(data) : null;
  }
  const doc = await col("weeklyPlans").doc(weekKey).get();
  return doc.exists ? doc.data() : null;
}

// === Committed Plans ===

export async function commitPlan(weekKey, plan) {
  const committed = { ...plan, committed: true, committedAt: Date.now() };
  if (!firebaseEnabled) {
    localStorage.setItem(`committed_${weekKey}`, JSON.stringify(committed));
    return;
  }
  await col("committedPlans").doc(weekKey).set(committed);
}

export async function loadCommittedPlan(weekKey) {
  if (!firebaseEnabled) {
    const data = localStorage.getItem(`committed_${weekKey}`);
    return data ? JSON.parse(data) : null;
  }
  const doc = await col("committedPlans").doc(weekKey).get();
  return doc.exists ? doc.data() : null;
}

// === Comments ===

export async function addComment(weekKey, memberName, text) {
  const comment = { memberName, text, timestamp: Date.now() };
  if (!firebaseEnabled) {
    const key = `comments_${weekKey}`;
    const comments = JSON.parse(localStorage.getItem(key) || "[]");
    comments.push(comment);
    localStorage.setItem(key, JSON.stringify(comments));
    return;
  }
  await col("comments").add({ weekKey, ...comment });
}

export async function loadComments(weekKey) {
  if (!firebaseEnabled) {
    return JSON.parse(localStorage.getItem(`comments_${weekKey}`) || "[]");
  }
  const snapshot = await col("comments")
    .where("weekKey", "==", weekKey)
    .get();
  const comments = [];
  snapshot.forEach(doc => comments.push(doc.data()));
  comments.sort((a, b) => a.timestamp - b.timestamp);
  return comments;
}

// === Recipes (custom per household) ===

export async function saveRecipeToFirebase(recipe) {
  if (!firebaseEnabled) {
    const custom = JSON.parse(localStorage.getItem("custom_recipes") || "[]");
    custom.push(recipe);
    localStorage.setItem("custom_recipes", JSON.stringify(custom));
    return;
  }
  await col("recipes").doc(recipe.uid).set(recipe);
}

export async function archiveRecipe(uid) {
  if (!firebaseEnabled) {
    const archived = JSON.parse(localStorage.getItem("archived_recipes") || "[]");
    archived.push(uid);
    localStorage.setItem("archived_recipes", JSON.stringify(archived));
    return;
  }
  await col("recipes").doc(uid).set({ archived: true }, { merge: true });
}

export function getArchivedRecipes() {
  if (!firebaseEnabled) {
    return JSON.parse(localStorage.getItem("archived_recipes") || "[]");
  }
  return _cachedArchived || [];
}

let _cachedArchived = [];
let _cachedCustom = [];

export function getCustomRecipes() {
  if (!firebaseEnabled) {
    return JSON.parse(localStorage.getItem("custom_recipes") || "[]");
  }
  return _cachedCustom || [];
}

// Bulk import recipes to household
export async function bulkSaveRecipes(recipes) {
  if (!firebaseEnabled) {
    const custom = JSON.parse(localStorage.getItem("custom_recipes") || "[]");
    custom.push(...recipes);
    localStorage.setItem("custom_recipes", JSON.stringify(custom));
    return;
  }
  // Firestore batches support up to 500 writes
  const batchSize = 450;
  for (let i = 0; i < recipes.length; i += batchSize) {
    const batch = db.batch();
    const chunk = recipes.slice(i, i + batchSize);
    for (const recipe of chunk) {
      const ref = col("recipes").doc(recipe.uid);
      batch.set(ref, recipe);
    }
    await batch.commit();
  }
}

// Load custom/archived recipes from household Firestore
export async function loadHouseholdRecipes() {
  if (!firebaseEnabled || !householdId) return;
  const snapshot = await col("recipes").get();
  _cachedCustom = [];
  _cachedArchived = [];
  snapshot.forEach(doc => {
    const data = doc.data();
    if (data.archived) {
      _cachedArchived.push(doc.id);
    } else {
      _cachedCustom.push({ ...data, uid: doc.id });
    }
  });
}

// === Grocery Extras ===

export async function loadGroceryExtras() {
  if (!firebaseEnabled || !householdId) {
    return JSON.parse(localStorage.getItem('grocery_extras') || '[]');
  }
  const doc = await col('settings').doc('groceryExtras').get();
  return doc.exists ? (doc.data().items || []) : [];
}

export async function saveGroceryExtras(items) {
  if (!firebaseEnabled || !householdId) {
    localStorage.setItem('grocery_extras', JSON.stringify(items));
    return;
  }
  await col('settings').doc('groceryExtras').set({ items });
}

// === Repeat Window Setting ===

export async function loadRepeatWindow() {
  if (!firebaseEnabled || !householdId) {
    return parseInt(localStorage.getItem('repeat_window') || '3', 10);
  }
  const doc = await col('settings').doc('repeatWindow').get();
  return doc.exists ? (doc.data().weeks || 3) : 3;
}

export async function saveRepeatWindow(weeks) {
  if (!firebaseEnabled || !householdId) {
    localStorage.setItem('repeat_window', String(weeks));
    return;
  }
  await col('settings').doc('repeatWindow').set({ weeks, updated: Date.now() });
}

// === Use-Up Items (ingredients to prioritize in meal planning) ===

export async function loadUseUpItems(weekKey) {
  if (!firebaseEnabled || !householdId) {
    return JSON.parse(localStorage.getItem(`useup_${weekKey}`) || '[]');
  }
  const doc = await col('useUpItems').doc(weekKey).get();
  return doc.exists ? (doc.data().items || []) : [];
}

export async function saveUseUpItems(weekKey, items) {
  if (!firebaseEnabled || !householdId) {
    localStorage.setItem(`useup_${weekKey}`, JSON.stringify(items));
    return;
  }
  await col('useUpItems').doc(weekKey).set({ items, updated: Date.now() });
}

// === Shared Recipe Packs ===

export async function createSharedPack(name, recipes) {
  if (!firebaseEnabled) throw new Error('Firebase required for sharing');

  const code = generateInviteCode();
  const packRecipes = recipes.map(r => ({
    name: r.name || '',
    ingredients: r.ingredients || '',
    directions: r.directions || '',
    servings: r.servings || '',
    prep_time: r.prep_time || '',
    cook_time: r.cook_time || '',
    total_time: r.total_time || '',
    categories: r.categories || [],
    source: r.source || '',
    source_url: r.source_url || '',
    description: r.description || '',
    notes: r.notes || '',
    image_url: r.image_url || '',
  }));

  await db.collection('sharedPacks').doc(code).set({
    name,
    recipes: packRecipes,
    createdBy: householdId,
    createdAt: Date.now(),
  });

  return code;
}

export async function loadSharedPack(code) {
  if (!firebaseEnabled) throw new Error('Firebase required for sharing');

  const doc = await db.collection('sharedPacks').doc(code.toUpperCase().trim()).get();
  if (!doc.exists) throw new Error('Pack not found. Check the code and try again.');
  return doc.data();
}

