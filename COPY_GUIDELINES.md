# Good Brief Copy Guidelines

> For the weekly curation job that fetches, summarizes, and publishes newsletter issues.

---

## Brand Voice

| Attribute | Description |
|-----------|-------------|
| **Tone** | Calm, warm, slightly witty – never cheesy |
| **Persona** | A smart friend who curates vești bune, not a "redacție" |
| **Energy** | Low-medium, "slow news / slow living" vibe |
| **Register** | Direct second person ("tu", "îți"), avoid formal newsy words |

---

## Language Rules

### Base: Romanian with English Sprinkles

- **Romanian** is the primary language for all content
- **English** is used sparingly for:
  - Section headers (e.g., "Local Heroes", "Wins", "Green Stuff")
  - Short phrases (e.g., "feel-good only", "no doomscrolling")
  - Max 1-2 English words per sentence

### Avoid

- Formal Romanian ("în atenție", "ne propunem să", "menționăm că")
- Corporate/news outlet language
- Clickbait or sensational phrasing
- "Dumneavoastră" – always use "tu"

---

## Newsletter Issue Structure

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
Rezumat în 2-3 fraze clare și concise.

→ [Citește pe Biziday](link-original)

---

## 🏆 Wins

### [Titlu articol]
Rezumat în 2-3 fraze clare și concise.

→ [Citește pe Europa FM](link-original)

---

## 💚 Green Stuff

### [Titlu articol]
Rezumat în 2-3 fraze clare și concise.

→ [Citește pe Europa Liberă](link-original)

---

Thanks for reading! 🙏

Ai o poveste bună? Reply la acest email sau scrie-ne la hello@goodbrief.ro.
Ne ajută enorm dacă dai forward cuiva care are nevoie de vești bune azi.
```

---

## Section Categories

| Emoji | Section | Use For |
|-------|---------|---------|
| 🌱 | **Local Heroes** | Inițiative locale, oameni care fac bine în comunități |
| 🏆 | **Wins** | Reușite, premii, recorduri, realizări notabile |
| 💚 | **Green Stuff** | Mediu, sustenabilitate, natură |
| ✨ | **Quick Hits** | Micro-vești bune, 1-2 fraze (optional, for shorter items) |

---

## AI Summary Guidelines

### Format

Each news item summary should:

1. Be **2-3 sentences** maximum
2. Start with the **key fact** (who did what)
3. Include **context** if needed (why it matters)
4. End with **impact** (what this means for people)

### Example

**Bad:**
> "Potrivit surselor, în cadrul unui proiect amplu de reabilitare, autoritățile locale din Cluj-Napoca au finalizat lucrările de modernizare a parcului central, investiția totală ridicându-se la suma de 2 milioane de euro."

**Good:**
> "Cluj-Napoca și-a redeschis parcul central după o renovare de 2 milioane de euro. Acum are piste de biciclete, spații de joacă noi și WiFi gratuit. Perfect pentru weekendurile de primăvară."

### Tone Checklist

- [ ] Does it sound like a friend telling you good news?
- [ ] Is it under 3 sentences?
- [ ] Did you avoid formal/bureaucratic language?
- [ ] Is the English sprinkle natural, not forced?

---

## Headline Rules

### Do

- Keep it simple and honest
- Use active voice
- Lead with the positive outcome

### Don't

- Use clickbait ("Nu o să crezi ce...")
- Add unnecessary drama
- Use ALL CAPS or excessive punctuation

### Examples

| Bad | Good |
|-----|------|
| "INCREDIBIL! Un tânăr din România a reușit imposibilul!" | "Un student din Iași a inventat un dispozitiv care purifică apa" |
| "Ce a făcut acest ONG te va face să plângi" | "Un ONG din Brașov a plantat 10.000 de copaci anul ăsta" |

---

## Source Attribution

Always link back to the original source:

```markdown
→ [Citește pe Biziday](https://biziday.ro/articol)
→ [Citește pe Europa FM](https://europafm.ro/articol)
→ [Citește pe Europa Liberă](https://romania.europalibera.org/articol)
```

Format: `→ [Citește pe {Source Name}]({URL})`

---

## Positivity Score Guidance

When the AI assigns a "positivity score", prioritize stories that:

| Score | Type of Story |
|-------|---------------|
| **High** | Clear positive outcome, inspiring people, community wins |
| **Medium** | Progress on challenges, hopeful developments |
| **Low** | Mixed news, achievements with caveats |
| **Skip** | Tragedy, conflict, political drama, clickbait |

### Red Flags (auto-skip)

- Deaths, accidents, disasters
- Political scandals or conflicts
- Crime stories (even if "resolved")
- Rage-bait or divisive topics
- Celebrity gossip

---

## Emoji Usage

- Use sparingly – only for section headers
- Stick to the defined set: 🌱 🏆 💚 ✨ 👋 🙏
- Never in headlines or summaries

---

## Quick Reference

```
✓ "Un ONG din Cluj a plantat 5.000 de copaci"
✗ "Potrivit reprezentanților organizației, s-a realizat plantarea..."

✓ "feel-good only"
✗ "doar știri care te fac să te simți bine"

✓ "Thanks for reading!"
✗ "Vă mulțumim pentru lectură!"

✓ "Citește pe Biziday"
✗ "Click aici pentru articolul complet"
```

---

## File Naming

Newsletter issues: `YYYY-MM-DD-slug.md`

Example: `2025-01-13-local-heroes.md`

Slug should be:
- Lowercase
- Hyphens instead of spaces
- Short and descriptive
