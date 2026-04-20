# cc-guard dashboard

Local web UI for cc-guard — Apple HIG (macOS System Settings vibrancy) aesthetic.

## Preview now

```bash
cd dashboard/
bun mock-server.ts
```

Open `http://localhost:3458/`. The mock server emits a fresh event every 6s and a fake alert every 45s so you can see live SSE in action.

## File map

| File | Purpose |
|:---|:---|
| `index.html` | SPA shell with 4 tabs (Overview / Alerts / Events / Settings), sidebar, slide-over |
| `styles.css` | Apple HIG System Settings tokens (vibrancy, grouped inset lists, systemBlue accent), auto dark/light |
| `app.js` | Client-side routing, tab lazy-load, SSE wiring, filter chips, slide-over, search |
| `mock-server.ts` | Bun.serve with 4 REST endpoints + SSE stream. **Replace handlers when wiring to real cc-guard daemon.** |
| `mockups/` | The 3 style explorations (kept for reference) |

## Integration checklist (for the cc-guard daemon)

When wiring to the real daemon:

1. Copy/move `index.html` / `styles.css` / `app.js` into the daemon's static assets dir (e.g. `cc-guard/static/`).
2. In the daemon, expose HTTP on a config-driven port (default **3458**) with:
   - `GET /` → serve `index.html`
   - `GET /styles.css`, `GET /app.js` → serve matching file
   - `GET /api/overview` → use `mock-server.ts` as the response shape reference
   - `GET /api/alerts?limit=N` → same
   - `GET /api/events?limit=N` → same
   - `GET /api/config` → same
   - `GET /api/stream` → SSE; emit `overview` (on state change), `alert` (on new alert), `event` (on new event)
3. In `cli.ts`, launch a browser to the dashboard port when `cc-guard dashboard` is invoked (optional; just documenting `localhost:3458/` in `cc-guard status` is enough).
4. Point the OS notification handler's click-to-open target at the dashboard URL so the ⚠ notification → dashboard path closes.

## Response shapes

All endpoints return `application/json`. The SSE stream emits three event types: `overview`, `alert`, `event`. See `mock-server.ts` for concrete TypeScript shapes.

Each shape was chosen to let the daemon read directly from its existing structures:

- **overview** = ring-buffer head state summary + config version.
- **alerts** = `alertsStore` filter from the dedup layer.
- **events** = `ringBuffer.recent(N)` with `source`/`type`/`summary` derived from event payload.
- **config** = `loadConfig()` output + `backends` info from router's enabled list.

## Design notes

- **System Settings vibrancy**: backdrop-filter blur on window + sidebar, translucent materials. Only works well on Chromium/Safari; Firefox falls back to solid.
- **Grouped inset lists**: 10px rounded cards with internal hairline dividers, never full-width rows. Matches iOS/macOS grouped table style.
- **SF Pro via `-apple-system` stack**: no external font load needed; on non-Apple OS it gracefully falls back to system sans-serif.
- **systemBlue accent**: `#0071E3` light, `#0A84FF` dark. All other colors derive from this + severity palette.
- **Live dot**: subtle pulse only when SSE connected; turns amber when reconnecting.
- **Row flash**: new alerts/events fade in with `row-flash` animation — attention-grabbing without being jarring.

## Known limitations

- No auth (localhost-only by assumption; never bind to public interfaces).
- No realtime graphs — sparklines would need a proper data endpoint.
- Search scope is alerts + events text, not a full-text index across config/past sessions.
- Settings tab is read-only; editing config must go through the config.json file (hot-reloaded by the daemon).
