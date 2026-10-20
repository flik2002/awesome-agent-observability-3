import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, normalizeUrl } from '../scripts/lib/data.mjs';
import { validate, descriptionProblems, unknownFields, orderProblems } from '../scripts/lib/rules.mjs';
import { buildOutputs } from '../scripts/build.mjs';
import { makeRoot, entry } from './helpers.mjs';

const run = (entries) => validate(load(makeRoot(entries)));
const hasError = (r, text) => r.errors.some((e) => e.includes(text));
// Errors about the entry itself, without the section-size errors that a one-entry fixture always has.
const entryErrors = (r) => r.errors.filter((e) => !e.startsWith('registry/categories.yml'));

test('a valid entry passes', () => {
  const r = run({ alpha: entry() });
  assert.deepEqual(entryErrors(r), []);
});

test('description rules', () => {
  assert.deepEqual(descriptionProblems('Library that traces agent runs.'), []);
  assert.ok(descriptionProblems('Library that traces agent runs').some((p) => p.includes('dot')));
  assert.ok(descriptionProblems('First sentence. Second sentence.').some((p) => p.includes('one sentence')));
  assert.ok(descriptionProblems(`${'A'.repeat(160)}.`).some((p) => p.includes('161 characters')));
  assert.ok(descriptionProblems('Library with a [link](https://example.com).').some((p) => p.includes('markdown')));
  assert.ok(descriptionProblems('The best tracing library.').some((p) => p.includes('promotional')));
  assert.ok(descriptionProblems('Tracing for agents, e.g. coding agents.').some((p) => p.includes('abbreviations')));
  // A dot inside a name or version is not a sentence break.
  assert.deepEqual(descriptionProblems('SDK for .NET and Node.js applications.'), []);
});

test('schema violations are errors', () => {
  const r = run({ alpha: entry({ type: 'gadget', extra: 1 }) });
  assert.ok(hasError(r, 'schema'));
});

test('file name must match the name', () => {
  const r = run({ wrong: entry() });
  assert.ok(hasError(r, 'file name must be alpha.yml'));
});

test('unknown category, subcategory, tag, license and agent type', () => {
  assert.ok(hasError(run({ alpha: entry({ category: 'nope' }) }), 'unknown category'));
  assert.ok(hasError(run({ alpha: entry({ category: 'platforms' }) }), 'needs a subcategory'));
  assert.ok(hasError(run({ alpha: entry({ category: 'platforms', subcategory: 'nope' }) }), 'unknown subcategory'));
  assert.ok(hasError(run({ alpha: entry({ subcategory: 'hosted' }) }), 'has no subcategories'));
  assert.ok(hasError(run({ alpha: entry({ tags: ['nope'] }) }), 'unknown tag'));
  assert.ok(hasError(run({ alpha: entry({ tags: ['oss'] }) }), 'derived'));
  assert.ok(hasError(run({ alpha: entry({ license: 'WTFPL' }) }), 'unknown license'));
  assert.ok(hasError(run({ alpha: entry({ agent_types: ['robot'] }) }), 'unknown agent type'));
});

test('duplicate url and repo_url are errors', () => {
  const r = run({
    alpha: entry(),
    beta: entry({ name: 'Beta', url: 'https://github.com/example/alpha/' }),
  });
  assert.ok(hasError(r, 'duplicate url'));
  const r2 = run({
    alpha: entry(),
    beta: entry({ name: 'Beta', url: 'https://beta.example.com/', repo_url: 'https://github.com/example/alpha' }),
  });
  assert.ok(hasError(r2, 'is the url of'));
});

test('em dash anywhere is an error', () => {
  const r = run({ alpha: entry({ license_note: 'core MIT \u2014 rest commercial' }) });
  assert.ok(hasError(r, 'em dash'));
});

test('per-type requirements', () => {
  assert.ok(hasError(run({ alpha: entry({ type: 'finding' }) }), 'schema'));
  assert.ok(hasError(run({ alpha: entry({ type: 'spec' }) }), 'schema'));
  const finding = entry({ type: 'finding', evidence_url: 'https://github.com/a/b/issues/1', status: 'fixed', versions: '1.0' });
  assert.ok(hasError(run({ alpha: finding }), 'schema'), 'fixed needs fixed_in');
  assert.deepEqual(entryErrors(run({ alpha: { ...finding, fixed_in: '1.1' } })), []);
});

test('a section with 1 or 2 entries is an error; an empty section and a small tag only warn', () => {
  const one = run({ alpha: entry({ tags: ['tracing'] }) });
  assert.ok(hasError(one, 'category tools has 1 entries (minimum 3)'));
  assert.ok(one.warnings.some((w) => w.includes('category empty has 0 entries') && w.includes('hidden from the README')));
  assert.ok(one.warnings.some((w) => w.includes('subcategory platforms/empty has 0 entries')));
  assert.ok(!hasError(one, 'has 0 entries'));
  assert.ok(one.warnings.some((w) => w.includes('tag tracing is used by 1')));

  const two = run({
    alpha: entry({ category: 'platforms', subcategory: 'hosted' }),
    beta: entry({ name: 'Beta', url: 'https://example.com/b', category: 'platforms', subcategory: 'hosted' }),
  });
  assert.ok(hasError(two, 'subcategory platforms/hosted has 2 entries (minimum 3)'));

  const three = run(
    Object.fromEntries(['alpha', 'beta', 'gamma'].map((n) => [n, entry({ name: n[0].toUpperCase() + n.slice(1), url: `https://example.com/${n}` })])),
  );
  assert.ok(!hasError(three, 'category tools has'));
});

test('archived and historical entries do not count toward the section minimum', () => {
  const r = run({
    alpha: entry({ name: 'Alpha', url: 'https://example.com/a' }),
    beta: entry({ name: 'Beta', url: 'https://example.com/b' }),
    gamma: entry({ name: 'Gamma', url: 'https://example.com/g', archived: true }),
  });
  assert.ok(hasError(r, 'category tools has 2 entries'));
});

test('OTel claims without evidence and stale repositories warn', () => {
  const r = run({ alpha: entry({ otlp: ['export'], pushed_at: '2024-01-01T00:00:00Z', last_checked: '2026-10-20' }) });
  assert.ok(r.warnings.some((w) => w.includes('without otel_evidence')));
  assert.ok(r.warnings.some((w) => w.includes('no push for')));
  const mature = run({ alpha: entry({ pushed_at: '2024-01-01T00:00:00Z', last_checked: '2026-10-20', mature: 'Finished spec.' }) });
  assert.ok(!mature.warnings.some((w) => w.includes('no push for')));
});

test('unknown fields are listed', () => {
  const data = load(makeRoot({ alpha: entry({ license: 'unknown', otlp: 'unknown' }) }));
  assert.deepEqual(unknownFields(data), [['alpha', 'license'], ['alpha', 'otlp']]);
});

test('drift between disk and build output is an error', () => {
  const root = makeRoot({ alpha: entry() });
  const r = validate(load(root), { generated: buildOutputs(root) });
  assert.ok(hasError(r, 'README.md: is out of date'));
});

test('order check flags unsorted README sections and ignores the contents list', () => {
  const md = '## Contents\n\n- [Zeta](#z)\n- [Alpha](#a)\n\n## Tools\n\n- [Beta](x) - B.\n- [alpha](x) - A.\n';
  assert.deepEqual(orderProblems(md), ['"alpha" is out of alphabetical order in ## Tools']);
});

test('normalized URLs keep the video id of YouTube links and drop other queries', () => {
  assert.notEqual(normalizeUrl('https://www.youtube.com/watch?v=AAAAAAAAAAA'), normalizeUrl('https://www.youtube.com/watch?v=BBBBBBBBBBB'));
  assert.equal(normalizeUrl('https://youtube.com/watch?v=AAAAAAAAAAA&t=5'), normalizeUrl('https://www.youtube.com/watch?v=AAAAAAAAAAA'));
  assert.equal(normalizeUrl('https://Example.com/Page/?utm=1#top'), 'example.com/page');
});
