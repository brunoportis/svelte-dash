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
