# Family Meals

A meal planning website for the family — browse 188 recipes, rate them, plan weekly meals, and generate grocery lists.

## Quick Start (Local)

Serve the project root with any static server:

```bash
# Python
python -m http.server 8000

# Then open http://localhost:8000
```

## Features

- **Recipe Browser** — Search and view all 188 recipes imported from Paprika
- **Preference Voting** — Each family member rates recipes (Love / Like / Acceptable / Unacceptable) and flags them (Make Ahead, Dad Can Make)
- **Weekly Planner** — Set who's home each day, constraints, and get smart meal suggestions
- **This Week's View** — See the current plan at a glance, add comments
- **Grocery List** — Auto-generated from the week's planned recipes, with copy-to-clipboard
- **Manage Recipes** — Add new recipes manually

## Data Persistence

The app works in two modes:

1. **Local mode** (default) — All data stored in browser localStorage. Works immediately, no setup needed. Data is per-browser/device.
2. **Firebase mode** — Shared across all family members' devices. Requires setup (see below).

### Setting Up Firebase (for shared data)

1. Go to [Firebase Console](https://console.firebase.google.com/) and create a new project
2. Enable **Firestore Database** (start in test mode)
3. Go to Project Settings > General > Your Apps > Add Web App
4. Copy the config values into `src/firebase.js`
5. Deploy and all family members will share the same data

### Setting Up EmailJS (optional, for emailing plans)

1. Sign up at [EmailJS](https://www.emailjs.com/)
2. Create a service and template
3. Update the config values in `src/email.js`

## Deploying to GitHub Pages

Push to GitHub, then enable Pages in repo Settings > Pages > Source: Deploy from branch (main, / root).

## Customizing Family Members

Edit the `DEFAULT_MEMBERS` array in `src/firebase.js` to set your family member names.
