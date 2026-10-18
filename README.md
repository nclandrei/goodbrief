# Good Brief

> Vesti bune pentru Romania. Newsletter saptamanal cu stiri pozitive.

**Website:** [goodbrief.ro](https://goodbrief.ro)

## Tech Stack

- **Framework:** [Astro](https://astro.build/) + TypeScript
- **Styling:** [Tailwind CSS](https://tailwindcss.com/)
- **Hosting:** [Cloudflare Pages](https://pages.cloudflare.com/)
- **Email:** [Resend](https://resend.com/)
- **Editorial assessment:** Amp in a scheduled orb; no separate inference API

## Dezvoltare locala

```bash
npm install
npm run dev       # Server de dezvoltare
npm run build     # Build pentru productie
npm run check     # Astro + TypeScript checks
npm run test      # Test suite
npm run preview   # Preview build
```

## Weekly workflow

GitHub fetches the configured RSS feeds every six hours. Amp starts Saturday at
08:00 Europe/Bucharest, with recovery wake-ups, to assess the entire frozen pool,
verify finalists, select a varied edition and send the editor one scored proof.
The goal is review by Saturday lunch. No separate `[TEST]` email is automatic.

Amp authors every eligible article's three scores, decision and Romanian
judgment. Code only checks coverage, fingerprints, explicit exclusions,
full-source evidence, archive freshness and the editor handoff. It never invents
missing judgments or calls another assessment model. These guards detect missing
or inconsistent work; they cannot prove that a factual judgment is true.

Each edition lives in `data/assessments/YYYY-WXX/`. The same orb resumes that
checkpoint after an interruption, rather than starting over or consulting a
previous selection. Editor-only emails have persisted, content-bound receipts;
an uncertain send stops for inspection instead of risking a duplicate.

```bash
# In the scheduled Amp thread, after syncing fresh raw data:
npm run review:weekly -- prepare T-<current-thread-uuid>
# Amp reads pages and writes small, individually authored batches:
npm run assess-news -- page data/assessments/2026-W43
npm run assess-news -- import data/assessments/2026-W43 /tmp/amp-batch.json
npm run assess-news -- check data/assessments/2026-W43
npm run assess-news -- audit data/assessments/2026-W43
# After full-source checks, proposal.json and editorial-review.json:
npm run review:weekly -- stage data/assessments/2026-W43
# Inspect the staged editor-proof.html and newsletter.html, then:
npm run assess-news -- finish data/assessments/2026-W43 data/assessments/2026-W43/proposal.json
npm run review:weekly -- deliver data/assessments/2026-W43
```

`stage` must precede `finish`: if freshness blocks a proposal, Amp can revise it
before the assessment becomes immutable. The review includes selection reasoning,
alternatives, source limitations, and at least 12 distinct manual spot-checks,
including candidates and rejects. `deliver` sends only to the single editor,
materializes the exact unapproved draft, and records `review-ready.json` only
after Resend accepts the matching proof. Retrying an accepted send is a no-op.

Saturday review **does not approve, push or schedule subscriber delivery**.
The editor must approve the exact final edition and authorize its commit/push.
The existing delivery workflow then reconciles one persisted Resend broadcast
for Monday 09:00 Europe/Bucharest; website publication waits for confirmed delivery.

## Assessment contract and recovery

For a standalone experiment, initialize a new run from raw JSON:

```bash
npm run assess-news -- init /tmp/assessment data/raw/2026-W43.json
npm run assess-news -- page /tmp/assessment
```

`init` freezes the snapshot, its SHA-256 fingerprint, per-row fingerprints and a
UTC cutoff. Only malformed required fields/dates, repeated IDs, future timestamps
and publication older than the rolling 14-day ingestion window are explicitly
excluded. Negative stories are assessed, not filtered out. Empty excerpts remain
eligible, with that evidence limitation noted. Record acquisition and setup time
separately from assessment time when benchmarking.

Batch JSON has `assessments` and/or `sourceChecks` arrays, defined in
`scripts/lib/amp-assessment.ts`. Each assessment contains its raw `index`,
`fingerprint`, UTC `assessedAt`, three integer scores from 0–100,
`candidate`/`reject` decision and article-specific judgment. `page` returns the
next 25 missing rows; an optional offset is within the remaining rows. Invalid
imports preserve the previous checkpoint. There is one writer per run.

Persist finalist full sources and retrieval metadata, then record the source URL,
full `sourceText`, `sourceHash` (`hash(sourceText)`), UTC `checkedAt`, claims,
caveats and `verified`/`unverified` verdict. The latest check controls eligibility.
An RSS excerpt is not full-source verification. Follow `AGENTS.md` for primary
sources, event dates, laws and publisher-access fallbacks.

`check` exits nonzero with exact missing indices for incomplete coverage.
`audit` flags repeated six-word phrases; manually examine them and varied
accepted/rejected stories. Exact repeated judgments are invalid. Wording checks
and an `author: Amp` label are audit aids, not proof of independent thought.
`finish` requires full coverage and a verified source for every selected story.
Rendering, email and materialization use that same gate.

The project plugin `.amp/plugins/goodbrief-assessment.js` continues an explicitly
armed thread after `agent.end`. Weekly `prepare` arms the full editor-review goal
without replacing its recurring schedule. Zero missing rows alone is not enough:
completion also requires the finished proof, source checks, manual review,
matching unapproved draft and accepted editor email.

The ignored `.amp/assessment-worker.json` binds work to a thread and checkpoint.
Cancellation, invalid data, three no-progress turns or consecutive errors, a
90-minute deadline and 128-continuation cap stop recovery and report failure,
never partial success. Backup Saturday wake-ups resume active checkpoints and
no-op on a ready edition; they do not reset a failed or expired worker. Persistent
files and a reachable executor are required. A successful benchmark is not a
guarantee that future sources or model runs will meet the deadline.

For an explicitly authorized standalone trial, `assess-news arm <directory>
<thread-id> 90` writes a local bounded `schedule-request.json`. Install it with
Amp's schedule tools only in a thread without another recurring schedule. It is
separate from weekly automation; never replace the weekly schedule with it.

## Configuration

Email delivery uses `RESEND_API_KEY`, `RESEND_AUDIENCE_ID` and
`RESEND_SEGMENT_ID`. The scheduled proof requires exactly one editor address in
`TEST_EMAIL` (falling back to the Amp account email). Copy the other email-service
settings from `.env.example` as needed. No external model key is used.

See `AGENTS.md` for operating instructions and `COPY_GUIDELINES.md` for Romanian
copy, audience, environmental coverage and source fidelity.
