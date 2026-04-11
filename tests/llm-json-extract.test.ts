import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractJsonPayload,
  parseJsonPayload,
} from '../scripts/lib/llm/json-extract.js';

test('extractJsonPayload returns a bare JSON object unchanged', () => {
  const input = '{"a":1,"b":"x"}';
  assert.equal(extractJsonPayload(input), '{"a":1,"b":"x"}');
});

test('extractJsonPayload returns a bare JSON array unchanged', () => {
  const input = '[{"id":"a"},{"id":"b"}]';
  assert.equal(extractJsonPayload(input), '[{"id":"a"},{"id":"b"}]');
});

test('extractJsonPayload strips ```json fenced code blocks', () => {
  const input = '```json\n{"a":1}\n```';
  assert.equal(extractJsonPayload(input), '{"a":1}');
});

test('extractJsonPayload strips unlabeled ``` code blocks', () => {
  const input = '```\n[1,2,3]\n```';
  assert.equal(extractJsonPayload(input), '[1,2,3]');
});

test('extractJsonPayload drops leading prose before an object', () => {
  const input = 'Here is the JSON you requested:\n{"result":"ok"}';
  assert.equal(extractJsonPayload(input), '{"result":"ok"}');
});

test('extractJsonPayload drops trailing commentary after the object', () => {
  const input = '{"result":"ok"}\n\nLet me know if you need anything else.';
  assert.equal(extractJsonPayload(input), '{"result":"ok"}');
});

test('extractJsonPayload handles nested objects and arrays', () => {
  const input =
    'Response:\n{"groups":[{"ids":["a","b"],"reason":"same story"}]}';
  assert.equal(
    extractJsonPayload(input),
    '{"groups":[{"ids":["a","b"],"reason":"same story"}]}'
  );
});

test('extractJsonPayload is not confused by braces inside strings', () => {
  const input = '{"intro":"Săptămâna asta {literal braces} în text","n":1}';
  assert.equal(
    extractJsonPayload(input),
    '{"intro":"Săptămâna asta {literal braces} în text","n":1}'
  );
});

test('extractJsonPayload handles escaped quotes inside strings', () => {
  const input = '{"quote":"He said \\"hi\\"","ok":true}';
  assert.equal(extractJsonPayload(input), '{"quote":"He said \\"hi\\"","ok":true}');
});

test('extractJsonPayload throws when no JSON is present', () => {
  assert.throws(() => extractJsonPayload('just some prose here'), /No JSON/);
});

test('extractJsonPayload throws on unbalanced payload', () => {
  assert.throws(() => extractJsonPayload('{"a":1'), /Unbalanced/);
});

test('parseJsonPayload returns the parsed object', () => {
  const parsed = parseJsonPayload<{ a: number }>('{"a":42}');
  assert.deepEqual(parsed, { a: 42 });
});

test('parseJsonPayload parses an array through fences + prose', () => {
  const raw =
    'Here is the scored output:\n```json\n[{"id":"x","positivity":80}]\n```\n\nLet me know!';
  const parsed = parseJsonPayload<Array<{ id: string; positivity: number }>>(raw);
  assert.deepEqual(parsed, [{ id: 'x', positivity: 80 }]);
});

test('parseJsonPayload includes preview on parse failure', () => {
  assert.throws(
    () => parseJsonPayload('{"a":1, not-json}'),
    /Failed to parse JSON/
  );
});
