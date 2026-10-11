# Good Brief - Agent Guidelines

## Project Overview
Romanian positive news newsletter web app (goodbrief.ro). Core audience: educated Romanians aged 25–40; a strong story is not excluded just because it also speaks to other ages.

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
# Subscriber delivery is scheduled only by the Send Newsletter GitHub workflow
npx tsx scripts/send-welcome-test.ts        # Send test welcome email to TEST_EMAIL

# Newsletter Pipeline
npm run ingest-news      # Fetch news from RSS feeds
npm run check-feed-health # Verify RSS feed health and parser readiness
npm run pipeline:prepare # Run pipeline prepare phase
npm run pipeline:score   # Run pipeline scoring phase
npx tsx scripts/send-independent-proof.ts --week 2026-W41 --dry-run --output /tmp/proof.html # Preview independent editor proof
npx tsx scripts/send-independent-proof.ts --week 2026-W41 --test-email # Send editor-only newsletter-format test
npm run pipeline:verify-ingest-e2e  # Verify ingest + feed-health pipeline flow
npm run publish-issue    # Publish issue to content/issues/
npm run alert-missing-draft -- <week> <reason>  # Alert when Monday send has no draft
npm run alert-workflow-failure -- --workflow "<name>" --run-url "<url>"  # Alert on GH workflow failure
npm run cleanup-raw-data # Remove old data/raw/*.json files
# Legacy manual recovery only (not part of Saturday automation):
npm run generate-draft   # Generate an AI draft
npm run pipeline:semantic-dedup  # Run semantic dedup phase
npm run pipeline:validate        # Run counter-signal validation phase
npm run pipeline:select  # Run shortlist selection phase
npm run pipeline:natural-titles  # Rewrite source headlines for readers
npm run pipeline:wrapper-copy    # Generate wrapper copy phase
npm run pipeline:refine  # Run final refine phase
npm run pipeline:verify-local -- --week 2026-W02  # Verify phase outputs locally
npm run validate-draft -- --week 2026-W02         # Validate draft quality/rules
npm run validate-draft-freshness -- --week 2026-W02  # Validate archive freshness gate
npm run backfill-legacy-validation -- --through-week 2026-W09  # Backfill validation metadata for legacy drafts/issues
npm run notify-draft     # Send proof for a validated legacy draft only
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
├── orb-proofs/     # Independent editor proofs (YYYY-WXX.json)
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

### Independent Newsletter Curation
- Follow `COPY_GUIDELINES.md` for Romanian voice, headlines, source attribution, and factual fidelity. These are editorial preferences for the independent Saturday proof, not a replacement for source checking or the editor's final say.
- Start from the entire week's raw news pool, not the current week's Gemini draft, proof, shortlist, refined artifacts, or scores. Score plausible candidates independently for positivity, concrete impact, and relevance to educated Romanian readers aged 25–40. The scores inform judgment; they do not mechanically determine the edition.
- Verify material claims in each finalist's full source, not just its RSS headline or excerpt. If the article blocks direct access, try the publisher's own public feed or API (for a WordPress site, its post/search API), then any linked primary source or independent coverage. A third-party mirror alone is not primary evidence. If the key claim remains unverified, prefer a verified alternative; if it still belongs in an editor-only proof, label it provisional and tell the editor exactly what could not be checked. Never call an RSS-only claim source-verified.
- A 403 from one client does not establish that the publisher's public API is inaccessible: try its normal unauthenticated endpoints with a different ordinary HTTP client or User-Agent before giving up. For Edupedu, `/wp-json/wp/v2/search?search=...` can identify a post ID and `/wp-json/wp/v2/posts/<id>` can return the full article even when the page itself blocks access; check a linked service page too. Do not bypass paywalls or authentication. For laws and regulations, verify adoption, application, and local implementation separately against a primary authority; a new explainer is not necessarily a new law.
- For retrospective evaluations, judge eligibility and deadlines at the requested as-of time, not today's date or the ingestion timestamp alone. Check event and publication dates; a live source page viewed later may have been edited, so do not present it as an archived snapshot.
- Ask what changes in a 25–40-year-old reader's world: commuting, repair and household costs, public spaces, accessible services, work and learning, civic life, nature, and the future of the places they live. Do not assume every reader is a parent, lives in Bucharest, or can personally use every local service. A children's initiative can still earn a place if its scale, novelty, or community benefit makes it interesting beyond parents and schools. Prefer tangible, distinctive progress over routine awards, one-off school achievements, and institutional self-promotion.
- Give Green Stuff more room: when the pool has strong, distinct options, aim for roughly a third of a ten-story edition with a genuine environmental core (nature, biodiversity, cleaner mobility, energy transition, repair/reuse, circular economy, or environmental education). Prefer concrete action and useful changes over corporate green claims; do not pad with weak stories or relabel a non-environmental story to hit a quota. A distant foreign conservation announcement with little Romanian relevance should not displace a stronger local non-green story just to increase the count. Check the event date as well as the publication date, and explain when strong green candidates were absent.
- Apply the editor's W41 feedback as a tie-break, not a fixed story list: a newly available environmental learning resource such as Doers School can beat another wind-project financing story even if schoolchildren are its direct users. The editor also welcomed meaningful EU repair rules and funded electric public transport before their full benefits arrive. Judge each new development on its own evidence and relevance, and avoid mistaking a program covered months earlier for the same news.
- Funding and regulatory developments can belong when meaningful for readers; describe what has actually been approved or launched, not the future benefit as though already delivered.
- Build a varied 7–12-story edition, not a stack of the highest-scoring stories in one subject. Avoid several similar medical procedures in one issue; one strong human health story can coexist with practical access-to-care information. Do not apply rigid topic quotas or exclude health stories categorically.
- Write each title and summary at the verified stage of the story (funded, authorized, planned, launched, operating). Put material uncertainty where readers need it, but do not append repetitive "not yet delivered" disclaimers to every article. Favor natural, specific facts over robotic qualifications or inflated optimism.
- In the editor-facing handoff, explain why the final stories won, name plausible alternatives and cuts, and flag source limitations. Keep that reasoning separate from reader-facing newsletter copy. When the editor asks for revisions, preserve explicit keep/add/cut choices, explain tradeoffs, and check the whole edition's balance again.
- Treat the editor's stated preferences as stronger than a previous candidate ranking. Capture durable preferences here when requested; do not turn one week's choice into a permanent ban or a numeric rule. No editor proof or local draft is approval to email subscribers: explicit editor approval and the existing delivery safeguards still apply.
- Close the Saturday-to-Monday handoff, not just the proof email. After the editor's revisions, compare the reviewed `data/orb-proofs/<week>.json` with `data/drafts/<week>.json`; the latter may still be an unrelated Gemini draft. If the independent proof is the chosen edition, materialize that exact selection and copy using `materializeIndependentDraft` in `scripts/send-independent-proof.ts` and inspect the resulting newsletter. The CLI's `--materialize-draft` refuses an existing draft; replace an obsolete one deliberately, never silently approve its old content. Leave the new draft unapproved until the editor authorizes that exact edition for subscribers. Report what is ready, what remains unverified, and whether the production gate, remote manifest, and Resend broadcast actually exist.
- Resolve what "approve this" refers to before running `approve-draft`: an endorsement of story additions, an editor-only proof, or a `[TEST]` email is not by itself approval of the final subscriber edition. If the editor explicitly approves the final proof as the subscriber edition, transfer it to the production draft first, confirm the content matches, then apply the existing approval lock. Do not chain materialization and approval in one shell command: an LFS pointer or failed transfer must stop before the old draft can be approved. Do not substitute the earlier Gemini draft. Commit/push or schedule only with the applicable authorization; do not claim a local draft or test email is scheduled delivery.

### Styling
- Primary color: green (`primary-*` in Tailwind config)
- Max content width: `max-w-4xl` for layouts, `max-w-3xl` for prose
- Mobile-first responsive design

## External Services

### Resend (Newsletter + Transactional Email)
- Subscribe form posts to `/api/subscribe` (Cloudflare Function: `functions/api/subscribe.ts`)
- Audience-based newsletter sending uses `RESEND_AUDIENCE_ID` and `RESEND_SEGMENT_ID`
- Production broadcasts are keyed by exact draft week in `data/deliveries/`; Resend never selects a draft itself
- For a final edit before delivery: edit the draft, run `npm run approve-draft -- --week YYYY-WXX`, push, then manually rerun `send-newsletter.yml` for that week so it cancels/updates/reschedules the same broadcast
- Requires DNS setup: SPF, DKIM, DMARC

### Cloudflare
- Pages for hosting (auto-deploy from main)
- Web Analytics for privacy-friendly stats

## CI/CD Workflows
- `ingest-news.yml`: every 6 hours + manual trigger; retries `npm run ingest-news`, runs `npm run cleanup-raw-data`, and retries `git pull --rebase && git push` with Git LFS retry tuning
- `generate-newsletter.yml`: Saturday 09:30 Europe/Bucharest + manual trigger; prepares and scores the weekly pool, then commits the scoring artifacts. It does not generate a draft or send a proof. The scheduled orb independently selects stories, sends the editor-only proof and a separate newsletter-format test to the editor's account; legacy draft commands are manual recovery only.
- `send-newsletter.yml`: prepares Sunday 20:17 Europe/Bucharest with Sunday-night/Monday-morning recovery passes; requires exact-week editor approval, reconciles a persisted Resend broadcast, and schedules Monday 09:00 Europe/Bucharest across DST
- `publish-newsletter.yml`: verifies Resend delivery Monday at 09:30 with a strict 10:30 watchdog, then publishes the matching website issue; scheduled content is never published early
- Failure alerting in scheduled workflows uses `npm run alert-workflow-failure`

## Important Notes
- Keep dependencies minimal for cost efficiency
- No persistent custom backend/database - static site + Cloudflare Functions + external services
- GDPR compliance required (Romanian audience)
