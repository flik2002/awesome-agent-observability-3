#!/usr/bin/env node
// Refreshes bot-filled metadata (stars, archived, pushed_at, last_release, last_checked) from the GitHub API.
// Uses the GitHub CLI (`gh api`), so it runs with whatever token gh is logged in with (GH_TOKEN in CI).
// Usage: node scripts/refresh.mjs [--root <dir>] [--only <slug>] [--dry-run]
// Prints a line for every repository that moved (the API returns another owner/name) or is archived.
import { readFileSync, writeFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDocument } from 'yaml';
import { load, entryRepo, KEY_ORDER } from './lib/data.mjs';

const run = promisify(execFile);

async function ghApi(path) {
  try {
    const { stdout } = await run('gh', ['api', path], { maxBuffer: 10 * 1024 * 1024 });
    return JSON.parse(stdout);
  } catch (err) {
    if (/HTTP 404/.test(String(err.stderr))) return null;
    throw new Error(`gh api ${path} failed: ${String(err.stderr || err.message).trim()}`);
  }
}

/** Strips sub-second precision so values match the schema pattern. */
const isoSecond = (s) => (s ? s.replace(/\.\d+Z$/, 'Z') : s);

export async function fetchMeta(repo, today) {
  const r = await ghApi(`repos/${repo}`);
  if (!r) return { missing: true };
  const rel = await ghApi(`repos/${repo}/releases/latest`);
  return {
    full_name: r.full_name,
    fields: {
      stars: r.stargazers_count,
      archived: r.archived,
      pushed_at: isoSecond(r.pushed_at),
      last_release: rel ? { tag: rel.tag_name, published_at: isoSecond(rel.published_at ?? rel.created_at) } : null,
      last_checked: today,
    },
  };
}

/** Writes bot fields into the YAML document, keeping comments and the order of hand-written keys. */
export function applyFields(text, fields) {
  const doc = parseDocument(text);
  for (const [k, v] of Object.entries(fields)) doc.set(k, v);
  // Keep bot fields at the end, in KEY_ORDER.
  const items = doc.contents.items;
  items.sort((a, b) => KEY_ORDER.indexOf(String(a.key)) - KEY_ORDER.indexOf(String(b.key)));
  return doc.toString({ lineWidth: 0 });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const root = resolve(opt('--root') ?? join(dirname(fileURLToPath(import.meta.url)), '..'));
  const only = opt('--only');
  const dry = args.includes('--dry-run');
  const today = new Date().toISOString().slice(0, 10);
  const data = load(root);
  let changed = 0;
  let problems = 0;
  const targets = data.entries.filter((e) => entryRepo(e) && (!only || e._slug === only));
  const queue = [...targets];
  const worker = async () => {
    for (let e = queue.shift(); e; e = queue.shift()) {
      const repo = entryRepo(e);
      let meta;
      try {
        meta = await fetchMeta(repo, today);
      } catch (err) {
        console.error(`${e._slug}: ${err.message}`);
        problems++;
        continue;
      }
      if (meta.missing) {
        console.log(`${e._slug}: ${repo} returns 404 (removed or private); review the entry`);
        problems++;
        continue;
      }
      if (meta.full_name.toLowerCase() !== repo.toLowerCase()) {
        console.log(`${e._slug}: ${repo} now resolves to ${meta.full_name}; check where the project lives and update the URL`);
      }
      if (meta.fields.archived) console.log(`${e._slug}: ${repo} is archived`);
      const path = join(root, e._file);
      const before = readFileSync(path, 'utf8');
      const after = applyFields(before, meta.fields);
      if (after !== before) {
        changed++;
        if (!dry) writeFileSync(path, after);
      }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  console.log(`${targets.length} repositories checked, ${changed} files ${dry ? 'would change' : 'changed'}, ${problems} problems`);
  process.exit(problems ? 1 : 0);
}
