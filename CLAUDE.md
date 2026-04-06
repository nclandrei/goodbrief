# Good Brief - Agent Guidelines

## Overview
Romanian positive news newsletter (goodbrief.ro). Static site + automated pipeline. Target: 20-30yo educated Romanians.

## Tech Stack
- **Framework:** Astro 5 + TypeScript (strict, `@/*` → `src/*` path alias)
- **Styling:** Tailwind CSS (custom tokens: olive, cream, charcoal, coral; fonts: Inter sans, Fraunces serif)
- **Content:** Markdown in `content/issues/`, Zod-validated via `src/content.config.ts`
- **Email:** React Email `.tsx` templates in `emails/`, sent via Resend
- **AI:** Google Gemini (`@google/generative-ai`) for draft scoring + copy generation
- **Hosting:** Cloudflare Pages (auto-deploy from main) + Functions (`functions/api/`)
- **Tests:** Node.js native test runner (`node --import tsx --test tests/**/*.test.ts`)

## Commands

```bash
# Development
npm run dev              # Astro dev server (localhost:4321)
npm run build            # Production build
npm run preview          # Preview production build
npm run check            # Astro + TypeScript type check
npm run test             # Run test suite

# Email (requires RESEND_API_KEY, TEST_EMAIL)
npm run email:dev                            # React Email dev server (localhost:3001)
npm run email:preview -- --week 2026-W12     # Preview newsletter HTML in browser
npm run email:test -- --week 2026-W12        # Send test to TEST_EMAIL
npm run email:send -- --week 2026-W12 --confirm  # Send to all subscribers

# Pipeline (staged, each phase reads previous output)
npm run ingest-news           # Fetch RSS feeds → data/raw/
npm run check-feed-health     # Verify RSS feed health
npm run pipeline:prepare      # Collect + deduplicate candidates
npm run pipeline:score        # AI scoring (needs GEMINI_API_KEY)
npm run pipeline:semantic-dedup
npm run pipeline:validate     # Counter-signal validation
npm run pipeline:select       # Shortlist finalization
npm run pipeline:wrapper-copy # AI-generated greeting/intro/signoff
npm run pipeline:refine       # Final refinement
npm run validate-draft -- --week 2026-W12          # Validate draft quality
npm run validate-draft-freshness -- --week 2026-W12 # Archive freshness gate
npm run publish-issue         # Publish draft → content/issues/ markdown
npm run notify-draft          # Send proof email to editor
npm run pipeline:verify-local -- --week 2026-W12   # Verify phase outputs
npm run cleanup-raw-data      # Remove old data/raw/ files
```

## Project Structure

```
src/
├── components/        # .astro components (PascalCase)
├── layouts/           # BaseLayout.astro, ProsePageLayout.astro
├── pages/             # File-based routing (issues/[slug].astro)
├── styles/global.css  # Tailwind directives only
├── utils/             # date.ts, issues.ts helpers
└── content.config.ts  # Zod schema for issues collection

content/issues/        # Published newsletter markdown (YYYY-MM-DD-issue.md)
data/drafts/           # Draft JSON files (YYYY-WXX.json)
data/pipeline/         # Pipeline phase outputs (YYYY-WXX/01-prepared.json → 07-refined-draft.json)
data/raw/              # Raw RSS feed data (weekly, auto-cleaned)
data/sources.json      # RSS feed configuration
emails/                # React Email templates + components
  ├── newsletter.tsx   # Main newsletter template
  ├── welcome.tsx      # Welcome email template
  ├── components/      # Header, Footer, NewsItem, SectionHeader, Intro, SignOff
  └── utils/           # render.ts, generate-copy.ts
scripts/               # CLI scripts (TypeScript, run via tsx)
  ├── lib/             # Shared pipeline logic (draft-pipeline, ranking, gemini, etc.)
  └── *.ts             # Entry points for each npm script
functions/api/         # Cloudflare Functions
  ├── subscribe.ts     # POST /api/subscribe → Resend audience
  └── receive-email.ts # Webhook for incoming email forwarding
tests/                 # *.test.ts files + fixtures/
docs/                  # Plans and specs (PLAN.md, COPY_PLAN.md, etc.)
```

## Environment Variables

```
GEMINI_API_KEY         # Required for AI pipeline phases
RESEND_API_KEY         # Required for email sending
RESEND_AUDIENCE_ID     # Newsletter audience
RESEND_SEGMENT_ID      # Targeted sending segment
TEST_EMAIL             # Test recipient for dev/preview
```

## Code Conventions

### Language
- **User-facing content: Romanian** (informal "tu" form, never "Dumneavoastră")
- Code comments and docs: English

### Components
- Astro: `.astro`, PascalCase, `interface Props {}` at top of frontmatter, Tailwind inline
- React Email: `.tsx`, functional components, inline `styles` objects, system font stack

### Content (Newsletter Issues)
- Filename: `YYYY-MM-DD-issue.md`
- Frontmatter: `title`, `date`, `summary`, `validated`, `validationSource`, `validatedAt`
- Sections: 🌱 Local Heroes, 🏆 Wins, 💚 Green Stuff, ✨ Quick Hits
- Link format: `→ [Citește pe SourceName](url)`

### Draft JSON (`data/drafts/YYYY-WXX.json`)
- `{ weekId, generatedAt, selected: [{ id, sourceId, sourceName, originalTitle, url, summary, category, positivity, impact, ... }] }`
- Categories: `"local-heroes"`, `"wins"`, `"green-stuff"`

### Styling
- Colors: `olive-500` (primary), `cream`, `charcoal`, `coral`
- Layout widths: `max-w-5xl` (full), `max-w-3xl` (content/prose)
- Typography: Fraunces for headings, Inter for body, `clamp()` responsive sizes
- Mobile-first responsive

### Brand Voice
- Calm, warm, slightly witty — never cheesy or corporate
- "A smart friend" curating positive news
- Low-medium energy, slow-news vibe

## CI/CD Workflows

- **ingest-news.yml**: Every 6h — `ingest-news` → `cleanup-raw-data` → commit + push
- **generate-newsletter.yml**: Saturday 10:00 UTC — staged pipeline (prepare → score → semantic-dedup → validate → select → wrapper-copy → refine) → materialize draft → validate freshness → commit → proof email
- **send-newsletter.yml**: Monday 05:00 UTC (~08:00 Romania) — preflight checks → send (with concurrency guard) → publish issue → commit; alerts if draft missing

## Key Constraints
- No persistent backend — static site + edge functions + external services
- Keep dependencies minimal
- GDPR compliance required
- Week IDs use ISO format: `YYYY-WXX`
