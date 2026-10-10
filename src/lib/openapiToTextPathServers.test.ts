import { describe, expect, it } from 'vitest';
import rawSpec from '../data/openapi.json';
import { openapiToText } from './openapiToText';

// /api/workspaces lives on https://api.nan.builders, outside the spec-wide
// https://api.nan.builders/v1 base URL, through a path-level `servers`
// override. The text rendering served at /api/docs must not send agents to
// /v1/api/workspaces, a route that does not exist.
describe('openapiToText: path-level servers', () => {
  const text = openapiToText(rawSpec as Parameters<typeof openapiToText>[0]);

  it('prints the override for the workspace operations', () => {
    for (const path of ['/api/workspaces', '/api/workspaces/{id}']) {
      const start = text.indexOf(`### GET ${path}:`);
      expect(start).toBeGreaterThan(-1);
      const section = text.slice(start, text.indexOf('\n### ', start + 1) === -1 ? undefined : text.indexOf('\n### ', start + 1));
      expect(section).toContain('Base URL: `https://api.nan.builders`');
    }
  });

  it('does not print a per-operation base URL for operations on the default server', () => {
    const start = text.indexOf('### POST /runs:');
    expect(start).toBeGreaterThan(-1);
    const end = text.indexOf('\n### ', start + 1);
    expect(text.slice(start, end === -1 ? undefined : end)).not.toContain('Base URL:');
  });
});
