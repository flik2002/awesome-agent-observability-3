#!/usr/bin/env node
// Checks that every link in the entries answers. Patterns in registry/link-check-exclude.yml are skipped.
// Usage: node scripts/check-links.mjs [--root <dir>] [--only <slug>] [--timeout <ms>]
// Exits 1 when a link fails: HTTP status 400 or above (after redirects), or no connection.
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from './lib/data.mjs';

const LINK_FIELDS = ['url', 'repo_url', 'docs_url', 'otel_evidence', 'telemetry_docs', 'evidence_url'];
const UA = 'Mozilla/5.0 (compatible; awesome-agent-observability link check)';

/** Collects [url, [where...]] pairs, skipping excluded patterns. */
export function collectLinks(data) {
  const exclude = (data.linkExclude ?? []).map((x) => {
    if (!x.reason) throw new Error(`link-check-exclude.yml: pattern ${x.pattern} needs a reason`);
    return new RegExp(x.pattern);
  });
  const links = new Map();
  for (const e of data.entries) {
    for (const f of LINK_FIELDS) {
      const u = e[f];
      if (!u || exclude.some((re) => re.test(u))) continue;
      if (!links.has(u)) links.set(u, []);
      links.get(u).push(`${e._slug}.${f}`);
    }
  }
  return links;
}

async function check(url, timeout) {
  const attempt = async (method) => {
    const res = await fetch(url, { method, redirect: 'follow', headers: { 'user-agent': UA }, signal: AbortSignal.timeout(timeout) });
    if (method === 'GET') await res.body?.cancel();
    return res.status;
  };
  try {
    let status = await attempt('HEAD');
    if (status >= 400) status = await attempt('GET');
    return { ok: status < 400, detail: String(status) };
  } catch (err) {
    return { ok: false, detail: err.cause?.code ?? err.name };
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const root = resolve(opt('--root') ?? join(dirname(fileURLToPath(import.meta.url)), '..'));
  const timeout = Number(opt('--timeout') ?? 20000);
  const data = load(root);
  const only = opt('--only');
  if (only) data.entries = data.entries.filter((e) => e._slug === only);
  const links = [...collectLinks(data)];
  const failures = [];
  const queue = [...links];
  const worker = async () => {
    for (let item = queue.shift(); item; item = queue.shift()) {
      const [url, where] = item;
      const r = await check(url, timeout);
      if (!r.ok) failures.push(`${r.detail} ${url} (${where.join(', ')})`);
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  failures.sort();
  for (const f of failures) console.log(`FAIL ${f}`);
  console.log(`${links.length} links checked, ${failures.length} failed`);
  process.exit(failures.length ? 1 : 0);
}
