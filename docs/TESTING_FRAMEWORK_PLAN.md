# Testing Framework Plan

## Problem

The current feedback loop for iterating on the news pipeline is too slow. Processing a full week's data (~200+ articles) takes minutes and costs API tokens. When making changes to deduplication logic, Gemini prompts, or ranking algorithms, we need fast verification.

## Solution

A testing framework that:
- Runs on a **small slice** of current week's data (default: 20 articles)
- **Caches Gemini responses** to avoid repeated API calls
- **Includes LLM reasoning** so we can understand scoring decisions
- Outputs a **detailed trace** of each pipeline stage for debugging

This enables an **agentic feedback loop**: Amp can make changes, run `npm run test:pipeline`, interpret results, and iterate without manual intervention.

---

## Architecture

```
scripts/
├── generate-draft.ts           # Production (unchanged API)
├── lib/
│   ├── pipeline.ts             # Extracted core logic (shared)
│   └── gemini.ts               # Gemini client with cache support
├── test/
│   ├── run-pipeline.ts         # Test harness
│   ├── cache/
│   │   └── gemini-responses.json
│   └── output/
│       └── latest-run.json
```

---

## Commands

| Command | Description |
|---------|-------------|
| `npm run test:pipeline` | Run on 20 articles using cached Gemini responses |
| `npm run test:pipeline -- --limit=5` | Run on 5 articles (faster iteration) |
| `npm run test:pipeline:refresh` | Re-call Gemini API, update cache |

**Expected timing:**
- With cache: 2-5 seconds
- With refresh (20 articles): 10-20 seconds

---

## Output Format

### `test/output/latest-run.json`

```json
{
  "timestamp": "2026-01-10T14:30:00Z",
  "config": {
    "limit": 20,
    "cached": true,
    "weekId": "2026-W02"
  },
  "stages": {
    "input": {
      "count": 20,
      "articles": [
        { "id": "abc123", "title": "Cluj deschide parc nou..." }
      ]
    },
    "deduplication": {
      "inputCount": 20,
      "outputCount": 14,
      "clusters": [
        {
          "kept": "abc123",
          "merged": ["def456", "ghi789"],
          "similarity": 0.82
        }
      ]
    },
    "gemini": {
      "articles": [
        {
          "id": "abc123",
          "title": "Cluj deschide parc nou...",
          "positivity": 85,
          "impact": 72,
          "category": "wins",
          "romaniaRelevant": true,
          "summary": "Cluj-Napoca și-a redeschis parcul central...",
          "reasoning": "High positivity: community benefit, new public infrastructure. Impact is regional but significant for local residents who will use the park daily."
        }
      ]
    },
    "filtering": {
      "passed": 10,
      "discarded": 4,
      "discardReasons": [
        { "id": "xyz999", "reason": "positivity 35 < 40" },
        { "id": "uvw888", "reason": "romaniaRelevant: false" }
      ]
    },
    "ranking": {
      "selected": [
        { "id": "abc123", "score": 79.8, "positivity": 85, "impact": 72 }
      ],
      "reserves": []
    }
  },
  "summary": {
    "inputArticles": 20,
    "afterDedup": 14,
    "afterGemini": 14,
    "afterFiltering": 10,
    "selected": 10,
    "reserves": 0
  }
}
```

---

## Caching Strategy

### Cache file: `test/cache/gemini-responses.json`

```json
{
  "abc123": {
    "positivity": 85,
    "impact": 72,
    "category": "wins",
    "romaniaRelevant": true,
    "summary": "Cluj-Napoca și-a redeschis...",
    "reasoning": "High positivity because...",
    "cachedAt": "2026-01-10T14:30:00Z"
  }
}
```

**Behavior:**
- Cache is keyed by article ID
- If article ID exists in cache → skip Gemini call, use cached response
- `--refresh` flag: clear cache entries for current article set, re-call API
- Cache persists across runs (committed to repo in `.gitignore`? TBD)

**Cache invalidation:**
- Manual: run `npm run test:pipeline:refresh` when prompts change
- No automatic invalidation (KISS)

---

## Test Mode vs Production

| Aspect | Production | Test Mode |
|--------|-----------|-----------|
| Data source | Full `data/raw/YYYY-WNN.json` | First N articles from same file |
| Gemini calls | Always live | Cached (unless `--refresh`) |
| Reasoning field | Not requested | Always included |
| Output | `data/drafts/YYYY-WNN.json` | `test/output/latest-run.json` |
| Console logs | Minimal | Verbose stage-by-stage |

---

## Implementation Plan

### Phase 1: Extract shared logic (6 tasks) ✅ COMPLETED

**Goal:** Make `generate-draft.ts` logic reusable without changing behavior.

**Status:** All tasks completed on 2026-01-10. TypeScript compiles with no errors.

#### Task 1.1: Create types for pipeline results ✅
- **File:** `scripts/lib/types.ts`
- **Work:**
  - Define `DeduplicationResult` interface (outputArticles, clusters with kept/merged/similarity)
  - Define `GeminiResult` interface (articles with scores + reasoning)
  - Define `FilterResult` interface (passed, discarded with reasons)
  - Define `RankingResult` interface (selected, reserves with scores)
  - Define `PipelineTrace` interface (full output structure)

#### Task 1.2: Extract deduplication logic ✅
- **File:** `scripts/lib/deduplication.ts`
- **Work:**
  - Move `normalizeTitle()` from `generate-draft.ts`
  - Move `titleSimilarity()` from `generate-draft.ts`
  - Move `deduplicateArticles()` from `generate-draft.ts`
  - Modify to return `DeduplicationResult` with cluster info (not just articles)
  - Export all functions

#### Task 1.3: Extract Gemini client with caching ✅
- **File:** `scripts/lib/gemini.ts`
- **Work:**
  - Define `GeminiOptions` interface: `{ useCache, cachePath, includeReasoning }`
  - Move `callWithRetry()` from `generate-draft.ts`
  - Move `processArticleBatch()` from `generate-draft.ts`
  - Add cache read/write logic (JSON file keyed by article ID)
  - Add prompt modification for reasoning when `includeReasoning: true`
  - Export `processArticles(articles, options)` as main entry point

#### Task 1.4: Extract filtering and ranking logic ✅
- **File:** `scripts/lib/ranking.ts`
- **Work:**
  - Create `filterArticles(articles)` → returns `FilterResult` with discard reasons
  - Create `rankArticles(articles)` → returns `RankingResult` with scores
  - Export both functions

#### Task 1.5: Update generate-draft.ts to use lib/ ✅
- **File:** `scripts/generate-draft.ts`
- **Work:**
  - Import from `./lib/deduplication.ts`
  - Import from `./lib/gemini.ts`
  - Import from `./lib/ranking.ts`
  - Replace inline logic with imported functions
  - Pass `{ useCache: false, includeReasoning: false }` to Gemini

#### Task 1.6: Verify production unchanged ✅
- **Command:** `npm run generate-draft`
- **Verify:** TypeScript compilation passes, no regressions

---

### Phase 2: Build test harness (5 tasks)

#### Task 2.1: Create directory structure and gitignore
- **Work:**
  - Create `scripts/test/cache/.gitkeep`
  - Create `scripts/test/output/.gitkeep`
  - Add to `.gitignore`:
    ```
    scripts/test/cache/*.json
    scripts/test/output/*.json
    ```

#### Task 2.2: Create CLI argument parser
- **File:** `scripts/test/run-pipeline.ts`
- **Work:**
  - Parse `--limit=N` (default: 20)
  - Parse `--refresh` flag (default: false)
  - Helper to get current week ID
  - Load articles from `data/raw/{weekId}.json`, slice to limit

#### Task 2.3: Implement pipeline runner
- **File:** `scripts/test/run-pipeline.ts`
- **Work:**
  - Call `deduplicateArticles()`, capture result
  - Call `processArticles()` with `{ useCache: !refresh, includeReasoning: true }`
  - Call `filterArticles()`, capture result
  - Call `rankArticles()`, capture result
  - Build `PipelineTrace` object with all stages

#### Task 2.4: Implement output writer
- **File:** `scripts/test/run-pipeline.ts`
- **Work:**
  - Write `PipelineTrace` to `test/output/latest-run.json`
  - Print console summary:
    ```
    ✓ Pipeline complete (2.3s)
      Input: 20 → Dedup: 14 → Gemini: 14 → Filter: 10 → Selected: 10
      Output: scripts/test/output/latest-run.json
    ```

#### Task 2.5: Add npm scripts
- **File:** `package.json`
- **Work:**
  - Add `"test:pipeline": "npx tsx scripts/test/run-pipeline.ts"`
  - Add `"test:pipeline:refresh": "npx tsx scripts/test/run-pipeline.ts --refresh"`

---

### Phase 3: Add reasoning to schema (2 tasks)

#### Task 3.1: Update types
- **File:** `scripts/types.ts`
- **Work:**
  - Add `reasoning?: string` to `ArticleScore` interface

#### Task 3.2: Update Gemini prompt for reasoning
- **File:** `scripts/lib/gemini.ts`
- **Work:**
  - When `includeReasoning: true`, append to prompt:
    ```
    Also include a "reasoning" field (2-3 sentences) explaining your positivity and impact scores.
    ```
  - Update schema to include `reasoning: { type: 'string' }` when in test mode

---

### Verification Checklist

After all phases complete:

- [ ] `npm run generate-draft` works unchanged (production)
- [ ] `npm run test:pipeline:refresh` calls Gemini, creates cache
- [ ] `npm run test:pipeline` uses cache, runs in <5s
- [ ] `npm run test:pipeline -- --limit=5` works with fewer articles
- [ ] `latest-run.json` contains all stages with reasoning
- [ ] Deduplication clusters are logged correctly
- [ ] Filter discard reasons are logged

---

## Verification

After implementation, verify:

1. **Cache works:**
   ```bash
   npm run test:pipeline:refresh  # Calls Gemini, creates cache
   npm run test:pipeline          # Uses cache, no API calls (check timing)
   ```

2. **Output is correct:**
   - `test/output/latest-run.json` contains all stages
   - Reasoning field populated for all articles
   - Deduplication clusters logged correctly

3. **Production unchanged:**
   ```bash
   npm run generate-draft  # Still works, no reasoning in output
   ```

---

## Future Enhancements (not in scope)

- Baseline comparison for regression testing
- Invariant assertions (e.g., "all selected articles have positivity ≥ 40")
- Visual diff tool for comparing runs
- Integration with CI

---

## Decisions

1. **`test/cache/` is gitignored** — avoids stale cache; run `--refresh` on first use
2. **Console shows summary by default** — detailed trace in `latest-run.json`
