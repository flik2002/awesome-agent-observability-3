#!/usr/bin/env node
// Generates README.md, entries.json and llms.txt from entries/ and registry/.
// Usage: node scripts/build.mjs [--root <dir>] [--check]
//   --check  writes nothing; exits 1 when a generated file differs from what is on disk.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from './lib/data.mjs';
import { renderReadme, renderEntriesJson, renderLlms } from './lib/render.mjs';

export function buildOutputs(root) {
  const data = load(root);
  const template = readFileSync(join(root, 'templates', 'README.md.tmpl'), 'utf8');
  return {
    'README.md': renderReadme(data, template),
    'entries.json': renderEntriesJson(data),
    'llms.txt': renderLlms(data),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const rootArg = args.indexOf('--root');
  const root = resolve(rootArg >= 0 ? args[rootArg + 1] : join(dirname(fileURLToPath(import.meta.url)), '..'));
  const outputs = buildOutputs(root);
  let drift = 0;
  for (const [path, content] of Object.entries(outputs)) {
    if (args.includes('--check')) {
      let current = null;
      try { current = readFileSync(join(root, path), 'utf8'); } catch {}
      if (current !== content) { console.error(`${path} is out of date`); drift++; }
    } else {
      writeFileSync(join(root, path), content);
      console.log(`wrote ${path}`);
    }
  }
  process.exit(drift ? 1 : 0);
}
