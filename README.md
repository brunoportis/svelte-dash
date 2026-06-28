# QAPlanner Demo App

Deterministic Svelte app used as a target for QAPlanner smoke tests.

## Run

```bash
npm install
npm run dev
```

Open:

http://localhost:5173

## Purpose

This is not a real product. It is a local-only fixture for browser automation.

## Main flows

- Login
- Create store through a 4-step wizard
- View store detail
- Edit store address
- Seed demo store
- Reset demo data

## Stable selectors

Important UI elements expose `data-testid` attributes for automation.

## Suggested QAPlanner env

```yaml
base_url: http://localhost:5173/
```

## Deploy to GitHub Pages

This app can be deployed as a static Vite app to GitHub Pages.

In the repository settings, go to:

Settings -> Pages -> Build and deployment -> Source

Select:

GitHub Actions

Then push to `main`.

The app will be available at:

https://<user>.github.io/<repo>/

Because the app uses hash routing, routes look like:

https://<user>.github.io/<repo>/#/login

All demo state persists in browser `localStorage`, so it remains available after navigation and reloads on GitHub Pages.
