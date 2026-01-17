# Email Implementation Plan

> React Email + Resend integration for Good Brief newsletter

---

## Overview

Replace manual email workflow with a code-first, agent-editable system using React Email for templates and Resend for sending + subscription management.

**Key feature:** AI generates fresh "wrapper" copy (intro, sign-off) each week while you approve the final email before sending.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Good Brief Email System                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────┐   │
│  │  Astro Site  │───▶│ Cloudflare   │───▶│ Resend Audiences │   │
│  │  (Frontend)  │    │ Function     │    │ (Contacts DB)    │   │
│  └──────────────┘    └──────────────┘    └──────────────────┘   │
│                                                                  │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────┐   │
│  │ React Email  │───▶│ Send Script  │───▶│ Resend Broadcast │   │
│  │  Templates   │    │ (CLI)        │    │ (Delivery)       │   │
│  └──────────────┘    └──────────────┘    └──────────────────┘   │
│                                                                  │
│  ┌──────────────┐    ┌──────────────┐                           │
│  │ Draft JSON   │───▶│ AI Copy      │──── Generates intro/      │
│  │ (data/drafts)│    │ Generation   │     sign-off each week    │
│  └──────────────┘    └──────────────┘                           │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Decisions Made

| Item | Decision |
|------|----------|
| **From address** | `buna@goodbrief.ro` |
| **Reply-to** | `hello@goodbrief.ro` |
| **Logo** | PNG image (`public/logo.png`) |
| **API approach** | Cloudflare Functions (no Astro SSR needed) |
| **Domain** | Already verified in Resend |

---

## Components

### 1. React Email Templates

**Location:** `emails/`

| File | Purpose |
|------|---------|
| `emails/newsletter.tsx` | Main newsletter template |
| `emails/components/Header.tsx` | Logo + tagline |
| `emails/components/Footer.tsx` | Footer with unsubscribe |
| `emails/components/NewsItem.tsx` | Single news story block |
| `emails/components/SectionHeader.tsx` | Section divider (🌱 Local Heroes, etc.) |
| `emails/components/Intro.tsx` | AI-generated intro section |
| `emails/components/SignOff.tsx` | AI-generated sign-off |

**Design principles:**
- Clean, minimal aesthetic (Ohana/Origo/Sloane inspired)
- Mobile-first responsive
- System fonts for fast loading
- Brand green accent color (`#3d5f46`)
- Ample whitespace
- PNG logo from `public/logo.png`

### 2. AI-Generated Wrapper Copy

**What AI generates each week (fresh content):**
- Opening greeting (variation on "Bună dimineața!")
- Intro paragraph (themed to the week's stories)
- Sign-off message (warm, on-brand)

**What stays fixed (template):**
- Section structure (🌱 Local Heroes, 🏆 Wins, 💚 Green Stuff)
- Article summaries (from draft JSON)
- Footer (unsubscribe, contact info)
- Visual design

**Workflow with approval:**
```
Draft JSON
    ↓
AI generates wrapper copy
    ↓
npm run email:preview → Opens in browser
    ↓
You review and approve (or request changes)
    ↓
npm run email:send --confirm → Sends to subscribers
```

### 3. Subscribe Form + API

**Frontend:** Update `src/components/SubscribeForm.astro`
- Simple form: email input + submit button
- Consent checkbox with privacy link
- Client-side validation
- Success/error states

**Backend:** `functions/api/subscribe.ts` (Cloudflare Function)
- Validates email
- Calls Resend Audiences API to add contact
- Returns JSON response
- No Astro SSR adapter needed

### 4. Send Script

**Location:** `scripts/send-newsletter.ts`

**Workflow:**
1. Read draft JSON from `data/drafts/YYYY-WXX.json`
2. Call AI to generate intro/sign-off copy
3. Transform to React Email props
4. Render email to HTML
5. Preview mode: open in browser for approval
6. Send mode: send via Resend Broadcasts API

**Commands:**
```bash
# Start React Email dev server (hot reload)
npm run email:dev

# Generate and preview newsletter (approval step)
npm run email:preview -- --week 2026-W01

# Send to test email first
npm run email:test -- --week 2026-W01

# Send to all subscribers (requires --confirm flag)
npm run email:send -- --week 2026-W01 --confirm
```

### 5. Environment Variables

**`.env` (local) / Cloudflare env vars (production):**

```env
RESEND_API_KEY=re_xxxxxxxxxx
RESEND_AUDIENCE_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
RESEND_FROM_EMAIL=buna@goodbrief.ro
RESEND_REPLY_TO=hello@goodbrief.ro
OPENAI_API_KEY=sk-xxxxxxxxxx  # For AI copy generation
```

---

## Email Template Design

### Visual Hierarchy

```
┌─────────────────────────────────────────┐
│                                         │
│            [GB LOGO PNG]                │  ← Logo image (centered)
│         Vești bune din România          │  ← Tagline
│                                         │
├─────────────────────────────────────────┤
│                                         │
│  Bună dimineața! 👋                     │  ← AI-generated greeting
│                                         │
│  [Fresh intro paragraph themed to       │  ← AI-generated intro
│   this week's stories - 2-3 sentences]  │
│                                         │
├─────────────────────────────────────────┤
│                                         │
│  🌱 LOCAL HEROES                        │  ← Section header
│  ─────────────────────                  │
│                                         │
│  Titlu articol                          │  ← Bold headline
│                                         │
│  Rezumat în 2-3 fraze clare și          │  ← Body text
│  concise care spun povestea.            │
│                                         │
│  → Citește pe Biziday                   │  ← Source link (green)
│                                         │
├─────────────────────────────────────────┤
│                                         │
│  🏆 WINS                                │
│  ─────────────────────                  │
│                                         │
│  [...]                                  │
│                                         │
├─────────────────────────────────────────┤
│                                         │
│  💚 GREEN STUFF                         │
│  ─────────────────────                  │
│                                         │
│  [...]                                  │
│                                         │
├─────────────────────────────────────────┤
│                                         │
│  [AI-generated sign-off - warm,         │  ← AI-generated
│   fresh each week] 🙏                   │
│                                         │
│  Ai o poveste bună? Reply la acest      │  ← Fixed CTA
│  email sau scrie-ne la contact@...      │
│                                         │
│  ─────────────────────────────────────  │
│                                         │
│  Good Brief · goodbrief.ro              │  ← Footer
│  Unsubscribe                            │  ← Auto-handled by Resend
│                                         │
└─────────────────────────────────────────┘
```

### Typography

| Element | Style |
|---------|-------|
| Tagline | 16px, regular, secondary gray |
| Section headers | 14px, uppercase, brand green, letter-spacing: 1px |
| Headlines | 18px, bold, dark text |
| Body | 16px, regular, dark text, line-height: 1.6 |
| Links | Brand green, underline on hover |
| Footer | 14px, gray |

### Colors (matching brand)

| Use | Color | Hex |
|-----|-------|-----|
| Primary (logo bg, links) | Brand green | `#3d5f46` |
| Text | Dark warm gray | `#1f2937` |
| Secondary text | Gray | `#6b7280` |
| Background | Off-white/cream | `#f5f1eb` or `#ffffff` |
| Dividers | Light gray | `#e5e7eb` |

---

## File Structure (After Implementation)

```
goodbrief/
├── emails/                          # NEW: React Email templates
│   ├── newsletter.tsx               # Main newsletter template
│   ├── components/
│   │   ├── Header.tsx               # Logo + tagline
│   │   ├── Footer.tsx               # Footer with unsubscribe
│   │   ├── Intro.tsx                # AI-generated intro
│   │   ├── SignOff.tsx              # AI-generated sign-off
│   │   ├── NewsItem.tsx             # Single news story
│   │   └── SectionHeader.tsx        # Section divider
│   └── utils/
│       ├── render.ts                # Render email to HTML
│       └── generate-copy.ts         # AI copy generation
│
├── functions/                       # NEW: Cloudflare Functions
│   └── api/
│       └── subscribe.ts             # Subscribe endpoint
│
├── scripts/
│   ├── generate-draft.ts            # Existing
│   └── send-newsletter.ts           # NEW: Preview + send
│
├── src/
│   └── components/
│       └── SubscribeForm.astro      # UPDATED: Use Cloudflare Function
│
├── public/
│   ├── logo.png                     # Existing (used in emails)
│   └── logo.svg                     # Existing
│
├── data/
│   └── drafts/                      # Existing draft JSONs
│
└── package.json                     # Add react-email, resend deps
```

---

## Dependencies

```json
{
  "dependencies": {
    "resend": "^4.0.0",
    "@react-email/components": "^0.0.30",
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "@google/generative-ai": "^0.24.1"
  },
  "devDependencies": {
    "react-email": "^3.0.0"
  }
}
```

---

## Implementation Phases

### Phase 1: Email Template Setup
1. Install React Email + Resend dependencies
2. Create email template structure
3. Build newsletter template following COPY_GUIDELINES
4. Use PNG logo from `public/logo.png`
5. Set up `npm run email:dev` for local preview

### Phase 2: AI Copy Generation
1. Create AI prompt for wrapper copy (intro + sign-off)
2. Prompt follows COPY_GUIDELINES tone/voice
3. Integrate into preview workflow
4. Test with sample drafts

### Phase 3: Send Script with Approval
1. Create `send-newsletter.ts` script
2. `npm run email:preview` → generates + opens for approval
3. `npm run email:test` → sends to your email
4. `npm run email:send --confirm` → sends to all subscribers

### Phase 4: Subscription System
1. Create Cloudflare Function at `functions/api/subscribe.ts`
2. Update SubscribeForm component
3. Add consent checkbox + privacy link
4. Test subscription flow end-to-end

### Phase 5: Production Setup
1. Set up Resend Audience in dashboard
2. Configure environment variables in Cloudflare
3. DNS already verified
4. Test full flow with real subscribers

---

## AI Copy Generation Prompt

The AI will receive:
- This week's article headlines/summaries
- COPY_GUIDELINES.md for tone reference
- Current date/week number

It will generate:
- **Greeting:** Variation on "Bună dimineața!" (can include 👋)
- **Intro:** 2-3 sentences themed to the week's content
- **Sign-off:** Fresh closing message (can include 🙏)

Example output:
```json
{
  "greeting": "Bună dimineața! 👋",
  "intro": "Săptămâna asta avem de toate: de la un ONG care a salvat o pădure întreagă, până la un startup românesc care cucerește Europa. Grab your coffee și hai să vedem ce vești bune avem.",
  "signOff": "Thanks for reading! Sperăm că ți-am făcut ziua puțin mai bună. 🙏"
}
```

---

## GDPR Compliance Checklist

- [ ] Resend handles `List-Unsubscribe` headers automatically
- [ ] Footer includes unsubscribe link (Resend injects)
- [ ] Subscribe form has consent checkbox
- [ ] Privacy policy link in subscribe form
- [ ] Contacts can be deleted via Resend dashboard/API
- [ ] No tracking pixels (optional: can enable if disclosed)

---

## Commands Summary

| Command | Description |
|---------|-------------|
| `npm run email:dev` | Start React Email preview server (hot reload) |
| `npm run email:preview -- --week 2026-W01` | Generate AI copy + preview for approval |
| `npm run email:test -- --week 2026-W01` | Send test email to yourself |
| `npm run email:send -- --week 2026-W01 --confirm` | Send to all subscribers |

---

## Approval Workflow

```
┌────────────────────────────────────────────────────────────────┐
│                                                                │
│  1. Run: npm run email:preview -- --week 2026-W01              │
│     ↓                                                          │
│  2. Script reads draft JSON + generates AI wrapper copy        │
│     ↓                                                          │
│  3. Opens email preview in browser                             │
│     ↓                                                          │
│  4. You review:                                                │
│     - AI-generated intro sounds good?                          │
│     - Sign-off on brand?                                       │
│     - All articles correct?                                    │
│     ↓                                                          │
│  5a. Happy? Run: npm run email:send -- --week 2026-W01 --confirm
│                                                                │
│  5b. Changes needed? Edit draft JSON or re-run preview         │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

---

## Next Steps

Once you approve this plan:

1. **Phase 1** - Set up React Email and create the newsletter template
2. **Phase 2** - Add AI copy generation
3. **Phase 3** - Build send script with approval workflow
4. **Phase 4** - Add Cloudflare Function for subscriptions
5. **Phase 5** - Production deployment

Let me know if you want any changes to this plan.
