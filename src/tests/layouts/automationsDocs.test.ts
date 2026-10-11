import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parseFrontmatter } from '@astrojs/markdown-remark';
import { mdxToText } from '../../lib/mdxToText';
import openapi from '../../data/openapi.json';

/**
 * The Automations and the Webhooks and schedules guides (Agent Automations
 * Phase 2), and what the other guides say about them.
 *
 * The facts pinned here come from cloud-api origin/main (automations/api.go
 * limits and outcomes, templates.go, validate.go, webhook/verify.go,
 * middleware/pat_scopes.go), cloud-ui origin/main (the labels the portal
 * shows: lib/automations.ts, lib/approvals.ts, components/automations/*,
 * components/SecretsSection.tsx) and nan-cli 0.1.26 (PR helmcode/nan-cli#43:
 * commands, exit code 10, portal-only verbs).
 */
const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, '../..');
const read = (p: string) => readFileSync(resolve(src, p), 'utf-8');
const strip = (raw: string) => raw.replace(/^---[\s\S]*?\n---\n/, '');

const pages = {
  en: { dir: 'content/docs/', prefix: '', group: 'Guides', titles: ['Automations', 'Webhooks and schedules'], tokensAnchor: 'tokens-for-automations' },
  es: { dir: 'content/docs-es/', prefix: '/es', group: 'Guías', titles: ['Automatizaciones', 'Webhooks y programaciones'], tokensAnchor: 'tokens-para-automatizaciones' },
} as const;

/** Heading ids as the site renders them (github-slugger, as in runsDocs.test.ts). */
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
    if (m) ids.add(slug(m[1].replace(/`/g, '')));
  }
  return ids;
}

const INTERNAL = /firecracker|micro-?vms?\b|\bvm\b|\bkvm\b|kubernetes|\bk8s\b|\br2\b|nan-vmd|systemd|litellm|cgroup|\bvault\b|transit|dynamicuser/i;

/** cloud-ui lib/approvals.ts ACTION_KIND_LABELS. */
const ACTION_LABELS: Record<string, string> = {
  git_push: 'Push commits',
  github_create_pr: 'Open pull requests',
  github_pr_comment: 'Comment on pull requests',
  github_pr_review: 'Review pull requests',
  github_issue_comment: 'Comment on issues',
  github_add_labels: 'Add labels',
};

/** cloud-ui lib/automations.ts DELIVERY_OUTCOMES (persisted outcomes only). */
const DELIVERY_LABELS = [
  'Run started',
  'Ignored by a filter',
  'Stopped: caused by one of its own runs',
  'Skipped: a run for the same subject is active',
  'Not accepted: your membership does not include runs',
  'Too large',
];

/** cloud-ui lib/automations.ts SCHEDULE_OUTCOMES (without the generic Error). */
const SCHEDULE_LABELS = [
  'Run started',
  'Skipped: the previous run was still active',
  'Not accepted: your membership does not include runs',
  'Missed (more than 15 minutes late)',
  'Skipped: hourly limit reached',
  'Skipped: too many runs waiting',
  'Skipped: automation disabled',
  'Skipped: workspace deleted',
];

describe.each(Object.entries(pages))('automations guides (%s)', (_locale, page) => {
  const auto = read(page.dir + 'automations.mdx');
  const hooks = read(page.dir + 'webhooks.mdx');
  const autoBody = strip(auto);
  const hooksBody = strip(hooks);
  const autoFlat = autoBody.replace(/\s+/g, ' ');
  const hooksFlat = hooksBody.replace(/\s+/g, ' ');

  test('sit in the guides group, right after Agent runs', () => {
    const runs = parseFrontmatter(read(page.dir + 'runs.mdx')).frontmatter as { order: number };
    const a = parseFrontmatter(auto).frontmatter as { order: number; group: string; title: string };
    const h = parseFrontmatter(hooks).frontmatter as { order: number; group: string; title: string };
    expect([a.title, h.title]).toEqual(page.titles);
    expect(a.group).toBe(page.group);
    expect(h.group).toBe(page.group);
    expect(a.order).toBe(runs.order + 1);
    expect(h.order).toBe(runs.order + 2);
    for (const later of ['examples.md', 'apps.md']) {
      const o = (parseFrontmatter(read(page.dir + later)).frontmatter as { order: number }).order;
      expect(o, later).toBeGreaterThan(h.order);
    }
  });

  test('render through the docs text extractor', () => {
    expect(() => mdxToText(autoBody)).not.toThrow();
    expect(() => mdxToText(hooksBody)).not.toThrow();
  });

  test('every link to a docs page and anchor resolves, in the same locale', () => {
    const own = { automations: autoBody, webhooks: hooksBody } as Record<string, string>;
    const pageBody = (name: string) => own[name] ?? strip(read(`${page.dir}${name}.mdx`));
    for (const [name, body] of Object.entries(own)) {
      const links = [...body.matchAll(/\]\(((?:\/es)?\/docs\/[\w-]+)?(#[^)\s]+)?\)/g)];
      expect(links.length, name).toBeGreaterThan(5);
      for (const m of links) {
        const [, target, anchor] = m;
        if (!target && !anchor) continue;
        if (target) {
          if (target.endsWith('/api')) continue; // the API reference: checked against its tags below.
          expect(target.startsWith(`${page.prefix}/docs/`), `${name}: ${target} in the wrong locale`).toBe(true);
        }
        if (!anchor) continue;
        const targetName = target ? target.split('/').pop()! : name;
        expect(headingIds(pageBody(targetName)).has(decodeURIComponent(anchor.slice(1))), `${name}: ${target ?? ''}${anchor}`).toBe(true);
      }
    }
  });

  test('links into the API reference point at tags that exist', () => {
    const tags = new Set((openapi.tags as Array<{ name: string }>).map((t) => `tag/${t.name.toLowerCase()}`));
    for (const body of [autoBody, hooksBody]) {
      for (const m of body.matchAll(/\/docs\/api#(tag\/[\w-]+)/g)) expect(tags.has(m[1]), m[1]).toBe(true);
    }
  });

  test('templates, fields and the labels the portal shows', () => {
    for (const label of ['Pull request review', 'Issue triage', 'CI failure', 'Generic webhook', 'From scratch', 'New automation', 'Create automation', 'Run now', 'Needs approval', 'Review', 'Approve and apply', 'Reject', 'Open run', 'Changes to push']) {
      expect(autoBody, label).toContain(`**${label}**`);
    }
    for (const field of ['Name', 'Instructions', 'Workspace', 'Agent', 'Folder', 'Separate branch', 'Time limit (minutes)', 'GitHub repository (optional)', 'Secrets', 'Approval', 'Runs per hour', 'When a run is active', 'Chain depth', 'Enabled']) {
      expect(autoBody, field).toContain(`**${field}**`);
    }
    for (const preset of ['Approve everything', 'Fully automatic', 'Custom', 'Skip the new event', 'Queue it', 'Agent (read access)', 'Actions only (write access)']) {
      expect(autoBody, preset).toContain(`**${preset}**`);
    }
    for (const [kind, label] of Object.entries(ACTION_LABELS)) {
      expect(autoBody, kind).toContain(`\`${kind}\``);
      expect(autoBody, label).toContain(`**${label}**`);
    }
  });

  test('approval is the member\'s choice, empty = fully automatic, with the TTL options', () => {
    expect(autoBody).toContain('**1 hour**');
    expect(autoBody).toContain('**72 hours**');
    expect(autoBody).toContain('**7 days**');
    expect(autoBody).toContain('`awaiting_approval`');
    for (const code of ['approval_rejected', 'approval_expired', 'proposal_invalid', 'action_failed']) expect(autoBody, code).toContain(`\`${code}\``);
    expect(autoBody).toContain('`nan runs reject <id>`');
  });

  test('secrets: write-only, exposures, reserved names and budgets', () => {
    for (const fact of ['16 KiB', '48 KiB', '100', '20', '`GITHUB_TOKEN`', '`OPENAI_API_KEY`', '`NAN_`', '`PI_`', '`HERMES_`', '`secrets_unavailable`']) {
      expect(autoFlat, fact).toContain(fact);
    }
    expect(autoBody).toContain('**Add secret**');
    expect(autoBody).toContain('**Replace value**');
  });

  test('the limits of cloud-api (automations/api.go)', () => {
    const limits = autoBody;
    for (const row of [/\| (Automations|Automatizaciones) \| 50 /, /\| Triggers \| 5 /, /\| (Schedules|Programaciones) \| 10 /, /30 [^|]*120/, /120 [^|]*(hour|hora)/]) {
      expect(limits, String(row)).toMatch(row);
    }
    expect(autoFlat).toMatch(/5 [^.]*\(8 (on|con) Premium\)/);
  });

  test('the CLI: 0.1.26 commands, exit code 10, portal-only writes', () => {
    for (const cmd of ['nan automations ls', 'nan automations show', 'nan automations run', 'nan automations deliveries', 'nan approvals ls', 'nan runs proposal', 'nan runs reject', 'nan secrets ls']) {
      expect(autoBody, cmd).toContain(cmd);
    }
    expect(autoBody).toContain('**0.1.26**');
    expect(autoFlat).toMatch(/\*\*10\*\*/);
    expect(autoBody).not.toMatch(/nan (runs approve|secrets set|automations create)/);
  });

  test('tokens: the four scopes and what needs the browser', () => {
    for (const scope of ['runs', 'workspaces:read', 'automations:read', 'automations:run']) expect(autoBody, scope).toContain(`| \`${scope}\` |`);
    expect(autoBody).toContain('`403 token_scope_denied`');
    expect(autoBody).toContain('https://api.nan.builders/v1/automations/$AUTOMATION_ID/runs');
  });

  test('webhooks: URL, senders, every NaN header and the GitHub setup', () => {
    expect(hooksBody).toContain('`https://api.nan.builders/hooks/nan_whk_...`');
    for (const sender of ['GitHub', 'Stripe', 'NaN (HMAC)']) expect(hooksBody, sender).toContain(`**${sender}**`);
    for (const h of ['X-Nan-Timestamp', 'X-Nan-Signature', 'X-Nan-Delivery', 'X-Nan-Event', 'X-Nan-Run-Id', 'X-Hub-Signature-256', 'X-GitHub-Delivery', 'Stripe-Signature']) {
      expect(hooksBody, h).toContain(`\`${h}\``);
    }
    expect(hooksBody).toContain('`application/json`');
    expect(hooksBody).toContain('`415`');
    expect(hooksFlat).toMatch(/5 (minutes|minutos)/);
    expect(hooksFlat).toMatch(/24 (hours|horas)/);
    expect(hooksFlat).toContain('1 MiB');
    expect(hooksBody).toContain("**I've saved them**");
  });

  test('webhooks: the answers to the sender match cloud-api (DeliveryOutcome.HTTPStatus)', () => {
    for (const status of ['202', '200', '401', '404', '413', '415', '429', '503']) expect(hooksBody, status).toContain(`| \`${status}\` |`);
    for (const outcome of ['run_created', 'ignored', 'duplicate', 'loop_suppressed', 'skipped_active', 'not_accepted', 'too_large']) {
      expect(hooksBody, outcome).toContain(`"${outcome}"`);
    }
  });

  test('webhooks and schedules: the delivery and schedule outcomes the portal shows', () => {
    for (const label of DELIVERY_LABELS) expect(hooksBody, label).toContain(`**${label}**`);
    for (const label of SCHEDULE_LABELS) expect(hooksBody, label).toContain(`**${label}**`);
    expect(hooksFlat).toMatch(/30 (days|días)/);
  });

  test('event filters: the four fields of EventFilter', () => {
    for (const field of ['events', 'actions', 'exclude_drafts', 'conclusions']) expect(hooksBody, field).toContain(`| \`${field}\` |`);
    expect(hooksBody).toContain('"ready_for_review"');
  });

  test('schedules: cron, shortcuts, 15 minutes, 10 per member, no catch-up', () => {
    expect(hooksBody).toContain('`0 9 * * 1-5`');
    for (const d of ['@hourly', '@daily', '@weekly', '@monthly', '@yearly']) expect(hooksBody, d).toContain(`\`${d}\``);
    expect(hooksBody).not.toContain('@every');
    expect(hooksFlat).toMatch(/15 (minutes|minutos)/);
    expect(hooksFlat).toMatch(/10 /);
    for (const f of ['scheduled_for', 'cron', 'timezone']) expect(hooksBody, f).toContain(`\`${f}\``);
  });

  test('the bash, Python and Node.js signing examples sign `<timestamp>.<body>` with HMAC-SHA256', () => {
    expect(hooksBody).toMatch(/printf '%s\.%s' "\$TS" "\$BODY" \| openssl dgst -sha256 -hmac "\$SECRET"/);
    expect(hooksBody).toContain('hmac.new(secret, ts.encode() + b"." + body, hashlib.sha256).hexdigest()');
    expect(hooksBody).toContain("createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex')");
    // The scheme itself: what cloud-api's verifyNaN recomputes.
    const sig = createHmac('sha256', 'secret').update('1760000000.{"a":1}').digest('hex');
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });

  test('never discloses internals, never uses em-dashes', () => {
    for (const body of [autoBody, hooksBody]) {
      expect(body).not.toMatch(INTERNAL);
      expect(body).not.toContain('—');
    }
  });

  test('never publishes ids or private addresses', () => {
    for (const body of [autoBody, hooksBody]) {
      expect(body).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}|\b10\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/i);
      expect(body).not.toMatch(/nan_whk_[A-Za-z0-9_-]{8,}/);
    }
  });

  test('ephemeral executors and BYOK are not documented', () => {
    for (const body of [autoBody, hooksBody]) expect(body).not.toMatch(/ephemeral|ef[ií]mer|byok|bring your own key/i);
  });
});

describe('automations guides, both locales', () => {
  test.each(['automations.mdx', 'webhooks.mdx'])('%s: the Spanish page is a translation with the same structure', (file) => {
    const [en, es] = [pages.en, pages.es].map((p) => strip(read(p.dir + file)));
    const shape = (b: string) => (b.match(/^#{1,3} /gm) ?? []).join('');
    expect(shape(es)).toEqual(shape(en));
    expect(es).not.toEqual(en);
    const count = (b: string, re: RegExp) => (b.match(re) ?? []).length;
    for (const re of [/```/g, /<Details /g, /<Steps>/g, /<Callout /g, /^\|/gm]) expect(count(es, re), String(re)).toBe(count(en, re));
    const codeBlocks = (b: string) => [...b.matchAll(/```[\s\S]*?```/g)].map((m) => m[0].replace(/#.*$/gm, '').replace(/\/\/.*$/gm, ''));
    expect(codeBlocks(es)).toEqual(codeBlocks(en));
  });
});

describe.each(Object.entries(pages))('the other guides point at automations (%s)', (_locale, page) => {
  test('runs: the new state, events, exit code and token scopes', () => {
    const body = strip(read(page.dir + 'runs.mdx'));
    expect(body).toContain('| `awaiting_approval` |');
    expect(body).toContain('| `approval_required` |');
    expect(body).toContain('| `action` |');
    expect(body).toMatch(/^\| 10 \|/m);
    expect(body).toContain(`${page.prefix}/docs/automations#${page.tokensAnchor}`);
    expect(body).toContain('`nan automations`');
  });

  test('the CLI guide and the introduction link both guides', () => {
    expect(read(page.dir + 'nan-cli.mdx')).toContain('nan automations run');
    const intro = read(page.dir + 'intro.md');
    expect(intro).toContain(`(${page.prefix}/docs/automations)`);
    expect(intro).toContain(`(${page.prefix}/docs/webhooks)`);
  });
});

describe('member secrets are a portal feature, not part of the public API', () => {
  test('no page documents /api/account/secrets as an endpoint', () => {
    for (const dir of ['content/docs/', 'content/docs-es/']) {
      for (const f of ['automations.mdx', 'webhooks.mdx', 'runs.mdx', 'nan-cli.mdx']) {
        expect(read(dir + f), dir + f).not.toContain('/api/account/secrets');
      }
    }
  });
});
