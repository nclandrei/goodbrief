# Good Brief

> Vesti bune pentru Romania. Newsletter saptamanal cu stiri pozitive.

**Website:** [goodbrief.ro](https://goodbrief.ro)

## Tech Stack

- **Framework:** [Astro](https://astro.build/) + TypeScript
- **Styling:** [Tailwind CSS](https://tailwindcss.com/)
- **Hosting:** [Cloudflare Pages](https://pages.cloudflare.com/)
- **Email:** [Resend](https://resend.com/)

## Dezvoltare locala

```bash
npm install
npm run dev       # Server de dezvoltare
npm run build     # Build pentru productie
npm run check     # Astro + TypeScript checks
npm run test      # Test suite
npm run preview   # Preview build
```

## Pipeline

The Saturday GitHub workflow prepares and scores the raw news pool only. The Amp
schedule independently curates that pool, then emails the editor a proof with
scores **and** a separate `[TEST]` email rendered in the newsletter layout.
Neither email approves a subscriber send. After reviewing the edition, the
editor must approve and push its draft for the Monday delivery workflow.

```bash
npm run ingest-news
npm run pipeline:prepare -- --week 2026-W41
npm run pipeline:score -- --week 2026-W41
# After the orb has written data/orb-proofs/2026-W41.json from the raw pool:
npx tsx scripts/send-independent-proof.ts --week 2026-W41 --dry-run --output /tmp/proof.html
npx tsx scripts/send-independent-proof.ts --week 2026-W41
npx tsx scripts/send-independent-proof.ts --week 2026-W41 --test-email
```

## LLM providers

**Gemini** scores the weekly pool by default. The scheduled workflow also
supports OpenRouter as a fallback. The full AI draft pipeline below is retained
for *manual legacy recovery only*; it never runs in Saturday automation. Select
a provider with `--llm` or `LLM_PROVIDER` and supply its API key if needed.

| Provider     | Flag                  | Required env                  | Where it runs |
| ------------ | --------------------- | ----------------------------- | ------------- |
| Gemini       | `--llm gemini`        | `GEMINI_API_KEY`              | CI + local    |
| OpenRouter   | `--llm openrouter`    | `OPENROUTER_API_KEY`          | CI + local    |
| Claude Code  | `--llm claude-cli`    | none (uses local `claude`)    | **local only** |

```bash
# Default — uses Gemini
npm run pipeline:run-all -- --week 2026-W15

# Switch to OpenRouter (requires OPENROUTER_API_KEY)
npm run pipeline:run-all -- --week 2026-W15 --llm openrouter

# Gemini with OpenRouter fallback on quota errors
LLM_FALLBACK=openrouter npm run pipeline:run-all -- --week 2026-W15

# Local recovery when both paid providers are down
npm run pipeline:run-all -- --week 2026-W15 --llm claude-cli
```

OpenRouter-specific overrides (all optional):

```
OPENROUTER_API_KEY      # required when --llm openrouter
OPENROUTER_MODEL        # default: openai/gpt-4.1-mini
OPENROUTER_FALLBACK_MODELS # default: anthropic/claude-haiku-4.5
OPENROUTER_MAX_PROMPT_PRICE_PER_MILLION     # default: 1 USD
OPENROUTER_MAX_COMPLETION_PRICE_PER_MILLION # default: 5 USD
OPENROUTER_TIMEOUT_MS   # per attempt; default: 180000
OPENROUTER_MAX_RETRIES  # retries after the first attempt; default: 2
OPENROUTER_HTTP_REFERER # app attribution (default: https://goodbrief.ro)
OPENROUTER_APP_TITLE    # app attribution (default: Good Brief)
```

The OpenRouter route deliberately uses low-cost paid models behind hard
per-million-token price ceilings. This keeps scheduled generation off the
capacity-constrained free pool without allowing an unexpectedly expensive
provider route.

**CI note:** The `Score Weekly News` workflow accepts an
`llm_provider` input (`gemini` | `openrouter`) on `workflow_dispatch`.
Scheduled runs use `gemini` by default. `claude-cli` is deliberately rejected
in CI (`CI=true`) because it needs an interactive Claude Code session — it
exists purely for local recovery via `npm run recover-week`. The old
`generate-draft` and `notify-draft` commands are not part of the weekly path.

## Documentatie

- Instructiuni pentru agenti: `AGENTS.md`
