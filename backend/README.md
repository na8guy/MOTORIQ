# MOTORIQ API

Node.js + TypeScript + Fastify + Prisma. All routes are prefixed `/api/v1`.
All money fields are integer **minor units (pence)**.

## Auth

Send `Authorization: Bearer <accessToken>` on protected routes. Obtain tokens from
`/auth/login` or `/auth/register`; refresh with `/auth/refresh`.

## Endpoints

### Auth — `/auth`
| Method | Path | Auth | Body | Purpose |
|--------|------|------|------|---------|
| POST | `/auth/register` | — | `email, password, firstName?, lastName?, phone?` | Create account (+ wallet + free sub); sends a verification email |
| POST | `/auth/login` | — | `email, password` | Sign in |
| POST | `/auth/refresh` | — | `refreshToken` | Rotate tokens |
| POST | `/auth/logout` | — | `refreshToken` | Revoke a refresh token |
| GET | `/auth/verify?token=` | — | — | Verify from the emailed link (returns an HTML page) |
| POST | `/auth/verify-email` | — | `token` | Verify via API (returns JSON) |
| POST | `/auth/resend-verification` | — | `email` | Resend the verification email |

**Email verification (Resend).** Registration sends a verification email (via the
[Resend](https://resend.com) API — logged to the console if `RESEND_API_KEY` is unset).
Users get `emailVerified: false` until they click the link. By default this is **not**
enforced at login; set `REQUIRE_EMAIL_VERIFICATION=true` to block sign-in until verified.
The verify link's base URL comes from `APP_PUBLIC_URL`, or Render's `RENDER_EXTERNAL_URL`,
or `http://localhost:4000`.

### Users — `/users`
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/users/me` | Profile + wallet balance + total saved |
| PATCH | `/users/me` | Update `firstName, lastName, phone` |
| DELETE | `/users/me` | Delete account |

### Vehicles — `/vehicles`
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/vehicles` | List |
| GET | `/vehicles/:id` | Get one |
| POST | `/vehicles` | Create (`registration, make?, model?, year?, fuelType, mileage?`) |
| PATCH | `/vehicles/:id` | Update |
| DELETE | `/vehicles/:id` | Delete |

### Reminders — `/reminders`
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/reminders?upcoming=true` | List (optionally only upcoming) |
| POST | `/reminders` | Create (`type, dueDate, vehicleId?, note?`) |
| PATCH | `/reminders/:id` | Update / mark complete |
| DELETE | `/reminders/:id` | Delete |

`type` ∈ `MOT, ROAD_TAX, SERVICE, INSURANCE, BREAKDOWN, OTHER`.

### Wallet — `/wallet`
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/wallet` | Balance + recent transactions (provisions Wallester account) |
| GET | `/wallet/transactions` | Transactions |
| POST | `/wallet/topup` | Top up (`amount` in £; loads Wallester account) |
| POST | `/wallet/spend` | Spend (`amount` in £, `description`) |

### Cards — `/cards`
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/cards` | List issued cards |
| POST | `/cards` | Issue a virtual MOTORIQ Mastercard via Wallester |
| PATCH | `/cards/:id/status` | `status` ∈ `ACTIVE, FROZEN, CLOSED` |
| DELETE | `/cards/:id` | Close & remove |

### Subscriptions — `/subscriptions`
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/subscriptions/plans` | — | Plan catalogue with pricing |
| GET | `/subscriptions/me` | ✓ | Current subscription |
| POST | `/subscriptions` | ✓ | Subscribe (`plan`, `mileagePackage?` for Drive tiers) |
| POST | `/subscriptions/cancel` | ✓ | Cancel (reverts to Free) |

Plans: `FREE` (£0), `PLUS` (£5.99), `DRIVE` (mileage packages 500/1000/1500),
`DRIVE_PLUS` (£20).

### Fuel & EV — `/fuel` (public)
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/fuel/stations?lat=&lng=&radiusKm=&evOnly=&limit=` | Nearby stations sorted by distance |
| GET | `/fuel/cheapest?lat=&lng=&kind=&radiusKm=` | Cheapest station for a fuel kind |
| GET | `/fuel/ranked?lat=&lng=&kind=&limit=3&tankLitres=` | **Ranked cheapest** (default top 3) with per-station **savings vs average**, **extra-vs-cheapest**, and a **maps navigation URL** |
| GET | `/fuel/ev/stations?lat=&lng=` | EV chargers only |

`kind` ∈ `E10, E5, B7, SDV, ELECTRIC`. Prices are pence-per-litre (pence-per-kWh for EV).
Data source is controlled by `FUEL_FINDER_MODE`: `mock` (sample), `aggregate` (real UK retailer feeds), or `single` (gov.uk Fuel Finder REST endpoint).

### Savings — `/savings`
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/savings` | Dashboard: totals by category + records |
| POST | `/savings` | Record a saving (`category, amount, description?`) |
| DELETE | `/savings/:id` | Delete |

### Referrals — `/referrals`
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/referrals` | List your referral codes |
| POST | `/referrals` | Create a code (`refereeEmail?`) — Give £10 / Get £10 |
| DELETE | `/referrals/:id` | Delete |

### KYC / identity — `/kyc`
Money-movement flows (wallet top-up/spend, card issuance) require a **VERIFIED** KYC profile. The banking partner (Wallester) runs the regulated AML/KYC; we mirror the state.
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/kyc` | Current KYC status |
| POST | `/kyc` | Submit KYC (`dateOfBirth, addressLine1, city, postcode, documentType, documentNumber, …`) |
| POST | `/kyc/refresh` | Re-sync status from the provider (webhook/manual-review simulation) |

`status` ∈ `NOT_STARTED, PENDING, VERIFIED, REJECTED, EXPIRED`. In mock mode applicants are auto-verified unless under 18 (deterministic test rule).

### Fraud — `/fraud`
Every money-movement request is scored (0–100) by an explainable rules engine → `ALLOW` / `REVIEW` / `BLOCK`. Rules: single-txn ceiling, daily top-up limit, velocity, new-account, KYC status. `BLOCK` returns `403 RISK_BLOCKED`; every evaluation is persisted as a `RiskEvent`.
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/fraud/events?decision=` | Your risk events (audit trail) |
| GET | `/fraud/summary` | Counts by decision |

### AI savings engine — `/insights`
Deterministic savings figures + optional Claude-generated narrative. The **calculation** compares the price paid vs the local area-average benchmark × volume; **AI** turns the numbers into a summary and tips (falls back to a rule-based narrative with no `ANTHROPIC_API_KEY`).
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/insights/purchases` | Log a fill-up (`fuelKind, litres, pricePencePerUnit, lat?, lng?, …`) — computes benchmark + saving |
| GET | `/insights/purchases` | List logged purchases |
| GET | `/insights/fuel-savings?period=daily\|weekly\|monthly` | Rollup: time series + totals + **projected annual saving** |
| GET | `/insights/ai?period=…` | Computed summary **+ AI narrative & tips** (`insight.source` = `ai` or `rules`) |

### Notifications — `/notifications`
In-app inbox + push device registration. Push is fanned out via FCM (mock-logs unless configured).
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/notifications/devices` | Register an FCM token (`token, platform`) |
| DELETE | `/notifications/devices/:token` | Remove a device |
| GET | `/notifications?unread=` | Inbox + unread count |
| POST | `/notifications/:id/read` | Mark one read |
| POST | `/notifications/read-all` | Mark all read |

Notifications fire automatically on KYC outcomes and fraud REVIEW/BLOCK.

### Admin / Ops — `/admin` (ADMIN role only)
Backing API for the dashboard served at **`GET /admin`** (a web page).
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/admin/stats` | Platform KPIs (members, KYC, review queue, cards, wallet float, member savings) |
| GET | `/admin/users?q=` | Search users |
| GET | `/admin/risk/queue` | Fraud events flagged REVIEW |
| POST | `/admin/risk/:id/decision` | `{ decision: ALLOW\|BLOCK }` |
| GET | `/admin/kyc/pending` | KYC awaiting manual review |
| POST | `/admin/kyc/:userId/decision` | `{ decision: VERIFIED\|REJECTED, reason? }` |
| POST | `/admin/broadcast` | Send a notification to all/tier members |

Seed an admin with `npm run seed` (`ADMIN_EMAIL` / `ADMIN_PASSWORD`).

## Error shape

```json
{ "error": { "code": "BAD_REQUEST", "message": "…", "details": { } } }
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Dev server with hot reload |
| `npm run build` / `npm start` | Compile to `dist/` and run |
| `npm run typecheck` | Type-check without emitting |
| `npm run prisma:push` | Sync schema to the database |
| `npm run prisma:migrate` | Create a migration |
| `npm run seed` | Seed the demo user |
