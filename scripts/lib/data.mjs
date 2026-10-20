// Loading of registries and entries, and helpers shared by build, validate and refresh.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { parse } from 'yaml';

export const SCHEMA_LINE = '# yaml-language-server: $schema=../schema/entry.schema.json';

/** Key order used when entry files are written by scripts. */
export const KEY_ORDER = [
  'name', 'url', 'description', 'type', 'category', 'subcategory', 'added',
  'repo_url', 'docs_url', 'tags', 'agent_types', 'license', 'license_note', 'hosting', 'languages',
  'otlp', 'conventions', 'otel_evidence', 'telemetry', 'telemetry_docs',
  'body', 'version', 'evidence_url', 'upstream_issue', 'versions', 'status', 'fixed_in', 'chains',
  'also_in', 'vendor_affiliation', 'historical', 'mature',
  'stars', 'archived', 'pushed_at', 'last_release', 'last_checked',
];

export function readYaml(path) {
  return parse(readFileSync(path, 'utf8'));
}

/** Loads registries and entries below `root`. Entries carry their file slug in `_slug`. */
export function load(root) {
  const registry = (name) => {
    const p = join(root, 'registry', name);
    return existsSync(p) ? (readYaml(p) ?? []) : [];
  };
  const categories = registry('categories.yml');
  const tags = registry('tags.yml');
  const licenses = registry('licenses.yml');
  const agentTypes = registry('agent-types.yml');
  const linkExclude = registry('link-check-exclude.yml');
  const dir = join(root, 'entries');
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.yml')).sort() : [];
  const entries = files.map((f) => ({ ...readYaml(join(dir, f)), _slug: basename(f, '.yml'), _file: `entries/${f}` }));
  return { root, categories, tags, licenses, agentTypes, linkExclude, entries };
}

/** File slug for an entry name: lowercase ASCII, words joined by hyphens. */
export function slugify(name) {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\+/g, ' plus ')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** GitHub heading anchor for a heading text (the subset of github-slugger rules used by our titles). */
export function anchor(title) {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

/** The one comparator for entry order: case-insensitive name, then slug. */
export function compareEntries(a, b) {
  const an = a.name.toLowerCase();
  const bn = b.name.toLowerCase();
  if (an < bn) return -1;
  if (an > bn) return 1;
  return a._slug < b._slug ? -1 : a._slug > b._slug ? 1 : 0;
}

export function licenseKind(data, id) {
  return data.licenses.find((l) => l.id === id)?.kind;
}

/** Tags computed from fields; never set by hand. */
export function derivedTags(data, e) {
  const out = [];
  if (Array.isArray(e.otlp) && e.otlp.length) out.push('otlp');
  if (Array.isArray(e.conventions)) out.push(...e.conventions);
  if (e.license && licenseKind(data, e.license) === 'osi') out.push('oss');
  if (e.hosting === 'self-hosted' || e.hosting === 'both') out.push('self-hosted');
  if (e.hosting === 'saas' || e.hosting === 'both') out.push('saas');
  for (const l of e.languages ?? []) if (['python', 'typescript', 'go', 'java', 'dotnet'].includes(l)) out.push(l);
  return out;
}

export function allTags(data, e) {
  return [...new Set([...(e.tags ?? []), ...derivedTags(data, e)])].sort();
}

/** True when the entry belongs in the collapsed Archived and historical section. */
export function isHistorical(e) {
  return e.archived === true || typeof e.historical === 'string';
}

/** Normalized form of a URL for duplicate detection. */
export function normalizeUrl(u) {
  const bare = u.replace(/^https?:\/\/(www\.)?/, '').replace(/#.*$/, '');
  // A YouTube video is identified by its `v` query parameter, so that one is kept.
  const video = /^youtube\.com\/watch\?(?:.*&)?v=([\w-]+)/i.exec(bare);
  if (video) return `youtube.com/watch?v=${video[1]}`;
  return bare.toLowerCase().replace(/\?.*$/, '').replace(/\/+$/, '');
}

/** owner/repo for a github.com repository URL, or null. */
export function githubRepo(u) {
  const m = u?.match(/^https:\/\/github\.com\/([^/]+)\/([^/#?]+)\/?$/);
  return m ? `${m[1]}/${m[2]}` : null;
}

/** The GitHub repository of an entry: repo_url first, then url (only when it is a repository root). */
export function entryRepo(e) {
  return githubRepo(e.repo_url) ?? githubRepo(e.url);
}
