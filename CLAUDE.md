# Good Brief - Agent Guidelines

## Overview
Romanian positive news newsletter (goodbrief.ro). Static site + automated pipeline. Core audience: educated Romanians aged 25–40. Follow `AGENTS.md` for the current independent-curation preferences and `COPY_GUIDELINES.md` for voice.

## Tech Stack
- **Framework:** Astro 5 + TypeScript (strict, `@/*` → `src/*` path alias)
- **Styling:** Tailwind CSS (custom tokens: olive, cream, charcoal, coral; fonts: Inter sans, Fraunces serif)
- **Content:** Markdown in `content/issues/`, Zod-validated via `src/content.config.ts`
- **Email:** React Email `.tsx` templates in `emails/`, sent via Resend
- **Editorial assessment:** Amp-authored scores, source checks and selection in a scheduled orb; no separate model API
- **Hosting:** Cloudflare Pages (auto-deploy from main) + Functions (`functions/api/`)
- **Tests:** Node.js native test runner (`node --import tsx --test tests/*.test.ts`)

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
# Subscriber delivery is scheduled only by the Send Newsletter GitHub workflow

# Amp editorial review (follow AGENTS.md for the full run)
npm run ingest-news           # Fetch RSS feeds → data/raw/
npm run check-feed-health     # Verify RSS feed health
npm run review:weekly -- prepare T-<current-thread-id> # Freeze/resume this week's input and arm recovery
npm run assess-news -- page data/assessments/2026-W43
npm run assess-news -- import data/assessments/2026-W43 /tmp/amp-batch.json
npm run review:weekly -- stage data/assessments/2026-W43 # Before finish; inspect rendered proof + newsletter
npm run assess-news -- finish data/assessments/2026-W43 data/assessments/2026-W43/proposal.json
npm run review:weekly -- deliver data/assessments/2026-W43 # One editor-only proof; draft stays unapproved
npx tsx scripts/send-independent-proof.ts --week 2026-W41 --dry-run --output /tmp/proof.html
npx tsx scripts/send-independent-proof.ts --week 2026-W41 --test-email # Only on explicit editor request
npm run publish-issue         # Publish approved draft → content/issues/ markdown
npm run cleanup-raw-data      # Remove old data/raw/ files
npm run validate-draft-freshness -- --week 2026-W12 # Archive freshness gate
npm run pipeline:verify-ingest-e2e # Ingestion and feed-health integration check
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
data/assessments/       # Frozen weekly input, Amp ledger, source/review/email evidence
data/drafts/           # Draft JSON files (YYYY-WXX.json)
data/raw/              # Raw RSS feed data (weekly, auto-cleaned)
data/sources.json      # RSS feed configuration
emails/                # React Email templates + components
  ├── newsletter.tsx   # Main newsletter template
  ├── welcome.tsx      # Welcome email template
  ├── components/      # Header, Footer, NewsItem, SectionHeader, Intro, SignOff
  └── utils/           # render.ts
scripts/               # CLI scripts (TypeScript, run via tsx)
  ├── lib/             # Assessment, ingestion, editorial and delivery guards
  └── *.ts             # Entry points for each npm script
functions/api/         # Cloudflare Functions
  ├── subscribe.ts     # POST /api/subscribe → Resend audience
  └── receive-email.ts # Webhook for incoming email forwarding
tests/                 # *.test.ts files + fixtures/
docs/                  # Plans and specs (PLAN.md, COPY_PLAN.md, etc.)
```

## Environment Variables

```
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
- `{ weekId, generatedAt, selected: [{ id, sourceId, sourceName, originalTitle, title?, url, summary, category, positivity, impact, ... }] }`
- `originalTitle` is immutable source provenance; `title` is the optional reader-facing editorial headline.
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
- **Amp Saturday review**: 08:00 Europe/Bucharest with checkpoint recovery — assess every eligible row, verify finalists, select, audit and send one scored editor proof, ready for review by lunch. The exact draft remains unapproved; never push or send subscribers automatically.
- **send-newsletter.yml**: Sunday evening plus recovery passes — exact-week editor approval → persisted Resend broadcast → Monday 09:00 Europe/Bucharest delivery
- **publish-newsletter.yml**: Monday 09:30/10:30 Europe/Bucharest — verify the matching Resend broadcast is sent → publish issue → commit

## Key Constraints
- No persistent backend — static site + edge functions + external services
- Keep dependencies minimal
- GDPR compliance required
- Week IDs use ISO format: `YYYY-WXX`

## Editorial Approval — Hands Off the Draft

When the editor says "validate and approve [the draft] for Monday" (or any
variant: "approve this", "lock it in", "make it ready to send"), identify the
edition they actually reviewed before locking anything. The Saturday independent
proof and its newsletter-format `[TEST]` are not necessarily the current
`data/drafts/YYYY-WXX.json`: that file may still contain an unrelated earlier
draft. Approval of proposed additions or a request for a test email alone does
not authorize a subscriber send. If approval refers unambiguously to the final
independent edition, first materialize that exact proof as the production draft,
verify its selection and copy against the reviewed proof, and only then approve
it in a separate command. Check that the raw LFS file contains JSON rather than
an LFS pointer before materializing; if any step fails, stop without approving.
Never use `;` to chain transfer, approval, and readiness checks: a failed first
command must not let `approve-draft` run on the old draft. If the edition or
authorization is unclear, present the actual draft/proof diff and ask which
final content the editor approves; never approve the old draft just because it
occupies the expected path.

Once the exact production edition is approved, **lock it without rewriting it**:
1. Run `npm run approve-draft -- --week YYYY-WXX`. That script sets
   `validation.status` to `passed`, `approvalSource: "editor-review"`, and a
   delivery content lock. It does not change `selected`, `reserves`, or
   `wrapperCopy`.
2. Optionally run `npm run validate-draft-freshness -- --week YYYY-WXX` as a
   read-only gate.
3. Check `scripts/assert-draft-ready.ts --production` and review the diff.
   Commit the approved draft in **one** commit (including proof-to-draft content
   if that was the approved edition). Push only when authorized; the GitHub
   workflow cannot schedule a local, unpushed draft.

**Never, under an approval instruction:**
- Re-run assessment, selection or copy generation.
- Regenerate greeting / intro / sign-off / shortSummary — those are the
  editor's final voice for the week.
- Move articles between `selected` and `reserves`, reorder, trim to a
  target count, or rewrite summaries/titles.
- Produce multiple commits (e.g. an "editor review" commit followed by a
  separate "approve" commit). If the approved proof replaces a different
  draft, that exact proof is the content change, not a reason to re-curate.

If something looks wrong (e.g. selected.length < 8, stale timestamps,
freshness gate fails), surface it and **ask** before changing the approved copy.
The approval verb is a lock, not a green light to re-curate.
