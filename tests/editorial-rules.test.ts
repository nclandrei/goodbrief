import test from 'node:test';
import assert from 'node:assert/strict';
import { getEditorialBlockReason } from '../scripts/lib/editorial-rules.js';

test('editorial rules block the Nostalgia festival without blocking ordinary nostalgia', () => {
  assert.equal(
    getEditorialBlockReason({
      originalTitle:
        'Mii de oameni au dat startul festivalului Nostalgia în Pădurea Băneasa',
      summary:
        'Muzica anilor 90 și 2000 a transformat Pădurea Băneasa într-o petrecere.',
    }),
    'commercial-festival-or-nostalgia'
  );

  assert.equal(
    getEditorialBlockReason({
      originalTitle:
        'O expoziție din Iași vorbește despre nostalgia copilăriei din anii 90',
      summary:
        'Artiștii folosesc fotografii de familie și obiecte vechi pentru a spune o poveste despre memorie.',
    }),
    null
  );
});
