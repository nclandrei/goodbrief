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

# Email Development & Testing (requires RESEND_API_KEY, TEST_EMAIL env vars)
npm run email:dev                           # React Email dev server (localhost:3001)
npm run email:preview -- --week 2026-W02    # Preview newsletter HTML in browser
npm run email:test -- --week 2026-W02       # Send test newsletter to TEST_EMAIL
npm run email:send -- --week 2026-W02 --confirm  # Send to all subscribers
npx tsx scripts/send-welcome-test.ts        # Send test welcome email to TEST_EMAIL

# Newsletter Pipeline
npm run ingest-news      # Fetch news from RSS feeds
npm run generate-draft   # Generate newsletter draft with AI
npm run publish-issue    # Publish issue to content/issues/

# No test framework configured yet
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
└── drafts/         # Newsletter draft JSON files (YYYY-WXX.json)

emails/
├── components/     # Reusable React Email components (Header, Footer, etc.)
├── newsletter.tsx  # Newsletter email template
├── welcome.tsx     # Welcome email template
└── utils/          # Email utilities (generate-copy.ts)

docs/               # Plans, specs, and documentation
├── PLAN.md                     # Main implementation plan
├── NEWS_AGGREGATION_PLAN.md    # RSS/AI news processing
├── COPY_PLAN.md                # Copy guidelines and brand voice
└── EMAIL_IMPLEMENTATION_PLAN.md # React Email + Resend setup

public/             # Static assets
```

## Documentation

All plans and implementation specs live in `docs/`. When creating new plans or design documents, add them there to keep the root directory clean.

## Code Conventions

### Language
- All user-facing content in **Romanian**
- Code comments and technical docs in English

### Astro Components
- Use `.astro` extension
- Props interface at top of frontmatter
- Tailwind for styling (no separate CSS files unless global)

### Content (Newsletter Issues)
- Filename format: `YYYY-MM-DD-slug.md`
- Required frontmatter: `title`, `date`, `summary`
- Use emoji sparingly for section headers

### Styling
- Primary color: green (`primary-*` in Tailwind config)
- Max content width: `max-w-4xl` for layouts, `max-w-3xl` for prose
- Mobile-first responsive design

## External Services

### EmailOctopus (Newsletter)
- Embed form in `SubscribeForm.astro`
- Free tier: 2,500 subscribers, 10k emails/month
- Requires DNS setup: SPF, DKIM, DMARC

### Ko-fi (Donations)
- Links in Footer and Support page
- 0% platform fee on donations

### Cloudflare
- Pages for hosting (auto-deploy from main)
- Web Analytics for privacy-friendly stats

## Important Notes
- Keep dependencies minimal for cost efficiency
- No backend/database - static site + external services
- GDPR compliance required (Romanian audience)
