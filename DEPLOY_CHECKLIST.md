# ShopShot deploy checklist

Production: `https://www.shopshot.co.uk` (Cloudflare Pages project `shopshot`,
D1 database `tesco-image-generator-db`, binding `TESCO_DB`).

Do the sections in order. Sections 1 to 3 can be done days ahead; nothing
changes for visitors until section 5.

The short version, once sections 1 to 3 are done:

```bash
npm run db:migrate:prod     # applies 0006 and 0007
npm run deploy:prod         # builds and deploys
```

---

## 0. Before you start

- Log in: `npx wrangler login` (or export `CLOUDFLARE_API_TOKEN` and
  `CLOUDFLARE_ACCOUNT_ID`).
- Check the Pages project's production branch is `main`: Cloudflare dashboard >
  Workers & Pages > shopshot > Settings > Builds & deployments. `deploy:prod`
  deploys whatever branch you have checked out, so deploy from `main`.
- `wrangler.jsonc` is **not read** by the pinned wrangler 3.78 (it only reads
  `wrangler.toml`, and Pages rejects JSON config in that version). Production
  bindings live in the Pages dashboard. The migration scripts use
  `wrangler.migrations.toml` for that reason.

---

## 1. Stripe

All prices are in **Stripe live mode**, on the existing ShopShot products.
Each price carries USD as its default currency and a **GBP currency option**
(Stripe dashboard: when creating the price, "Add another currency"). One price
ID then serves both currencies, so there are 6 subscription price IDs, not 12.

The amounts below are the ones in `src/config/constants.ts`
(`PLAN_PRICES`, `PACK_PRICES`). If you change one, change both.

### 1a. Subscription prices (recurring, tax behaviour as on the existing prices)

| Plan     | Interval | USD      | GBP option | Secret to set                      |
|----------|----------|----------|------------|------------------------------------|
| Starter  | monthly  | $9.99    | £7.99      | `STRIPE_PRICE_STARTER_MONTHLY`     |
| Standard | monthly  | $29.99   | £24.99     | `STRIPE_PRICE_STANDARD_MONTHLY`    |
| Pro      | monthly  | $79.99   | £64.99     | `STRIPE_PRICE_PRO_MONTHLY`         |
| Starter  | yearly   | $99.00   | £79.00     | `STRIPE_PRICE_STARTER_ANNUAL`      |
| Standard | yearly   | $299.00  | £249.00    | `STRIPE_PRICE_STANDARD_ANNUAL`     |
| Pro      | yearly   | $799.00  | £649.00    | `STRIPE_PRICE_PRO_ANNUAL`          |

Starter monthly can reuse the existing `price_1SxnmqK5jVZf8VX1TwmwvuIs` (it is
already $9.99/month) **if** you add a £7.99 GBP option to it; otherwise create
a new one. The old Standard ($39.99) and Pro ($59.99) prices must not be used.

### 1b. Credit pack prices (one-time)

The existing pack prices (IDs are in `packPriceIds()` in `src/index.tsx`) keep
their USD amounts. Add a GBP option to each. Stripe does not allow editing a
price's currency options after creation on every account; if yours does not,
create new one-time prices and set the matching secret.

| Pack          | Credits | USD  | GBP option | Optional secret if you create a new price |
|---------------|---------|------|------------|-------------------------------------------|
| Standard 25   | 140     | $25  | £20        | `STRIPE_PRICE_PACK_STD_25`                |
| Standard 50   | 290     | $50  | £40        | `STRIPE_PRICE_PACK_STD_50`                |
| Standard 75   | 450     | $75  | £60        | `STRIPE_PRICE_PACK_STD_75`                |
| Standard 100  | 620     | $100 | £80        | `STRIPE_PRICE_PACK_STD_100`               |
| Pro 25        | 41      | $25  | £20        | `STRIPE_PRICE_PACK_PRO_25`                |
| Pro 50        | 85      | $50  | £40        | `STRIPE_PRICE_PACK_PRO_50`                |
| Pro 75        | 130     | $75  | £60        | `STRIPE_PRICE_PACK_PRO_75`                |
| Pro 100       | 182     | $100 | £80        | `STRIPE_PRICE_PACK_PRO_100`               |

Credits are granted by our webhook from `CREDITS.PACKS` in `constants.ts`, not
by Stripe, so the new credit amounts need no Stripe change.

### 1c. WELCOME20 coupon

The site and emails offer `WELCOME20`: 20% off the first payment.

1. Products > Coupons > New: Percentage discount **20%**, Duration **Once**,
   name "Welcome 20%". Leave "Limit to specific products" empty.
   (A percentage coupon works in any currency; a fixed-amount one would not.)
2. On that coupon, add a **promotion code** `WELCOME20`. Tick "Limit to first
   time order" (Stripe calls it "Eligible for first-time order only").

Checkout already sets `allow_promotion_codes`, so the field appears in Checkout.

### 1d. Webhook

Developers > Webhooks: endpoint `https://www.shopshot.co.uk/api/billing/webhook`
must exist and send at least:
`checkout.session.completed`, `invoice.payment_succeeded`,
`invoice.payment_failed`, `customer.subscription.deleted`.
Its signing secret is `STRIPE_WEBHOOK_SECRET`.

---

## 2. Secrets and variables

Set each with (you are prompted for the value; nothing is echoed or stored in
the repo):

```bash
npx wrangler pages secret put <NAME> --project-name shopshot
```

| Name                              | Value                                                    | New? |
|-----------------------------------|----------------------------------------------------------|------|
| `STRIPE_PRICE_STARTER_MONTHLY`    | price ID from 1a                                         | yes  |
| `STRIPE_PRICE_STANDARD_MONTHLY`   | price ID from 1a                                         | yes  |
| `STRIPE_PRICE_PRO_MONTHLY`        | price ID from 1a                                         | yes  |
| `STRIPE_PRICE_STARTER_ANNUAL`     | price ID from 1a                                         | yes  |
| `STRIPE_PRICE_STANDARD_ANNUAL`    | price ID from 1a                                         | yes  |
| `STRIPE_PRICE_PRO_ANNUAL`         | price ID from 1a                                         | yes  |
| `STRIPE_PRICE_PACK_*` (8, optional) | only if you created new pack prices in 1b              | yes  |
| `CURRENCY_GBP_ENABLED`            | `true`, **only once every price in 1a and 1b has a GBP option** | yes |
| `CRON_SECRET`                     | a long random string: `openssl rand -hex 32`             | yes  |
| `STRIPE_SECRET_KEY`               | live secret key                                          | exists, check |
| `STRIPE_WEBHOOK_SECRET`           | from 1d                                                  | exists, check |
| `GEMINI_API_KEY`, `RESEND_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET` | unchanged | exists |

Until `CURRENCY_GBP_ENABLED=true`, every page shows and charges USD, so the
displayed currency and the checkout currency always match.

List what is set: `npx wrangler pages secret list --project-name shopshot`.

---

## 3. R2 image bucket

1. Create the bucket: `npx wrangler r2 bucket create shopshot-images`
2. Bind it to the Pages project: Workers & Pages > shopshot > Settings >
   Bindings > Add > R2 bucket, variable name **`IMAGES_BUCKET`**, bucket
   `shopshot-images`, for Production (and Preview if you test there).
   It is also listed in `wrangler.jsonc`, but see section 0: that file is not
   read at deploy time.

Without the binding the site still works and keeps storing images in D1;
`/api/health` shows `"imagesBucket": false`.

---

## 4. Database migration

**First time only**, mark the migrations production already reflects as
applied (production was built at runtime and has no `d1_migrations` table; see
the header of the script for what was checked):

```bash
npx wrangler d1 execute TESCO_DB --remote -c wrangler.migrations.toml --file=scripts/baseline-d1-migrations.sql
npm run db:migrations:list:prod   # should list exactly 0006 and 0007 as pending
```

Then:

```bash
npm run db:migrate:prod
```

Migrate **before** deploying. The new build adds the same columns at runtime,
and SQLite has no `ADD COLUMN IF NOT EXISTS`, so deploy-then-migrate makes the
migration fail with "duplicate column". If that happens anyway: mark the
migration applied with
`npx wrangler d1 execute TESCO_DB --remote -c wrangler.migrations.toml --command "INSERT INTO d1_migrations (name) VALUES ('0007_activation_currency_drip.sql')"`
and then run the three `UPDATE users ...` statements and the
`CREATE INDEX` statements from `migrations/0007_activation_currency_drip.sql`
by hand (they are what the runtime does not do).

---

## 5. Deploy

```bash
git checkout main && git pull
npm ci
npm run deploy:prod
```

---

## 6. Smoke tests

Run in a private window.

- [ ] `curl -s https://www.shopshot.co.uk/api/health` shows
      `"stripePrices": {"starter": true, "standard": true, "pro": true, "annual": true}`
      and `"migrations": "0007_activation_currency_drip.sql"`.
- [ ] Logged in as an admin, open `/api/health?deep=1`: every entry under
      `stripeCheck` is `ok`. Anything else names the price and the problem.
- [ ] Homepage shows "Try It Free - No Account Needed", the before/after slider
      and the three sample photos. Click a sample: one watermarked image appears
      in under 30 seconds with the sign-up prompt.
- [ ] `/pricing` shows Starter, Standard and Pro, the annual toggle changes the
      prices, and credit packs are listed. From a UK connection with GBP enabled
      every price is in £; from elsewhere in $.
- [ ] `/tools/remove-background` works without an account.
- [ ] Standard monthly checkout completes (see below). Stripe Checkout shows
      the same currency and amount as `/pricing`.
- [ ] After it completes, in D1:
      ```bash
      npx wrangler d1 execute TESCO_DB --remote -c wrangler.migrations.toml --command \
        "SELECT type, credit_type, amount, created_at FROM credit_transactions ORDER BY created_at DESC LIMIT 4"
      npx wrangler d1 execute TESCO_DB --remote -c wrangler.migrations.toml --command \
        "SELECT type, processed, created_at FROM stripe_events ORDER BY created_at DESC LIMIT 4"
      ```
      Expect two `subscription` rows (cheaper and better) and a processed
      `checkout.session.completed` event.
- [ ] Cancel the test subscription in Stripe and refund the payment.

**How to do the checkout test.** Production runs live keys, so either:
(a) pay with a real card on production and refund it straight after, or
(b) deploy the same build to a preview branch whose Preview environment has
test-mode `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and test-mode price IDs,
and pay with `4242 4242 4242 4242`. (b) needs a test-mode webhook pointing at
the preview URL.

---

## 7. Scheduled jobs

Pages has no cron triggers. `POST /api/cron/run` (authorised by
`Authorization: Bearer $CRON_SECRET`) sends the day-2 and day-7 emails and
deletes bot rows from analytics. Call it hourly from the small companion
Worker in `workers/cron/`:

```bash
cd workers/cron
npx wrangler secret put CRON_SECRET     # same value as the Pages secret
npx wrangler deploy
```

Check it: `curl -s -X POST -H "Authorization: Bearer <secret>" https://www.shopshot.co.uk/api/cron/run`.

The free weekly credit drip does not need the cron; it is granted the next
time the user loads a page.

---

## 8. After the deploy

1. **Image migration to R2** (after section 3, any time). Dry run first:
   ```bash
   npx tsx scripts/migrate-images-to-r2.ts --dry-run
   npx tsx scripts/migrate-images-to-r2.ts
   ```
   See the script header for the environment variables it needs. It is
   resumable and only touches rows without an `image_key`.
2. **Search Console**: Sitemaps > resubmit `https://www.shopshot.co.uk/sitemap.xml`.
   Then URL Inspection > Request indexing for the ten strongest posts (listed
   in the PR summary).
3. **GA4**: Admin > Events, mark `sign_up` and `purchase` as key events.
   Also mark `anon_preview_claim` if you want to track preview-to-signup.
4. **GitHub Actions deploys**: only after the manual deploy above is
   smoke-tested, add repository secrets `CLOUDFLARE_API_TOKEN` (permissions:
   Cloudflare Pages Edit, D1 Edit) and `CLOUDFLARE_ACCOUNT_ID` under
   Settings > Secrets and variables > Actions. From then on every push to
   `main` migrates and deploys (`.github/workflows/deploy.yml`). Without them
   the workflow builds only.

---

## Rolling back

Cloudflare dashboard > Workers & Pages > shopshot > Deployments > previous
deployment > Rollback. The 0007 migration only adds columns and indexes, so the
old build runs against the migrated database unchanged.
