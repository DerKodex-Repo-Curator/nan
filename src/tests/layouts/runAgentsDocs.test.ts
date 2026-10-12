import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import openapi from '../../data/openapi.json';
import { validate } from '../helpers/openapiValidate';

/**
 * The run agents across the guides: Pi, Pi + Gentle Shell and Hermes.
 *
 * Facts from cloud-api #345 (0.8.258), cloud-ui #158 and nan-cli #47 (0.1.29):
 * - three agent values, `pi`, `pi_gentle`, `hermes` (protocol.Agents), shown
 *   as "Pi", "Pi + Gentle Shell" and "Hermes" (runs.AgentName, cloud-ui
 *   agentName), in that display order (software.RunAgentIDs);
 * - `pi_gentle` needs Pi and gentle-shell; runs and automations only accept
 *   an agent the workspace has installed, otherwise `409 agent_not_installed`
 *   with `param: "agent"` (CLI exit 4);
 * - the workspace object lists them in `run_agents`;
 * - `nan run --agent pi_gentle` needs nan-cli 0.1.29.
 *
 * EN and ES must say the same: same table rows, same values, same anchors.
 */
const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, '../..');
const read = (p: string) => readFileSync(resolve(src, p), 'utf-8');
const strip = (raw: string) => raw.replace(/^---[\s\S]*?\n---\n/, '');

const AGENTS: Array<[label: string, value: string]> = [
  ['Pi', 'pi'],
  ['Pi + Gentle Shell', 'pi_gentle'],
  ['Hermes', 'hermes'],
];

const pages = {
  en: { dir: 'content/docs/', prefix: '', heading: '## Pick the agent', anchor: '#pick-the-agent' },
  es: { dir: 'content/docs-es/', prefix: '/es', heading: '## Elige el agente', anchor: '#elige-el-agente' },
} as const;

/** The rows of the first markdown table after `heading`, as trimmed cells. */
function tableAfter(body: string, heading: string): string[][] {
  const start = body.indexOf(`\n${heading}\n`);
  expect(start, heading).toBeGreaterThan(-1);
  const rest = body.slice(start + heading.length + 2);
  const lines = rest.split('\n');
  const first = lines.findIndex((l) => l.startsWith('|'));
  const rows: string[][] = [];
  for (const line of lines.slice(first)) {
    if (!line.startsWith('|')) break;
    rows.push(line.replace(/\\\|/g, '\u0000').split('|').slice(1, -1).map((c) => c.trim().replace(/\u0000/g, '|')));
  }
  return rows.slice(2); // header + separator
}

/** The section that starts at `heading`, up to the next `## `. */
function section(body: string, heading: string): string {
  const start = body.indexOf(`\n${heading}\n`);
  const end = body.indexOf('\n## ', start + heading.length + 2);
  return body.slice(start, end === -1 ? undefined : end);
}

describe.each(Object.entries(pages))('run agents in the guides (%s)', (locale, page) => {
  const runs = strip(read(page.dir + 'runs.mdx'));
  const flat = runs.replace(/\s+/g, ' ');
  const runsLink = `(${page.prefix}/docs/runs${page.anchor})`;

  test('Pick the agent: one row per agent, with its portal label and value, in display order', () => {
    const rows = tableAfter(runs, page.heading);
    expect(rows.map((r) => [r[0], r[1]])).toEqual(AGENTS.map(([label, value]) => [`**${label}**`, `\`${value}\``]));
    // pi_gentle needs both programs; Pi alone is not enough.
    expect(rows[1][2]).toMatch(/^Pi (and|y) gentle-shell\./);
  });

  test('Pick the agent sits right after Before you start', () => {
    const headings = [...runs.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    expect(headings.indexOf(page.heading.slice(3))).toBe(1);
  });

  test('explains the installed-only rule: portal list, 409 with param agent, CLI exit 4, automations', () => {
    const sec = section(runs, page.heading).replace(/\s+/g, ' ');
    expect(sec).toContain('`409 agent_not_installed`');
    expect(sec).toContain('`agent`');
    expect(sec).toMatch(/`nan run` (exits with code|sale con código) 4/);
    expect(sec).toContain('`run_agents`');
    expect(sec).toContain(`(${page.prefix}/docs/api#tag/workspaces)`);
  });

  test('the intro, the prerequisites and the form name all three agents and link the section', () => {
    expect(flat).toMatch(/\(Pi, Pi \+ Gentle Shell (or|o) Hermes, (among the ones installed in that workspace|entre los que tengas instalados en ese workspace)\)/);
    expect(flat).not.toMatch(/Pi (or|o) Hermes/);
    const formRow = runs.split('\n').find((l) => l.startsWith('| **Agent** |'))!;
    for (const [label] of AGENTS) expect(formRow).toContain(`**${label}**`);
    expect(formRow).toContain(`](${page.anchor})`);
  });

  test('the CLI documents --agent pi|pi_gentle|hermes, its version and a pi_gentle example', () => {
    const flagRow = runs.split('\n').find((l) => l.startsWith('| `--agent'))!;
    expect(flagRow).toContain('`--agent pi\\|pi_gentle\\|hermes`');
    for (const [label, value] of AGENTS) expect(flagRow).toContain(`\`${value}\` (${label})`);
    expect(runs).toContain('**0.1.29**');
    expect(runs).toMatch(/^nan run --ws develop --agent pi_gentle "/m);
  });

  test('the API 409 example is a valid error envelope and matches the reference', () => {
    const block = /```json\n(\{\n {2}"error"[\s\S]*?\n\})\n```/.exec(runs);
    expect(block).not.toBeNull();
    const err = JSON.parse(block![1]);
    const spec = openapi as any;
    const r409 = spec.paths['/runs'].post.responses['409'].content['application/json'];
    expect(validate(err, r409.schema)).toEqual([]);
    expect(err).toEqual(r409.examples.agent_not_installed.value);
    expect(flat).toMatch(/`agent` (is|es) `pi`, `pi_gentle` (or|o) `hermes`/);
  });

  test('automations: prerequisites and the Agent row', () => {
    const auto = strip(read(page.dir + 'automations.mdx'));
    expect(auto).toContain(runsLink);
    expect(auto).not.toMatch(/Pi (or|o) Hermes/);
    const row = auto.split('\n').find((l) => l.startsWith('| **Agent** |'))!;
    for (const [label] of AGENTS) expect(row).toContain(`**${label}**`);
    expect(row).toContain('**(not installed)**');
    expect(row).toContain('`agent_not_installed`');
    expect(row).toContain(runsLink);
  });

  test('PR gatekeeper: the prerequisite names the installed agent and links Pick the agent', () => {
    const pg = strip(read(page.dir + 'pr-gatekeeper.mdx'));
    const line = pg.split('\n').find((l) => l.includes('Pi + Gentle Shell'))!;
    expect(line).toBeDefined();
    expect(line).toContain(runsLink);
    expect(line).toMatch(/(The example uses Pi|El ejemplo usa Pi)\.$/);
    expect(pg).not.toMatch(/Pi (or|o) Hermes/);
  });

  test('workspaces: the run sentence names the three agents and gentle-shell links to Pick the agent', () => {
    const ws = strip(read(page.dir + 'workspaces.mdx'));
    const gentle = ws.split('\n').find((l) => l.startsWith('gentle-shell '))!;
    expect(gentle).toContain('**Pi + Gentle Shell**');
    expect(gentle).toContain(runsLink);
    expect(ws).toMatch(/\(Pi, Pi \+ Gentle Shell (or|o) Hermes\)/);
    expect(ws).not.toMatch(/Pi (or|o) (a )?Hermes/);
  });

  test('no em-dashes in what this change touched', () => {
    for (const f of ['runs.mdx', 'automations.mdx', 'pr-gatekeeper.mdx', 'workspaces.mdx']) {
      const body = strip(read(page.dir + f));
      for (const line of body.split('\n').filter((l) => /pi_gentle|Pi \+ Gentle Shell|agent_not_installed/.test(l))) {
        expect(line, `${locale} ${f}`).not.toContain('—');
      }
    }
  });
});

describe('run agents: EN and ES say the same', () => {
  const en = strip(read(pages.en.dir + 'runs.mdx'));
  const es = strip(read(pages.es.dir + 'runs.mdx'));

  test('same agent table labels and values', () => {
    const cols = (rows: string[][]) => rows.map((r) => [r[0], r[1]]);
    expect(cols(tableAfter(es, pages.es.heading))).toEqual(cols(tableAfter(en, pages.en.heading)));
  });

  test('same --agent flag cell and the same 409 example', () => {
    const flag = (b: string) => b.split('\n').find((l) => l.startsWith('| `--agent'))!.split('|')[1];
    expect(flag(es)).toBe(flag(en));
    const err = (b: string) => /```json\n(\{\n {2}"error"[\s\S]*?\n\})\n```/.exec(b)![1];
    expect(err(es)).toBe(err(en));
  });
});
