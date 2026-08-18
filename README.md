# SuperPixel Clock (Attendee UI)

Clock-in / clock-out web app for SuperPixel projects. Members open
`https://clock.<domain>` (works great on phones), tap a project to clock in,
tap again to clock out. The main SuperPixel Assistant reads these sessions to
show per-member workload in each project's **Team** tab.

Built per `docs/PROMPT-TIMECLOCK.md` in the main repo — see that file for
product rules (one active session globally, 12h auto-close, no surveillance).

## Architecture

- Standalone Next.js app on its OWN subdomain, e.g.
  `clock.spx-assistant.duckdns.org`. DuckDNS resolves every sub-subdomain to
  the same IP automatically — no DNS setup needed; Caddy routes by hostname
  and fetches a separate certificate for it.
- **This app is the single writer of timeclock data** (JSON files in the
  `attendee-data` volume). The main app reads over the internal Docker
  network with `INTERNAL_TOKEN`.
- The project list comes FROM the main app (`/api/internal/projects`, same
  token) — the main app stays the single writer of projects.

## Setup

1. `cp .env.example .env.local` and fill it (see comments inside).
2. Slack app → OAuth → add redirect URL
   `https://clock.<domain>/api/auth/callback/slack`.
3. Main app `.env.local`: add the SAME `INTERNAL_TOKEN=...`, then rebuild it.
4. One-time: `docker network create spx-net`, and add the `spx-net` external
   network to the main app's compose file (so `http://assistant-web:3000`
   resolves from this container).
5. Caddyfile — add a NEW site block (separate from the main app's):

   ```
   clock.spx-assistant.duckdns.org {
       reverse_proxy localhost:3210
   }
   ```

6. `cp docker-compose.example.yml docker-compose.yml`, adjust if needed, then
   `docker compose up -d --build`.

## API (used by the main app's Team tab)

- `GET https://clock.<domain>/api/timeclock/<projectId>` — or via the Docker
  network `http://attendee-ui:3000/api/timeclock/<projectId>` — with header
  `x-internal-token` →
  `{ members: [{userKey, name, todayMs, weekMs, sessions, lastSeen, activeSince?}], history: [...] }`
- `GET .../api/timeclock/<projectId>/export` → CSV (studio-local times).

## Dev

```bash
npm install
npm run dev            # http://localhost:3210
```

Set `NEXT_PUBLIC_AUTH_ENABLED=false` in `.env.local` for single-user local
dev without Slack.
