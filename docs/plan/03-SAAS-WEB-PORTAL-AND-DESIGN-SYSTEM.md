# 03 — SaaS Web Portal and Design System

**Status:** Proposed. **App:** `apps/web` — Next.js (App Router), TypeScript, Tailwind CSS v4, Drizzle (`@deepcode/db`), deployed separately from the gateway.

---

## 1. Visual identity and design tokens

### 1.1 Positioning (committed before any pixel)

- **Artifact:** composite — marketing site + SaaS dashboard + admin tool. Each region is designed for its own job.
- **Audience:** Arabic-speaking and international developers evaluating a paid AI IDE. They compare against Cursor, Windsurf and Zed, and they are sceptical of marketing.
- **Primary action:** download the app (landing), keep the subscription healthy (dashboard), keep the pool healthy (admin).
- **Adjectives:** precise, technical, calm, bilingual-native, trustworthy.
- **Essence:** *calm precision on paper* (light theme, owner decision 2026-11-15).

### 1.2 A note on the mandated palette

The brief fixed the palette and fonts. The owner changed the portal to a light
theme on 2026-11-15 (dark remains the desktop app's theme); the roles and the
cyan/indigo usage rules are unchanged, but the values moved to the 700 steps so
text and focus rings pass WCAG AA on paper:

- Cyan is the only action colour. Indigo is restricted to data visualisation and
  one hero treatment; it never appears on buttons, links or gradients.
- No cyan-to-indigo gradients, no gradient text, no glow shadows, no glassmorphism.
- The identity is carried by the **signature move** (§1.6), the **split-D mark**
  (§1.10) and by Arabic typography, not by colour.

If you are open to it, one optional refinement is listed in §1.7.

### 1.3 Core tokens

```css
@theme {
  /* surfaces — cool paper; white cards; one lightness step for hover/popovers */
  --color-bg:            #F7F8FA;
  --color-surface:       #FFFFFF;
  --color-surface-2:     #EEF1F5;
  --color-border:        #DDE3EA;   /* 1px borders */
  --color-border-strong: #B6BFCA;

  /* text */
  --color-fg:            #111827;
  --color-fg-muted:      #4B5563;
  --color-fg-subtle:     #636B78;   /* ≥4.5:1 on bg, surface and surface-2 */

  /* accents */
  --color-primary:       #0E7490;   /* action cyan (deep enough for link text + focus) */
  --color-primary-hover: #155E75;
  --color-primary-fg:    #FFFFFF;   /* text on primary — 5.36:1 */
  --color-secondary:     #4F46E5;   /* indigo — data viz + hero only */

  /* semantic — 700 steps */
  --color-success:       #047857;
  --color-warning:       #B45309;
  --color-danger:        #B91C1C;

  /* type */
  --font-ar:   "IBM Plex Sans Arabic", system-ui, sans-serif;
  --font-en:   "Inter", system-ui, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, monospace;

  /* shape */
  --radius-sm: 6px;      /* inputs, buttons, chips */
  --radius-lg: 10px;     /* cards, dialogs — the only two radii */

  /* motion */
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --dur-fast: 120ms;  --dur-base: 200ms;  --dur-slow: 320ms;
}
```

Contrast checks run in Phase 2 (WCAG 2.2 AA): `fg` 17.7:1, `fg-muted` 7.6:1 and
`fg-subtle` 5.4:1 on white; `primary` as text on white 5.36:1; white on
`primary` 5.36:1; each semantic 700 step ≥5:1 on `bg` and `surface`; primary as
a focus ring 5.36:1.

**Elevation:** by lightness step plus the 1px border. No drop shadows on cards.
One shadow token exists, for floating layers (menus, dialogs) only.

**Theme:** light is the designed default and the only web theme (owner decision
2026-11-15). The desktop app keeps its own dark system; tokens are semantic, so a
dark web theme can be added later without touching components.

### 1.4 Mapping onto the desktop app

The desktop already has a semantic token layer and a mandatory `text-ui-*` type
scale (`apps/desktop/DESIGN.md`). We do not introduce a second system there. The
same semantic roles are assigned to the desktop's existing variables
(`--background`, `--card`, `--border`, `--primary`, …) in a `deepcode-dark`
theme. After the owner's 2026-11-15 decision the web portal is light while the
IDE stays dark; both use the same brand mark and the same action-cyan role, so
the products still read as one family.

### 1.5 Typography

| Role | English | Arabic |
|------|---------|--------|
| Display / headings | Inter 600, tracking −0.02em | IBM Plex Sans Arabic 600, no negative tracking |
| Body | Inter 400, 16/26 | IBM Plex Sans Arabic 400, 16/30 |
| UI labels | Inter 500, 14/20 | IBM Plex Sans Arabic 500, 14/24 |
| Code, keys, numbers in tables | JetBrains Mono 400, tabular figures | same (always LTR) |

- Scale: 1.25 ratio from a 16px base → 12.8, 16, 20, 25, 31.25, 39, 48.8 (rounded to whole pixels).
- Arabic gets ~15% more line-height and never uses letter-spacing (it breaks joining). Arabic headings are set one step smaller than English for equal visual weight.
- Fonts are self-hosted through `next/font` with `display: swap` and subsets split by script, so an English visitor never downloads Arabic glyphs.
- Numerals are Western digits in both languages for keys, prices, tokens and dates.

### 1.6 Signature move

**The bilingual split line.** The product's distinctive fact is that Arabic interface and LTR code coexist correctly. The hero and section dividers show this literally: a 1px cyan rule separates an RTL Arabic pane from an LTR code pane, each running in its own direction, in a real rendering of the IDE. The same 1px rule recurs as the active-state indicator in navigation and tabs. Nothing else on the site competes with it.

### 1.7 Optional refinement (your call, not assumed)

Replace Inter with **IBM Plex Sans** for English. It is the Latin companion of IBM Plex Sans Arabic, so both scripts share proportions and stroke contrast, and it removes the most recognisable generic-UI signal. Zero cost, one token change. The plan proceeds with Inter unless you say otherwise.

### 1.8 Components

Built on shadcn/ui primitives (Radix), restyled to the tokens. Every interactive component is specified for default, hover, active, focus-visible, disabled, loading, error and selected. Rules:

- Buttons are ranked by importance: one primary (`bg-primary`, white text) per view, secondary (border), ghost. Destructive actions use danger only at the confirmation step.
- Focus: 2px primary outline with 2px offset, never removed.
- Tables: text start-aligned, numbers end-aligned in mono tabular figures, row separators only.
- Forms: visible labels, inline validation that keeps user input, errors tied by `aria-describedby`.
- Icons: Lucide at 1.5px stroke, 16/20px, one set throughout; directional icons flip in RTL.
- Motion: opacity and transform only, ≤ 200 ms ease-out for UI, `prefers-reduced-motion` honoured. No scroll-jacking, no marquees, no pulsing dots unless the data is live.
- Target size ≥ 24×24 px; touch targets 44 px on mobile.

### 1.9 Internationalisation

- Routes: `/[locale]/…` with `ar` and `en`; `<html lang dir>` set per locale; default chosen from `Accept-Language`, persisted in a cookie.
- Library: `next-intl` (ICU messages, plural rules, server components).
- **As built (2026-11-15):** locale routing is a small custom middleware, not next-intl's, so the CSP nonce can reach Next's script pipeline. The URL segment is authoritative (`x-locale` header), the cookie persists an explicit choice, and `Accept-Language` breaks ties at the root. Messages are static JSON imports; the server-side request config reads the header first.
- CSS uses logical properties only (`ms-`, `pe-`, `start-`, `text-start`). A lint rule bans physical-direction utilities in `apps/web`.
- Code samples, API keys, model ids and terminal snippets are wrapped in an `LtrIsland` component, the same rule as the desktop.

### 1.10 Brand identity

Built 2026-11-15 (owner request): **the split D** — a geometric `D` on an ink
tile whose vertical stem is the cyan split line from §1.6. Two colours, one
shape, legible at 16 px. The wordmark is live type: `DeepCode` 600, `Studio` 400
in `--color-fg-muted`.

| Asset | Path |
|---|---|
| React mark + wordmark | `apps/web/src/components/brand.tsx` |
| Favicon / Apple icon | `apps/web/src/app/icon.svg`, `apps/web/src/app/apple-icon.png` |
| Standalone mark + raster icons | `apps/web/public/brand/` |
| Usage rules | `docs/brand/identity.md` |

The mark is decorative (`aria-hidden`) because it is always adjacent to the
wordmark or link label. No gradients, shadows or extra glyphs; clear space is
25% of the mark height.

---

## 2. Information architecture

```
/[locale]
├── (marketing)
│   ├── /                     landing
│   ├── /pricing
│   ├── /download
│   ├── /docs/…               quick start, MCP, Skills, gateway API  (phase 2b)
│   ├── /changelog
│   └── /legal/{terms,privacy,acceptable-use,licenses}
├── (auth)
│   ├── /sign-in  /sign-up  /verify-email  /forgot-password
│   └── /auth/desktop         desktop consent → deep link
├── (dashboard)   — signed-in user
│   ├── /dashboard            overview
│   ├── /dashboard/usage
│   ├── /dashboard/keys
│   ├── /dashboard/devices
│   ├── /dashboard/billing
│   └── /dashboard/settings
└── (admin)       — role = admin, separate layout, 2FA required
    ├── /admin                health overview
    ├── /admin/pool
    ├── /admin/users  /admin/users/[id]
    ├── /admin/plans
    ├── /admin/models         routes + prices
    ├── /admin/marketplace    skills + MCP presets
    ├── /admin/releases       installers + update manifest
    └── /admin/audit
/api
├── /api/auth/*                     auth library handlers
├── /api/desktop/exchange           code → device key
├── /api/desktop/device             DELETE (sign-out)
├── /api/webhooks/{stripe,lemonsqueezy,moyasar}
├── /api/v1/client/configs          consumed by the desktop app
└── /api/v1/releases/electron/manifest
```

---

## 3. Public landing page

Section order, each with one job:

| # | Section | Content | Notes |
|---|---------|---------|-------|
| 1 | **Hero** | Headline (one line), one-sentence value statement, primary CTA "Download for <detected OS>", secondary "View pricing". Below: the **interactive IDE preview** | Preview is a real React mock of the IDE shell (sidebar, chat, diff), not a screenshot: a locale toggle flips it between Arabic and English live, and a scripted agent run types a prompt, streams a plan, and applies a diff. Pauses when off-screen; static frame under reduced-motion |
| 2 | **Proof strip** | Supported platforms, model families available, "your keys stay on your machine / ours stay on our servers" | Text, no logo wall of companies we do not have |
| 3 | **Agentic Workspace** | Full-width: task → plan → edits → terminal, with the diff viewer | Asymmetric layout; media bleeds to the edge |
| 4 | **MCP Ecosystem** | Half-width: a live-looking server list with stdio and SSE examples, config snippet in mono | Paired with #5 in a 7/5 split, not equal cards |
| 5 | **Custom Skills** | A `SKILL.md` file rendered next to the skill appearing in the IDE's slash menu | |
| 6 | **Multi-Model Gateway** | Model picker with plan-gated models; one line on usage metering and the HUD | Shows the HUD component itself |
| 7 | **Pricing** | Plan cards (§3.1) | Same component as `/pricing` |
| 8 | **Download** | OS-detecting block (§3.2) | Same component as `/download` |
| 9 | **FAQ** | 8–10 questions: what counts as a credit, what happens at the limit, can I use my own keys, data handling, refunds, supported OS versions, offline behaviour, relation to ZCode (open-source basis, Apache-2.0) | Native `<details>`; FAQ structured data |
| 10 | **Footer** | Product, legal, language switch, status link | |

Deliberately avoided: the hero + three identical icon cards + testimonials template; invented testimonials or usage numbers; stock imagery. Every visual is the product.

Performance budget: LCP < 2.0 s on a mid-range phone on 4G, CLS < 0.05, hero preview code-split and hydrated after first paint, marketing pages statically generated.

SEO: per-locale metadata and `hreflang` pairs, Open Graph images per locale, `SoftwareApplication` structured data, sitemap.

### 3.1 Pricing cards

- Data comes from the `plans` table (`isPublic = true`), so pricing has one source shared with the gateway.
- Each card: plan name, price with currency and interval, credits per period **with a plain-language equivalent** ("about N agent tasks with <model>", computed from `model_prices`), models included, RPM, devices, CTA.
- Monthly/yearly toggle; recommended plan marked by the cyan top rule, not by scaling the card.
- Transparency block under the cards: how a credit is calculated, link to the per-model price table, what happens when credits run out (requests stop, nothing is auto-charged).
- Plan definitions and prices are **your decision**; placeholders `Free / Starter / Pro / Team` are seeded for development only.

### 3.2 OS-detecting download centre

- Detection on the client: `navigator.userAgentData.getHighEntropyValues(["architecture","platform"])` where available, falling back to `navigator.platform` / user agent. Apple Silicon versus Intel cannot be detected reliably in Safari, so macOS always shows **both** buttons with Apple Silicon first.
- Primary button = detected build. Below it, the full matrix:

| OS | Builds |
|----|--------|
| Windows 10/11 | `.exe` x64, `.exe` arm64 |
| macOS 12+ | `.dmg` Apple Silicon, `.dmg` Intel |
| Linux | `.AppImage` x64/arm64, `.deb` x64/arm64 |

- Each row shows version, size, release date and SHA-256, read from the `releases` table that also backs the auto-update manifest. Links point to object storage/CDN, not to the Next.js server.
- No account is required to download. Sign-in happens in the app.

---

## 4. Authentication

- **Library:** Better Auth with the Drizzle adapter (sessions in Postgres, httpOnly `SameSite=Lax` secure cookies). Email + password with verification, plus Google and GitHub OAuth. TOTP 2FA optional for users, mandatory for admins.
- **Authorisation:** enforced in a server-side data-access layer (`requireUser()`, `requireAdmin()`) called by every server component, server action and route handler. Route middleware is only an early redirect and is never the sole check.
- Rate limits on sign-in, sign-up, password reset and code exchange (Redis). Generic error messages to prevent account enumeration.

### 4.1 Desktop deep-link callback — `/auth/desktop`

1. Query: `state`, `code_challenge`, `device_name`, `os`, `app_version`. Validated with zod; invalid requests show an error and never redirect.
2. If signed out → sign-in, then return here with the parameters preserved server-side (not in an open redirect parameter).
3. Consent screen: "Connect **DeepCode Studio** on *<device_name>* (<os>) to your account?" Shows the account email. Approve / Cancel.
4. Approve (server action, CSRF-protected): create a 32-byte code, store its hash with `userId`, `state`, `code_challenge`, 60-second expiry. Enforce `plan.maxDevices`; if exceeded, show the device list to remove one.
5. Respond with a page that navigates to `deepcodestudio://auth?token=<code>&state=<state>` and shows a fallback: an "Open DeepCode Studio" button and a copyable code for manual paste (deep links fail in some Linux desktop environments).
6. `POST /api/desktop/exchange` `{ code, code_verifier, device }`: atomically mark the code consumed (`UPDATE … WHERE consumed_at IS NULL AND expires_at > now() RETURNING`), verify PKCE, create the device and the `kind = 'desktop'` virtual key, return it once.

The `token` parameter name matches the brief; its value is a one-time code, not a credential (doc 00, F3).

---

## 5. Client dashboard

| Page | Content |
|------|---------|
| **Overview** | The same HUD as the IDE, large: plan, credit progress bar, remaining balance, expiry countdown. Below: today's usage, 7-day sparkline, last 5 requests, state-specific banner (≥ 80% used, expiring in ≤ 3 days, payment failed, expired) with one action |
| **Usage** | Daily credits stacked by model (bar), tokens in/out (line), range 7/30/90 days from `usage_daily`. Request history table from `usage_logs`: time, model, input/output tokens, credits, status, duration; filter by key, model, status; cursor pagination; CSV export. No prompt content exists to show |
| **API keys** | List: name, `sk-dc-Ab3x…9fQ2`, kind, created, last used, status. Create (name → key shown once in a mono field with copy and a "I have saved it" confirmation), rotate (new key shown once, old revoked, optional 24 h overlap), revoke. Quick-start snippets with the gateway base URL for curl and common SDKs |
| **Devices** | Desktop installs: name, OS, app version, last seen. "Sign out device" revokes its key |
| **Billing** | Current plan, renewal/expiry date, change plan, cancel at period end, invoices, payment method (provider-hosted portal) |
| **Settings** | Profile, language, password, 2FA, delete account |

Charts follow the tokens: cyan primary series, indigo second series, a fixed categorical order for models, values labelled directly, accessible table alternative for every chart, numbers in mono tabular figures.

Every page defines loading (skeleton), empty (what it is and the next step), and error (retry) states.

### 5.1 Subscription and billing

A provider-neutral interface, one adapter per provider, selected by `BILLING_PROVIDER`:

```ts
interface BillingProvider {
  createCheckout(input: { userId: string; planId: string; locale: "ar" | "en";
                          successUrl: string; cancelUrl: string }): Promise<{ url: string }>;
  createPortalSession?(userId: string): Promise<{ url: string }>;
  verifyAndParseWebhook(req: Request): Promise<BillingEvent>;      // throws on bad signature
  cancel(subscriptionId: string, opts: { atPeriodEnd: boolean }): Promise<void>;
}

type BillingEvent =
  | { type: "subscription.activated"; userId; planId; providerSubscriptionId; periodStart; periodEnd }
  | { type: "subscription.renewed";   providerSubscriptionId; periodStart; periodEnd }
  | { type: "subscription.past_due";  providerSubscriptionId }
  | { type: "subscription.canceled";  providerSubscriptionId; endsAt }
  | { type: "payment.refunded";       providerSubscriptionId; amountCents };
```

Webhook handling: verify the signature on the raw body → insert `billing_events` with a unique `providerEventId` (duplicate = acknowledge and stop) → apply the state change in one transaction → call the gateway's invalidate endpoint. On renewal: `creditsUsed = 0`, `creditsLimit = plan.creditsPerPeriod`, new `expiresAt`. Unused credits do not roll over in v1.

Provider notes:
- **Stripe** — full subscriptions and customer portal; availability depends on where your business is registered.
- **LemonSqueezy** — merchant of record, handles VAT/sales tax globally; simplest compliance.
- **Moyasar** — mada, Apple Pay and STC Pay for Saudi customers. Its recurring model is tokenised cards that **we** charge on schedule, so this adapter includes a renewal job and dunning logic the other two do not need.

Recommendation: launch with **one** provider, chosen by your company's country and target market, and add the second after launch. Which one is a question for you (doc 04 §6).

---

## 6. Admin dashboard

Separate layout and navigation, mandatory 2FA, every mutation written to `audit_logs`, optional IP allowlist.

### 6.1 Upstream key pool manager — `/admin/pool`
- Table per provider: label, fingerprint (`a1b2c3d4…`), status, in-flight / max concurrency, weight, requests and 429/5xx counts for 1 h and 24 h, last error, cooldown remaining.
- Row detail: per-minute success / 429 / 5xx chart for 24 h (from `pool:stat:*`), recent errors (sanitised).
- Actions: add key (write-only field, encrypted server-side, never displayed again — not even masked from the database), enable/disable, edit weight/concurrency/supported models, clear cooldown, test (a one-token request through that key), delete.
- Summary: pool utilisation, keys healthy / cooling / failed, fallback traffic share. Refreshes every 5 s.

### 6.2 Users and subscriptions — `/admin/users`
- Search by email or id. Detail: profile, subscription, credit usage, keys (prefix only), devices, recent requests, billing events, adjustments.
- Actions: assign or change plan manually (`billingProvider = 'manual'`), extend `expiresAt`, **credit adjustment** (± amount with a required reason → `credit_adjustments`, applied as a change to `creditsLimit`, so `creditsUsed` keeps a single writer), suspend/unsuspend, revoke all keys.
- No impersonation in v1.

### 6.3 Plans, models and prices
- Plans: edit credits, RPM, concurrency, allowed models, public flag. Changes apply to new periods; an explicit "apply to current subscribers" action exists for corrections.
- Models: route table (model → provider, upstream model id, API type, priority) and price table with `effectiveFrom`, so a price change never alters past charges.

### 6.4 Skills and MCP marketplace publisher — `/admin/marketplace`
- **Skills:** upload a folder or archive containing `SKILL.md`. The server validates frontmatter (name, description length), scans for executable files and flags them for explicit confirmation, computes SHA-256, stores the archive in object storage. Fields: bilingual title and description, minimum tier, version. Draft → published; publishing bumps the manifest revision and signs it.
- **MCP presets:** form for transport (`stdio` / `sse` / `http`), command and args or URL, required env variable names with descriptions (never values), icon, minimum tier. A preview shows the exact JSON a client will receive.
- Unpublish removes the item from the next manifest; desktops remove it on their next sync.
- The manifest signing key is held outside the web app's normal environment (KMS or an offline signing step) because it can deliver instructions to every installed client.

### 6.5 Releases — `/admin/releases`
Register a build (version, channel, platform, arch, URL, SHA-256, size, notes in both languages), promote preview → stable, set a minimum supported version. Backs both the download centre and the update manifest.

---

## 7. Web security baseline

- Strict Content-Security-Policy with nonces; `frame-ancestors 'none'`; HSTS; `Referrer-Policy: strict-origin-when-cross-origin`.
- All mutations are server actions or route handlers with zod validation, session check and CSRF protection.
- The web app can write pool-key ciphertext but has no code path that decrypts or returns it.
- Secrets are server-only; a build-time check fails if a non-`NEXT_PUBLIC_` variable is referenced from a client component.
- PII minimal: email, name, billing provider ids. Account deletion removes the user and keys and anonymises usage rows.

---

## 8. Catalogues worth mining during build (inspiration, not templates)

- **shadcn/ui** for primitives, restyled to our tokens (MIT; check licences of any third-party block before copying).
- **Refero** and **Mobbin** for dashboard and billing-flow patterns in shipped products.
- Developer-tool sites with strong product-led heroes (Linear, Zed, Warp) for how they show the product instead of describing it. Transpose structure; do not copy visuals.
