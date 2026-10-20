// Builds a throwaway list root (schema, registries, template, entries) in a temp directory.
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stringify } from 'yaml';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');

export const CATEGORIES = [
  { id: 'tools', title: 'Tools', scope: 'Tools for tests.', aliases: ['old-tools'] },
  {
    id: 'platforms',
    title: 'Platforms',
    scope: 'Platforms for tests.',
    aliases: [],
    subcategories: [
      { id: 'hosted', title: 'Hosted platforms', scope: 'Hosted ones.' },
      { id: 'empty', title: 'Empty sub', scope: 'Nothing here.' },
    ],
  },
  { id: 'empty', title: 'Empty category', scope: 'Nothing here.', aliases: [] },
];

export function entry(over = {}) {
  return {
    name: 'Alpha',
    url: 'https://github.com/example/alpha',
    description: 'Library that does one thing for agent traces.',
    type: 'library',
    category: 'tools',
    added: '2026-10-20',
    license: 'MIT',
    ...over,
  };
}

/** Creates a root with the real schema and template plus small registries; `entries` maps slug to object. */
export function makeRoot(entries, { template } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'aao-test-'));
  for (const d of ['schema', 'registry', 'templates', 'entries']) mkdirSync(join(root, d));
  copyFileSync(join(REPO, 'schema', 'entry.schema.json'), join(root, 'schema', 'entry.schema.json'));
  writeFileSync(join(root, 'registry', 'categories.yml'), stringify(CATEGORIES));
  writeFileSync(
    join(root, 'registry', 'tags.yml'),
    stringify([
      { id: 'tracing', description: 'Traces.' },
      { id: 'oss', description: 'Derived.', derived: true },
    ]),
  );
  writeFileSync(
    join(root, 'registry', 'licenses.yml'),
    stringify([
      { id: 'MIT', name: 'MIT', kind: 'osi' },
      { id: 'Elastic-2.0', name: 'ELv2', kind: 'source-available' },
      { id: 'proprietary', name: 'Proprietary', kind: 'proprietary' },
      { id: 'unknown', name: 'Unknown', kind: 'unknown' },
    ]),
  );
  writeFileSync(join(root, 'registry', 'agent-types.yml'), stringify([{ id: 'coding', description: 'Coding.' }]));
  writeFileSync(join(root, 'templates', 'README.md.tmpl'), template ?? '# List\n\n## Contents\n\n{{toc}}\n\n{{sections}}\n\n## Archived and historical\n\n{{archived}}\n\nCount: {{count}}\n');
  for (const [slug, e] of Object.entries(entries)) writeFileSync(join(root, 'entries', `${slug}.yml`), stringify(e));
  return root;
}
