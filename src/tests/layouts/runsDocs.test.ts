import { describe, expect, test } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parseFrontmatter } from '@astrojs/markdown-remark';
import { mdxToText } from '../../lib/mdxToText';

/**
 * The Agent runs guide: what members read before they start their first run,
 * from the portal, `nan run` or the API. It opens together with Agent
 * Automations (Phase 2).
 *
 * The facts pinned here come from the Phase 1 spec
 * (devops AGENT-AUTOMATIONS-PHASE1.md: §2.1.3 API, §2.1.4 admission, §2.2.6
 * worktrees, §2.4 CLI) and the production E2E of 2026-10-10: per-size
 * concurrency, the per-member cap shared with inference, the queue limits, the
 * CLI exit codes, and the two kinds of credentials (API keys vs `nan_pat_`
 * tokens).
 */
const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, '../..');
const read = (p: string) => readFileSync(resolve(src, p), 'utf-8');

const pages = {
  en: { dir: 'content/docs/', prefix: '', group: 'Guides', title: 'Agent runs' },
  es: { dir: 'content/docs-es/', prefix: '/es', group: 'Guías', title: 'Runs de agentes' },
} as const;

/** Workspace size -> runs at once. */
const CONCURRENCY: [string, number][] = [
  ['Micro', 1],
  ['Nano', 2],
  ['Basic', 3],
  ['Medium', 5],
  ['Large', 8],
];

const EXIT_CODES = ['0', '1', '2', '3', '4', '64', '65', '69', '75'];

const INTERNAL = /firecracker|micro-?vms?\b|\bvm\b|\bkvm\b|kubernetes|\bk8s\b|\br2\b|nan-vmd|systemd|litellm|cgroup/i;

const pub = resolve(src, '../public');
/** The portal captures, in the order the guide shows them. */
const SHOTS = ['runs-01-tab', 'runs-02-new-run', 'runs-03-run-page'];
/** Things that must never be published: full run or workspace ids (UUIDs) and private addresses. */
const PRIVATE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}|\b10\.\d{1,3}\.\d{1,3}\.\d{1,3}\b|\bws-[0-9a-f]{8}\b/i;

interface Shot {
  src: string;
  alt: string;
  caption: string;
  width: number;
  height: number;
}

/** Every <Screenshot .../> of a page, in order. */
function screenshots(body: string): Shot[] {
  return [...body.matchAll(/<Screenshot\s([^>]*?)\/>/g)].map((m) => {
    const attr = (name: string) => new RegExp(`${name}="([^"]*)"`).exec(m[1])?.[1] ?? '';
    const num = (name: string) => Number(new RegExp(`${name}=\\{(\\d+)\\}`).exec(m[1])?.[1]);
    return { src: attr('src'), alt: attr('alt'), caption: attr('caption'), width: num('width'), height: num('height') };
  });
}

/** Pixel size of a WebP (lossy VP8, lossless VP8L or extended VP8X). */
function webpSize(file: string): { width: number; height: number } {
  const b = readFileSync(file);
  expect(b.toString('ascii', 0, 4)).toBe('RIFF');
  expect(b.toString('ascii', 8, 12)).toBe('WEBP');
  const chunk = b.toString('ascii', 12, 16);
  if (chunk === 'VP8 ') return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
  if (chunk === 'VP8L') {
    const bits = b.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  return { width: b.readUIntLE(24, 3) + 1, height: b.readUIntLE(27, 3) + 1 };
}

const strip = (raw: string) => raw.replace(/^---[\s\S]*?\n---\n/, '');

/**
 * Heading ids as the site renders them. Astro slugs headings with
 * github-slugger: lowercase, punctuation dropped, accents kept, spaces to
 * hyphens. The build output was checked against this for both pages.
 */
const slug = (h: string) =>
  h
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/ /g, '-');

function headingIds(body: string): Set<string> {
  const ids = new Set<string>();
  let inFence = false;
  for (const line of body.split('\n')) {
    if (line.startsWith('```')) inFence = !inFence;
    const m = !inFence && /^#{1,6}\s+(.*)$/.exec(line);
    if (m) ids.add(slug(m[1]));
  }
  return ids;
}

describe.each(Object.entries(pages))('agent runs guide (%s)', (locale, page) => {
  const raw = read(page.dir + 'runs.mdx');
  const fm = parseFrontmatter(raw).frontmatter as { order?: number; group?: string; title?: string };
  const body = strip(raw);
  const flat = body.replace(/\s+/g, ' ');

  test('sits in the guides group, right after Workspaces', () => {
    expect(fm.title).toBe(page.title);
    expect(fm.group).toBe(page.group);
    const ws = parseFrontmatter(read(page.dir + 'workspaces.mdx')).frontmatter as { order: number };
    expect(fm.order).toBe(ws.order + 1);
  });

  test('names both agents and the three ways in', () => {
    expect(flat).toContain('Pi');
    expect(flat).toContain('Hermes');
    expect(body).toContain('**Runs**');
    expect(body).toContain('**New run**');
    expect(body).toContain('nan run');
    expect(body).toContain('https://api.nan.builders/v1/runs');
  });

  test('uses the labels the portal shows', () => {
    for (const label of ['Agent runs', 'New run', 'Agent', 'Task', 'Folder', 'Separate branch', 'Auto', 'On', 'Off', 'Time limit', 'Start run', 'Cancel run', 'Output', 'Tool call', 'Tool result']) {
      expect(body, label).toContain(`**${label}**`);
    }
    // The old names of the form fields are gone from the portal copy.
    expect(body).not.toMatch(/\| (Prompt|Working directory|Worktree|Timeout) \|/);
  });

  test('maps the portal labels to the CLI flags and the API fields', () => {
    expect(flat).toMatch(/\*\*Agent\*\* (is|es) `--agent`, \*\*Folder\*\* (is|es) `--cwd`, \*\*Separate branch\*\* (is|es) `--worktree` \/ `--no-worktree` (and|y) \*\*Time limit\*\* (is|es) `--timeout`/);
    expect(flat).toMatch(/\*\*Agent\*\* (is|es) `agent`, \*\*Task\*\* (is|es) `prompt`, \*\*Folder\*\* (is|es) `cwd`, \*\*Separate branch\*\* (is|es) `git_isolation` (and|y) \*\*Time limit\*\* (is|es) `timeout_seconds`/);
  });

  test('describes the portal form with its limits', () => {
    expect(flat).toContain('32 KiB');
    expect(body).toContain('`/home/nan`');
    expect(flat).toMatch(/15, 30, 60 (or|o) 120/);
    for (const tab of ['Overview', 'Console', 'SSH keys', 'Events', 'Backups']) expect(body).toContain(`**${tab}**`);
  });

  test('explains the worktree rules: branch name, never pushes, no-change branch deleted', () => {
    expect(body).toContain('`nan-run/6f1c2a9b`');
    expect(flat).toMatch(/8 (characters|primeros caracteres)/);
    expect(flat).toMatch(/\*\*(never pushes|nunca hace push)\*\*/);
    expect(flat).toMatch(/(the branch is deleted|la rama se borra)/);
    expect(flat).toMatch(/(fails with a configuration error|falla con un error de configuración)/);
  });

  test('lists every run state', () => {
    for (const s of ['queued', 'starting', 'running', 'succeeded', 'failed', 'cancelled', 'timed_out']) {
      expect(body).toContain(`\`${s}\``);
    }
    expect(flat).toMatch(/60 (seconds|segundos)/);
    expect(flat).toMatch(/2 (hours|horas)/);
  });

  test('publishes the concurrency per size and the per-member caps', () => {
    for (const [size, n] of CONCURRENCY) {
      expect(body, size).toMatch(new RegExp(`^\\| ${size}\\b[^|]*\\| ${n} \\|$`, 'm'));
    }
    expect(flat).toMatch(/\*\*5 runs/);
    expect(flat).toMatch(/\*\*8 (on|con) Premium\*\*/);
    expect(flat).toMatch(/\*\*20 runs (per|por) workspace\*\*/);
    expect(flat).toMatch(/\*\*50 (in total|en total)\*\*/);
    expect(flat).toMatch(/\*\*60 runs (per hour|por hora)\*\*/);
  });

  test('says runs need inference, count as usage and mask secrets', () => {
    expect(body).toContain('tier_restricted');
    expect(body).toContain('`***`');
  });

  test('documents the CLI: version, flags, Ctrl-C and every exit code', () => {
    expect(body).toContain('0.1.24');
    expect(body).toContain('curl -fsSL https://nan.builders/install | bash');
    expect(body).toContain('nan auth login');
    for (const flag of ['--ws', '--agent', '--model', '--cwd', '--worktree', '--no-worktree', '--timeout', '--detach', '--json', '--idempotency-key', '-f']) {
      expect(body, flag).toContain(`\`${flag}`);
    }
    for (const cmd of ['nan runs ls', 'nan runs show', 'nan runs logs <id> -f', 'nan runs cancel', 'nan runs logs <id> --json']) {
      expect(body, cmd).toContain(cmd);
    }
    for (const code of EXIT_CODES) expect(body, code).toMatch(new RegExp(`^\\| ${code} \\|`, 'm'));
    expect(flat).toMatch(/2 (seconds|segundos)/);
  });

  test('documents the API with working curl examples: create, follow, cancel', () => {
    expect(body).toContain('-H "Idempotency-Key:');
    expect(body).toContain('curl -N https://api.nan.builders/v1/runs/$RUN_ID/events');
    expect(body).toContain('-H "Accept: text/event-stream"');
    expect(body).toContain('curl -X POST https://api.nan.builders/v1/runs/$RUN_ID/cancel');
    // One table, rows back to back: a paragraph between two rows splits it and
    // turns the rest into loose text with pipes.
    const rows = ['workspace', 'agent', 'prompt', 'cwd', 'git_isolation', 'timeout_seconds', 'model'];
    const table = rows.map((f) => `\\| \`${f}\` \\|[^\\n]*`).join('\\n');
    expect(body).toMatch(new RegExp(table));
    for (const frame of ['event: run_event', 'event: state', 'event: end']) expect(body).toContain(frame);
    expect(body).toContain('Last-Event-ID');
    expect(body).toContain('next_cursor');
    expect(body).toContain('"error": {"message"');
    for (const code of ['400 invalid_request', '404', '409 idempotency_conflict', '429 run_queue_full', '429 rate_limited']) expect(body, code).toContain(`| \`${code}\` |`);
  });

  test('the create example is valid JSON with the documented fields', () => {
    const json = /-d '(\{[\s\S]*?\})'/.exec(body)![1];
    const req = JSON.parse(json);
    expect(Object.keys(req).sort()).toEqual(['agent', 'cwd', 'git_isolation', 'prompt', 'timeout_seconds', 'workspace']);
    expect(req.timeout_seconds).toBeGreaterThanOrEqual(60);
    expect(req.timeout_seconds).toBeLessThanOrEqual(7200);
  });

  test('explains API keys vs tokens', () => {
    expect(body).toContain('`nan_pat_...`');
    expect(body).toContain('**Settings → Tokens**');
    expect(flat).toMatch(/\*\*(No, never|No, nunca)\*\*/);
    expect(flat).toMatch(/\*\*10\*\*/);
    expect(flat).toMatch(/\*\*30, 90 (or|o) 365/);
    expect(body).toContain('workspace_key_not_allowed');
    expect(flat).toMatch(/(spend your plan|gastan tu plan)/);
  });

  test('never shows a real-looking secret', () => {
    expect(body).not.toMatch(/sk-[A-Za-z0-9]{8,}/);
    expect(body).not.toMatch(/nan_pat_[A-Za-z0-9]{4,}/);
  });

  test('keeps infrastructure words out of member copy', () => {
    expect(body).not.toMatch(INTERNAL);
  });

  test('in-page anchors point at headings that exist', () => {
    const ids = headingIds(body);
    const anchors = [...body.matchAll(/\]\(#([^)]+)\)/g)].map((m) => m[1]);
    expect(anchors.length).toBeGreaterThan(0);
    for (const a of anchors) expect(ids.has(a), a).toBe(true);
  });

  test('links only to docs pages that exist in the same locale', () => {
    const slugs = [...body.matchAll(new RegExp(`\\(${page.prefix}/docs/([\\w-]+)\\)`, 'g'))].map((m) => m[1]);
    expect(slugs).toEqual(expect.arrayContaining(['workspaces', 'nan-cli']));
    for (const slug of slugs) {
      expect(existsSync(resolve(src, page.dir, `${slug}.md`)) || existsSync(resolve(src, page.dir, `${slug}.mdx`)), slug).toBe(true);
    }
  });

  test('shows the three portal captures, in order, and no placeholder is left', () => {
    expect(screenshots(body).map((s) => s.src)).toEqual(SHOTS.map((n) => `/docs/runs/${n}.webp`));
    expect(body).not.toContain('SCREENSHOT');
  });

  test.each(SHOTS)('screenshot %s: file exists, size matches, alt and caption present', (name) => {
    const shot = screenshots(body).find((s) => s.src === `/docs/runs/${name}.webp`)!;
    const file = resolve(pub, `docs/runs/${name}.webp`);
    expect(existsSync(file)).toBe(true);
    expect(webpSize(file)).toEqual({ width: shot.width, height: shot.height });
    expect(shot.alt.length).toBeGreaterThan(30);
    expect(shot.caption.length).toBeGreaterThan(5);
    expect(`${shot.src} ${shot.alt} ${shot.caption}`).not.toMatch(PRIVATE);
    expect(`${shot.alt} ${shot.caption}`).not.toMatch(INTERNAL);
  });

  test('is served by /api/docs without errors, and the placeholders are not', async () => {
    const text = await mdxToText(body);
    expect(text).toContain(page.title);
    expect(text).toContain('/docs/runs/runs-01-tab.webp');
  });

  test('no em-dashes in the copy', () => {
    expect(body).not.toContain('—');
  });

  test('Workspaces, the CLI guide and the introduction link to it', () => {
    const link = `(${page.prefix}/docs/runs)`;
    for (const f of ['workspaces.mdx', 'nan-cli.mdx', 'intro.md']) expect(read(page.dir + f), f).toContain(link);
  });
});

describe('agent runs guide, both locales', () => {
  test('the Spanish page is a translation with the same structure', () => {
    const [en, es] = [pages.en, pages.es].map((p) => strip(read(p.dir + 'runs.mdx')));
    const shape = (b: string) => (b.match(/^#{1,3} /gm) ?? []).join('');
    expect(shape(es)).toEqual(shape(en));
    expect(es).not.toEqual(en);
    const count = (b: string, re: RegExp) => (b.match(re) ?? []).length;
    expect(count(es, /```bash/g)).toBe(count(en, /```bash/g));
    expect(count(es, /<Details /g)).toBe(count(en, /<Details /g));
  });

  test('both locales show the same pictures with translated alt text', () => {
    const [en, es] = [pages.en, pages.es].map((p) => screenshots(strip(read(p.dir + 'runs.mdx'))));
    expect(es.map((s) => s.src)).toEqual(en.map((s) => s.src));
    en.forEach((shot, i) => expect(es[i].alt).not.toBe(shot.alt));
  });

  test('only the published screenshots live in the folder (no raw captures)', () => {
    expect(readdirSync(resolve(pub, 'docs/runs')).sort()).toEqual(SHOTS.map((n) => `${n}.webp`).sort());
  });
});
