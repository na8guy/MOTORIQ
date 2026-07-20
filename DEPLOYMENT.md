# SaveOnDrive — deployment & environment

Everything you need to set in **Render → your service → Environment**, and what
breaks if you don't.

---

## 1. If a deploy fails on `prisma db push`

**Symptom in the log:**

```
Error: Use the --accept-data-loss flag to ignore the data loss warnings
==> Exited with status 1
```

**Cause.** Render stores the start command *on the service* at creation time. A
Blueprint's `startCommand` is only applied when the Blueprint is **synced**, so
editing `render.yaml` does nothing to an existing service — the log shows the
old command still running.

**This is now handled in the build step** (`npm run build` → `npm run predeploy`),
which Render does re-read, so no dashboard change is required.

If you ever want the blueprint's start command to actually apply:
**Render → Blueprints → your blueprint → Sync**, or paste this into
**Settings → Start Command**:

```
npm run predeploy && npx prisma db push --accept-data-loss && (npm run seed || echo skip) && (npm run seed:partners || echo skip) && node dist/server.js
```

---

## 2. Environment variables

### Already set — check these are still right

| Variable | Value | Why |
|---|---|---|
| `DATABASE_URL` | (from the Render database) | |
| `JWT_SECRET` | generated | |
| `ADMIN_EMAIL` | `wood.tyna@gmail.com` | Grants admin tier-simulation |
| `APP_PUBLIC_URL` | leave empty | Falls back to `RENDER_EXTERNAL_URL` |

### Needed now — these features are inert without them

| Variable | Where to get it | What breaks without it |
|---|---|---|
| **`RESEND_API_KEY`** | resend.com → API Keys | **No email is sent at all.** No verification, no password reset, no membership emails. Nothing reaches Resend, which is why your Resend logs are empty. |
| `EMAIL_FROM` | `SaveOnDrive <noreply@wanadryve.xyz>` | Must be a domain **verified in Resend**, or every send is rejected |
| **`STRIPE_SECRET_KEY`** | Stripe → Developers → API keys (`sk_live_…`) | Upgrades run in test mode — clearly labelled, but no money is taken |
| **`STRIPE_WEBHOOK_SECRET`** | Stripe → Webhooks → your endpoint (`whsec_…`) | **Memberships are never granted after payment.** The webhook is the only thing that upgrades a member; without the secret it returns 503 and refuses every event |
| `STRIPE_SUCCESS_URL` | `saveondrive://billing/success` | Where Stripe returns after paying |
| `STRIPE_CANCEL_URL` | `saveondrive://billing/cancelled` | |

**Stripe webhook setup.** In Stripe → Developers → Webhooks → *Add endpoint*:

- **URL:** `https://<your-render-host>/api/v1/stripe/webhook`
- **Events:** `checkout.session.completed`, `customer.subscription.created`,
  `customer.subscription.updated`, `customer.subscription.deleted`,
  `invoice.payment_failed`

Then copy the signing secret into `STRIPE_WEBHOOK_SECRET`.

### MOT History (DVSA) — you have these

| Variable | Value |
|---|---|
| `MOT_HISTORY_CLIENT_ID` | your client id |
| `MOT_HISTORY_CLIENT_SECRET` | your client secret |
| `MOT_HISTORY_API_KEY` | your API key |
| `MOT_HISTORY_TOKEN_URL` | *already defaulted* — `https://login.microsoftonline.com/a455b827-244f-4c97-b5b4-ce5d13b4d00c/oauth2/v2.0/token` |
| `MOT_HISTORY_SCOPE` | *already defaulted* — `https://tapi.dvsa.gov.uk/.default` |
| **`DVLA_MOCK`** | **set to `false`** — otherwise real lookups are still faked |

Verify from the backend directory:

```
npm run check:mot -- AB12CDE
```

It tests OAuth and the API **separately**, so a failure tells you which half
broke rather than just "it didn't work".

### DVLA VES (road tax) — waiting on approval

| Variable | Status |
|---|---|
| `DVLA_VES_API_KEY` | Leave empty until DVLA approve you |

Registration was closed for system upgrades. Until it opens, MOT expiry comes
from DVSA (real) and tax dates fall back to sample data. With `DVLA_MOCK=false`
and only the MOT key set, you get **real MOT data and no tax data** — which is
correct, and better than faking it.

### Marketplace — no API key needed

There is **no third-party API** for garage prices; no such national service
exists. Partner prices live in the database:

- 16 real UK garages are seeded by `npm run seed:partners`
- Each carries a `priceList` of that chain's own published pricing
- Garages without published prices show a clearly-labelled **regional estimate**

**All partners are seeded `vetted: false`** — real businesses that have not
agreed to anything with you. They are **comparable but NOT bookable**. As you
sign each partnership, flip `vetted` to `true` and booking opens for them. The
booking route enforces this, so an unvetted garage cannot be booked even if the
app asked.

### EV charging

| Variable | Where |
|---|---|
| `OCM_API_KEY` | openchargemap.org → My Profile → My Apps → Register Application (free) |

Without it the EV screen shows sample chargers and says so.
⚠️ OCM data is **CC BY-SA 4.0** and their terms restrict commercial use —
worth emailing them before charging for a membership that leans on it.

### Optional

| Variable | Effect if unset |
|---|---|
| `ANTHROPIC_API_KEY` | AI savings narrative falls back to a rule-based one |
| `WALLESTER_*` | Cards/wallet stay simulated (`WALLESTER_MOCK=true`) |
| `FUEL_FINDER_CLIENT_ID` / `_SECRET` | Fuel prices use the legacy retailer feeds (working, ~2,400 stations) instead of the statutory Fuel Finder API |

---

## 3. Checking what is actually live

Sign in as admin and call:

```
GET /api/v1/admin/diagnostics
```

It reports live-vs-mock for **every** integration and says what to set. This
exists because an unset `RESEND_API_KEY` produced no email *and* no trace in
Resend's logs — indistinguishable from a delivery problem unless you read the
server logs.

---

## 4. Admin: testing paid tiers without paying

Signed in as `wood.tyna@gmail.com`:

**Settings → Admin → Test a membership tier** → Free / Premium / Pro

- Your real membership and billing are **untouched**
- A banner appears throughout the app so a screenshot is never mistaken for a
  paying member
- **No email is sent** — nothing was bought. Real changes do email.

Or via the API: `POST /api/v1/admin/simulate-tier {"tier":"PRO"}`, and
`{"tier":null}` to stop.

---

## 5. Stripe webhook — the URL must match exactly

You configured:

```
https://motoriq-api.onrender.com/api/v1/payments/webhook
```

That path returned **404** before this change, which would have broken every
payment silently: Stripe records a failed delivery, nobody is watching it, and
the member pays and never receives their membership.

**Both paths now work**, so your existing configuration is fine:

- `/api/v1/stripe/webhook`
- `/api/v1/payments/webhook` ← what you set

Confirm in **Stripe → Developers → Webhooks → your endpoint**: recent
deliveries should return **200**, not 404. Send a test event to check.

**Events to subscribe to** (if not already):
`checkout.session.completed`, `customer.subscription.created`,
`customer.subscription.updated`, `customer.subscription.deleted`,
`invoice.payment_failed`

---

## 6. Push notifications — going live with FCM

The **backend is complete**: FCM HTTP v1, service-account JWT to OAuth, token
caching, and invalid-token cleanup. It needs four variables.

⚠️ **But credentials alone will not make notifications arrive.** The app
currently registers a *placeholder* device id, not a real FCM token — so the
server would send to ids Firebase has never heard of, and every send would fail
silently. Both halves are needed.

### Server side

| Variable | Where it comes from |
|---|---|
| `PUSH_PROVIDER` | set to `fcm` (default is `mock`) |
| `FCM_PROJECT_ID` | service-account JSON → `project_id` |
| `FCM_CLIENT_EMAIL` | service-account JSON → `client_email` |
| `FCM_PRIVATE_KEY` | service-account JSON → `private_key` |

Get the JSON from **Firebase console → Project settings → Service accounts →
Generate new private key**.

**The private key is the thing most often pasted wrong.** Render mangles real
newlines, so the value must keep its `\n` escapes exactly as they appear in the
JSON — the whole string including `-----BEGIN PRIVATE KEY-----`.

Verify with:

```
npm run check:push
```

### App side — still to do, and it needs your Firebase project

1. Create a Firebase project (or use the one the service account belongs to)
2. Add an iOS app with bundle id **`uk.co.saveondrive.app`**
3. Download **`GoogleService-Info.plist`** into `app/ios/Runner/`
4. Upload an **APNs authentication key** (from your Apple Developer account) to
   Firebase → Project settings → Cloud Messaging. **iOS push does not work
   without this** — it is the step people most often miss.
5. In Xcode, add the **Push Notifications** capability to the Runner target
6. Then `flutter pub add firebase_core firebase_messaging` and swap the
   placeholder in `auth_state.dart` `_registerDevice()` for
   `FirebaseMessaging.instance.getToken()`

Steps 1–5 need your Google and Apple accounts, so I cannot do them. Step 6 is a
small change once the rest exists.

Until then `PUSH_PROVIDER=mock` is the honest setting: notifications are written
to the database and shown in-app, they just are not pushed to the lock screen.
