import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { checkFeedHealth } from '../scripts/lib/feed-health.js';

async function createFeedServer(): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  const server = createServer((req, res) => {
    if (req.url === '/ok') {
      res.writeHead(200, { 'content-type': 'application/rss+xml' });
      res.end(`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Fixture Feed</title>
    <item>
      <title>Prima știre</title>
      <link>https://example.ro/one</link>
      <pubDate>Mon, 09 Mar 2026 10:00:00 GMT</pubDate>
      <description>Summary</description>
    </item>
    <item>
      <title>Fără link</title>
    </item>
  </channel>
</rss>`);
      return;
    }

    if (req.url === '/empty') {
      res.writeHead(200, { 'content-type': 'application/rss+xml' });
      res.end(`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Empty Feed</title>
  </channel>
</rss>`);
      return;
    }

    if (req.url === '/broken') {
      res.writeHead(200, { 'content-type': 'application/rss+xml' });
      res.end('<rss><channel><item>');
      return;
    }

    res.writeHead(404);
    res.end('not found');
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Could not resolve test server address');
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      server.close();
      await once(server, 'close');
    },
  };
}

test('checkFeedHealth accepts parseable feeds with usable items', async () => {
  const server = await createFeedServer();

  try {
    const result = await checkFeedHealth({
      id: 'fixture',
      name: 'Fixture',
      url: `${server.baseUrl}/ok`,
    });

    assert.equal(result.ok, true);
    assert.equal(result.parsedItemCount, 2);
    assert.equal(result.usableItemCount, 1);
  } finally {
    await server.close();
  }
});

test('checkFeedHealth fails on feeds with no usable items', async () => {
  const server = await createFeedServer();

  try {
    const result = await checkFeedHealth({
      id: 'fixture',
      name: 'Fixture',
      url: `${server.baseUrl}/empty`,
    });

    assert.equal(result.ok, false);
    assert.match(result.error || '', /no usable items/i);
  } finally {
    await server.close();
  }
});

test('checkFeedHealth fails on malformed XML responses', async () => {
  const server = await createFeedServer();

  try {
    const result = await checkFeedHealth({
      id: 'fixture',
      name: 'Fixture',
      url: `${server.baseUrl}/broken`,
    });

    assert.equal(result.ok, false);
    assert.ok(result.error);
  } finally {
    await server.close();
  }
});
