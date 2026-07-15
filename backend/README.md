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
| POST | `/auth/register` | — | `email, password, firstName?, lastName?, phone?` | Create account (+ wallet + free sub) |
| POST | `/auth/login` | — | `email, password` | Sign in |
| POST | `/auth/refresh` | — | `refreshToken` | Rotate tokens |
| POST | `/auth/logout` | — | `refreshToken` | Revoke a refresh token |

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
| GET | `/fuel/ev/stations?lat=&lng=` | EV chargers only |

`kind` ∈ `E10, E5, B7, SDV, ELECTRIC`. Prices are pence-per-litre (pence-per-kWh for EV).

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
