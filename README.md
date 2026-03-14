# Good Brief

> Vesti bune pentru Romania. Newsletter saptamanal cu stiri pozitive.

**Website:** [goodbrief.ro](https://goodbrief.ro)

## Tech Stack

- **Framework:** [Astro](https://astro.build/) + TypeScript
- **Styling:** [Tailwind CSS](https://tailwindcss.com/)
- **Hosting:** [Cloudflare Pages](https://pages.cloudflare.com/)
- **Email:** [Resend](https://resend.com/)

## Dezvoltare locala

```bash
npm install
npm run dev       # Server de dezvoltare
npm run build     # Build pentru productie
npm run check     # Astro + TypeScript checks
npm run test      # Test suite
npm run preview   # Preview build
```

## Pipeline

```bash
npm run ingest-news
npm run generate-draft
npm run validate-draft-freshness -- --week 2026-W10
npm run notify-draft -- 2026-W10
npm run publish-issue -- --week 2026-W10
```

## Documentatie

- Instructiuni pentru agenti: `AGENTS.md`
