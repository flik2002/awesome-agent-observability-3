// Validation rules. Returns findings instead of printing, so tests can check them.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv from 'ajv';
import { slugify, normalizeUrl, isHistorical } from './data.mjs';

export const MIN_PER_SECTION = 3;
export const MAX_DESCRIPTION = 160;
const SOFTWARE_TYPES = new Set(['tool', 'platform', 'framework', 'library', 'sdk']);
const BANNED_WORDS = [
  'best', 'powerful', 'leading', 'fastest', 'ultimate', 'awesome', 'revolutionary', 'cutting-edge',
  'world-class', 'blazing', 'seamless', 'seamlessly', 'effortless', 'effortlessly', 'amazing', 'next-generation',
  'state-of-the-art', 'game-changing', 'unparalleled', 'robust',
];
const EM_DASH = '\u2014';

function stringsOf(value, path, out) {
  if (typeof value === 'string') out.push([path, value]);
  else if (Array.isArray(value)) value.forEach((v, i) => stringsOf(v, `${path}[${i}]`, out));
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) stringsOf(v, path ? `${path}.${k}` : k, out);
  return out;
}

/** Checks a description: one sentence, at most 160 characters, ends with a dot, plain text. Returns problems. */
export function descriptionProblems(d) {
  const p = [];
  if (d.length > MAX_DESCRIPTION) p.push(`is ${d.length} characters, the limit is ${MAX_DESCRIPTION}`);
  if (!d.endsWith('.')) p.push('must end with a dot');
  if (/[.!?]\s+[A-Z]/.test(d.slice(0, -1))) p.push('must be one sentence (found a sentence break)');
  if (/\be\.g\.|\bi\.e\.|\betc\./i.test(d)) p.push('avoid abbreviations with dots (e.g., i.e., etc.)');
  if (/\[[^\]]*\]\([^)]*\)/.test(d)) p.push('must not contain markdown links; use docs_url, repo_url or otel_evidence');
  if (/^[a-z]/.test(d)) p.push('must start with a capital letter or a name');
  const words = d.toLowerCase().match(/[a-z-]+/g) ?? [];
  const banned = words.filter((w) => BANNED_WORDS.includes(w));
  if (banned.length) p.push(`must not use promotional words: ${[...new Set(banned)].join(', ')}`);
  return p;
}

/** Fields whose value is `unknown`, as [slug, field] pairs. */
export function unknownFields(data) {
  const out = [];
  for (const e of data.entries) {
    for (const [k, v] of Object.entries(e)) if (v === 'unknown') out.push([e._slug, k]);
  }
  return out.sort((a, b) => (a[0] + a[1] < b[0] + b[1] ? -1 : 1));
}

export function counts(data) {
  return data.categories.map((c) => {
    const inCat = data.entries.filter((e) => e.category === c.id && !isHistorical(e));
    return {
      id: c.id,
      title: c.title,
      count: inCat.length,
      subs: (c.subcategories ?? []).map((s) => ({ id: s.id, title: s.title, count: inCat.filter((e) => e.subcategory === s.id).length })),
    };
  });
}

/**
 * Runs every rule. `generated` maps an output path (relative to root) to its expected content; when given, the
 * files on disk must match it (no drift).
 */
export function validate(data, { generated } = {}) {
  const errors = [];
  const warnings = [];
  const err = (file, msg) => errors.push(`${file}: ${msg}`);
  const warn = (file, msg) => warnings.push(`${file}: ${msg}`);

  const schema = JSON.parse(readFileSync(join(data.root, 'schema', 'entry.schema.json'), 'utf8'));
  const ajv = new Ajv({ allErrors: true, strict: false });
  const check = ajv.compile(schema);

  // Registries.
  const catIds = new Map(data.categories.map((c) => [c.id, c]));
  const tagById = new Map(data.tags.map((t) => [t.id, t]));
  const licenseIds = new Set(data.licenses.map((l) => l.id));
  const agentTypeIds = new Set(data.agentTypes.map((a) => a.id));
  for (const [name, list] of [['categories', data.categories], ['tags', data.tags], ['licenses', data.licenses], ['agent-types', data.agentTypes]]) {
    const seen = new Set();
    for (const item of list) {
      if (seen.has(item.id)) err(`registry/${name}.yml`, `duplicate id ${item.id}`);
      seen.add(item.id);
    }
  }
  for (const t of data.tags) if (!t.description) err('registry/tags.yml', `tag ${t.id} needs a description`);
  for (const c of data.categories) {
    if (!c.title || !c.scope) err('registry/categories.yml', `category ${c.id} needs a title and a scope`);
    for (const s of c.subcategories ?? []) if (!s.title || !s.scope) err('registry/categories.yml', `subcategory ${c.id}/${s.id} needs a title and a scope`);
  }

  const urls = new Map();
  const repos = new Map();
  const tagUse = new Map();
  for (const e of data.entries) {
    const f = e._file;
    const plain = Object.fromEntries(Object.entries(e).filter(([k]) => !k.startsWith('_')));
    if (!check(plain)) for (const x of check.errors) err(f, `schema: ${x.instancePath || '/'} ${x.message}`);

    for (const [path, s] of stringsOf(plain, '', [])) if (s.includes(EM_DASH)) err(f, `${path} contains an em dash`);
    if (typeof e.name !== 'string' || typeof e.description !== 'string') continue;

    if (slugify(e.name) !== e._slug) err(f, `file name must be ${slugify(e.name)}.yml for the name "${e.name}"`);
    for (const p of descriptionProblems(e.description)) err(f, `description ${p}`);

    const cat = catIds.get(e.category);
    if (!cat) err(f, `unknown category ${e.category}`);
    else if (cat.subcategories?.length) {
      if (!e.subcategory) err(f, `category ${e.category} needs a subcategory: ${cat.subcategories.map((s) => s.id).join(', ')}`);
      else if (!cat.subcategories.some((s) => s.id === e.subcategory)) err(f, `unknown subcategory ${e.subcategory} in ${e.category}`);
    } else if (e.subcategory) err(f, `category ${e.category} has no subcategories`);
    for (const a of e.also_in ?? []) {
      if (!catIds.has(a)) err(f, `also_in names unknown category ${a}`);
      if (a === e.category) err(f, 'also_in repeats the primary category');
    }

    for (const t of e.tags ?? []) {
      const tag = tagById.get(t);
      if (!tag) err(f, `unknown tag ${t}`);
      else if (tag.derived) err(f, `tag ${t} is derived from fields; remove it and set the field instead`);
      tagUse.set(t, (tagUse.get(t) ?? 0) + 1);
    }
    for (const a of e.agent_types ?? []) if (!agentTypeIds.has(a)) err(f, `unknown agent type ${a}`);
    if (e.license !== undefined && !licenseIds.has(e.license)) err(f, `unknown license ${e.license}; add it to registry/licenses.yml`);

    for (const [field, map] of [['url', urls], ['repo_url', repos]]) {
      if (!e[field]) continue;
      const n = normalizeUrl(e[field]);
      if (map.has(n)) err(f, `duplicate ${field} ${e[field]} (also in ${map.get(n)})`);
      else map.set(n, f);
    }
    if (e.repo_url && urls.has(normalizeUrl(e.repo_url)) && urls.get(normalizeUrl(e.repo_url)) !== f) {
      err(f, `repo_url ${e.repo_url} is the url of ${urls.get(normalizeUrl(e.repo_url))}`);
    }

    // Warnings: gaps a reviewer should look at, not blockers.
    if (SOFTWARE_TYPES.has(e.type) && e.license === undefined) warn(f, 'no license field (use an SPDX id, proprietary or unknown)');
    const claimsOtel = (Array.isArray(e.otlp) && e.otlp.length) || (Array.isArray(e.conventions) && e.conventions.length);
    if (claimsOtel && !e.otel_evidence) warn(f, 'otlp or conventions set without otel_evidence');
    if (e.telemetry && e.telemetry !== 'unknown' && !e.telemetry_docs) warn(f, 'telemetry set without telemetry_docs');
    if (e.archived === true && !e.historical) warn(f, 'repository is archived upstream; move it with a historical reason or remove it');
    if (e.pushed_at && !e.mature && !isHistorical(e)) {
      const age = (Date.parse(e.last_checked ?? e.pushed_at) - Date.parse(e.pushed_at)) / 86400000;
      if (age > 365) warn(f, `no push for ${Math.round(age)} days; set mature with a reason, move to historical or remove`);
    }
  }

  // Section sizes: a category or subcategory with 1 or 2 visible entries is an error; an empty one is hidden from
  // the README and only warns.
  const sectionSize = (what, n) => {
    if (n === 0) warn('registry/categories.yml', `${what} has 0 entries (minimum ${MIN_PER_SECTION}; hidden from the README)`);
    else if (n < MIN_PER_SECTION) err('registry/categories.yml', `${what} has ${n} entries (minimum ${MIN_PER_SECTION}); add entries or merge the section`);
  };
  for (const c of counts(data)) {
    sectionSize(`category ${c.id}`, c.count);
    for (const s of c.subs) sectionSize(`subcategory ${c.id}/${s.id}`, s.count);
  }
  for (const [t, n] of tagUse) if (n < MIN_PER_SECTION) warn('registry/tags.yml', `tag ${t} is used by ${n} entries (minimum ${MIN_PER_SECTION})`);

  if (generated) {
    for (const [path, expected] of Object.entries(generated)) {
      let actual = null;
      try {
        actual = readFileSync(join(data.root, path), 'utf8');
      } catch {}
      if (actual !== expected) err(path, 'is out of date; run `npm run build` and commit the result');
    }
    const readme = generated['README.md'];
    if (readme) for (const p of orderProblems(readme)) err('README.md', p);
  }

  return { errors, warnings };
}

/** Checks that entry lines inside each README section are in alphabetical order (a guard on the generator). */
export function orderProblems(readme) {
  const problems = [];
  let section = '';
  let prev = null;
  for (const line of readme.split('\n')) {
    if (line.startsWith('#')) {
      section = line;
      prev = null;
      continue;
    }
    const m = line.match(/^- \[([^\]]+)\]\(/);
    if (!m || section === '## Contents') continue;
    const name = m[1].toLowerCase();
    if (prev !== null && name < prev) problems.push(`"${m[1]}" is out of alphabetical order in ${section}`);
    prev = name;
  }
  return problems;
}
