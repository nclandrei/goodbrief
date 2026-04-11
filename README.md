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

```bash
npm run ingest-news
npm run generate-draft
npm run validate-draft-freshness -- --week 2026-W10
npm run notify-draft -- 2026-W10
npm run publish-issue -- --week 2026-W10
```

## LLM providers

The draft pipeline supports three interchangeable LLM backends. **Gemini** is
the default; switch via `--llm` or the `LLM_PROVIDER` env var. You only need
the API key for the provider you actually use — the others can stay unset.

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
OPENROUTER_MODEL        # default: anthropic/claude-sonnet-4.5
OPENROUTER_HTTP_REFERER # app attribution (default: https://goodbrief.ro)
OPENROUTER_APP_TITLE    # app attribution (default: Good Brief)
```

**CI note:** The `Generate Newsletter Draft` workflow accepts an
`llm_provider` input (`gemini` | `openrouter`) on `workflow_dispatch`.
Scheduled runs use `gemini` by default. `claude-cli` is deliberately rejected
in CI (`CI=true`) because it needs an interactive Claude Code session — it
exists purely for local recovery via `npm run recover-week`.

## Documentatie

- Instructiuni pentru agenti: `AGENTS.md`
