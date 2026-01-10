# Good Brief - Implementation Plan

**Website:** goodbrief.ro  
**Mission:** Deliver positive/good news to Romanian citizens (target: 20-30 years, educated)

---

## Tech Stack (Cost-First)

| Component | Choice | Cost |
|-----------|--------|------|
| **Framework** | Astro + TypeScript | Free |
| **Styling** | Tailwind CSS | Free |
| **Hosting** | Cloudflare Pages | Free |
| **Email/Newsletter** | EmailOctopus | Free (≤2,500 subs, 10k emails/mo) |
| **Donations** | Ko-fi | 0% platform fee |
| **Analytics** | Cloudflare Web Analytics | Free |
| **Domain** | goodbrief.ro | ~10-15€/year |

**Estimated Monthly Cost:** €0 (until exceeding free tiers)  
**Annual Cost:** ~€10-15 (domain only)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    goodbrief.ro (Static)                     │
├─────────────────────────────────────────────────────────────┤
│  /              → Homepage + Subscribe form                  │
│  /issues        → Newsletter archive listing                 │
│  /issues/[slug] → Individual issue pages (from Markdown)     │
│  /about         → About the project                          │
│  /support       → Donation options (Ko-fi)                   │
│  /privacy       → Privacy policy (GDPR)                      │
│  /terms         → Terms of use                               │
└─────────────────────────────────────────────────────────────┘
              │                              │
              ▼                              ▼
    ┌─────────────────┐           ┌─────────────────┐
    │  EmailOctopus   │           │     Ko-fi       │
    │  - Subscribers  │           │  - Donations    │
    │  - Double opt-in│           │  - Recurring    │
    │  - Weekly send  │           └─────────────────┘
    └─────────────────┘
```

---

## Content Storage

Newsletter issues stored as Markdown in `/content/issues/`:

```markdown
---
title: "Săptămâna Veștilor Bune #1"
date: 2025-01-05
summary: "Prima ediție Good Brief"
slug: 2025-01-05-vestile-bune
---

Content here...
```

---

## MVP Features (Phase 1)

### Pages
- [x] Homepage with pitch, latest issue preview, subscribe CTA
- [ ] Issues archive page
- [ ] Individual issue pages
- [ ] About page
- [ ] Support/Donate page
- [ ] Privacy Policy (GDPR compliant)
- [ ] Terms of Use

### Newsletter Integration
- [ ] EmailOctopus embedded form
- [ ] Double opt-in flow (Romanian copy)
- [ ] Custom sending domain (news.goodbrief.ro)
- [ ] SPF/DKIM/DMARC configuration

### Donations
- [ ] Ko-fi account setup
- [ ] Donation buttons in nav/footer
- [ ] Support page with explanation

---

## Future Enhancements (Phase 2+)

- Tags/categories for issues
- Search functionality
- Dark mode
- Referral program
- Welcome email sequence
- Social sharing buttons
- Comments (Giscus)

---

## Implementation Phases

### Phase 0: Setup (~0.5 day)
- [x] Create GitHub repo
- [ ] Initialize Astro project
- [ ] Set up Cloudflare Pages deployment
- [ ] Configure CI/CD

### Phase 1: Core Pages (~1-2 days)
- [ ] Layout component (header, footer)
- [ ] Homepage
- [ ] About page
- [ ] Support page
- [ ] Legal pages (Privacy, Terms)

### Phase 2: Newsletter System (~1-1.5 days)
- [ ] EmailOctopus setup
- [ ] Subscribe form component
- [ ] Content collection for issues
- [ ] Archive page
- [ ] Issue detail page
- [ ] Add sample issues

### Phase 3: Polish & Launch (~0.5-1 day)
- [ ] Ko-fi integration
- [ ] SEO meta tags
- [ ] Open Graph images
- [ ] Responsive testing
- [ ] Performance optimization

**Total Estimated Time:** 3-5 working days

---

## Email Service Decision

**EmailOctopus** chosen because:
- 2,500 subscribers free (vs 1,000 for MailerLite)
- 10,000 emails/month free
- Good EU deliverability
- Easy embedded forms
- GDPR-ready consent fields

**DNS Records Needed:**
- SPF record for sending domain
- DKIM keys (provided by EmailOctopus)
- DMARC policy

---

## Donation Platform Decision

**Ko-fi** chosen because:
- 0% platform fee on donations (only Stripe/PayPal fees)
- One-time + recurring support
- Simple setup
- Works with Romanian banks via Stripe

---

## Commands

```bash
# Development
pnpm dev          # Start dev server
pnpm build        # Build for production
pnpm preview      # Preview production build

# Deployment
# Automatic via Cloudflare Pages on push to main
```

---

## Project Structure

```
goodbrief/
├── src/
│   ├── components/
│   │   ├── Header.astro
│   │   ├── Footer.astro
│   │   ├── SubscribeForm.astro
│   │   └── IssueCard.astro
│   ├── layouts/
│   │   └── BaseLayout.astro
│   ├── pages/
│   │   ├── index.astro
│   │   ├── about.astro
│   │   ├── support.astro
│   │   ├── privacy.astro
│   │   ├── terms.astro
│   │   └── issues/
│   │       ├── index.astro
│   │       └── [slug].astro
│   └── styles/
│       └── global.css
├── content/
│   └── issues/
│       └── *.md
├── public/
│   └── images/
├── astro.config.mjs
├── tailwind.config.mjs
├── package.json
└── README.md
```
