/**
 * Tolerant JSON extraction for free-form LLM responses.
 *
 * Gemini has a `responseSchema` mode that returns a clean JSON payload. Claude
 * Code headless mode does not — it returns natural-language text that should
 * contain JSON but may be wrapped in code fences, preceded by prose, or
 * followed by commentary even when the prompt says "return JSON only".
 *
 * These helpers aim to recover valid JSON from realistic Claude outputs
 * without silently accepting garbage.
 */

const FENCE_REGEX = /```(?:json|JSON)?\s*([\s\S]*?)```/;

/**
 * Extract the first JSON value (object or array) from a free-form string.
 * Strips markdown code fences, leading prose ("Here is the JSON:"), and
 * trailing commentary. Throws if no JSON-like payload is found.
 */
export function extractJsonPayload(raw: string): string {
  if (typeof raw !== 'string') {
    throw new Error('extractJsonPayload: expected string input');
  }

  // 1. Prefer content inside a fenced code block if present.
  const fenceMatch = raw.match(FENCE_REGEX);
  if (fenceMatch && fenceMatch[1].trim().length > 0) {
    return fenceMatch[1].trim();
  }

  // 2. Otherwise, scan for the first balanced JSON value.
  const start = findJsonStart(raw);
  if (start === -1) {
    throw new Error('No JSON value found in LLM response');
  }

  const end = findBalancedEnd(raw, start);
  if (end === -1) {
    throw new Error('Unbalanced JSON value in LLM response');
  }

  return raw.slice(start, end + 1).trim();
}

/**
 * Parse a free-form LLM response as JSON, with one retry-friendly error type
 * that callers can bubble up to the user when Claude refuses to emit valid
 * structured output after retries.
 */
export function parseJsonPayload<T = unknown>(raw: string): T {
  const payload = extractJsonPayload(raw);
  try {
    return JSON.parse(payload) as T;
  } catch (error) {
    const preview = payload.length > 200 ? `${payload.slice(0, 200)}…` : payload;
    throw new Error(
      `Failed to parse JSON from LLM response: ${
        error instanceof Error ? error.message : String(error)
      }. Payload preview: ${preview}`
    );
  }
}

function findJsonStart(raw: string): number {
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '{' || ch === '[') {
      return i;
    }
  }
  return -1;
}

function findBalancedEnd(raw: string, start: number): number {
  const opener = raw[start];
  const closer = opener === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (inString) {
      if (ch === '\\') {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === opener) {
      depth++;
    } else if (ch === closer) {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
  }

  return -1;
}
