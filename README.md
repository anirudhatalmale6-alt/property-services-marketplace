# Property Services Marketplace — Phase 1 (MVP)

A two-sided marketplace connecting customers who need property services with
verified providers.

- **Customers** book a service, pick a time, pay, and track the job to its report.
- **Providers** get verified once, then see available work in their area on a
  mobile portal, accept it, complete it, upload the report, and get paid.
- **Admin** verifies providers, oversees jobs, moves money, and works an
  exceptions queue of anything the platform could not resolve on its own.

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
| `provider@example.com` | Approved provider — inspections |
| `provider2@example.com` | Approved provider — maintenance |
| `provider3@example.com` | Provider **awaiting approval** (for the review queue) |
| `admin@example.com` | Full admin dashboard |

The sign-in page lists these and fills the form on tap. **Delete that block
before the platform takes a real customer** — it is in `web/src/pages/Login.jsx`.

---

## What Phase 1 covers

| Requirement | Where it lives |
| --- | --- |
| Customer booking and checkout | `web/src/pages/Book.jsx`, `server/src/routes/bookings.js` |
| Secure customer & provider accounts | `server/src/lib/auth.js` |
| Provider onboarding / verification | `web/src/pages/provider/Onboarding.jsx`, admin review in `routes/admin.js` |
| Available-job marketplace | `web/src/pages/provider/JobBoard.jsx` |
| Real-time job acceptance | `server/src/services/assignment.js`, `server/src/realtime.js` |
| SMS and email notifications | `server/src/services/notify.js` |
| Payment processing and payouts | `server/src/services/payments.js` |
| Document / report upload | `server/src/services/storage.js`, `routes/documents.js` |
| Admin dashboard | `web/src/pages/admin/*` |
| Nationwide architecture | `ServiceArea` model + `web/src/pages/admin/Coverage.jsx` |
| Mobile-first responsive design | Throughout; verified at 390px in the browser tests |

---

## Design decisions worth knowing

**Geography is data, not code.** A market exists because there is a row in
`ServiceArea`. Launching a new city or state is adding rows on the admin
Coverage page — no deploy, no code change. Nothing in the codebase knows about
any particular city.

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
# API: 45 checks across the full customer + provider + admin journey
cd server && sh test/flow.sh

# Concurrency: 8 providers accept the same job simultaneously, 5 rounds
cd server && node test/race.mjs

# Browser: 47 checks, screenshots every screen at phone and desktop width
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
6. **Seed the real catalogue and coverage** — services with real prices, and a
   `ServiceArea` row per postcode actually being served.

The server refuses to boot in production if any of the critical settings above
are still at their development values.

### Known gaps, stated plainly

These are deliberately out of Phase 1 scope, not oversights:

- **Provider payout onboarding** — payouts are recorded and released correctly,
  but connecting each provider's bank account needs Stripe Connect onboarding.
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
