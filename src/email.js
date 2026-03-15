import { getPlanSummary, getGroceryText } from './grocery.js';
import { getWeekLabel } from './planner.js';

// EmailJS configuration — Emily will set these up
const EMAILJS_SERVICE_ID = 'YOUR_SERVICE_ID';
const EMAILJS_TEMPLATE_ID = 'YOUR_TEMPLATE_ID';
const EMAILJS_PUBLIC_KEY = 'YOUR_PUBLIC_KEY';

export function isEmailConfigured() {
  return EMAILJS_SERVICE_ID !== 'YOUR_SERVICE_ID';
}

export async function sendPlanEmail() {
  const weekLabel = getWeekLabel();
  const planSummary = getPlanSummary();
  const groceryList = getGroceryText();

  if (!planSummary) {
    throw new Error('No meals planned this week.');
  }

  // If EmailJS not configured, offer clipboard fallback
  if (!isEmailConfigured()) {
    const fullText = `Dinner, Planned — ${weekLabel}\n\n${groceryList}`;
    await navigator.clipboard.writeText(fullText);
    return { fallback: true, text: fullText };
  }

  // Use EmailJS
  const script = document.createElement('script');
  script.src = 'https://cdn.jsdelivr.net/npm/@emailjs/browser@3/dist/email.min.js';
  document.head.appendChild(script);

  await new Promise(resolve => { script.onload = resolve; });

  emailjs.init(EMAILJS_PUBLIC_KEY);

  await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
    week: weekLabel,
    plan: planSummary,
    grocery: groceryList,
  });

  return { fallback: false };
}
