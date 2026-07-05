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

test('editorial rules block routine Republic of Moldova stories but allow exceptional civic wins', () => {
  assert.equal(
    getEditorialBlockReason({
      originalTitle:
        'Un nou pod peste Prut și primii kilometri de autostradă din R. Moldova',
      summary:
        'Guvernele anunță un proiect de infrastructură rutieră între România și Republica Moldova.',
    }),
    'routine-republic-of-moldova-story'
  );

  assert.equal(
    getEditorialBlockReason({
      originalTitle:
        'Premieră pentru drepturile LGBT în Republica Moldova: cuplurile primesc protecție legală',
      summary:
        'Decizia marchează o victorie civică pentru egalitate și drepturile omului.',
    }),
    null
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

  assert.equal(
    normalizeDisplayTitle(
      'Mega terminal la Aeroportul „Henri Coandă”. Proiect de 176.000 mp pentru 30 de milioane de pasageri anual. FOTO&VIDEO'
    ),
    'Mega terminal la Aeroportul „Henri Coandă”. Proiect de 176.000 mp pentru 30 de milioane de pasageri anual'
  );

  assert.equal(
    normalizeDisplayTitle(
      'Plecat din România la 4 ani, Vladimir și-a lansat firma când avea 17 ani – VIDEO interviu StartupCafe'
    ),
    'Plecat din România la 4 ani, Vladimir și-a lansat firma când avea 17 ani'
  );

  assert.equal(
    normalizeDisplayTitle(
      'Cerere în căsătorie pe Empire State Building. Doi tineri au escaladat turnul și au desfășurat un banner | VIDEO & FOTO'
    ),
    'Cerere în căsătorie pe Empire State Building. Doi tineri au escaladat turnul și au desfășurat un banner'
  );

  assert.equal(
    normalizeDisplayTitle(
      'Rochia cu care Bella Hadid a făcut furori în Franța | GALERIE FOTO'
    ),
    'Rochia cu care Bella Hadid a făcut furori în Franța'
  );

  assert.equal(
    normalizeDisplayTitle('Lista cu propunerile de miniștri rămâne neschimbată.'),
    'Lista cu propunerile de miniștri rămâne neschimbată.'
  );
});
