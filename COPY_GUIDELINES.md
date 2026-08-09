# Good Brief Copy Guidelines

> For newsletter summaries, wrapper copy, welcome emails, and site copy.

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

The source headline is evidence, not newsletter copy. Build the reader-facing
headline again from the central verified fact after the final article pool has
been selected. Keep `originalTitle` unchanged for provenance and duplicate
detection; store the newsletter headline in `title`.

### Shape

- Write natural Romanian for an educated reader in their 20s or 30s.
- Keep one concrete idea, usually 7-14 words and roughly 45-90 characters.
- Use sentence case, correct diacritics, and active voice when it sounds natural.
- Prefer a person or place plus a concrete action, result, or useful fact.
- Keep a source headline unchanged when it is already clear and natural.
- Never exceed 110 characters.

### Fidelity

- Preserve names, places, numbers, timing, and certainty exactly.
- Distinguish completed work from work that is ongoing, planned, proposed, or
  postponed. Never turn `poate`, `ar urma`, `va`, `plan`, or `amânat` into a
  completed result.
- Keep a material caveat in view. If the good outcome has not happened yet, the
  headline must not imply that it has.
- Add no fact, superlative, causal claim, emotion, or positive spin that the
  verified article does not support.

### Remove

- Outlet and series labels such as `Business CheckIn`, `Doctor de bine`, and
  `Români din lume`.
- Format labels such as `FOTO`, `VIDEO`, `LIVE`, `INTERVIU`, `GRAFIC`, and
  `EXCLUSIV`.
- Quote hooks, stacked headline decks, source names, rhetorical questions,
  emoji, ALL CAPS, and terminal punctuation.
- Marketing and clickbait language such as `spectaculos`, `incredibil`,
  `de succes`, `fără precedent`, `cucerește`, and `gustul copilăriei`.
- Generic AI formulas such as `scrie istorie`, `pune România pe hartă`,
  `un pas important`, `un nou capitol`, `o dovadă că`, `rază de speranță`,
  `schimbă jocul`, `mai mult decât`, `nu doar... ci și`, `viitor mai bun`,
  `povestea care`, and `cum a reușit`.

Use a superlative such as `cel mai mare` only when it is both verified and
central to the news.

### Examples

| Bad | Good |
|-----|------|
| "INCREDIBIL! Un tânăr din România a reușit imposibilul!" | "Un student din Iași a inventat un dispozitiv care purifică apa" |
| "Ce a făcut acest ONG te va face să plângi" | "Un ONG din Brașov a plantat 10.000 de copaci anul ăsta" |
| "Business CheckIn. Gustul copilăriei la borcan. Cum au transformat o tânără din Iași și mama ei vechile obiceiuri într-o afacere" | "La Iași, Iosefina și mama ei fac conserve după rețetele familiei" |
| "Locul spectaculos din România unde intri într-un labirint subteran unic" | "Peștera Vântului are 52 de kilometri de galerii în Munții Apuseni" |
| "Autostrada Sibiu-Pitești A1. Pe tronsonul 4 se așterne ultimul strat de asfalt" | "Ultimii metri de asfalt pe A1, între Tigveni și Curtea de Argeș" |
| "INTERVIU Profesoara Carmen Ion: Acum 12 ani am aplicat ideea la o clasă..." | "Profesoara care îi convinge pe elevi să citească prin trailere de carte" |

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

## Wrapper Copy

- Greeting, intro, sign-off, and short summary should sound light and human.
- Keep intros compact. They should frame the week, not repeat every story.
- Sign-offs should feel warm, not promotional.
- Avoid hard-coded slogans that make each issue sound identical.

---

## Quick Reference

```
✓ "Un ONG din Cluj a plantat 5.000 de copaci"
✗ "Potrivit reprezentanților organizației, s-a realizat plantarea..."

✓ "feel-good only"
✗ "doar știri care te fac să te simți bine"

✓ "Salut! Uite câteva vești bune care chiar merită atenție."
✗ "Vă mulțumim pentru lectură!"

✓ "Citește pe Biziday"
✗ "Click aici pentru articolul complet"
```
