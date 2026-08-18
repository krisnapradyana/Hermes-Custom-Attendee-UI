# SuperPixel Clock (Attendee UI)

Clock-in / clock-out web app for SuperPixel projects. Members open
`https://<domain>/clock` (works great on phones), tap a project to clock in,
tap again to clock out. The main SuperPixel Assistant reads these sessions to
show per-member workload in each project's **Team** tab.

Built per `docs/PROMPT-TIMECLOCK.md` in the main repo — see that file for
product rules (one active session globally, 12h auto-close, no surveillance).

## Architecture

- Standalone Next.js app, `basePath: /clock`, served on the SAME domain as the
  main assistant via Caddy — one cert, one Slack app.
- **This app is the single writer of timeclock data** (JSON files in the
  `attendee-data` volume). The main app reads over the internal Docker
  network with `INTERNAL_TOKEN`.
- The project list comes FROM the main app (`/api/internal/projects`, same
  token) — the main app stays the single writer of projects.

## Setup

1. `cp .env.example .env.local` and fill it (see comments inside).
2. Slack app → OAuth → add redirect URL
   `https://<domain>/clock/api/auth/callback/slack`.
3. Main app `.env.local`: add the SAME `INTERNAL_TOKEN=...`, then rebuild it.
4. One-time: `docker network create spx-net`, and add the `spx-net` external
   network to the main app's compose file (so `http://assistant-web:3000`
   resolves from this container).
5. Caddyfile — add INSIDE the existing site block, ABOVE the main app's
   reverse_proxy:

   ```
   handle /clock* {
       reverse_proxy localhost:3210
   }
   ```

   (`handle`, not `handle_path` — the app expects the /clock prefix.)
6. `docker compose -f docker-compose.example.yml up -d --build`
   (copy the file to `docker-compose.yml` and adjust first if needed).

## API (used by the main app's Team tab)

- `GET /clock/api/timeclock/<projectId>` + header `x-internal-token` →
  `{ members: [{userKey, name, todayMs, weekMs, sessions, lastSeen, activeSince?}], history: [...] }`
- `GET /clock/api/timeclock/<projectId>/export` → CSV (studio-local times).

## Dev

```bash
npm install
npm run dev            # http://localhost:3210/clock
```

Set `NEXT_PUBLIC_AUTH_ENABLED=false` in `.env.local` for single-user local
dev without Slack.
