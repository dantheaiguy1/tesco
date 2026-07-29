# ShopShot - Business & Product Review

**Date:** 27 July 2026 (revised after the first round of fixes)
**Scope:** Full review of the business model, application, website, funnel and unit economics
**Live site reviewed:** https://www.shopshot.co.uk
**Codebase reviewed:** `dantheaiguy1/tesco` @ `claude/shop-shot-business-review-5hlv8i`

---

## 1. Executive summary

ShopShot is a genuinely good product with a broken commercial funnel. The AI pipeline works, the feature set is deep (36+ shot types, 14 marketplace export presets, batch upload, background removal, referrals, brand colours, 360 video), and the one real named testimonial is glowing.

Revenue was near zero for four compounding reasons, roughly in order of impact:

1. **You could not buy.** On `/pricing`, all three subscription buttons rendered with the HTML `disabled` attribute for logged-out visitors. The highest-intent page on the site could not convert a single anonymous visitor. **Fixed.**
2. **You could not try.** The free tier granted 8 credits (5 Standard + 3 Pro) and a shoot costs 10. It was arithmetically impossible for a free user to see the thing the homepage promises - they watched the grid fill halfway and hit a paywall mid-generation. **Fixed** (now 10 Standard + 3 Pro).
3. **You could not get in easily.** Signup demanded name, email, a **required mobile phone number**, password + confirm + three complexity rules, two consent checkboxes, then a 6-digit email code - all before any value. **Partly fixed** (phone now optional; verification gate unchanged).
4. **The economics did not reward success.** Gross margin *fell* as customers upgraded, and the Pro plan ran at roughly 5% gross margin before infrastructure or support. **Repriced** - see §6. With no customers yet there was no grandfathering constraint, so the pricing was redesigned rather than patched.

Items 1-3 are what kept revenue at zero. Item 4 decides whether the revenue that now starts arriving is worth having.

The remaining open item is distribution: one slow channel (SEO) against competitors with far greater domain authority. That is covered in §9 and is now the binding constraint.

---

## 2. What the business is

| | |
|---|---|
| **Product** | Upload one product photo, get 10 professional e-commerce variations in ~25s |
| **Target** | eBay / Etsy / Amazon / Depop / Vinted / Shopify sellers, small businesses |
| **Stack** | Hono on Cloudflare Pages/Workers, D1 (SQLite), R2, Gemini API Direct with Vertex AI fallback |
| **Models** | `gemini-2.5-flash-image` (Standard) and `gemini-3-pro-image-preview` (Pro) |
| **Monetisation** | Dual-credit system, 3 subscription tiers + one-off credit packs, Stripe |
| **Pricing** | Free (13 credits once) / Starter $9.99 / Standard $29.99 / Pro $79.99 per month, or 10x those annually |
| **Acquisition** | SEO only - 31 blog posts, 73 URLs in sitemap. No paid, no marketplace distribution |

---

## 3. Critical defects blocking revenue

These are bugs, not strategy. All five are fixed.

### 3.1 `/pricing` subscription buttons are disabled for logged-out visitors — FIXED

`src/index.tsx` rendered every plan button as:

```
${!user ? 'disabled title="Please sign up first"' : ...}
```

Verified live before the fix - all three buy buttons on the production pricing page carried `disabled`. Note the JS handler `startCheckout()` **already** handled the logged-out case correctly by redirecting to `/register`; the `disabled` attribute meant that code could never run.

**Impact:** every visitor who reached `/pricing` with intent to buy - the single most qualified traffic on the site - found dead buttons.

### 3.2 The Starter plan never reached Stripe — FIXED

The post-verification handler routed only two of the three paid plans to checkout:

```js
if (selectedPlan === 'standard' || selectedPlan === 'pro') { ...create checkout... }
else { window.location.href = redirectTo || '/?welcome=1'; }
```

A user who clicked "Get Starter", saw the button change to "Create Account & Subscribe", filled in the whole form and verified their email was silently dumped on the homepage with no charge attempted. The same gap existed in the Google OAuth callback.

**Impact:** the cheapest, lowest-friction, most likely first purchase was the one plan that could not be bought through its own advertised path.

### 3.3 New users land on the marketing page — FIXED

After email verification the redirect was `/?welcome=1`. Route `/` always renders `getMarketingPage()`, and nothing anywhere reads `welcome=1`. A user who had just handed over an email, phone number and password was shown the sales pitch again instead of the upload screen. Now redirects to `/app?welcome=1`.

### 3.4 The free background-removal tool was advertised as "no account needed" but returned 401 — FIXED

The homepage said *"Free to use, no account needed"* and *"No account needed - completely free"*. The tool page said *"No signup required for your first removal."* `POST /api/tools/remove-background` began with:

```ts
const user = c.get('user')
if (!user) return c.json({ success: false, error: 'Auth required' }, 401)
```

The page had no auth awareness, so a logged-out visitor uploaded an image and received `alert("Background removal failed: Auth required")`.

**Impact:** the site's only ungated top-of-funnel asset - the thing designed to earn trust before signup - actively broke for every anonymous visitor.

Fixed by routing logged-out users to signup with a return path, and correcting the copy on both pages. See §6.1 for the strategic version of this fix.

### 3.5 Stale credit counts sitewide — FIXED

Nineteen blog CTAs promised "15 free credits" against an actual grant of 8; the refund policy said 15 too. Rather than correcting the numbers by hand again, every one of these strings now interpolates `SIGNUP_CREDITS_TOTAL` from `src/config/constants.ts`, so marketing copy cannot drift from the code a third time. See §4 for why it drifted in the first place.

---

## 4. The free tier cannot demonstrate the product

This is the highest-leverage strategic problem and it is not a bug - it is a deliberate setting that backfired.

```
SIGNUP_CHEAPER: 5,   // "reduced to encourage upgrades" (was 10)
SIGNUP_BETTER:  3,   // (was 5)
```

A shoot is 10 images at 1 credit each, and the two credit types are not interchangeable. So a free user gets **5 of the 10 images** on Standard, or 3 on Pro. The generation loop charges per image, so what they actually experience is:

> Images 1-5 appear. Image 6 renders as a yellow `💳 Need Credits` tile. A paywall modal fires over a half-finished grid.

You are demonstrating the failure state, not the product. The homepage headline promises "10 marketplace-ready variations"; the free tier makes that literally unreachable. Then you ask for $39.99/month on the strength of a job the user never saw finish.

**Competitive context:**

| Tool | Free tier |
|---|---|
| Pebblely | 40 images **per month**, no card |
| Photoroom | 250 exports/month (watermarked, no commercial use) |
| **ShopShot** | **8 images once, ever - not enough for one job** |

Making this worse: the anonymous try-before-signup flow **used to exist and was deleted**. The code still carries the tombstone:

```
// REMOVED: Anonymous upload, preview generation, and claim-session endpoints
// All users must sign up/login before uploading or generating images
```

The dead UI is still shipped - `signup-gate-modal`, "You've seen 3 previews - sign up free to get the rest". That removed flow was the single best asset this funnel had. For a visual product, demonstration *is* the sales pitch.

**Status: the grant is now 10 Standard + 3 Pro** (`SIGNUP_CHEAPER: 10`), so the first shoot always completes. Marginal COGS of the 5 extra Standard images is about **$0.20 per signup** - the cheapest acquisition spend available.

`CREDITS` and `PRICING` were duplicated in `src/index.tsx` and `src/config/constants.ts`, with `index.tsx` winning and `constants.ts` dead. That is the mechanism by which copy drifted from reality. `index.tsx` now imports from `constants.ts`, and every "N free credits" string across the marketing pages, blog and legal pages interpolates `SIGNUP_CREDITS_TOTAL` rather than hardcoding a number.

**Still recommended, not implemented:**

- Add a recurring free allowance - 10 Standard credits per month - so lapsed users have a reason to return. Pebblely proves this works.
- ~~Restore anonymous try-before-signup.~~ **Implemented.** A visitor can now generate 3 variations from the homepage with no account, then hits a signup gate, and the previews follow them into the new account. Bounded on three axes so it cannot be farmed: 3 images per preview session, 6 images and 10 sessions per IP per rolling 24h, and the cheap model only - anonymous visitors never reach `gemini-3-pro-image-preview`. Worst case is about $0.23 of API cost per IP per day. IPs are stored only as a salted SHA-256 hash.

---

## 5. Signup friction

Current path from "I want to try this" to "I have seen an image":

`Land → /register → name + email + phone + password + confirm + 2 checkboxes → submit → check email → type 6-digit code → land on marketing page → find the app → upload → generate 5 of 10 images → paywall`

Every step is a drop-off. Specific problems:

- ~~**Required mobile phone number.**~~ **Fixed.** It was required, justified in the UI as *"For important account updates and exclusive offers"* - which reads as "we will text you marketing" - while nothing in the codebase sends SMS. Now optional on both the client and the server, with the format check applying only to values actually entered.
- **Mandatory email verification before first value.** Still in place. Verification is reasonable *eventually*; blocking the first generation on it is not. Let users generate immediately and require verification before download or before the second session. Not changed here because it touches the abuse model.
- **Password complexity rules** (8+ chars, upper, lower, number) on an account holding no sensitive data. Google OAuth exists and should be the visually dominant option - right now it is present but not privileged.

Realistic target: land → Google sign-in → upload → 10 images. Three steps, no typing.

---

## 6. Unit economics

**This section has been rewritten and implemented.** The original finding stands: at $59.99 for 800 Standard + 175 Pro credits, the Pro plan cleared about 5% gross margin, and margin *fell* as customers upgraded. Since there are no customers yet, there was no grandfathering constraint, so the pricing was redesigned rather than patched.

### What was wrong

Pro credits cost 3.4x Standard ($0.134 vs $0.039) and were being bundled generously into every tier. On the old Standard plan, 45 Pro credits were $6.03 of COGS out of $39.99 - 15% of revenue given away as a "taste". On the old Pro plan, 175 Pro credits were $23.45. That single decision is what destroyed the margin at the top.

### The new model

| Plan | Price | Standard | Pro | COGS | GM | $/image |
|---|---|---|---|---|---|---|
| Free | $0 | 10 | 3 | $0.79 | - | acquisition |
| Starter | $9.99/mo | 60 | 5 | $3.01 | **68%** | $0.154 |
| Standard | $29.99/mo | 200 | 18 | $10.21 | **65%** | $0.138 |
| Pro | $79.99/mo | 600 | 60 | $31.44 | **59%** | $0.121 |

Two properties this has that the old model didn't: **margin no longer collapses as the tier rises** (68/65/59 rather than 44/34/5), and **per-image price falls as volume rises** ($0.154 -> $0.138 -> $0.121), so upgrading is rewarded rather than punished.

Standard came *down* from $39.99 to $29.99. It was the "most popular" tier and was priced above the market while running 34% margin - a bad combination. At $29.99 with a tighter allocation it earns more per pound of COGS and reads better against Pebblely's $19 tier.

The arithmetic now lives in `src/config/constants.ts` as `planCogs()` and `planGrossMargin()`, with the unit costs beside them. If Google changes image pricing, that is the one file to revisit.

### Annual plans

Added at 10x the monthly rate - **two months free**, the most legible annual offer and the industry norm. Starter $99, Standard $299, Pro $799.

The credit model was the real decision. Granting twelve months up front is simple and cash-positive but hands one subscriber a year of API cost on day one. Dripping monthly is correct, but `invoice.payment_succeeded` only fires once a year on annual billing, and Cloudflare Pages has no cron trigger.

Resolved with **lazy accrual**: `next_credit_grant_at` on the user row, checked on authenticated requests, granting one month at a time. No scheduled job, no new infrastructure, self-healing if the site is idle. A conditional `UPDATE ... WHERE next_credit_grant_at = ?` makes concurrent requests grant at most once, and grants never run past `subscription_period_end`. Monthly subscribers are deliberately excluded - their top-up already arrives by webhook, and running both paths would double-grant.

Verified against a local D1: a subscriber two months overdue received exactly three months and no more on repeat requests; a monthly subscriber received nothing; and a grant dated after the paid period ended was refused.

### Still open

- **The advertised "credits roll over (2x)" cap was never implemented.** No cap exists anywhere in the code - credits accumulate without limit. The claim has been corrected to "unused credits carry over", which is what actually happens. If you want a real cap, it needs building.
- **Pro remains labelled Beta**, takes 2-5 minutes against Standard's 25 seconds, and auto-falls-back after two consecutive failures. It is now the $79.99 tier, which makes stabilising it more urgent, not less.

---

## 7. Website & conversion

### Legal and compliance - added after an external review pass

**The Cookie Policy was factually wrong, and GA4 loaded on the page making the claim.** `getCookiesPage()` stated *"We do NOT use analytics or advertising cookies. No behavioral tracking occurs on the Service"* and promised *"If we add analytics cookies in the future: we will implement an opt-in consent banner"*. Meanwhile `GTM_HEAD` loaded Google Tag Manager and GA4 on every page, including `/cookies` itself. No consent banner existed anywhere in the codebase, and the Privacy Policy's third-party and cookie lists omitted Google entirely. The `ssTrack` funnel work would have increased that collection considerably on deploy.

Under PECR, non-essential analytics cookies need consent before being set. The site was setting them, denying in writing that it set them, and promising a banner it had not built.

Fixed properly rather than by editing the wording:
- **Google Consent Mode v2**, denied by default, emitted before any Google tag on every page. A consent banner records the choice for six months and re-applies it on later visits.
- The four duplicated copies of `GTM_HEAD`/`GTM_BODY` (one per page module - the same class of duplication that caused the credit-copy drift in §4) are now a single `src/config/analytics.ts`.
- Cookie Policy now discloses GA4 and GTM, names the cookies, and describes the consent mechanism. Privacy Policy gains an Analytics section and lists Google under third-party cookies.

**Verified:** the banner renders on first visit and hides on choice, the choice persists across reloads, `consent default … denied` is emitted before any Google tag on all six page types, and `consent update … granted` fires on accept. **Not verified in this environment:** that no `_ga` cookie is actually written before consent - outbound requests to googletagmanager.com are blocked in the sandbox, so gtag.js never executed. The consent signals are correct; confirm the cookie behaviour once on a real deploy.

**Refund policy leftovers.** §1 was rewritten to a 7-day guarantee, but §2 still said refunds happen *"ONLY"* for outages and §7 framed them as *"the rare cases where refunds are issued (prolonged outage)"* - both in the same document, one section apart. §8 justified the CCR waiver partly on the grounds it is *"standard industry practice for SaaS"*, which is not a legal basis, and nowhere said the guarantee survives the waiver. §5 threatened *"debt collection for unpaid balances"* against consumers using a payment-dispute mechanism. All corrected, plus an explicit statement that the guarantee applies whether or not the waiver box is ticked, and that nothing affects Consumer Rights Act 2015 rights.

**Credit expiry contradicted itself across three surfaces.** Terms said credits do not expire while subscribed; the FAQ said subscription credits *"reset each billing cycle and don't roll over"*; the pricing page advertised rollover. Checked against the code: nothing anywhere resets or expires credits - `addCredits()` only ever adds - so the FAQ was the wrong surface. All three now say credits carry over. Terms also claimed free trial credits expire after 30 days, which is not implemented; removed.

Stale dates corrected (Privacy and Terms were dated November 2025 while carrying the new guarantee; footers said © 2025).

### Trust
- ~~**Refund policy is hostile.**~~ **Fixed.** It read *"All purchases are final... Unused credits are forfeited upon cancellation. No exceptions."* - on a product the buyer could not properly test first. Replaced with a **7-day money-back guarantee** on the first subscription payment, surfaced on the pricing page and inside the paywall modal where it does the work. Cancellation now keeps credits usable to the end of the paid period. **This is a commercial and legal commitment - have it read before it goes live.**
- ~~**Testimonials read as partly fabricated.**~~ **Fixed.** One real named customer (Sparklyscotty Gifts, with logo) sat alongside two initial-only entries ("Mike R.", "Sarah K.") with generated gradient avatars and "Verified Customer" badges. Anonymous composites next to a real named review discount the real one. The two invented cards are gone; the section now carries the single real review plus an invitation to submit one. **Go and collect two more real ones** - that is the only fix that actually restores the lost proof.
- ~~**`aggregateRating: 4.8 / 150 ratings`.**~~ **Removed** from the schema.org markup. Google requires ratings to be genuine and displayed on the page; there is no review system behind that claim, so it was a manual-action risk. Re-add it when real reviews exist.
- **Currency mismatch.** Still open. USD pricing on a `.co.uk` domain, with a UK postal address in schema, British spelling throughout ("optimised", "colour", "programme") and UK-centric content. UK sellers seeing `$` assume FX fees. Either price in GBP for UK traffic or move to a `.com`.

### Conversion mechanics
- No exit-intent capture, no email capture anywhere outside registration, no abandoned-checkout recovery.
- The `WELCOME20` code is hard-coded into the paywall modal UI. `allow_promotion_codes` is enabled in Stripe, but nothing in this repo verifies the coupon exists - worth confirming in the Stripe dashboard, because a promoted code that errors at checkout is worse than no code.
- No urgency, no scarcity, no social proof counters ("X images generated this week"), no live example gallery that updates.

### Second-pass findings (full site sweep, all 21 routes)

All 73 sitemap URLs return 200 and TTFB is healthy at 0.2-0.6s off the Cloudflare edge. Four further issues surfaced, all now fixed:

- **No `og:image` on any non-blog page.** The homepage, `/pricing`, `/get-started`, `/faq`, `/about` and the background-removal tool all declared `twitter:card="summary_large_image"` with no image to go in it. Every share of this site on X, LinkedIn, Facebook, WhatsApp or Slack rendered a blank card. For a product whose entire pitch is visual, that is the most persuasive asset you own failing to appear at the exact moment someone recommends you. Fixed with a shared `socialTags()` helper and a purpose-built 1200x630 card (`/static/og-image.jpg`) showing a real ten-variation result grid. Blog posts already had images and are unaffected.
- **The 404 page was 13 bytes of plain text.** Hono's default `404 Not Found`, with no navigation, no branding, no recovery. Every stale inbound link, mistyped URL and old shared address hit a dead end. Replaced with a branded page carrying links to the main pages, plus a matching 500 handler on `app.onError`.
- **A 571KB logo rendered at 56x56px.** `sparklyscotty-logo.png` was a 968x1024 PNG - 40% of the homepage's entire 1.4MB image payload - displayed as a 56px avatar. Downscaled to 168px and palette-optimised: **571KB to 14.6KB**, a 557KB saving on the most important page on the site.
- **Missing canonicals** on `/get-started` and `/tools/remove-background`. Added.

The `/faq` page also still promised "15 free credits" and answered "Can I get a refund?" with *"No. All sales are final and no refunds are issued under any circumstances"* - including inside its `FAQPage` JSON-LD, so that answer was being served to Google as structured data. Both corrected, along with the same claim in the Terms summary and in the checkout confirmation modal, where an amber "⚠️ Important - Read Before Purchase / All sales final - no refunds" warning was the last thing a buyer saw before clicking pay. That box is now the guarantee.

### Performance
- **Tailwind is loaded via `cdn.tailwindcss.com` on every page.** That is the in-browser JIT compiler - 300KB+ of render-blocking JS plus a flash of unstyled content. Google's own docs say not to use it in production. This is hurting Core Web Vitals and therefore rankings, on a site whose only acquisition channel is SEO.
- Homepage is 68KB of HTML before that CDN request. After the logo fix the image payload is ~860KB; the remaining example images are unoptimised JPEGs at 40-110KB each. The blog already ships WebP - the marketing pages don't. Converting them would save roughly another 400KB.
- **Generated images are stored as base64 in D1**, not R2. This bloats rows, slows the history and results pages, and D1 has row-size limits that this will hit at volume. R2 buckets are already bound and unused for this.

---

## 8. Application & user journey

### The dual-credit system is the biggest UX tax in the product
Two non-interchangeable currencies ("Standard" and "Pro") with different burn rates, shown as two separate balances, granted in different amounts, purchased in different packs. Users have to understand a two-currency exchange system before they understand the product. It created the absurdity in §4, where 8 credits could not buy one 10-credit job.

Internally the naming is inverted too - model key `nano` means Pro, `flash` means Standard - which is a reliable source of future bugs even though it is currently wired correctly.

**Recommendation:** collapse to a single credit. Pro generations cost 3 credits, Standard cost 1. One balance, one number, one mental model. Not done here - it is a data migration across `users`, `credit_transactions` and every pricing surface, and it deserves its own change.

### Missing from the app
- ~~**No onboarding.**~~ **Partly fixed.** A new user landed on a bare upload box. There is now a first-run welcome panel on `/app?welcome=1` showing the credit balance, that it covers one complete set, and the three steps. Dismissible, remembered in `localStorage`.
- **No sample product.** A "try it with our demo photo" button would let people see output before committing their own image. **Not built** - it needs an asset that does not exist. Every image in `public/static/examples/` is either a finished result grid or an AI *output*; using one as the "before" would misrepresent the input. Send one genuine rough phone photo of a real product and this becomes a small change.
- **No re-engagement.** There is an out-of-credits email, but no "you haven't finished your shoot" nudge, no day-2 activation email for signups who never uploaded.
- **Pro tier is Beta.** `quality: 'Best (Beta)'`, `totalTime: '~2-5 minutes'`, with auto-fallback after 2 failures. Either stabilise it or stop selling a 50% premium on it.
- **Dead code shipped to production.** The anonymous `signup-gate-modal` and "You've seen 3 previews" copy are still in the app page markup for a flow that no longer exists. Left in place deliberately: it is the scaffolding for restoring try-before-signup, and deleting it now would mean rebuilding it later.

---

## 9. Acquisition

You have one channel - SEO - and it is the slowest possible channel in a category dominated by Photoroom, Canva and Pebblely, all with vastly greater domain authority. 31 posts and 73 URLs is respectable effort but it is a 6-12 month bet, and it currently converts badly because each post carries roughly one register CTA and the offer at the end of it ("15 free credits") was both wrong and insufficient.

**Analytics was the blocking issue - now fixed.** GA4 fired exactly one event: purchase. Signup, upload, generation-complete and paywall-hit went to D1 only, so GA4 showed no drop-off, supported no remarketing audiences, and could not optimise any ad spend. Being blind to the funnel is why these defects survived as long as they did.

A `window.ssTrack()` helper now sits in the shared analytics module and fires to both `gtag` and `dataLayer`: `sign_up`, `login`, `image_uploaded`, `generation_complete` (variations requested vs actually rendered, elapsed seconds), `paywall_hit` (credit type and balance), `begin_checkout`, `purchase` and `onboarding_started`.

Three gaps in that first pass, found on review and now fixed:
- **Google sign-ups were invisible.** `ssTrack('sign_up')` existed only on the email registration path, hard-coded to `method: 'email'`. The OAuth callback is a server-side redirect and cannot call it. The callback now flags new accounts in the redirect URL and the landing page fires the event with `method: 'google'`.
- **`begin_checkout` carried no `value` or `currency`,** so GA4 could not report checkout value on the subscription funnel - the funnel that matters. Both now included, with a GA4-standard `items` array.
- **`purchase` was never actually fired.** The old code emitted `purchase_complete` to `dataLayer` and a Google Ads conversion, but not GA4's standard `purchase` event - and it hard-coded `currency: 'GBP'` on a site that prices in USD, with no `value` at all. So no revenue was ever recorded, in either system. Now fires a proper `purchase` through `ssTrack` with USD and the real plan or pack value.

**You still need to register these as key events in GA4** - the code emits them, GA4 will not count them until you say so. Note GA4 cannot star an event it has never received, so the order is deploy first, trigger each event once, then star it.

**Check the GTM container before trusting any number.** `ssTrack` fires to `gtag` *and* `dataLayer`, and the page loads both a hardcoded gtag config for `G-FJR6WVMLHE` and the GTM container. If GTM also holds a GA4 tag for the same property, every event lands twice.

**Channel recommendations, in order:**

1. **Shopify App Store.** This is where your competitors get most of their volume. Built-in distribution, built-in billing, built-in trust, and buyers with a credit card already on file. For an e-commerce imaging tool this is the obvious channel and you are not in it.
2. **eBay / Etsy / Vinted seller communities.** Facebook groups, subreddits (r/Etsy, r/eBaySellers, r/FulfillmentByAmazon). Give away free credits, post genuine before/afters. Cheap, fast, and your one real testimonial came from exactly this kind of seller.
3. **Etsy and eBay app integrations** - direct listing image upload would be a genuine moat.
4. **Paid** only after GA4 event tracking and the funnel fixes are live. Spending on a funnel with disabled buy buttons would have burned the budget.

---

## 10. Technical debt

`src/index.tsx` is **25,063 lines**. Backend routes, all HTML pages, all inline CSS and all frontend JavaScript are in one file. This is the root cause of most of what is in this document - the site has drifted out of sync with itself because no change is safely reviewable. The stale "15 credits" copy, the missing `starter` branch, the disabled pricing buttons and the duplicated `CREDITS` block are all symptoms of the same thing.

Split it: `routes/`, `pages/`, `lib/`, `api/`. Not glamorous, but every week it stays monolithic is a week where the next revenue-blocking one-line bug ships unnoticed.

---

## 11. Prioritised action plan

### Done - shipped in this branch
1. Enable pricing page buy buttons for logged-out visitors, carrying plan intent into signup
2. Route Starter to Stripe checkout (email verification path and Google OAuth path)
3. Send new users to `/app`, not the marketing page
4. Fix the background-removal tool and its false "no account needed" copy
5. Free tier raised to 10 Standard + 3 Pro so the first shoot always completes
6. De-duplicate `CREDITS`/`PRICING` into `config/constants.ts` and interpolate every credit figure in copy
7. Phone number made optional, client and server
8. GA4 funnel events via `window.ssTrack()`
9. 7-day money-back guarantee, surfaced on `/pricing` and in the paywall modal
10. Remove unsubstantiated `aggregateRating` schema and the two invented testimonials
11. First-run welcome panel on `/app`
12. Repriced every tier for a defensible margin ladder, with the arithmetic living in `constants.ts`
13. Annual plans at two months free, with lazy monthly credit accrual
14. Anonymous try-before-signup on the homepage, rate limited three ways
15. Fixed three latent runtime bugs surfaced by adding `@cloudflare/workers-types` to tsconfig
16. `og:image` and full social card tags on every non-blog page, with a purpose-built 1200x630 image
17. Branded 404 and 500 pages replacing Hono's 13-byte plain-text default
18. Testimonial logo optimised from 571KB to 14.6KB
19. Canonicals added to `/get-started` and `/tools/remove-background`
20. FAQ, Terms summary and the checkout confirmation modal brought in line with the new refund policy

### Needs you, not code
- **Register the new GA4 events as conversions** in the GA4 UI. The code emits them; GA4 will not count them until configured.
- **Have the refund policy read** before deploy. It is now a commercial commitment.
- **Confirm the `WELCOME20` coupon exists** in Stripe. It is hard-coded into the paywall modal, and a promoted code that errors at checkout is worse than no code.
- **Collect two real named testimonials.** The section is honest now but thinner.
- **Supply one genuine rough phone photo** of a real product so the "try our sample" button can be built.

### Needs new Stripe products before deploy
The plan prices changed, so the old Stripe price objects carry the wrong amounts. Subscription price IDs are now read from the environment and checkout **fails loudly with a 503** rather than quietly charging the old price. Create these six prices and set the secrets:

| Secret | Product |
|---|---|
| `STRIPE_PRICE_STARTER_MONTHLY` | $9.99/month (optional - the existing $9.99 price still works) |
| `STRIPE_PRICE_STANDARD_MONTHLY` | $29.99/month |
| `STRIPE_PRICE_PRO_MONTHLY` | $79.99/month |
| `STRIPE_PRICE_STARTER_ANNUAL` | $99/year |
| `STRIPE_PRICE_STANDARD_ANNUAL` | $299/year |
| `STRIPE_PRICE_PRO_ANNUAL` | $799/year |

Also run migration `0006_annual_subscriptions.sql`, or let `ensureDatabase()` add the columns on first request - it carries the same changes idempotently.

### Then - growth and structure
- **Recurring free allowance** - 10 Standard credits monthly - to give lapsed users a reason to return.
- **Ship a Shopify app.** Where competitors get their volume, with billing and trust built in.
- **Seller-community distribution** - eBay/Etsy/Vinted groups and subreddits.
- **Collapse the dual-credit system** to a single currency. Deferred deliberately: it is a data migration across `users`, `credit_transactions` and every pricing surface, and it deserves its own PR. The plan: one balance, Standard generations cost 1 credit, Pro cost 3. Existing balances convert as `cheaper + (better * 3)`. This removes the two-currency mental model that caused the free-tier arithmetic failure in §4, and removes the "Pro plan gives you Pro credits" naming collision.
- **Replace the Tailwind CDN** with a build-time stylesheet; migrate generated images from base64-in-D1 to R2.
- **Split `index.tsx`.**

---

## 12. The one-paragraph answer to "why is there no revenue?"

Because for the entire period you have been measuring, a logged-out visitor could not click a buy button, the cheapest plan could not reach Stripe even if they signed up first, the free tier could not complete a single job, the free tool advertised as needing no account returned an authentication error, and newly verified users were returned to the sales page instead of the product. None of those are marketing problems. The product works; the path to paying for it did not.

All five are now fixed. What is left is a pricing structure that pays you least when customers spend most, and a distribution strategy that is one slow channel. Those are decisions, not bugs.
