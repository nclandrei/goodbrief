# News Aggregation System Plan

## Overview

Automated weekly job that fetches Romanian news from multiple RSS sources, processes them with AI to identify positive stories, and generates a draft for human review before publishing to the Good Brief newsletter.

**Target audience:** 20-30 year old educated Romanians  
**Newsletter frequency:** Weekly (sent Monday)  
**Job schedule:** Ingestion every 6 hours, newsletter generation on Saturday

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     INGESTION (GitHub Actions - every 6 hours)          │
├─────────────────────────────────────────────────────────────────────────┤
│  1. Fetch all RSS feeds in parallel                                     │
│  2. Normalize to common schema                                          │
│  3. Deduplicate by URL                                                  │
│  4. Append new articles to weekly buffer: data/raw/YYYY-WNN.json        │
│  5. Commit changes to repo                                              │
└─────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────┐
│                     PROCESSING (GitHub Actions - Saturday)              │
├─────────────────────────────────────────────────────────────────────────┤
│  1. Read weekly buffer (data/raw/YYYY-WNN.json)                         │
│  2. Send to Gemini for semantic deduplication (cluster same stories)    │
│  3. For each unique story, use Gemini to:                               │
│     • Generate 1-2 sentence Romanian summary                            │
│     • Assign positivity score (0-100)                                   │
│     • Estimate popularity (if data available)                           │
│  4. Filter: discard articles with positivity < 40                       │
│  5. Rank by: positivity * popularity_weight                             │
│  6. Output top 30 to draft: data/drafts/YYYY-WNN.json                   │
│     • Items 1-10: "selected"                                            │
│     • Items 11-30: "reserves"                                           │
└─────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────┐
│                     HUMAN REVIEW (Saturday/Sunday)                      │
├─────────────────────────────────────────────────────────────────────────┤
│  1. Editor reviews data/drafts/YYYY-WNN.json                            │
│  2. Remove false positives from "selected"                              │
│  3. Move items from "reserves" to "selected" as replacements            │
│  4. Run publish script: npm run publish-issue                           │
│  5. Script generates: content/issues/YYYY-MM-DD-issue.md                │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## News Sources (RSS Feeds)

All sources have confirmed RSS availability. Start with these 8-10 for v1:

| Source | RSS URL | Notes |
|--------|---------|-------|
| HotNews | `http://www.hotnews.ro/rss` | General news, high volume |
| HotNews Actualitate | `http://www.hotnews.ro/rss/actualitate` | Current affairs section |
| DW România | `https://rss.dw.com/rdf/rss-rom-all` | Deutsche Welle Romanian |
| Europa Liberă | `https://romania.europalibera.org/api/...` | Verify exact URL on their /rssfeeds page |
| Mediafax | `https://www.mediafax.ro/rss` | National agency |
| Biziday | `https://www.biziday.ro/feed/` | Curated, high quality |
| Știrile ProTV | `http://rss.stirileprotv.ro/` | TV news portal |
| Ziare.com | `http://www.ziare.com/rss/actualitate.xml` | Aggregator, broad coverage |
| Agerpres | Check their RSS page | National news agency |

**Configuration file:** `data/sources.json`

```json
[
  { "id": "hotnews", "name": "HotNews", "url": "http://www.hotnews.ro/rss" },
  { "id": "hotnews-actualitate", "name": "HotNews Actualitate", "url": "http://www.hotnews.ro/rss/actualitate" },
  { "id": "dw-romania", "name": "DW România", "url": "https://rss.dw.com/rdf/rss-rom-all" },
  { "id": "mediafax", "name": "Mediafax", "url": "https://www.mediafax.ro/rss" },
  { "id": "biziday", "name": "Biziday", "url": "https://www.biziday.ro/feed/" },
  { "id": "stirileprotv", "name": "Știrile ProTV", "url": "http://rss.stirileprotv.ro/" },
  { "id": "ziare", "name": "Ziare.com", "url": "http://www.ziare.com/rss/actualitate.xml" }
]
```

---

## Data Schemas

### Raw Article (from RSS ingestion)

```typescript
interface RawArticle {
  id: string;              // hash(sourceId + url)
  sourceId: string;        // e.g., "hotnews"
  sourceName: string;      // e.g., "HotNews"
  title: string;
  url: string;
  summary: string;         // RSS description/excerpt
  publishedAt: string;     // ISO8601
  fetchedAt: string;       // ISO8601
}
```

### Processed Article (after Gemini)

```typescript
interface ProcessedArticle {
  id: string;
  sourceId: string;
  sourceName: string;
  originalTitle: string;
  url: string;
  
  // AI-generated
  summary: string;         // 1-2 sentence Romanian summary
  positivity: number;      // 0-100 score
  popularity: number;      // estimated engagement score
  
  // Metadata
  clusterId?: string;      // for deduplication tracking
  publishedAt: string;
  processedAt: string;
}
```

### Draft Output

```typescript
interface NewsletterDraft {
  weekId: string;          // e.g., "2025-W01"
  generatedAt: string;
  selected: ProcessedArticle[];   // Top 10
  reserves: ProcessedArticle[];   // Items 11-30
  discarded: number;              // Count of low-positivity articles
  totalProcessed: number;
}
```

---

## Deduplication Strategy

### Step 1: URL-based (during ingestion)
- Normalize URLs: strip tracking params (`utm_*`, `fbclid`, etc.)
- Hash `sourceId + normalizedUrl` for unique ID
- Skip if ID already exists in weekly buffer

### Step 2: Semantic clustering (during processing)
- Send all article titles + first paragraph to Gemini in a single batch
- Prompt:
  ```
  Here are news articles from Romanian sources this week.
  Group them by the same underlying story/event.
  Return JSON: { "clusters": [[0,5,12], [3,8], ...], "unique": [1,2,4,...] }
  
  Articles:
  0: "Title..." - "First paragraph..."
  1: "Title..." - "First paragraph..."
  ...
  ```
- For each cluster, keep the article with highest positivity score
- Token estimate: ~2,000-4,000 tokens per batch (within Gemini free tier)

---

## AI Processing (Gemini)

### Provider
- **Gemini 1.5 Flash** (free tier: 15 RPM, 1M tokens/day)
- Sufficient for 100-200 articles/week

### Tasks per article

1. **Summary generation**
   ```
   Generate a 1-2 sentence summary in Romanian for this news article.
   Focus on the key facts. Be concise and neutral.
   
   Title: {title}
   Content: {description}
   ```

2. **Positivity scoring**
   ```
   Rate this news article's positivity from 0 to 100.
   
   Scoring guide:
   - 0-20: Crime, tragedy, corruption, death
   - 20-40: Political conflict, economic problems
   - 40-60: Neutral news, mixed outcomes
   - 60-80: Positive developments, achievements, progress
   - 80-100: Inspiring stories, community success, innovation, good deeds
   
   Return only the number.
   
   Title: {title}
   Summary: {summary}
   ```

3. **Batch processing** (recommended for efficiency)
   - Process 10-20 articles per API call
   - Request structured JSON output
   - Reduces API calls and latency

---

## GitHub Actions Workflows

### 1. Ingestion Workflow (`.github/workflows/ingest-news.yml`)

```yaml
name: Ingest News

on:
  schedule:
    - cron: '0 */6 * * *'  # Every 6 hours
  workflow_dispatch:        # Manual trigger

jobs:
  ingest:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npm run ingest-news
      - name: Commit changes
        run: |
          git config user.name "GitHub Actions"
          git config user.email "actions@github.com"
          git add data/raw/
          git diff --staged --quiet || git commit -m "Update news buffer"
          git push
```

### 2. Newsletter Generation Workflow (`.github/workflows/generate-newsletter.yml`)

```yaml
name: Generate Newsletter Draft

on:
  schedule:
    - cron: '0 10 * * 6'  # Saturday at 10:00 UTC
  workflow_dispatch:

jobs:
  generate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npm run generate-draft
        env:
          GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
      - name: Commit draft
        run: |
          git config user.name "GitHub Actions"
          git config user.email "actions@github.com"
          git add data/drafts/
          git diff --staged --quiet || git commit -m "Generate newsletter draft"
          git push
```

---

## Project Structure

```
goodbrief/
├── data/
│   ├── sources.json           # RSS feed configuration
│   ├── raw/
│   │   └── 2025-W01.json      # Weekly article buffer
│   └── drafts/
│       └── 2025-W01.json      # AI-processed draft for review
├── scripts/
│   ├── ingest-news.ts         # RSS fetching script
│   ├── generate-draft.ts      # AI processing script
│   └── publish-issue.ts       # Convert draft to Markdown
├── .github/
│   └── workflows/
│       ├── ingest-news.yml
│       └── generate-newsletter.yml
├── content/
│   └── issues/
│       └── 2025-01-06-issue.md  # Published newsletter
└── package.json               # Add new scripts
```

---

## NPM Scripts (add to package.json)

```json
{
  "scripts": {
    "ingest-news": "npx tsx scripts/ingest-news.ts",
    "generate-draft": "npx tsx scripts/generate-draft.ts",
    "publish-issue": "npx tsx scripts/publish-issue.ts"
  }
}
```

---

## Dependencies to Add

```json
{
  "devDependencies": {
    "tsx": "^4.x",
    "rss-parser": "^3.x",
    "@google/generative-ai": "^0.x"
  }
}
```

---

## Environment Variables

| Variable | Description | Where |
|----------|-------------|-------|
| `GEMINI_API_KEY` | Google AI API key | GitHub Secrets |

---

## Review Workflow (Manual)

1. **Saturday/Sunday:** Check `data/drafts/YYYY-WNN.json`
2. **Edit the file:**
   - Remove false positives from `selected` array
   - Copy items from `reserves` to `selected`
   - Ensure exactly 10 items in `selected`
3. **Run:** `npm run publish-issue`
4. **Result:** New file in `content/issues/YYYY-MM-DD-issue.md`
5. **Commit and push** to trigger Astro build

---

## Implementation Order

1. **Phase 1: RSS Ingestion**
   - [ ] Create `data/sources.json` with initial feeds
   - [ ] Write `scripts/ingest-news.ts`
   - [ ] Test locally with `npm run ingest-news`
   - [ ] Set up GitHub Action for ingestion

2. **Phase 2: AI Processing**
   - [ ] Get Gemini API key
   - [ ] Write `scripts/generate-draft.ts`
   - [ ] Implement deduplication (clustering)
   - [ ] Implement positivity scoring
   - [ ] Test locally with sample data

3. **Phase 3: Publishing**
   - [ ] Write `scripts/publish-issue.ts`
   - [ ] Define Markdown template for issues
   - [ ] Test end-to-end flow

4. **Phase 4: Automation**
   - [ ] Set up GitHub Actions workflows
   - [ ] Add `GEMINI_API_KEY` to repo secrets
   - [ ] Test scheduled runs

---

## Future Enhancements

- **Admin UI:** Simple web page to review/approve drafts instead of editing JSON
- **Email integration:** Auto-send to EmailOctopus after approval
- **Analytics:** Track which stories get most clicks
- **Topic filtering:** Allow filtering by category (tech, environment, community, etc.)
- **Cloudflare Workers:** Move to edge if GitHub Actions becomes limiting

---

## Notes

- All user-facing content must be in **Romanian**
- Keep dependencies minimal for cost efficiency
- Gemini free tier: 15 requests/minute, 1M tokens/day — sufficient for this use case
- RSS feeds typically show 10-20 articles; polling every 6 hours accumulates a full week
- Always attribute original source with link in newsletter
