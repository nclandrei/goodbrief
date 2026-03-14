# Good Brief - Agent Guidelines

## Project Overview
Romanian positive news newsletter web app (goodbrief.ro). Target audience: 20-30 year old educated Romanians.

## Tech Stack
- **Framework:** Astro 5 + TypeScript (strict)
- **Styling:** Tailwind CSS
- **Content:** Markdown files in `content/issues/`
- **Hosting:** Cloudflare Pages

## Commands

```bash
# Development
npm run dev         # Start dev server (localhost:4321)
npm run build       # Build for production
npm run preview     # Preview production build
npm run check       # TypeScript check
npm run test        # Run Node.js test suite (tests/**/*.test.ts)

# Email Development & Testing (requires RESEND_API_KEY, TEST_EMAIL env vars)
npm run email:dev                           # React Email dev server (localhost:3001)
npm run email:preview -- --week 2026-W02    # Preview newsletter HTML in browser
npm run email:test -- --week 2026-W02       # Send test newsletter to TEST_EMAIL
npm run email:send -- --week 2026-W02 --confirm  # Send to all subscribers
npx tsx scripts/send-welcome-test.ts        # Send test welcome email to TEST_EMAIL

# Newsletter Pipeline
npm run ingest-news      # Fetch news from RSS feeds
npm run check-feed-health # Verify RSS feed health and parser readiness
npm run generate-draft   # Generate newsletter draft with AI
npm run pipeline:prepare # Run pipeline prepare phase
npm run pipeline:score   # Run pipeline scoring phase
npm run pipeline:semantic-dedup  # Run semantic dedup phase
npm run pipeline:validate        # Run counter-signal validation phase
npm run pipeline:select  # Run shortlist selection phase
npm run pipeline:wrapper-copy    # Generate wrapper copy phase
npm run pipeline:refine  # Run final refine phase
npm run pipeline:verify-local -- --week 2026-W02  # Verify phase outputs locally
npm run pipeline:verify-ingest-e2e  # Verify ingest + feed-health pipeline flow
npm run validate-draft -- --week 2026-W02         # Validate draft quality/rules
npm run validate-draft-freshness -- --week 2026-W02  # Validate archive freshness gate
npm run backfill-legacy-validation -- --through-week 2026-W09  # Backfill validation metadata for legacy drafts/issues
npm run publish-issue    # Publish issue to content/issues/
npm run notify-draft     # Send editor notification/proof email for generated draft
npm run alert-missing-draft -- <week> <reason>  # Alert when Monday send has no draft
npm run alert-workflow-failure -- --workflow "<name>" --run-url "<url>"  # Alert on GH workflow failure
npm run cleanup-raw-data # Remove old data/raw/*.json files
```

## Project Structure

```
src/
├── components/     # Reusable .astro components
├── layouts/        # Page layouts (BaseLayout.astro)
├── pages/          # File-based routing
│   └── issues/     # Newsletter archive pages
├── styles/         # Global CSS
└── content.config.ts  # Content collection schema

content/
└── issues/         # Newsletter markdown files

data/
├── drafts/         # Newsletter draft JSON files (YYYY-WXX.json)
├── pipeline/       # Per-phase pipeline artifacts (data/pipeline/<week>/)
└── raw/            # Ingested RSS buffers (weekly JSON snapshots)

emails/
├── components/     # Reusable React Email components (Header, Footer, etc.)
├── newsletter.tsx  # Newsletter email template
├── welcome.tsx     # Welcome email template
└── utils/          # Email utilities (generate-copy.ts)

docs/               # Optional plans/specs only when a task explicitly asks for them

public/             # Static assets
```

## Documentation

Avoid adding new planning docs unless the task explicitly asks for them.

## Code Conventions

### Language
- All user-facing content in **Romanian**
- Code comments and technical docs in English

### Astro Components
- Use `.astro` extension
- Props interface at top of frontmatter
- Tailwind for styling (no separate CSS files unless global)

### Content (Newsletter Issues)
- Filename format: `YYYY-MM-DD-issue.md`
- Required frontmatter: `title`, `date`, `summary`, `validated`, `validationSource`, `validatedAt`
- Use emoji sparingly for section headers

### Styling
- Primary color: green (`primary-*` in Tailwind config)
- Max content width: `max-w-4xl` for layouts, `max-w-3xl` for prose
- Mobile-first responsive design

## External Services

### Resend (Newsletter + Transactional Email)
- Subscribe form posts to `/api/subscribe` (Cloudflare Function: `functions/api/subscribe.ts`)
- Audience-based newsletter sending uses `RESEND_AUDIENCE_ID` and `RESEND_SEGMENT_ID`
- Requires DNS setup: SPF, DKIM, DMARC

### Cloudflare
- Pages for hosting (auto-deploy from main)
- Web Analytics for privacy-friendly stats

## CI/CD Workflows
- `ingest-news.yml`: every 6 hours + manual trigger; retries `npm run ingest-news`, runs `npm run cleanup-raw-data`, and retries `git pull --rebase && git push` with Git LFS retry tuning
- `generate-newsletter.yml`: Saturday 10:00 UTC + manual trigger; runs staged pipeline jobs (`prepare` → `score` → `semantic-dedup` → `counter-signal-validate` → `select` → `wrapper-copy` → `refine`), materializes draft output, validates freshness, commits `data/pipeline/` + `data/drafts/`, then sends proof email via `npm run notify-draft`
- `send-newsletter.yml`: Monday 08:00 UTC + manual trigger; adds send concurrency guard, runs preflight checks (`check-send-preflight` + `assert-draft-ready`), skips duplicate sends when issue already exists, sends with `--automated`, publishes issue, alerts if draft missing
- Failure alerting in scheduled workflows uses `npm run alert-workflow-failure`

## Important Notes
- Keep dependencies minimal for cost efficiency
- No persistent custom backend/database - static site + Cloudflare Functions + external services
- GDPR compliance required (Romanian audience)
