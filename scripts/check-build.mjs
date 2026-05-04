import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dist = new URL('../dist/', import.meta.url);
const html = readFileSync(new URL('index.html', dist), 'utf8');
if (!html.includes('/openfda/assets/')) {
  throw new Error('Built HTML is not using /openfda asset paths.');
}

const assetsDir = new URL('assets/', dist);
const jsFile = readdirSync(assetsDir).find((name) => name.endsWith('.js'));
if (!jsFile) throw new Error('No built JavaScript asset found.');
const js = readFileSync(join(assetsDir.pathname, jsFile), 'utf8');

for (const required of ['brought to you by Neuromancer', 'https://api.fda.gov', 'drug/enforcement.json', 'device/enforcement.json', 'food/enforcement.json']) {
  if (!js.includes(required)) throw new Error(`Missing required build content: ${required}`);
}

console.log('Build smoke check passed.');
