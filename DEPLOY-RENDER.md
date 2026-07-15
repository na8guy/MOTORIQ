# Deploying MOTORIQ to Render

Render hosts **both** the backend API and the PostgreSQL database. Two ways:

- **Blueprint (recommended):** commit [`render.yaml`](render.yaml), then in Render → **New → Blueprint** and select this repo. It creates the DB + web service and wires `DATABASE_URL` and a generated `JWT_SECRET` automatically.
- **Manual:** create a **PostgreSQL** instance and a **Web Service** and set these in the service settings:
  | Setting | Value |
  |---|---|
  | **Root Directory** | `backend` |
  | **Build Command** | `npm install --include=dev && npx prisma generate && npm run build` |
  | **Pre-Deploy Command** | `npx prisma db push` |
  | **Start Command** | `npm start` |
  | **Health Check Path** | `/health` |

Render sets `PORT` automatically — the app reads it. `--include=dev` is required because Render sets `NODE_ENV=production`, which otherwise skips `typescript` + `prisma` (devDependencies) and the build fails.

> ### ⚠️ Fixing `Couldn't find a package.json file in "/opt/render/project/src"` (running `yarn start`)
> This means the service's **Root Directory is blank** (Render is looking at the repo root, where there is no `package.json`) and it fell back to the default `yarn start`. The API lives in **`backend/`**. Fix it one of two ways:
> 1. **Set Root Directory to `backend`** in the service's **Settings**, set the Build/Start commands from the table above, and **Manual Deploy → Clear build cache & deploy**. *(Changing Root Directory alone isn't enough — also set the Build and Start commands, or it will still default to `yarn` with no build step.)*
> 2. **Or delete the service and re-create it via Blueprint** (`render.yaml` already sets `rootDir: backend` and the correct commands).

After the first deploy, seed the admin + demo data **once** from the service Shell:

```bash
npm run seed
```

The Ops dashboard is then at `https://<your-service>.onrender.com/admin`.

---

## Environment variables

### Required
| Variable | Value | Notes |
|---|---|---|
| `NODE_ENV` | `production` | |
| `DATABASE_URL` | *(from Render Postgres)* | Blueprint wires this via `fromDatabase`. Manual: copy the **Internal** connection string. |
| `JWT_SECRET` | long random string | Blueprint generates it; manual: use ≥ 32 random chars. |

### Recommended
| Variable | Default | Notes |
|---|---|---|
| `CORS_ORIGINS` | `*` | Comma-separated app/web origins in production. |
| `JWT_ACCESS_TTL` | `15m` | Access-token lifetime. |
| `JWT_REFRESH_TTL` | `30d` | Refresh-token lifetime. |
| `ADMIN_EMAIL` | `admin@motoriq.co.uk` | Seeded admin login. |
| `ADMIN_PASSWORD` | `admin12345` | **Change this** before seeding. |

### Fuel data
| Variable | Default | Notes |
|---|---|---|
| `FUEL_FINDER_MODE` | `mock` | `aggregate` = real UK retailer feeds; `single` = gov.uk Fuel Finder REST endpoint; `mock` = sample data. |
| `FUEL_RETAILER_FEEDS` | *(built-in list)* | Comma-separated retailer JSON feed URLs (aggregate mode). |
| `FUEL_FINDER_BASE_URL` | `https://api.fuel-finder.service.gov.uk` | For `single` mode. |
| `FUEL_FINDER_API_KEY` | — | Bearer token for `single` mode. |
| `FUEL_FEED_TTL_SECONDS` | `900` | Feed cache TTL. |
| `DEFAULT_TANK_LITRES` | `45` | Tank size for "save £X on a full tank". |

### Card issuer — Wallester (virtual cards + wallet, gates real money)
| Variable | Default | Notes |
|---|---|---|
| `WALLESTER_MOCK` | `true` | Set `false` to go live. |
| `WALLESTER_BASE_URL` | `https://api.wallester.com` | |
| `WALLESTER_API_VERSION` | `6.0` | |
| `WALLESTER_API_KEY` | — | From Wallester. |
| `WALLESTER_PRIVATE_KEY` | — | PEM, `\n`-escaped on one line. |
| `WALLESTER_PROGRAM_ID` | — | |
| `WALLESTER_CARD_PRODUCT_ID` | — | |
| `WALLESTER_AUDIENCE_ID` | — | |
| `WALLESTER_DEFAULT_CURRENCY` | `GBP` | |

### AI savings insights — Claude (optional)
| Variable | Default | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Without it, insights fall back to a rule-based narrative. |
| `AI_INSIGHTS_MODEL` | `claude-opus-4-8` | |

### Push notifications — Firebase Cloud Messaging (optional)
| Variable | Default | Notes |
|---|---|---|
| `PUSH_PROVIDER` | `mock` | `fcm` to actually send. |
| `FCM_PROJECT_ID` | — | Firebase project id. |
| `FCM_CLIENT_EMAIL` | — | Service-account email. |
| `FCM_PRIVATE_KEY` | — | Service-account PEM, `\n`-escaped on one line. |

---

## Point the Flutter app at Render

```bash
cd app
flutter run --dart-define=API_BASE_URL=https://<your-service>.onrender.com/api/v1
```

## Going fully live checklist
1. `FUEL_FINDER_MODE=aggregate` (real fuel prices).
2. Wallester: `WALLESTER_MOCK=false` + credentials → real KYC, wallet, cards.
3. `ANTHROPIC_API_KEY` → AI savings narratives.
4. `PUSH_PROVIDER=fcm` + FCM service account → real push (also add Firebase to the Flutter app).
5. Rotate `ADMIN_PASSWORD`, restrict `CORS_ORIGINS`, upgrade the DB/service plans.
