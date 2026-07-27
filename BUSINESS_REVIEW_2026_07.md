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
4. **The economics do not reward success.** Gross margin *falls* as customers upgrade, and the Pro plan runs at roughly 5% gross margin before infrastructure or support. **Not fixed** - this needs pricing decisions and new Stripe products, covered in §6.

Items 1-3 are what kept revenue at zero. Item 4 is what decides whether the revenue that now starts arriving is worth having.

---

## 2. What the business is

| | |
|---|---|
| **Product** | Upload one product photo, get 10 professional e-commerce variations in ~25s |
| **Target** | eBay / Etsy / Amazon / Depop / Vinted / Shopify sellers, small businesses |
| **Stack** | Hono on Cloudflare Pages/Workers, D1 (SQLite), R2, Gemini API Direct with Vertex AI fallback |
| **Models** | `gemini-2.5-flash-image` (Standard) and `gemini-3-pro-image-preview` (Pro) |
| **Monetisation** | Dual-credit system, 3 subscription tiers + one-off credit packs, Stripe |
| **Pricing** | Free (13 credits once) / Starter $9.99 / Standard $39.99 / Pro $59.99 per month |
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
- Restore anonymous try-before-signup: let a visitor generate 3 variations with no account, then gate the remaining 7 behind signup. The session-claim mechanic already existed. **Not implemented here** - it needs new endpoints plus abuse controls, since anonymous generation spends real Gemini budget. Worth a decision on rate limiting first.

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

Current API costs: Standard (`gemini-2.5-flash-image`) ≈ **$0.039/image**, Pro (`gemini-3-pro-image-preview`) ≈ **$0.134/image**.

| Plan | Price | Credits | COGS at full use | After Stripe (2.9% + 30¢) | Gross margin |
|---|---|---|---|---|---|
| Starter | $9.99 | 100 Std + 10 Pro | $5.25 | $9.40 | **~44%** |
| Standard | $39.99 | 500 Std + 45 Pro | $25.58 | $38.53 | **~34%** |
| Pro | $59.99 | 800 Std + 175 Pro | $54.80 | $58.05 | **~5%** |
| Std pack | $25.00 | 400 Std | $15.60 | $23.98 | **~35%** |
| Pro pack | $25.00 | 115 Pro | $15.41 | $23.98 | **~36%** |

Three problems:

1. **Margin falls as customers spend more.** Your best customers are your worst customers. This is backwards - volume should buy you margin, not cost you margin.
2. **The Pro plan is effectively break-even.** $3.25/month contribution before any Cloudflare, Resend, Loops, Stripe Radar or support cost. If Pro ever sold well it would be a problem, not a win. It is also the tier labelled `quality: 'Best (Beta)'`, taking 2-5 minutes vs 25 seconds, with an auto-fallback that silently switches to Standard after two consecutive failures - so you are charging a 50% premium for the least reliable experience.
3. **Credits accumulate without limit.** The pricing page advertises *"Credits roll over (2x)"* but no cap exists anywhere in the code - `addCredits()` simply adds to the balance. A user can stockpile for six months and burn half a year of COGS in one weekend. The advertised claim is also unimplemented, which is its own problem.

**Recommendations:**

- Re-price Pro to **$79-99/month**, or cut it to 500 Std + 120 Pro at $59.99. Target 65-70% gross margin on every tier. SaaS at 34% gross margin cannot fund acquisition.
- **Add annual plans at 30-35% off.** You currently have none. Competitors lead with annual pricing (Photoroom's headline $7.50/mo is the annual rate). Annual fixes cash flow, halves churn, and is the single easiest revenue lever here.
- **Implement the advertised 2x rollover cap** or remove the claim.
- Consider collapsing the dual-credit system (see §8).

---

## 7. Website & conversion

### Trust
- ~~**Refund policy is hostile.**~~ **Fixed.** It read *"All purchases are final... Unused credits are forfeited upon cancellation. No exceptions."* - on a product the buyer could not properly test first. Replaced with a **7-day money-back guarantee** on the first subscription payment, surfaced on the pricing page and inside the paywall modal where it does the work. Cancellation now keeps credits usable to the end of the paid period. **This is a commercial and legal commitment - have it read before it goes live.**
- ~~**Testimonials read as partly fabricated.**~~ **Fixed.** One real named customer (Sparklyscotty Gifts, with logo) sat alongside two initial-only entries ("Mike R.", "Sarah K.") with generated gradient avatars and "Verified Customer" badges. Anonymous composites next to a real named review discount the real one. The two invented cards are gone; the section now carries the single real review plus an invitation to submit one. **Go and collect two more real ones** - that is the only fix that actually restores the lost proof.
- ~~**`aggregateRating: 4.8 / 150 ratings`.**~~ **Removed** from the schema.org markup. Google requires ratings to be genuine and displayed on the page; there is no review system behind that claim, so it was a manual-action risk. Re-add it when real reviews exist.
- **Currency mismatch.** Still open. USD pricing on a `.co.uk` domain, with a UK postal address in schema, British spelling throughout ("optimised", "colour", "programme") and UK-centric content. UK sellers seeing `$` assume FX fees. Either price in GBP for UK traffic or move to a `.com`.

### Conversion mechanics
- No exit-intent capture, no email capture anywhere outside registration, no abandoned-checkout recovery.
- The `WELCOME20` code is hard-coded into the paywall modal UI. `allow_promotion_codes` is enabled in Stripe, but nothing in this repo verifies the coupon exists - worth confirming in the Stripe dashboard, because a promoted code that errors at checkout is worse than no code.
- No urgency, no scarcity, no social proof counters ("X images generated this week"), no live example gallery that updates.

### Performance
- **Tailwind is loaded via `cdn.tailwindcss.com` on every page.** That is the in-browser JIT compiler - 300KB+ of render-blocking JS plus a flash of unstyled content. Google's own docs say not to use it in production. This is hurting Core Web Vitals and therefore rankings, on a site whose only acquisition channel is SEO.
- Homepage is 68KB of HTML before that CDN request. Example images are unoptimised JPEGs at 40-75KB each (the blog already has WebP - the marketing pages don't).
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

A `window.ssTrack()` helper now sits in the shared GTM snippet and fires to both `gtag` and `dataLayer`: `sign_up`, `login`, `image_uploaded`, `generation_complete` (with variations requested vs actually rendered, and elapsed seconds), `paywall_hit` (with credit type and balance), `begin_checkout` and `onboarding_started`. **You need to register these as conversions in GA4** - the code emits them, but GA4 will not treat them as conversions until you say so.

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

### Needs you, not code
- **Register the new GA4 events as conversions** in the GA4 UI. The code emits them; GA4 will not count them until configured.
- **Have the refund policy read** before deploy. It is now a commercial commitment.
- **Confirm the `WELCOME20` coupon exists** in Stripe. It is hard-coded into the paywall modal, and a promoted code that errors at checkout is worse than no code.
- **Collect two real named testimonials.** The section is honest now but thinner.
- **Supply one genuine rough phone photo** of a real product so the "try our sample" button can be built.

### Next - the offer (needs Stripe products, so not built here)
- **Annual plans at 30-35% off.** You have none; competitors lead with them (Photoroom's headline $7.50/mo is the annual rate). Annual fixes cash flow and roughly halves churn. Needs new Stripe prices, plus a decision: grant 12x credits upfront (simple, cash-positive, risks a stockpile-and-churn user) or drip monthly (correct, but needs a scheduled job because `invoice.payment_succeeded` only fires annually). **Recommendation: drip monthly.**
- **Re-price Pro.** At $59.99 with 800 Standard + 175 Pro it clears about 5% gross margin. Either $79-99/month at current credits, or hold $59.99 and cut to ~500 Standard + 120 Pro. Needs a new Stripe price either way.
- **Implement the advertised "credits roll over (2x)" cap**, or drop the claim. Today credits accumulate without limit, so a stockpiler can burn a year of COGS in a weekend.
- **Stabilise or stop selling Pro.** It is marked Beta, takes 2-5 minutes against Standard's 25 seconds, and auto-falls-back after two failures. A 50% premium on the least reliable path is not defensible.

### Then - growth and structure
- **Restore anonymous try-before-signup** (3 free variations, then gate). Highest-leverage remaining conversion change. Needs rate limiting first, since anonymous generation spends real Gemini budget.
- **Recurring free allowance** - 10 Standard credits monthly - to give lapsed users a reason to return.
- **Ship a Shopify app.** Where competitors get their volume, with billing and trust built in.
- **Seller-community distribution** - eBay/Etsy/Vinted groups and subreddits.
- **Collapse the dual-credit system** to a single currency.
- **Replace the Tailwind CDN** with a build-time stylesheet; migrate generated images from base64-in-D1 to R2.
- **Split `index.tsx`.**

---

## 12. The one-paragraph answer to "why is there no revenue?"

Because for the entire period you have been measuring, a logged-out visitor could not click a buy button, the cheapest plan could not reach Stripe even if they signed up first, the free tier could not complete a single job, the free tool advertised as needing no account returned an authentication error, and newly verified users were returned to the sales page instead of the product. None of those are marketing problems. The product works; the path to paying for it did not.

All five are now fixed. What is left is a pricing structure that pays you least when customers spend most, and a distribution strategy that is one slow channel. Those are decisions, not bugs.
