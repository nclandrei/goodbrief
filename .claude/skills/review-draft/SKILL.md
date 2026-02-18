---
name: review-draft
description: Human review of newsletter draft before Saturday publication. Reviews copy, article selection, and sends test email.
disable-model-invocation: true
user-invocable: true
argument-hint: "[week-id]"
allowed-tools: Read, Glob, Bash
---

# Newsletter Draft Review

Review the latest newsletter draft for Saturday publication.

## 1. Load the Draft

Find and load the latest draft from `data/drafts/`. If a week ID is provided as `$ARGUMENTS`, use that instead (format: `2026-W07`).

```bash
# List available drafts
ls -la data/drafts/*.json
```

Read the draft JSON file and parse the structure:
- `selected`: Articles chosen for the newsletter
- `reserves`: Backup articles that could be swapped in
- `wrapperCopy`: Greeting, intro, signOff, shortSummary

## 2. Copy Quality Review

Review the `wrapperCopy` fields against these guidelines from `docs/COPY_GUIDELINES.md`:

### Language Check
- **Must be Romanian** - flag any English text in greeting, intro, or signOff
- Light English sprinkles are OK only in specific phrases like "feel-good", "quick hits"
- Use "tu" form, never "dumneavoastră"

### Tone Check
- Calm, warm, slightly witty - never cheesy
- Like a smart friend, not a newsroom
- Avoid formal words: "în atenție", "ne propunem să", "menționăm că"
- Avoid clickbait or sensational phrasing

### Summary Check
- `intro` should accurately describe the selected articles
- Should mention 2-3 highlights without overselling
- Under 3 sentences max

Flag any issues and suggest rewrites if needed.

## 3. Article Selection Review

For each article in `selected`, evaluate:

### Positivity & Vibe
- Good vibe, uplifting news
- No politics, scandals, or divisive topics
- No tragedy, accidents, or crime (even if "resolved")

### Impact & Interest
- High impact stories preferred
- Interesting for educated 20-30 year old Romanian audience
- Local heroes and community wins are valuable

### Category Balance
Check distribution across categories:
- `wins` - Achievements, records, milestones
- `local-heroes` - Community initiatives, people doing good
- `green-stuff` - Environment, sustainability
- `quick-hits` - Short positive news

### Swap Suggestions
Compare `selected` with `reserves`:
- Are there better articles in reserves?
- Would any reserve article improve category balance?
- Are there duplicate/similar stories that could be consolidated?

Present a table of recommended swaps with reasoning.

## 4. Summary Check

Verify that `wrapperCopy.intro` accurately represents the selected articles:
- Does it mention the key stories?
- Is it misleading about any content?
- Does the `shortSummary` capture the essence?

## 5. Final Actions

After review is complete:

### Preview in Browser
```bash
npm run email:preview -- --week WEEK_ID
```

### Send Test Email
```bash
npm run email:test -- --week WEEK_ID
```

Both commands require `RESEND_API_KEY` and `TEST_EMAIL` environment variables.

## Output Format

Present your review as:

```
## Draft Review: [WEEK_ID]

### Copy Quality
- Language: [OK / Issues found]
- Tone: [OK / Issues found]
- Summary accuracy: [OK / Issues found]

[Details of any issues with suggested fixes]

### Article Selection
| # | Title | Category | Score | Status |
|---|-------|----------|-------|--------|
| 1 | ...   | wins     | 85/90 | Keep   |
| 2 | ...   | ...      | ...   | Swap → [reserve article] |

### Recommended Swaps
[Table of swaps with reasoning]

### Actions Taken
- [ ] Preview opened in browser
- [ ] Test email sent to [TEST_EMAIL]

### Summary
[Overall assessment and any manual actions needed]
```
