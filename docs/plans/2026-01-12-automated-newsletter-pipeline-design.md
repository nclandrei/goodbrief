# Automated Newsletter Pipeline Design

## Overview

Automate the full newsletter flow from draft generation to sending, with human review opportunity on weekends.

## Flow

```
Mon-Fri: News ingestion (every 6h) ✓ exists
    ↓
Saturday 10:00 UTC:
    ↓
[generate-draft] → saves to data/drafts/YYYY-WXX.json
    ↓              (includes wrapper copy)
[notify-draft]  → sends editor:
                   1. "Draft ready" notification email
                   2. Newsletter proof (exact email subscribers will get)
    ↓
Sat/Sun: Editor optionally edits the draft JSON
    ↓
Monday 08:00 UTC (10:00 Romania):
    ↓
[send-newsletter] → broadcasts to all subscribers
                    (or sends alert if draft missing)
```

## Changes

### 1. Draft Schema Extension

`data/drafts/YYYY-WXX.json` will include wrapper copy:

```json
{
  "weekId": "2026-W02",
  "generatedAt": "...",
  "selected": [...],
  "wrapperCopy": {
    "greeting": "Salutare!",
    "intro": "Săptămâna aceasta am adunat...",
    "signOff": "Săptămână frumoasă,\nEchipa Good Brief"
  }
}
```

### 2. Saturday Notification Emails

After draft generation, send two emails to `TEST_EMAIL`:

**Email 1 - Notification:**
- Subject: `[Action Required] Good Brief 2026-W02 draft ready`
- Body: Article count summary + link to edit on GitHub

**Email 2 - Newsletter Proof:**
- Subject: `[PROOF] Good Brief 2026-W02 – Vești bune din România`
- Body: Exact rendered newsletter subscribers will receive

### 3. Monday Automated Send

New workflow at Monday 08:00 UTC:
- Determines current week ID
- Checks if draft exists
- Sends newsletter OR alerts editor if draft missing

### 4. Script Changes

| Script | Changes |
|--------|---------|
| `generate-draft.ts` | Add `generateWrapperCopy()` call, store in draft JSON |
| `send-newsletter.ts` | Read `wrapperCopy` from draft; add `--automated` flag for CI |
| **New:** `notify-draft.ts` | Sends notification + proof emails |
| **New:** `alert-missing-draft.ts` | Sends "no draft found" alert |

### 5. Workflow Changes

| Workflow | Changes |
|----------|---------|
| `generate-newsletter.yml` | Add step to run `notify-draft.ts` after commit |
| **New:** `send-newsletter.yml` | Monday schedule, send or alert on missing draft |

## Environment Variables Required

- `RESEND_API_KEY` - For sending emails
- `TEST_EMAIL` - Editor email for notifications and proofs
- `RESEND_SEGMENT_ID` - Audience for broadcast
- `GEMINI_API_KEY` - For AI copy generation
