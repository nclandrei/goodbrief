# Good Brief Copy Improvement Plan

> **Target audience:** 20-30 year old educated Romanians (hipsters) who follow brands like Ototo, Origo Coffee, Sloane Coffee, Ohana Vet.

## Brand Voice & Positioning

### Core Identity
- **What we are:** AI-powered Romanian good news filter/aggregator
- **What we're not:** A news outlet or original journalism
- **Tone:** Calm, warm, slightly witty – never cheesy
- **Persona:** A smart friend who curates vești bune, not a "redacție"
- **Energy:** Low-medium, "slow news / slow living" vibe

### Language Rules
- **Base language:** Romanian
- **English sprinkles:** Taglines, CTAs, 1-2 words in headings
- **Register:** Direct second person ("tu", "îți"), avoid formal newsy words

### Main Tagline Options (pick one)
1. "Good Brief – vești bune, no doomscrolling"
2. "Romanian good news, filtered by AI, approved by humans"
3. "Good Brief – vești bune made in Romania"

### Supporting Phrases
- "5 minute de lectură, carefully curated"
- "AI-powered curation, om-friendly vibe"
- "Less anxiety, more vești bune"
- "Summaries by Good Brief. Știrile, de la Biziday, Europa FM, Europa Liberă & co."

---

## Page-by-Page Copy Changes

### 1. Homepage (`src/pages/index.astro`)

#### Hero Section

**BEFORE:**
```
Pre-title: Newsletter de știri bune
H1: Începe săptămâna cu vești bune din România
Body: Un newsletter săptămânal cu inițiative locale, oameni remarcabili și realizări de care să fii mândru.
Button: Abonează-te
Link: Vezi ultimul număr →
```

**AFTER:**
```
Pre-title: Newsletter de vești bune, no doomscrolling
H1: Începe săptămâna cu vești bune, nu cu anxietate
Body: Good Brief scanează surse de încredere ca Biziday, Europa FM și Europa Liberă, filtrează zgomotul cu AI și îți trimite doar veștile bune. 5 minute de lectură, carefully curated, direct în inbox.
Button: Vreau vești bune
Link: Citește ultima ediție →
```

#### "Ce primești?" Section

**BEFORE:**
```
Ce primești?

5 minute de lectură care îți schimbă perspectiva asupra zilei
Povești despre oameni care fac bine în comunitățile lor
Proiecte și inițiative locale care merită atenție
În fiecare luni dimineața, direct în inbox
```

**AFTER:**
```
Ce primești?

5 minute de lectură care îți schimbă vibe-ul de luni
Povești scurte despre oameni care fac bine, nu doar vorbe
Proiecte și inițiative locale care chiar merită un share
În fiecare luni dimineața, direct în inbox – one email, feel-good only
```

#### "Ultimele ediții" Section

**BEFORE:**
```
Ultimele ediții
Vezi toate edițiile →
```

**AFTER:**
```
Ultimele ediții
Vezi toate edițiile din arhivă →
```

---

### 2. About Page (`src/pages/about.astro`)

**Complete rewrite with new structure:**

```astro
---
import BaseLayout from '../layouts/BaseLayout.astro';
---

<BaseLayout title="Despre" description="Despre Good Brief și cum funcționează.">
  <section class="py-16">
    <div class="max-w-3xl mx-auto px-4">
      <h1 class="text-3xl font-bold text-gray-900 mb-8">
        Despre Good Brief
      </h1>

      <div class="prose prose-lg">
        <p>
          <strong>Good Brief</strong> este un newsletter săptămânal cu vești bune made in Romania.
          În loc de doomscrolling de luni dimineața, primești un email scurt, curat și optimist
          despre oameni, proiecte și idei care chiar fac bine.
        </p>

        <h2>Cum funcționează</h2>
        <ol>
          <li><strong>Collect</strong> – Scanăm automat știri din surse de încredere: Biziday, Europa FM, Europa Liberă.</li>
          <li><strong>Filter with AI</strong> – Un model AI citește fiecare articol, generează un rezumat scurt și un "positivity score".</li>
          <li><strong>Curate by hand</strong> – Alegem doar veștile relevante și sănătoase pentru inbox-ul tău.</li>
          <li><strong>Link out</strong> – Fiecare item are un rezumat scurt + link direct către articolul original.</li>
        </ol>

        <h2>Ce nu suntem</h2>
        <p>
          Good Brief nu este o redacție și nu facem jurnalism original.
          Nu înlocuim jurnalismul – îl punem într-o lumină mai optimistă și mai ușor de digerat.
        </p>

        <h2>Surse & încredere</h2>
        <p>
          Folosim surse pe care le citim și noi: Biziday, Europa FM, Europa Liberă.
          Dacă o sursă devine dubioasă, iese din listă. Simplu.
        </p>

        <h2>Cum folosim AI</h2>
        <p>AI ne ajută să:</p>
        <ul>
          <li>Citim mai mult decât ar putea citi un om</li>
          <li>Rezumăm știrile în 2-3 fraze clare</li>
          <li>Prioritizăm veștile cu impact pozitiv</li>
        </ul>
        <p>Humans still:</p>
        <ul>
          <li>Aleg ce intră în newsletter</li>
          <li>Editează rezumatele când par off</li>
          <li>Răspund la mailurile tale</li>
        </ul>

        <h2>Principiile noastre</h2>
        <ul>
          <li><strong>Fără clickbait</strong> – honest titles only. Titluri oneste, fără dramă de dragul traficului.</li>
          <li><strong>Verificat</strong> – fact-check, then share. Prezentăm doar informații din surse clare.</li>
          <li><strong>Respectuos</strong> – no hate, no noise. Nu promovăm ură sau divizare.</li>
          <li><strong>Gratuit</strong> – free to read, powered by community.</li>
        </ul>

        <h2>Open Source</h2>
        <p>
          Good Brief este un proiect open source. Codul este pe
          <a href="https://github.com/nclandrei/goodbrief" target="_blank" rel="noopener">GitHub</a>,
          ready for pull requests.
        </p>

        <h2>Contact</h2>
        <p>
          Ai o poveste bună? Ai găsit o greșeală? Scrie-ne la
          <a href="mailto:hello@goodbrief.ro">hello@goodbrief.ro</a>.
          Ne place să primim vești bune în inbox.
        </p>
      </div>
    </div>
  </section>
</BaseLayout>
```

---

### 3. Support Page (`src/pages/support.astro`)

#### Hero

**BEFORE:**
```
Good Brief este gratuit și va rămâne gratuit. Dacă îți place ce facem, ne poți susține prin donații.
```

**AFTER:**
```
Good Brief este gratuit și vrem să rămână așa.
Dacă îți place ce ajunge în inbox-ul tău în fiecare luni, poți cumpăra practic timp de research, curation și infrastructură – cu o cafea sau două.
```

#### Ko-fi Card

**BEFORE:**
```
Cumpără-ne o cafea! Donații unice sau recurente, fără comision de platformă.
```

**AFTER:**
```
Cumpără-ne o cafea (sau mai multe).
Donații unice sau recurente, fără comision – perfect pentru un "thank you" rapid.
```

#### GitHub Sponsors Card

**BEFORE:**
```
Susține proiectul direct prin GitHub. Ideal pentru developeri.
```

**AFTER:**
```
Susține proiectul direct prin GitHub Sponsors.
Ideal dacă ești developer și vrei să investești în partea de tech & open source.
```

#### "Alte moduri de a ajuta"

**BEFORE:**
```
📣 Distribuie newsletter-ul prietenilor
⭐ Dă o stea pe GitHub
💡 Trimite-ne povești bune la hello@goodbrief.ro
```

**AFTER:**
```
📣 Povestește-le prietenilor de Good Brief (sau forward la o ediție care ți-a plăcut)
⭐ Dă-ne o stea pe GitHub dacă ești în filmul ăsta tech
💡 Trimite-ne povești bune la hello@goodbrief.ro – suntem mereu în căutare de next good story
```

---

### 4. Header (`src/components/Header.astro`)

**BEFORE:**
```ts
const navLinks = [
  { href: '/', label: 'Acasă' },
  { href: '/issues', label: 'Arhivă' },
  { href: '/about', label: 'Despre' },
  { href: '/support', label: 'Susține-ne' },
];
```

**AFTER:**
```ts
const navLinks = [
  { href: '/', label: 'Home' },
  { href: '/issues', label: 'Arhivă' },
  { href: '/about', label: 'Despre' },
  { href: '/support', label: 'Susține' },
];
```

---

### 5. Footer (`src/components/Footer.astro`)

**BEFORE:**
```
© {currentYear} Good Brief. Toate drepturile rezervate.
Creat pentru o Românie mai optimistă.
```

**AFTER:**
```
© {currentYear} Good Brief.

Un newsletter mic cu vești bune made in Romania.
Summaries by AI, curated by humans.
```

---

### 6. Subscribe Form (`src/components/SubscribeForm.astro`)

**BEFORE:**
```
H2: Primește vești bune săptămânal
Body: Abonează-te și primești în fiecare luni un email cu cele mai bune știri din România.
Button: Abonează-te
Legal: Sunt de acord să primesc newsletter-ul Good Brief. Mă pot dezabona oricând.
```

**AFTER:**
```
H2: Primește vești bune, nu breaking news
Body: În fiecare luni dimineața, un singur email cu cele mai faine vești din România. Scurt, calm, feel-good only.
Button: Vreau în listă
Legal: Prin înscriere ești de acord să primești newsletter-ul Good Brief. Te poți dezabona oricând. Vezi Politica de confidențialitate.
```

---

## Newsletter Content Template

### Issue Structure

```markdown
---
title: "Good Brief #X – Vești bune din România"
date: YYYY-MM-DD
summary: "X vești bune din România săptămâna asta."
---

Bună dimineața! 👋

Here's your weekly dose de vești bune din România. X știri, sub 5 minute.

---

## 🌱 Local Heroes

### [Titlu articol]
Rezumat AI în 2-3 fraze clare și concise.

→ [Citește pe Biziday](link-original)

---

## 🏆 Wins

### [Titlu articol]
Rezumat AI în 2-3 fraze clare și concise.

→ [Citește pe Europa FM](link-original)

---

## 💚 Green Stuff

### [Titlu articol]
Rezumat AI în 2-3 fraze clare și concise.

→ [Citește pe Europa Liberă](link-original)

---

Thanks for reading! 🙏

Ai o poveste bună? Reply la acest email sau scrie-ne la hello@goodbrief.ro.
Ne ajută enorm dacă dai forward cuiva care are nevoie de vești bune azi.
```

### Section Names (Romanian + English hint)
- 🌱 **Local Heroes** – Inițiative locale
- 🏆 **Wins** – Reușite
- 💚 **Green Stuff** – Mediu
- ✨ **Quick Hits** – Micro-vești bune (optional, for shorter items)

---

## Email Footer Template

```
---

**De ce ai primit emailul ăsta**
Good Brief este un newsletter cu vești bune din România.
Știrile vin din surse ca Biziday, Europa FM, Europa Liberă.
Rezumatele sunt generate cu AI și verificate de oameni.

Nu mai vrei vești bune? [Unsubscribe aici]
```

---

## Implementation Checklist

- [ ] Update `src/pages/index.astro` – Hero, "Ce primești", "Ultimele ediții"
- [ ] Rewrite `src/pages/about.astro` – Complete new structure
- [ ] Update `src/pages/support.astro` – Hero, cards, "Alte moduri"
- [ ] Update `src/components/Header.astro` – Nav labels
- [ ] Update `src/components/Footer.astro` – Tagline and transparency
- [ ] Update `src/components/SubscribeForm.astro` – H2, body, button, legal
- [ ] Update `content/issues/2025-01-06-prima-editie.md` – Apply new template
- [ ] Create newsletter template for future issues

---

## Inspiration Brands Reference

| Brand | Key Takeaways |
|-------|---------------|
| **Ototo** | Mix RO+EN ("JOIN", "SHOP →"), B Corp messaging, community-feel |
| **Ohana Vet** | Values with English twist ("we feel you"), warm authentic tone |
| **Origo Coffee** | Ultra-minimal, "People of Specialty", community-focused |
| **Sloane Coffee** | Clean sophisticated copy, product storytelling, premium but not pretentious |

---

## Do's and Don'ts

### Do
- Use Romanian-English code-switching strategically
- Keep copy minimal and confident
- Be transparent about AI and sources
- Sound like a friend, not a news outlet
- Use "tu" not "dumneavoastră"

### Don't
- Use formal/generic Romanian ("în atenție", "ne propunem să")
- Overdo English (max 1-2 words per sentence)
- Hide that it's AI-powered
- Sound like corporate media
- Use clickbait or sensational language
