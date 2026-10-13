import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import spec from '../data/openapi.json';
import { validate, type Schema } from '../tests/helpers/openapiValidate';

/**
 * BYOK (bring your own key) in the API reference: Agent Automations Phase 3
 * (devops AGENT-AUTOMATIONS-PHASE3-BYOK.md §2, cloud-api #347, 0.8.260).
 *
 * The fixtures in src/tests/fixtures/phase3 are rendered by cloud-api
 * origin/main's own handlers (renderRun, renderAutomation) at 4c69270: every
 * one must validate against the schema this reference publishes.
 */

const s = spec as any;
const op = (path: string, method: string) => s.paths[path][method];
const ref = (name: string): Schema => ({ $ref: `#/components/schemas/${name}` });
const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) =>
  JSON.parse(readFileSync(resolve(here, '../tests/fixtures/phase3', `${name}.json`), 'utf-8'));
const GUIDE = 'https://nan.builders/docs/runs#use-your-own-provider-key-byok';
const PROVIDERS = ['openai_compatible', 'anthropic', 'openai', 'gemini'];

describe('openapi.json: BYOK inference', () => {
  it('the rendered inference object: source, provider, secret, model', () => {
    const inf = s.components.schemas.RunInference;
    expect(inf.additionalProperties).toBe(false);
    expect(inf.properties.source.enum).toEqual(['nan', 'byok']);
    expect(inf.properties.provider.enum).toEqual(PROVIDERS);
    expect(inf.properties.secret.pattern).toBe('^[A-Z][A-Z0-9_]{0,63}$');
    expect(inf.description).toContain(GUIDE);
    expect(s.components.schemas.Run.properties.inference).toEqual(ref('RunInference'));
    expect(s.components.schemas.Automation.properties.inference).toEqual(ref('RunInference'));
  });

  it('the request: {"source":"nan"} or {"source":"byok","secret","model"}, nothing else', () => {
    const body = s.components.schemas.CreateRunRequest.properties.inference;
    expect(body).toEqual(ref('CreateRunInference'));
    const req = ref('CreateRunInference');
    const ok = [
      { source: 'nan' },
      { source: 'byok', secret: 'TOGETHER_KEY', model: 'meta-llama/Llama-3.3-70B-Instruct' },
    ];
    const bad = [
      {},
      { source: 'own' },
      { source: 'nan', secret: 'K' },
      { source: 'byok', model: 'm' },
      { source: 'byok', secret: 'K' },
      { source: 'byok', secret: 'lower', model: 'm' },
      { source: 'byok', secret: 'K', model: 'm', provider: 'openai' },
    ];
    for (const v of ok) expect(validate(v, req), JSON.stringify(v)).toEqual([]);
    for (const v of bad) expect(validate(v, req).length, JSON.stringify(v)).toBeGreaterThan(0);
    const desc = s.components.schemas.CreateRunInference.description;
    expect(desc).toContain('`403 session_required`');
    expect(desc).toContain('portal-only');
    expect(s.components.schemas.CreateRunRequest.properties.model.description).toContain('inference.model');
  });

  it('usage.source can be byok', () => {
    const src = s.components.schemas.Run.properties.usage.properties.source;
    expect(src.enum).toEqual(['litellm', 'agent', 'byok', null]);
    expect(src.description).toMatch(/nothing is charged against your NaN plan/);
  });

  it('POST /runs documents who may use it and every BYOK error', () => {
    const create = op('/runs', 'post');
    expect(create.description).toMatch(/an active workspace of yours is enough/);
    expect(create.description).toMatch(/Up to 8 runs on your own keys/);
    expect(create.description).toContain(GUIDE);
    const r = create.responses;
    expect(r['400'].description).toContain('`inference.secret`');
    expect(r['400'].description).toContain('`inference.model`');
    const ex400 = r['400'].content['application/json'].examples;
    expect(ex400.not_a_provider_key.value.error.param).toBe('inference.secret');
    expect(ex400.byok_unavailable.value.error.param).toBe('inference');
    const ex403 = r['403'].content['application/json'].examples.session_required.value.error;
    expect(ex403).toMatchObject({ code: 'session_required', param: 'inference', type: 'permission_error' });
    expect(r['404'].content['application/json'].examples.secret.value.error).toMatchObject({
      code: 'not_found',
      param: 'inference.secret',
    });
    const req = create.requestBody.content['application/json'].examples;
    expect(req.byok.value.inference.source).toBe('byok');
    expect(req.byok.value.model).toBeUndefined();
  });

  it('running an automation on your key: any credential, untrusted input', () => {
    const run = op('/automations/{id}/runs', 'post');
    expect(run.description).toMatch(/needs an active workspace of yours instead/);
    expect(run.description).toMatch(/untrusted/);
    expect(run.responses['403'].description).toMatch(/own key/);
  });

  it('secrets stay out of the public API (they are written in the portal only)', () => {
    expect(Object.keys(s.paths).filter((p) => p.includes('secret'))).toEqual([]);
  });

  it('every request and response example of POST /runs matches its schema', () => {
    const create = op('/runs', 'post');
    const req = create.requestBody.content['application/json'];
    for (const [name, ex] of Object.entries(req.examples) as Array<[string, any]>) {
      expect(validate(ex.value, req.schema), `request ${name}`).toEqual([]);
    }
    for (const [status, r] of Object.entries(create.responses) as Array<[string, any]>) {
      const json = r.content?.['application/json'];
      for (const [name, ex] of Object.entries(json?.examples ?? {}) as Array<[string, any]>) {
        expect(validate(ex.value, json.schema), `${status} ${name}`).toEqual([]);
      }
    }
  });

  it.each([
    ['run_get_byok', 'Run'],
    ['run_list_byok', 'RunList'],
    ['automation_get_byok', 'Automation'],
  ])('cloud-api golden %s validates against %s', (name, schema) => {
    expect(validate(fixture(name), ref(schema))).toEqual([]);
  });

  it('the goldens carry the BYOK shape', () => {
    const run = fixture('run_get_byok');
    expect(run.inference).toEqual({ source: 'byok', provider: 'anthropic', secret: 'ANTHROPIC_KEY', model: 'claude-sonnet-4-5' });
    expect(run.model).toBe(run.inference.model);
    expect(run.usage.source).toBe('byok');
    expect(fixture('run_list_byok').data[1].inference).toEqual({ source: 'nan' });
    expect(fixture('automation_get_byok').inference.provider).toBe('openai_compatible');
  });
});

describe('docs: the BYOK guide exists where the reference links it', () => {
  const doc = (lang: string, name: string) =>
    readFileSync(resolve(here, `../content/${lang}/${name}.mdx`), 'utf-8');

  it.each(['docs', 'docs-es'])('%s: runs and automations have the BYOK section', (lang) => {
    expect(doc(lang, 'runs')).toMatch(/^## .*\(BYOK\)$/m);
    expect(doc(lang, 'automations')).toMatch(/^## .*\(BYOK\)$/m);
  });

  it('the English heading gives the anchor the reference and the CLI link', () => {
    expect(doc('docs', 'runs')).toMatch(/^## Use your own provider key \(BYOK\)$/m);
  });

  it.each(['docs', 'docs-es'])('%s: the guide covers the contract', (lang) => {
    const runs = doc(lang, 'runs');
    for (const term of ['provider_key', 'openai_compatible', '--byok-secret', 'session_required', '"source": "byok"', 'https', '8']) {
      expect(runs, term).toContain(term);
    }
    expect(runs).not.toMatch(/—/);
    expect(doc(lang, 'automations')).not.toMatch(/—/);
  });
});
