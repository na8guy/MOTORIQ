# MOTORIQ™

**The Smart Membership for Cheaper Driving** — a UK motoring membership platform that
reduces the cost of vehicle ownership through fuel savings, EV charging optimisation, a
prepaid driving wallet, virtual Mastercard, cashback, and reminders.

This repository contains a **working vertical slice** of the full product:

| Component | Stack | Location |
|-----------|-------|----------|
| **Backend API** | Node.js + TypeScript + Fastify + Prisma + PostgreSQL | [`backend/`](backend/) |
| **Mobile app** | Flutter (Dart) | [`app/`](app/) |
| **Ops dashboard** | Served at `GET /admin` (single-page web UI) | [`backend/src/modules/admin`](backend/src/modules/admin/) |
| **Virtual cards + fuel wallets** | Wallester Card Issuing API | [`backend/src/integrations/wallester`](backend/src/integrations/wallester/) |
| **Fuel & EV price data** | UK retailer open-data feed aggregator | [`backend/src/integrations/fuelfinder`](backend/src/integrations/fuelfinder/) |
| **AI savings insights** | Claude (`claude-opus-4-8`) | [`backend/src/integrations/ai`](backend/src/integrations/ai/) |
| **Push notifications** | Firebase Cloud Messaging | [`backend/src/integrations/push`](backend/src/integrations/push/) |

Every integration ships with a **mock/safe default** so the whole stack runs end-to-end
without credentials. Fuel prices default to `mock`; set `FUEL_FINDER_MODE=aggregate` for
**real live UK retailer prices** (Asda, BP, Sainsbury's, Tesco, Morrisons, Esso, …).

**Deploying to Render** (hosts the API + PostgreSQL): see [`DEPLOY-RENDER.md`](DEPLOY-RENDER.md)
and the [`render.yaml`](render.yaml) blueprint.

---

## Architecture

```
Flutter app  ──HTTPS/REST──▶  Fastify API  ──▶  PostgreSQL (Prisma)
                                   │
                                   ├──▶ Wallester  (accounts, virtual Mastercard, top-ups)
                                   └──▶ Fuel Finder (fuel + EV prices)
```

- Money is stored in **minor units (pence)** as integers everywhere — no floats.
- Auth is JWT access tokens (15 min) + rotating refresh tokens (30 days).
- Every user gets a wallet + FREE subscription on signup; a Wallester account is
  provisioned lazily on first wallet use.

## Feature coverage (from the business plan)

| Plan feature | API module | App tab |
|--------------|-----------|---------|
| Fuel & EV price comparison | `fuel` | Fuel |
| Fuel spend / savings tracking | `savings` | Home |
| Vehicle reminders (MOT, tax, service…) | `reminders`, `vehicles` | Vehicles |
| Prepaid driving wallet | `wallet` | Wallet |
| MOTORIQ Mastercard (virtual) | `cards` | Wallet |
| Membership tiers (Free/Plus/Drive/Drive+) | `subscriptions` | Home |
| Referral programme (Give £10 / Get £10) | `referrals` | — |
| Cashback & rewards | `wallet` (REWARD txns) + `savings` | Home |
| Identity verification (KYC) — gates money flows | `kyc` | More → Identity |
| Fraud mitigation (risk scoring, limits, velocity) | `fraud` | — (admin) |
| AI fuel-savings engine (daily/weekly/monthly + AI tips) | `insights` | More → Fuel savings |
| Ranked cheapest fuel + savings each + maps navigation | `fuel/ranked` | Fuel |
| Push + in-app notifications | `notifications` | More → Notifications |
| Admin/ops dashboard, review queue, KYC review, broadcast | `admin` + `/admin` UI | — (web) |
| Membership / referrals / reminders (app-facing) | `subscriptions`/`referrals`/`reminders` | More |

---

## Quick start

### 1. Backend

```bash
cd backend
cp .env.example .env          # set JWT_SECRET; mock integrations are on by default
npm install
npm run prisma:generate

# Start PostgreSQL, then:
npm run prisma:push           # create the schema
npm run seed                  # seed demo user
npm run dev                   # API on http://localhost:4000
```

Need a database quickly? `docker compose up -d db` (see [`docker-compose.yml`](docker-compose.yml)).

**Demo login:** `demo@motoriq.co.uk` / `password123`

Smoke test:
```bash
curl localhost:4000/health
curl "localhost:4000/api/v1/fuel/cheapest?lat=51.5&lng=-0.12&kind=E10"
```

### 2. Flutter app

```bash
cd app
flutter pub get
flutter run          # iOS sim / desktop use localhost; Android emulator auto-uses 10.0.2.2
```

Point the app at a deployed API:
```bash
flutter run --dart-define=API_BASE_URL=https://api.motoriq.co.uk/api/v1
```

The app opens on the login screen pre-filled with the demo credentials.

---

## Going live — integration checklist

The mock clients implement the real request/response shapes; swap in credentials and
confirm the exact contract against each provider's docs:

- **Wallester** (`backend/src/integrations/wallester/wallester.client.ts`)
  - Set `WALLESTER_MOCK=false` and provide `WALLESTER_API_KEY`, `WALLESTER_PRIVATE_KEY`,
    `WALLESTER_PROGRAM_ID`, `WALLESTER_CARD_PRODUCT_ID`.
  - Confirm the request-signing scheme (header names + canonical string) in
    `signRequest()` against <https://api-doc.wallester.com>.
- **Fuel Finder** (`backend/src/integrations/fuelfinder/fuelfinder.client.ts`)
  - Register at <https://www.developer.fuel-finder.service.gov.uk>, set
    `FUEL_FINDER_MOCK=false` + `FUEL_FINDER_API_KEY`, and confirm the endpoint path and
    JSON schema in `load()`.

See [`backend/README.md`](backend/README.md) for the full API reference.
