# ShopShot - Business & Product Review

**Date:** 27 July 2026
**Scope:** Full review of the business model, application, website, funnel and unit economics
**Live site reviewed:** https://www.shopshot.co.uk
**Codebase reviewed:** `dantheaiguy1/tesco` @ `claude/shop-shot-business-review-5hlv8i`

---

## 1. Executive summary

ShopShot is a genuinely good product with a broken commercial funnel. The AI pipeline works, the feature set is deep (36+ shot types, 14 marketplace export presets, batch upload, background removal, referrals, brand colours, 360 video), and the one real named testimonial is glowing.

Revenue is near zero for four compounding reasons, roughly in order of impact:

1. **You cannot buy.** On `/pricing`, all three subscription buttons render with the HTML `disabled` attribute for logged-out visitors. The highest-intent page on the site has been unable to convert a single anonymous visitor.
2. **You cannot try.** The free tier grants 8 credits (5 Standard + 3 Pro) and a shoot costs 10. It is arithmetically impossible for a free user to see the thing the homepage promises. They watch the grid fill halfway and then hit a paywall modal mid-generation.
3. **You cannot get in easily.** Signup demands name, email, a **required mobile phone number**, password + confirm + three complexity rules, two consent checkboxes, and then a 6-digit email verification code - before any value is delivered.
4. **The economics do not reward success.** Gross margin *falls* as customers upgrade. The Pro plan runs at roughly 5% gross margin before infrastructure or support.

Fix 1, 2 and 3 and the funnel starts working. Fix 4 or the growth will not be worth having.

---

## 2. What the business is

| | |
|---|---|
| **Product** | Upload one product photo, get 10 professional e-commerce variations in ~25s |
| **Target** | eBay / Etsy / Amazon / Depop / Vinted / Shopify sellers, small businesses |
| **Stack** | Hono on Cloudflare Pages/Workers, D1 (SQLite), R2, Gemini API Direct with Vertex AI fallback |
| **Models** | `gemini-2.5-flash-image` (Standard) and `gemini-3-pro-image-preview` (Pro) |
| **Monetisation** | Dual-credit system, 3 subscription tiers + one-off credit packs, Stripe |
| **Pricing** | Free (8 credits once) / Starter $9.99 / Standard $39.99 / Pro $59.99 per month |
| **Acquisition** | SEO only - 31 blog posts, 73 URLs in sitemap. No paid, no marketplace distribution |

---

## 3. Critical defects blocking revenue

These are bugs, not strategy. Four of the five are fixed in the accompanying commit.

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

### 3.5 Stale credit counts across 19 blog CTAs — FIXED

Nineteen blog CTAs promised "15 free credits". The actual grant is 8. The refund policy page also still says 15. Corrected in `src/blog-pages.ts`; the legal pages still need a manual pass.

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

**Recommendation (highest priority, business decision - not implemented):**

- Grant **10 Standard + 3 Pro** at signup, so the first shoot always completes. The marginal COGS of the 5 extra Standard images is about **$0.20 per signup**. That is the cheapest customer acquisition spend available to you and you are currently declining to make it.
- Add a recurring free allowance - 10 Standard credits per month - so lapsed users have a reason to return. Pebblely proves this works.
- Restore anonymous try-before-signup: let a visitor generate 3 variations with no account, then gate the remaining 7 behind signup. The session-claim mechanic already existed.

---

## 5. Signup friction

Current path from "I want to try this" to "I have seen an image":

`Land → /register → name + email + phone + password + confirm + 2 checkboxes → submit → check email → type 6-digit code → land on marketing page → find the app → upload → generate 5 of 10 images → paywall`

Every step is a drop-off. Specific problems:

- **Required mobile phone number.** For a $9.99 self-serve tool. The field is justified in the UI as *"For important account updates and exclusive offers"* - which reads as "we will text you marketing". Nothing in the codebase sends SMS. This is pure friction with no payoff. **Make it optional or remove it.**
- **Mandatory email verification before first value.** Verification is reasonable *eventually*; blocking the first generation on it is not. Let users generate immediately and require verification before download or before the second session.
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
- **Refund policy is hostile.** *"All purchases are final... Unused credits are forfeited upon cancellation. No exceptions."* On a product the buyer could not properly test first. This is the biggest single objection on the site, it sits awkwardly with UK consumer contract regulations on a `.co.uk` domain, and at your current volume a **7-day money-back guarantee would cost almost nothing** while removing the top reason people don't click buy.
- **Testimonials read as partly fabricated.** One real named customer with a logo (Sparklyscotty Gifts) alongside two initial-only entries ("Mike R.", "Sarah K.") with generated gradient avatars and "Verified Customer" badges. Sophisticated buyers spot this instantly and it discounts the real testimonial too. Use the one real one, prominently, and go get two more.
- **`aggregateRating: 4.8 / 150 ratings` in schema.org markup.** If those 150 ratings do not exist this is a Google structured-data policy violation and a manual-action risk. Remove it or make it real.
- **Currency mismatch.** USD pricing on a `.co.uk` domain, with a UK postal address in schema, British spelling throughout ("optimised", "colour", "programme") and UK-centric content. UK sellers seeing `$` assume FX fees. Either price in GBP for UK traffic or move to a `.com`.

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
Two non-interchangeable currencies ("Standard" and "Pro") with different burn rates, shown as two separate balances, granted in different amounts, purchased in different packs. Users have to understand a two-currency exchange system before they understand the product. It also creates the absurdity in §4, where 8 credits cannot buy one 10-credit job.

Internally the naming is inverted too - model key `nano` means Pro, `flash` means Standard - which is a reliable source of future bugs even though it is currently wired correctly.

**Recommendation:** collapse to a single credit. Pro generations cost 3 credits, Standard cost 1. One balance, one number, one mental model. This also fixes the free-tier arithmetic automatically.

### Missing from the app
- **No onboarding.** No product tour, no sample image to try, no empty state guidance. A new user lands on a bare upload box.
- **No sample product.** A "try it with our demo photo" button would let people see the output before committing their own image. Trivial to build, high impact.
- **No re-engagement.** There is an out-of-credits email, but no "you haven't finished your shoot" nudge, no day-2 activation email for signups who never uploaded.
- **Pro tier is Beta.** `quality: 'Best (Beta)'`, `totalTime: '~2-5 minutes'`, with auto-fallback after 2 failures. Either stabilise it or stop selling a 50% premium on it.
- **Dead code shipped to production.** The anonymous `signup-gate-modal` and "You've seen 3 previews" copy render on a flow that no longer exists.

---

## 9. Acquisition

You have one channel - SEO - and it is the slowest possible channel in a category dominated by Photoroom, Canva and Pebblely, all with vastly greater domain authority. 31 posts and 73 URLs is respectable effort but it is a 6-12 month bet, and it currently converts badly because each post carries roughly one register CTA and the offer at the end of it ("15 free credits") was both wrong and insufficient.

**Analytics is the blocking issue.** GA4 fires exactly one event - purchase. Signup, upload, generation-complete and paywall-hit are tracked server-side into D1 only. So in GA4 you cannot see where people drop, cannot build remarketing audiences, and cannot optimise any ad campaign you might run. **Fix this first** - you are flying blind, which is also why these funnel defects survived this long.

**Channel recommendations, in order:**

1. **Shopify App Store.** This is where your competitors get most of their volume. Built-in distribution, built-in billing, built-in trust, and buyers with a credit card already on file. For an e-commerce imaging tool this is the obvious channel and you are not in it.
2. **eBay / Etsy / Vinted seller communities.** Facebook groups, subreddits (r/Etsy, r/eBaySellers, r/FulfillmentByAmazon). Give away free credits, post genuine before/afters. Cheap, fast, and your one real testimonial came from exactly this kind of seller.
3. **Etsy and eBay app integrations** - direct listing image upload would be a genuine moat.
4. **Paid** only after GA4 event tracking and the funnel fixes are live. Spending on a funnel with disabled buy buttons would have burned the budget.

---

## 10. Technical debt

`src/index.tsx` is **25,063 lines**. Backend routes, all HTML pages, all inline CSS and all frontend JavaScript are in one file. This is the root cause of most of what is in this document - the site has drifted out of sync with itself because no change is safely reviewable. The dead signup-gate modal, the stale "15 credits" copy, the missing `starter` branch and the disabled pricing buttons are all symptoms of the same thing.

Split it: `routes/`, `pages/`, `lib/`, `api/`. Not glamorous, but every week it stays monolithic is a week where the next revenue-blocking one-line bug ships unnoticed.

---

## 11. Prioritised action plan

### This week - unblock revenue
1. ~~Enable pricing page buy buttons for logged-out visitors~~ **done**
2. ~~Route Starter to Stripe checkout~~ **done**
3. ~~Send new users to `/app`, not the marketing page~~ **done**
4. ~~Fix the background-removal tool and its false "no account needed" copy~~ **done**
5. ~~Correct the "15 free credits" claims~~ **done in blog; legal pages still need a pass**
6. **Raise the free tier to 10 Standard + 3 Pro** so the first shoot always completes (~$0.20/signup)
7. **Make the phone number optional**
8. **Add GA4 events** for signup, upload, generation_complete, paywall_hit

### Weeks 2-4 - fix the offer
9. Add a 7-day money-back guarantee and rewrite the refund page
10. Add annual plans at 30-35% off
11. Re-price Pro to a sustainable margin
12. Remove or substantiate the `aggregateRating` schema and the two anonymous testimonials
13. Restore anonymous try-before-signup (3 free variations, then gate)
14. Add a "try our sample photo" button and a basic onboarding tour

### Months 2-3 - grow
15. Ship a Shopify app
16. Collapse the dual-credit system to a single currency
17. Replace the Tailwind CDN with a build-time stylesheet; migrate images to R2
18. Split `index.tsx`
19. Begin seller-community distribution

---

## 12. The one-paragraph answer to "why is there no revenue?"

Because for the entire period you have been measuring, a logged-out visitor could not click a buy button, the cheapest plan could not reach Stripe even if they signed up first, the free tier could not complete a single job, the free tool advertised as needing no account returned an authentication error, and newly verified users were returned to the sales page instead of the product. None of those are marketing problems. The product works; the path to paying for it did not.
