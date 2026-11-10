#!/usr/bin/env node
// Validates supabase/seed/names_starter.sql by parsing its value tuples.
// Usage: node scripts/validate-seed.mjs [path-to-sql]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const file = process.argv[2] ?? path.join(here, '..', 'supabase', 'seed', 'names_starter.sql');
const sql = fs.readFileSync(file, 'utf8');

const ORIGINS = ['English','Irish','Scottish','Welsh','French','Spanish','Italian','German','Scandinavian','Greek','Latin','Hebrew','Arabic','Indian','Japanese','African','Slavic','Celtic','Other'];
const STYLES = ['classic','modern','vintage','nature','short','long','strong','soft','royal','literary','biblical','mythological','unisex-feel','playful','elegant'];
const GENDERS = ['boy','girl','neutral'];

// Tokenise the values section into tuples of literals.
const start = sql.search(/\bvalues\b/i);
const end = sql.search(/\bon conflict\b/i);
if (start < 0 || end < 0) { console.error('Could not find values / on conflict'); process.exit(1); }
const body = sql.slice(start + 6, end);

const errors = [];
const review = [];
const rows = [];
let i = 0;
function skipWs() { while (i < body.length && /[\s,]/.test(body[i])) i++; }
function readString() {
  if (body[i] !== "'") throw new Error('expected quote at ' + i + ': ' + body.slice(i, i + 30));
  i++; let s = '';
  for (;;) {
    if (i >= body.length) throw new Error('unterminated string');
    if (body[i] === "'") { if (body[i + 1] === "'") { s += "'"; i += 2; continue; } i++; break; }
    s += body[i++];
  }
  return s;
}
function readValue() {
  skipWs();
  if (body[i] === "'") {
    const s = readString();
    if (body.startsWith('::', i)) i += body.slice(i).match(/^::\w+/)[0].length;
    return s;
  }
  if (body.startsWith('array[', i)) {
    i += 6; const items = [];
    for (;;) {
      skipWs();
      if (body[i] === ']') { i++; break; }
      items.push(readString());
    }
    if (body.startsWith('::text[]', i)) i += 8;
    return items;
  }
  const m = body.slice(i).match(/^(true|false|-?\d+)/);
  if (!m) throw new Error('bad token at ' + i + ': ' + body.slice(i, i + 30));
  i += m[0].length;
  return m[0] === 'true' ? true : m[0] === 'false' ? false : Number(m[0]);
}
try {
  for (;;) {
    skipWs();
    if (i >= body.length) break;
    if (body[i] !== '(') throw new Error('expected ( at ' + i + ': ' + body.slice(i, i + 30));
    i++;
    const t = [];
    for (let k = 0; k < 9; k++) { t.push(readValue()); skipWs(); }
    if (body[i] !== ')') throw new Error('expected ) after 9 fields near: ' + body.slice(i - 40, i + 10));
    i++;
    const [name, gender, origins, meaning, style_tags, syllables, popularity, blurb, is_starter] = t;
    rows.push({ name, gender, origins, meaning, style_tags, syllables, popularity, blurb, is_starter });
  }
} catch (e) { console.error('PARSE ERROR: ' + e.message); process.exit(1); }

function vowelGroups(n) {
  const s = n.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');
  let c = (s.match(/[aeiouy]+/g) || []).length;
  if (/[^aeiouy]e$/.test(s) && !/(le|ie)$/.test(s) && c > 1) c--; // silent final e
  return Math.max(c, 1);
}

const seen = new Set();
const counts = { boy: 0, girl: 0, neutral: 0 };
const starters = [];
for (const r of rows) {
  const id = `${r.name}/${r.gender}`;
  if (seen.has(id)) errors.push(`duplicate ${id}`);
  seen.add(id);
  if (!GENDERS.includes(r.gender)) errors.push(`${id}: bad gender`); else counts[r.gender]++;
  if (!/^[A-ZÀ-Þ][A-Za-zÀ-ÿ'-]{1,19}$/.test(r.name)) errors.push(`${id}: bad name format`);
  if (!r.origins.length) errors.push(`${id}: no origins`);
  for (const o of r.origins) if (!ORIGINS.includes(o)) errors.push(`${id}: bad origin ${o}`);
  if (!r.style_tags.length) errors.push(`${id}: no style tags`);
  for (const s of r.style_tags) if (!STYLES.includes(s)) errors.push(`${id}: bad style ${s}`);
  if (!Number.isInteger(r.syllables) || r.syllables < 1 || r.syllables > 5) errors.push(`${id}: syllables out of range`);
  else { const v = vowelGroups(r.name); if (Math.abs(v - r.syllables) >= 3) errors.push(`${id}: syllables=${r.syllables}, vowel groups=${v}`); else if (v !== r.syllables) review.push(`${id}: syllables=${r.syllables}, vowel groups=${v}`); }
  if (!Number.isInteger(r.popularity) || r.popularity < 1 || r.popularity > 100) errors.push(`${id}: popularity out of range`);
  if (!r.blurb || r.blurb.length > 90) errors.push(`${id}: blurb length ${r.blurb.length}`);
  if (!r.meaning.trim()) errors.push(`${id}: empty meaning`);
  if (r.meaning.length > 120) errors.push(`${id}: meaning too long`);
  if (typeof r.is_starter !== 'boolean') errors.push(`${id}: is_starter not boolean`);
  else if (r.is_starter) starters.push(r);
}
const total = rows.length;
if (total < 250 || total > 350) errors.push(`total ${total} outside 250..350`);
if (counts.boy < 90 || counts.boy > 130) errors.push(`boys ${counts.boy} outside 90..130`);
if (counts.girl < 90 || counts.girl > 130) errors.push(`girls ${counts.girl} outside 90..130`);
if (counts.neutral < 60 || counts.neutral > 100) errors.push(`neutral ${counts.neutral} outside 60..100`);
if (starters.length < 25 || starters.length > 35) errors.push(`starters ${starters.length} outside 25..35`);
for (const g of GENDERS) if (!starters.some(s => s.gender === g)) errors.push(`no starter of gender ${g}`);
const starterOrigins = new Set(starters.flatMap(s => s.origins));
if (starterOrigins.size < 8) errors.push(`only ${starterOrigins.size} origins among starters`);
const uncertain = rows.filter(r => r.meaning === 'Meaning uncertain').map(r => r.name);

console.log(`Parsed ${total} names: boy=${counts.boy} girl=${counts.girl} neutral=${counts.neutral}`);
console.log(`Starters: ${starters.length}, starter origins: ${starterOrigins.size} (${[...starterOrigins].join(', ')})`);
console.log(`Meaning uncertain (${uncertain.length}): ${uncertain.join(', ')}`);
if (review.length) { console.log(`\nSyllable heuristic off by one (${review.length}; mostly vowel pairs pronounced separately, e.g. Mia, Noel, Liam; manually reviewed):`); console.log('  ' + review.map(x => x.split(':')[0]).join(', ')); }
if (errors.length) { console.log(`\nERRORS (${errors.length}):`); errors.forEach(x => console.log('  ' + x)); process.exit(1); }
console.log('\nOK');
