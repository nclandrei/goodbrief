# Good Brief 🌱

> Vești bune pentru România. Newsletter săptămânal cu știri pozitive.

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)

## Despre

**Good Brief** este un newsletter săptămânal care aduce în atenție veștile bune din România. Într-o lume în care știrile negative domină, oferim o alternativă: inițiative locale care funcționează, oameni care fac diferența, și realizări de care merită să știi.

🌐 **Website:** [goodbrief.ro](https://goodbrief.ro)

## Tech Stack

- **Framework:** [Astro](https://astro.build/) + TypeScript
- **Styling:** [Tailwind CSS](https://tailwindcss.com/)
- **Hosting:** [Cloudflare Pages](https://pages.cloudflare.com/) (gratuit)
- **Email:** [EmailOctopus](https://emailoctopus.com/) (gratuit până la 2,500 abonați)
- **Donații:** [Ko-fi](https://ko-fi.com/)

## Dezvoltare locală

```bash
# Clonează repository-ul
git clone https://github.com/nclandrei/goodbrief.git
cd goodbrief

# Instalează dependențele
npm install

# Pornește serverul de dezvoltare
npm run dev

# Build pentru producție
npm run build

# Preview build
npm run preview
```

## Structura proiectului

```
goodbrief/
├── src/
│   ├── components/     # Componente Astro reutilizabile
│   ├── layouts/        # Layout-uri de pagină
│   ├── pages/          # Pagini (routing automat)
│   └── styles/         # CSS global
├── content/
│   └── issues/         # Edițiile newsletter-ului (Markdown)
├── public/             # Fișiere statice
└── astro.config.mjs    # Configurare Astro
```

## Adăugarea unei ediții noi

1. Creează un fișier nou în `content/issues/`:

```markdown
---
title: "Good Brief #X - Titlul Ediției"
date: 2025-01-13
summary: "O scurtă descriere a ediției."
---

Conținutul ediției aici...
```

2. Commit și push - site-ul se actualizează automat.

## Contribuții

Contribuțiile sunt binevenite! Poți:

- 🐛 Raporta bug-uri
- 💡 Sugera îmbunătățiri
- 📝 Trimite pull request-uri
- 📣 Distribui prietenilor

## Susține proiectul

Good Brief este gratuit și open source. Dacă îți place ce facem:

- ☕ [Ko-fi](https://ko-fi.com/goodbrief)
- ⭐ Dă o stea pe GitHub
- 📧 Trimite povești bune la hello@goodbrief.ro

## Licență

[MIT](LICENSE) - folosește codul liber pentru proiectele tale!
