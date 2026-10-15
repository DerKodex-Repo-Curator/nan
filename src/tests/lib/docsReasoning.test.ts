import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import spec from '../../data/openapi.json';

/**
 * THE REASONING CONTRACT, as published. Measured live 2026-10-15 on both
 * hosts and enforced by the proxy's reasoning-effort hook (nan-devops,
 * scripts/litellm-reasoning-effort-hook/): one parameter turns reasoning off
 * on every chat model, the other providers' switches are accepted as aliases,
 * and the one model that cannot stop reasoning (GLM) says so. A customer had
 * to guess before this, guessed DeepSeek's own `thinking` switch, and kept
 * reasoning on; these tests keep the reference from going back to "each model
 * is different, find out".
 */

const CHAT_MODELS = [
  'deepseek-v4-flash',
  'qwen3.8-flash',
  'mimo-v2.6-flash',
  'qwen3.6',
  'gemma4',
  'glm5.3',
  'glm5.3-flash',
];
const LEVELS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
const ALIASES = [
  '`thinking: {"type": "disabled"}`',
  '`reasoning: {"enabled": false}`',
  '`enable_thinking: false`',
  '`chat_template_kwargs: {"enable_thinking": false}`',
];

const here = dirname(fileURLToPath(import.meta.url));
const page = (locale: '' | '-es') =>
  readFileSync(resolve(here, `../../content/docs${locale}/models.mdx`), 'utf-8');

/** The "Controlling reasoning" section of a models page. */
const section = (locale: '' | '-es') => {
  const text = page(locale);
  const heading = locale === '' ? '## Controlling reasoning.' : '## Controlar el razonamiento.';
  const start = text.indexOf(heading);
  expect(start, `${heading} missing`).toBeGreaterThan(-1);
  const end = text.indexOf('\n## ', start + heading.length);
  return text.slice(start, end);
};

/** One model's row in that section's table. */
const row = (text: string, model: string) =>
  text.split('\n').find((l) => l.startsWith('|') && l.split('|')[1].includes(`\`${model}\``)) ?? '';

/** The feature line of a model card that talks about reasoning. */
const cardReasoning = (locale: '' | '-es', model: string) => {
  const text = page(locale);
  const start = text.indexOf(`name="${model}"`);
  expect(start, `card ${model} missing`).toBeGreaterThan(-1);
  const card = text.slice(start, text.indexOf('/>', start));
  return card.split('\n').filter((l) => /reasoning|razonamiento|Razonamiento/i.test(l) && l.trim().startsWith("'"));
};

const chatBody = (spec.paths as any)['/chat/completions'].post.requestBody.content['application/json'].schema.properties;
const respBody = (spec.paths as any)['/responses'].post.requestBody.content['application/json'].schema.properties;

describe('API reference: one documented way to turn reasoning off', () => {
  const desc: string = spec.info.description;
  const reasoning = desc.slice(desc.indexOf('## Reasoning'), desc.indexOf('\n## ', desc.indexOf('## Reasoning') + 3));

  it('has a Reasoning section in the overview', () => {
    expect(desc).toContain('\n## Reasoning\n');
  });

  it('names the one switch for both APIs', () => {
    expect(reasoning).toContain('"reasoning_effort": "none"');
    expect(reasoning).toContain('"reasoning": {"effort": "none"}');
    expect(reasoning).toMatch(/every chat model/);
  });

  it('lists the accepted aliases and says the explicit value wins', () => {
    for (const alias of ALIASES) expect(reasoning).toContain(alias);
    expect(reasoning).toContain('`extra_body`');
    expect(reasoning).toMatch(/value wins/);
  });

  it('says plainly that GLM cannot stop reasoning, and what none does there', () => {
    expect(reasoning).toMatch(/`glm5\.3` and `glm5\.3-flash` always reason/);
    expect(reasoning).toMatch(/`none` is applied as `minimal`/);
  });

  it('points at the per-model table', () => {
    expect(reasoning).toContain('https://nan.builders/docs/models#controlling-reasoning');
  });

  it('chat reasoning_effort: every level, and none turns it off', () => {
    expect(chatBody.reasoning_effort.enum).toEqual(LEVELS);
    expect(chatBody.reasoning_effort.description).toMatch(/`none` turns reasoning off/);
    // The old reference said the parameter had no effect on deepseek-v4-flash. It does.
    expect(chatBody.reasoning_effort.description).not.toMatch(/no effect/);
    expect(JSON.stringify(spec)).not.toMatch(/accepted and has no effect/);
  });

  it('chat_template_kwargs is documented as an alias, not as the way', () => {
    expect(chatBody.chat_template_kwargs.description).toMatch(/alias/i);
    expect(chatBody.chat_template_kwargs.description).toContain('reasoning_effort');
  });

  it('responses documents reasoning.effort with the same levels', () => {
    expect(respBody.reasoning).toBeDefined();
    expect(respBody.reasoning.properties.effort.enum).toEqual(LEVELS);
    expect(respBody.reasoning.description).toMatch(/`none` turns reasoning off/);
  });
});

describe('models page: the per-model table is the contract (en + es)', () => {
  for (const locale of ['', '-es'] as const) {
    const text = section(locale);

    it(`${locale || 'en'}: has a row for every chat model`, () => {
      for (const model of CHAT_MODELS) expect(row(text, model), model).not.toBe('');
    });

    it(`${locale || 'en'}: names both switches and every alias`, () => {
      expect(text).toContain('`reasoning_effort`');
      expect(text).toContain('`reasoning: {"effort": ...}`');
      for (const alias of ALIASES) expect(text).toContain(alias);
      for (const level of LEVELS) expect(text).toContain(`\`${level}\``);
    });

    it(`${locale || 'en'}: none is off everywhere except GLM, which says it cannot`, () => {
      const off = locale === '' ? /\| Off/ : /\| Apagado/;
      for (const model of ['deepseek-v4-flash', 'qwen3.8-flash', 'mimo-v2.6-flash', 'qwen3.6']) {
        expect(row(text, model), model).toMatch(off);
      }
      const glm = row(text, 'glm5.3');
      expect(glm).toContain('`minimal`');
      expect(glm).toMatch(locale === '' ? /always reasons/ : /siempre razona/);
    });

    it(`${locale || 'en'}: documents the remaps and the Responses limit on vLLM`, () => {
      expect(row(text, 'mimo-v2.6-flash')).toMatch(/`minimal`.*`low`.*`xhigh`.*`max`/);
      expect(row(text, 'qwen3.6')).toContain('32,768'.replace(',', locale === '' ? ',' : '.'));
      expect(row(text, 'qwen3.6')).toMatch(/Responses/);
    });

    it(`${locale || 'en'}: no row claims the parameter does nothing`, () => {
      expect(text).not.toMatch(/no effect|sin efecto|not adjustable|no ajustable/);
    });

    it(`${locale || 'en'}: shows how to turn it off`, () => {
      expect(text).toContain('"reasoning_effort": "none"');
      expect(text).toContain('reasoning={"effort": "none"}');
    });
  }
});

describe('model cards agree with the table (en + es)', () => {
  for (const locale of ['', '-es'] as const) {
    it(`${locale || 'en'}: every chat card says how reasoning is controlled`, () => {
      for (const model of CHAT_MODELS) {
        const lines = cardReasoning(locale, model);
        expect(lines.length, model).toBeGreaterThan(0);
        const joined = lines.join(' ');
        expect(joined, model).toContain('reasoning_effort');
        if (model.startsWith('glm')) expect(joined, model).toMatch(/always reasons|siempre razona/);
        else expect(joined, model).toContain('`none`');
      }
    });
  }
});
