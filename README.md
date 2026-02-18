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
npm run preview   # Preview build
```

## Adaugarea unei editii noi

Creaza un fisier Markdown in `content/issues/`:

```markdown
---
title: "Good Brief #X - Titlul Editiei"
date: 2025-01-13
summary: "O scurta descriere a editiei."
---

Continutul editiei aici...
```

Commit si push -- site-ul se actualizeaza automat.

## Licenta

[MIT](LICENSE)
