# Home Inspection Marketplace — Phase 1 (MVP)

A US two-sided marketplace connecting customers who need property inspections
with verified, licensed inspectors. Built to the client's Developer SOP.

- **Customers** request an inspection, give the property details, get a priced
  quote, pay, and track the job to its report.
- **Inspectors** get verified once (per state), then see eligible work on a
  mobile portal, accept it, complete it, submit the report, and get paid.
- **Admin** verifies inspectors, oversees jobs, moves money, configures pricing
  and coverage, and works an exceptions queue.

Core transaction, per SOP §1:
`REQUEST → PAYMENT SECURED → JOB AVAILABLE → INSPECTOR ACCEPTS → COMPLETED →
REPORT SUBMITTED → PAYOUT`

---

## Running it locally

**Requirements:** Node 20+, PostgreSQL 14+.

```bash
# 1. API
cd server
cp .env.example .env          # then set DATABASE_URL and JWT_SECRET
npm install
npx prisma migrate deploy
npm run seed                  # demo catalogue, areas, providers and jobs
npm run dev                   # http://localhost:4000

# 2. Web app (second terminal)
cd web
npm install
npm run dev                   # http://localhost:5173
```

The web dev server proxies `/api` and `/socket.io` to the API, so the browser
sees a single origin and the session cookies work with no CORS setup.

### Demo accounts

All use the password from `SEED_PASSWORD` (default `DemoPass123!`):

| Account | What it shows |
| --- | --- |
| `customer@example.com` | Bookings in flight, live tracking |
| `provider@example.com` | Approved inspector — TX, full home inspections |
| `provider2@example.com` | Approved inspector — TX, specialty inspections |
| `provider3@example.com` | Inspector **awaiting approval**, AZ (for the review queue) |
| `admin@example.com` | Full admin dashboard |

The sign-in page lists these and fills the form on tap. **Delete that block
before the platform takes a real customer** — it is in `web/src/pages/Login.jsx`.

---

## What Phase 1 covers

| SOP section | Where it lives |
| --- | --- |
| §3 Customer booking workflow | `web/src/pages/Book.jsx`, `server/src/routes/bookings.js` |
| §3.6 Configurable pricing rules | `server/src/services/pricing.js` |
| §4 Inspector onboarding & verification | `web/src/pages/provider/Onboarding.jsx` |
| §5 Inspector mobile portal | `web/src/pages/provider/*` |
| §6 Job notification & atomic acceptance | `server/src/services/assignment.js`, `realtime.js` |
| §7 Job status model | `server/src/services/jobs.js` |
| §8 Completion verification & payout | `routes/provider.js`, `services/payments.js` |
| §9 Admin dashboard | `web/src/pages/admin/*` |
| §10 Configurable fee / payout rules | `services/pricing.js`, admin → Coverage → Platform fee |
| §11 Reliability & failure handling | `lib/http.js`, `assignment.js`, `routes/webhooks.js` |
| §13 Nationwide-ready data | `ServiceArea` + `InspectorCredential` models |
| §14 Security & data protection | `lib/auth.js`, `routes/documents.js`, `services/storage.js` |
| §12 US mobile-first | Throughout; verified at 390px in the browser tests |

---

## Design decisions worth knowing

**Geography is data, not code** (SOP §13). A market exists because there is a
row in `ServiceArea`. Launching a new city or state is adding rows on the admin
Coverage page — no deploy, no code change. No state-specific terminology appears
anywhere in the schema: a credential carries a plain `jurisdiction` string, never
a column named after one state.

**The platform fee is not hard-coded** (SOP §10). There is no percentage literal
in the pricing logic. The split comes from the service's own rule, falling back
to a global `payout.defaultPercentBp` setting the business edits from the admin
screen. A service can pay a percentage of the *final* price (so square-footage
tiers and add-ons are shared automatically) or a flat amount.

**Prices are calculated from configurable rules** (SOP §3.6). Square-footage
bands, an age surcharge and optional add-ons are admin-editable rows, and every
quote returns an itemised breakdown that is stored on the job. "Why was I
charged $625?" is answered from what actually happened, not by re-running
today's rules against yesterday's booking. Only the highest matching age band
applies — the bands are not cumulative.

**Money is integer cents, never floats.** And a job snapshots both the customer
price and the provider rate at the moment it is booked, so changing the
catalogue later cannot retroactively alter what someone was charged or promised.

**One status enum, one audit trail.** Every job status change goes through
`transitionJob`, which refuses illegal transitions and appends a `JobEvent`. The
customer's tracker and the admin's audit trail render from the same rows, so
they cannot disagree.

**Job acceptance is race-safe.** This is the one place where a bug costs real
money — two providers driving to one property, two payouts for one fee. The
claim is a single conditional `UPDATE ... WHERE status='OPEN' AND providerId IS
NULL`; Postgres row-locks for the duration, so the second transaction
re-evaluates against the committed row and matches zero rows. `count === 0` is a
definitive "someone else got it", not a guess. There is no read-then-write gap.
See `server/src/services/assignment.js` — and `server/test/race.mjs`, which
proves it under real concurrency rather than asserting it.

**Payment truth comes from the webhook, never the browser.** With Stripe, a
payment is only believed when `payment_intent.succeeded` arrives and verifies
against the raw body signature. Webhook deliveries are idempotent via a unique
constraint on the event id — and a replay is distinguished from a *retry after a
failed handler* by checking `processedAt`, so a transient error cannot cause an
event to be permanently swallowed.

**Documents are never public files.** Uploaded filenames are discarded and
replaced with generated keys; downloads run through an authenticated route that
checks entitlement per request. A provider's licence and a customer's report are
not guessable URLs.

**Drivers, not hard-coded vendors.** Payments, email, SMS and storage each sit
behind an adapter. The MVP runs on `mock`/`log`/`local` so the entire flow is
demoable before any Stripe, Twilio or S3 account exists; switching to the real
thing is an env var. **The mock payment driver refuses to run in production** —
both at boot and at the call site — so it can never quietly become the live
payment path.

---

## Testing

Three suites, all runnable against a running stack:

```bash
# API: 57 checks across the full customer + inspector + admin journey
cd server && sh test/flow.sh

# Concurrency: 8 providers accept the same job simultaneously, 5 rounds
cd server && node test/race.mjs

# Browser: 55 checks, screenshots every screen at phone and desktop width
cd web && python3 test/walkthrough.py
```

The browser walkthrough writes to `web/test/screens/`. All three are
idempotent — they clean up what they create and can be re-run against the same
database.

> **Note:** login is rate-limited to 20 attempts per 15 minutes per IP, which
> these suites will exhaust if run back to back. Raise `AUTH_RATE_LIMIT_MAX`
> locally when running them. The server refuses a value above 100 when
> `NODE_ENV=production`, so a loosened test setting cannot reach live.

---

## Going live — what has to happen

Phase 1 is complete and self-contained, but it runs on simulated payments and
logged notifications by design. To take real bookings:

1. **Accounts** (all created in the business's own name, not the developer's):
   Stripe, Twilio, an SMTP or transactional email provider, a Postgres host, an
   S3-compatible bucket, and the domain.
2. **Set the drivers** in the production env: `PAYMENTS_DRIVER=stripe`,
   `EMAIL_DRIVER=smtp`, `SMS_DRIVER=twilio`, `STORAGE_DRIVER=s3`.
3. **Point the Stripe webhook** at `POST /api/webhooks/stripe` and set
   `STRIPE_WEBHOOK_SECRET`.
4. **Generate a real `JWT_SECRET`** (`openssl rand -base64 48`) and set
   `COOKIE_SECURE=true`.
5. **Delete the demo-account block** from the sign-in page.
6. **Seed the real catalogue and coverage** — inspection types with real prices
   and square-footage tiers, and a `ServiceArea` row per ZIP actually served.
7. **Set the platform split** on admin → Coverage → Platform fee.

The server refuses to boot in production if any of the critical settings above
are still at their development values.

### Known gaps, stated plainly

These are deliberately out of Phase 1 scope, not oversights:

- **Inspector payout onboarding** — payouts are recorded and released correctly,
  but connecting each inspector's bank account needs Stripe Connect onboarding
  (SOP §4, §8).
- **Address validation / autocomplete** (SOP §3.2) — addresses are typed and
  validated for shape, not verified against a postal database. Needs a Google
  Places or Smarty account.
- **Email / phone verification at signup** (SOP §4) — accounts are created and
  usable immediately; the verification round-trip needs the live email and SMS
  drivers.
- **A2P 10DLC registration** (SOP §12) — a Twilio account-level compliance
  registration, done once the client's Twilio account exists.
- **Inspector Calendar tab** (SOP §5) — accepted work is listed under My Jobs;
  a month view is not built.
- **Institutional / Net-30 company accounts** (SOP §3) — the booking records who
  is paying (customer, realtor or company), but invoice terms are not built. The
  SOP lists this as quotable separately.
- **Monitoring, uptime alerting and backups** (SOP §11) — these are deployment
  concerns rather than code, and belong with the hosting account.
- **Password reset by email** — the change-password flow exists for signed-in
  users; a forgotten-password link needs the email driver live first.
- **Scheduled jobs** — overdue-job and expiring-insurance detection are modelled
  in the exceptions system but nothing runs them on a timer yet; they need a
  cron process.
- **Per-provider calendars** — availability currently assumes business hours for
  all providers. The slot logic is isolated in `services/slots.js` so individual
  working hours can be added without touching the booking routes.
- One `npm audit` high-severity advisory remains in the **Prisma CLI's** own
  dependency tree (`deepmerge-ts`). It is a devDependency and never ships;
  `npm audit --omit=dev` is clean.

---

## Stack

Node 22 · Express · PostgreSQL 16 · Prisma · Socket.IO · React 19 · Vite ·
Tailwind 4 · Stripe · Twilio · bcrypt + JWT (httpOnly cookies, rotating refresh
tokens) · Zod validation · Helmet · rate limiting.
