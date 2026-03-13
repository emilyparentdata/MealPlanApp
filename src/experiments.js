import { loadPlan, saveExperimentEval, loadExperimentEvals, saveRecipeToFirebase, archiveRecipe } from './firebase.js';
import { getExperiments, getRecipeByUid, loadRecipes } from './recipes.js';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

// Scan past weekly plans for experiments that were used
async function findPastExperiments() {
  const experimentUids = new Set(getExperiments().map(e => e.uid));
  const used = new Map(); // uid -> { recipe, weekKey }

  // Scan back ~12 weeks
  const now = new Date();
  for (let w = 0; w < 12; w++) {
    const d = new Date(now);
    d.setDate(d.getDate() - w * 7);
    const monday = getMonday(d);
    const weekKey = monday.toISOString().slice(0, 10);
    const plan = await loadPlan(weekKey);
    if (!plan?.days) continue;
    for (const day of DAYS) {
      const uid = plan.days[day]?.recipeUid;
      if (uid && experimentUids.has(uid) && !used.has(uid)) {
        const recipe = getExperiments().find(e => e.uid === uid);
        if (recipe) {
          used.set(uid, { recipe, weekKey });
        }
      }
    }
  }
  return used;
}

function getMonday(d) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  date.setDate(diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

export async function renderExperimentsPage(container) {
  container.innerHTML = '<p style="color:var(--text-light);">Loading experiments...</p>';

  const evals = await loadExperimentEvals();
  const pastExperiments = await findPastExperiments();
  const allExperiments = getExperiments();

  container.innerHTML = '';

  // Section 1: Experiments that have been on the menu and need evaluation
  const needsEval = [];
  for (const [uid, info] of pastExperiments) {
    if (!evals[uid]) {
      needsEval.push(info);
    }
  }

  if (needsEval.length) {
    const section = document.createElement('div');
    section.innerHTML = `<h3 style="margin-bottom:1rem;">Needs Evaluation</h3>`;
    for (const { recipe, weekKey } of needsEval) {
      section.appendChild(createEvalCard(recipe, weekKey, evals, container));
    }
    container.appendChild(section);
  }

  // Section 2: Already evaluated
  const evaluated = [];
  for (const [uid, evalData] of Object.entries(evals)) {
    const recipe = allExperiments.find(e => e.uid === uid) || { uid, name: uid };
    evaluated.push({ recipe, evalData });
  }

  if (evaluated.length) {
    const section = document.createElement('div');
    section.innerHTML = `<h3 style="margin:2rem 0 1rem;">Previously Evaluated</h3>`;
    for (const { recipe, evalData } of evaluated) {
      const card = document.createElement('div');
      card.className = 'experiment-card evaluated';
      const icon = evalData.result === 'success' ? '&#10003;' : '&#10007;';
      const label = evalData.result === 'success' ? 'Success — added to rotation' : 'Failed — removed';
      card.innerHTML = `
        <span class="experiment-icon ${evalData.result}">${icon}</span>
        <span class="experiment-name">${escHtml(recipe.name)}</span>
        <span class="experiment-status">${label}</span>
      `;
      section.appendChild(card);
    }
    container.appendChild(section);
  }

  // Section 3: Untried experiments
  const triedUids = new Set([...pastExperiments.keys(), ...Object.keys(evals)]);
  const untried = allExperiments.filter(e => !triedUids.has(e.uid));

  if (untried.length) {
    const section = document.createElement('div');
    section.innerHTML = `<h3 style="margin:2rem 0 1rem;">Not Yet Tried (${untried.length})</h3>`;
    const list = document.createElement('div');
    list.className = 'experiment-untried-list';
    for (const r of untried) {
      const item = document.createElement('div');
      item.className = 'experiment-untried';
      item.innerHTML = `<span>${escHtml(r.name)}</span>`;
      if (r.source_url) {
        item.innerHTML += ` <a href="${escHtml(r.source_url)}" target="_blank" rel="noopener" style="font-size:0.8rem;color:var(--primary);">view source</a>`;
      }
      list.appendChild(item);
    }
    section.appendChild(list);
    container.appendChild(section);
  }

  if (!needsEval.length && !evaluated.length && !untried.length) {
    container.innerHTML = '<p style="color:var(--text-light);padding:2rem;">No experiments found.</p>';
  }
}

function createEvalCard(recipe, weekKey, evals, pageContainer) {
  const card = document.createElement('div');
  card.className = 'experiment-card needs-eval';

  card.innerHTML = `
    <div class="experiment-card-header">
      <strong>${escHtml(recipe.name)}</strong>
      <span style="color:var(--text-light);font-size:0.8rem;">Week of ${weekKey}</span>
      ${recipe.source_url ? `<a href="${escHtml(recipe.source_url)}" target="_blank" rel="noopener" style="font-size:0.8rem;color:var(--primary);margin-left:auto;">View recipe source</a>` : ''}
    </div>
    <div class="experiment-eval-actions">
      <button class="btn success-btn" style="background:var(--primary);color:white;border-color:var(--primary);">Success!</button>
      <button class="btn failure-btn" style="background:var(--accent);color:white;border-color:var(--accent);">Didn't work</button>
    </div>
    <div class="experiment-success-form" style="display:none;">
      <p style="margin-bottom:0.75rem;color:var(--primary-dark);">Great! Add the ingredients and directions so it joins the regular rotation:</p>
      <textarea class="success-ingredients" placeholder="Ingredients (one per line)" style="width:100%;min-height:100px;margin-bottom:0.5rem;"></textarea>
      <textarea class="success-directions" placeholder="Directions" style="width:100%;min-height:100px;margin-bottom:0.5rem;"></textarea>
      <button class="btn primary save-success-btn">Save to Rotation</button>
    </div>
  `;

  card.querySelector('.success-btn').addEventListener('click', () => {
    card.querySelector('.experiment-eval-actions').style.display = 'none';
    card.querySelector('.experiment-success-form').style.display = 'block';
  });

  card.querySelector('.failure-btn').addEventListener('click', async () => {
    await saveExperimentEval(recipe.uid, 'failure');
    await archiveRecipe(recipe.uid);
    showToast(`"${recipe.name}" removed.`);
    renderExperimentsPage(pageContainer);
  });

  card.querySelector('.save-success-btn').addEventListener('click', async () => {
    const ingredients = card.querySelector('.success-ingredients').value.trim();
    const directions = card.querySelector('.success-directions').value.trim();
    if (!ingredients || !directions) {
      showToast('Please fill in both ingredients and directions.');
      return;
    }

    // Save evaluation
    await saveExperimentEval(recipe.uid, 'success', ingredients, directions);

    // Promote to regular recipe with the content
    const promoted = {
      ...recipe,
      ingredients,
      directions,
      categories: [...(recipe.categories || [])],
    };
    await saveRecipeToFirebase(promoted);

    showToast(`"${recipe.name}" added to regular rotation!`);
    // Reload recipes so it moves from experiments to regular
    await loadRecipes();
    renderExperimentsPage(pageContainer);
  });

  return card;
}

function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.remove('hidden');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.add('hidden'), 3000);
}

function escHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}
