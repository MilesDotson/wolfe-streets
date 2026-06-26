# Wolfe Streets

A local top-down open-city driving game inspired by classic crime sandbox games.

## Play locally

```bash
npm start
```

Then open:

```text
http://localhost:5173
```

No package install is required. The game is plain HTML, CSS, and JavaScript.

## Test

```bash
npm test
```

## Controls

- `WASD` or arrow keys: move / drive
- `Shift`: sprint / boost
- `E`: enter or exit a nearby vehicle
- `Space`: handbrake
- `M`: cycle to the next job

## Features

- Large generated city with roads, buildings, river docks, and minimap
- On-foot and vehicle movement
- Traffic, pedestrians, collisions, and police pursuit
- IDM-based traffic following with signal-aware queues and safer lane changes
- Five lives before game over
- Three rotating missions with timers, pickups, rewards, and heat
- Persistent cash and reputation through `localStorage`

## Deploy

This is a static site, so the simplest domain deployment is GitHub Pages:

1. Push `main` to GitHub.
2. In the repo settings, enable Pages from the `main` branch root.
3. Point a custom domain CNAME at the GitHub Pages hostname.

For a direct IP address, host the folder on a small VPS with Nginx/Caddy and serve `index.html` plus the `src/` directory. The local Python server is fine for testing, but not for production.
