# Gemini API Optimization Plan

**Goal:** Reduce API calls from 100+ to under 15 per weekly run.

**Context:** With 1663 articles and a 15 requests/day limit, the current approach (1 clustering + 111 processing batches + 1 wrapper) exceeds the limit by ~10x.

---

## Tasks

### Task 1: Local Deduplication

**Status:** ✅ Completed

**Objective:** Replace the Gemini-based `clusterArticles()` function with local title similarity matching.

**Implementation:**
1. Add a dependency for string similarity (e.g., `fastest-levenshtein` or implement simple Jaccard similarity)
2. Create `deduplicateArticles()` function in `scripts/generate-draft.ts`
3. Group articles where title similarity > 0.7 (tune threshold as needed)
4. Pick representative from each group (prefer longer summary or more recent)
5. Remove the `clusterArticles()` function and its API call

**Files to modify:**
- `scripts/generate-draft.ts`
- `package.json` (if adding dependency)

**Verification:**
- Run with sample data, confirm no Gemini call for clustering
- Check that obvious duplicates are merged

---

### Task 2: Enable Structured JSON Output Mode

**Status:** 🔲 Not Started

**Objective:** Use Gemini's JSON response mode for more reliable parsing of large outputs.

**Implementation:**
1. Update model configuration to use `responseMimeType: "application/json"`
2. Add `responseSchema` for type safety (optional but recommended)
3. Remove manual JSON cleanup code (`replace(/```json/, ...)`)

**Files to modify:**
- `scripts/generate-draft.ts` (model config + `processArticleBatch()`)
- `emails/utils/generate-copy.ts` (model config + response handling)

**Reference:** https://ai.google.dev/gemini-api/docs/structured-output

**Verification:**
- Run a batch and confirm clean JSON parsing without regex cleanup

---

### Task 3: Increase Batch Size to 120 Articles

**Status:** 🔲 Not Started

**Objective:** Process ~120 articles per API call to stay within 15 requests/day.

**Implementation:**
1. Change `BATCH_SIZE` from 50 to 120 in `scripts/generate-draft.ts`
2. Calculate dynamic batch size based on article count:
   ```typescript
   const MAX_API_CALLS = 13; // Reserve 2 for clustering fallback + wrapper
   const BATCH_SIZE = Math.ceil(representatives.length / MAX_API_CALLS);
   ```
3. Add logging to show expected API call count before processing

**Files to modify:**
- `scripts/generate-draft.ts`

**Verification:**
- Run with 1663 articles, confirm ≤13 processing batches
- Monitor for JSON parsing errors with larger batches

---

### Task 4: Add Pre-processing Filters (Optional Enhancement)

**Status:** 🔲 Not Started

**Objective:** Reduce article count before AI processing using local heuristics.

**Implementation:**
1. Filter out articles older than 5 days (stale news)
2. Remove articles with very short titles/summaries (likely low quality)
3. Deduplicate by URL before title similarity check
4. Add configurable filters in a separate `filterArticles()` function

**Files to modify:**
- `scripts/generate-draft.ts`

**Verification:**
- Log article count before/after filtering
- Ensure no high-quality articles are incorrectly filtered

---

### Task 5: Add Retry Logic with Exponential Backoff

**Status:** 🔲 Not Started

**Objective:** Handle transient API failures gracefully.

**Implementation:**
1. Create `callWithRetry()` wrapper function
2. Retry up to 3 times with exponential backoff (1s, 2s, 4s)
3. On final failure, log error and continue (don't crash entire run)

**Files to modify:**
- `scripts/generate-draft.ts`

**Verification:**
- Simulate failure, confirm retry behavior
- Ensure partial results are saved even if some batches fail

---

## Expected Outcome

| Metric | Before | After |
|--------|--------|-------|
| Clustering calls | 1 | 0 |
| Processing calls | 111 | ≤13 |
| Wrapper call | 1 | 1 |
| **Total** | **113** | **≤14** |

---

## Notes

- Tasks 1-3 are **required** to stay within limits
- Tasks 4-5 are **optional** but improve reliability
- If JSON parsing still fails at 120 articles, reduce to 100 and accept slightly more calls
