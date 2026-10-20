#!/usr/bin/env node
// Validates entries and registries, and checks that the generated files are up to date.
// Usage: node scripts/validate.mjs [--root <dir>] [--no-drift] [--strict] [--quiet]
//   --no-drift  skip the README.md / entries.json / llms.txt drift check
//   --strict    treat warnings as errors
//   --quiet     print only errors and the summary line
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from './lib/data.mjs';
import { validate, counts, unknownFields } from './lib/rules.mjs';
import { buildOutputs } from './build.mjs';

const args = process.argv.slice(2);
const rootArg = args.indexOf('--root');
const root = resolve(rootArg >= 0 ? args[rootArg + 1] : join(dirname(fileURLToPath(import.meta.url)), '..'));
const data = load(root);
const generated = args.includes('--no-drift') ? undefined : buildOutputs(root);
const { errors, warnings } = validate(data, { generated });
const quiet = args.includes('--quiet');

if (!quiet) {
  console.log('Entries per category:');
  for (const c of counts(data)) {
    console.log(`  ${String(c.count).padStart(3)}  ${c.title}`);
    for (const s of c.subs) console.log(`  ${String(s.count).padStart(3)}    ${s.title}`);
  }
  const unk = unknownFields(data);
  console.log(`\nFields set to unknown (${unk.length}):`);
  for (const [slug, field] of unk) console.log(`  ${slug}: ${field}`);
  if (warnings.length) {
    console.log(`\nWarnings (${warnings.length}):`);
    for (const w of warnings) console.log(`  ${w}`);
  }
}
if (errors.length) {
  console.error(`\nErrors (${errors.length}):`);
  for (const e of errors) console.error(`  ${e}`);
}
const failed = errors.length > 0 || (args.includes('--strict') && warnings.length > 0);
console.log(`\n${data.entries.length} entries, ${errors.length} errors, ${warnings.length} warnings: ${failed ? 'FAILED' : 'OK'}`);
process.exit(failed ? 1 : 0);
