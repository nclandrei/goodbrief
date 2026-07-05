import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getEditorialBlockReason,
  normalizeDisplayTitle,
} from '../scripts/lib/editorial-rules.js';

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

test('editorial rules block sponsored and advertorial stories', () => {
  assert.equal(
    getEditorialBlockReason({
      originalTitle:
        'Spitalul care contactează peste 2.000 de pacienți lunar după externare (P)',
      summary: 'Un material despre servicii medicale private.',
    }),
    'sponsored-or-advertorial'
  );

  assert.equal(
    getEditorialBlockReason({
      originalTitle: 'Advertorial: o companie lansează o clinică nouă',
      summary: 'Articol sponsorizat despre o investiție privată.',
    }),
    'sponsored-or-advertorial'
  );
});

test('normalizeDisplayTitle strips HTML, entities, and source labels', () => {
  assert.equal(
    normalizeDisplayTitle(
      '<span class="title-highlight">Oana Opriș &amp; Genuin</span> | ”Familia stă mereu înaintea banilor”'
    ),
    'Oana Opriș & Genuin | ”Familia stă mereu înaintea banilor”'
  );

  assert.equal(
    normalizeDisplayTitle(
      'GRAFIC. Explozia fotovoltaicului pune soarele în fruntea surselor de generare'
    ),
    'Explozia fotovoltaicului pune soarele în fruntea surselor de generare'
  );
});
