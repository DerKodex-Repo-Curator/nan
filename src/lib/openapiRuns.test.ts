import { describe, expect, it } from 'vitest';
import spec from '../data/openapi.json';
import { resolveSpec } from './apiDoc';
import { DEFAULT_RATE_LIMITS } from './rateLimits';
import { openapiToText } from './openapiToText';

/**
 * The Runs and Workspaces surface of the API reference.
 *
 * Shapes come from cloud-api origin/main: internal/runs/api.go (limits,
 * states, error codes), internal/runs/protocol (event kinds and their data),
 * internal/handlers/runs.go + runs_sse.go (routes, bodies, statuses, SSE
 * frames), internal/handlers/workspace.go + internal/workspace/models.go
 * (the workspace view) and the platform-token middleware
 * (internal/middleware/auth.go, handlers.PlatformTokenAPIRoutes).
 *
 * There is no OpenAPI validator among the dependencies, so the examples are
 * checked against their schemas with the small validator below: enough of
 * JSON Schema for what this spec uses ($ref, type, enum, required,
 * properties, additionalProperties: false, items, oneOf, allOf, pattern,
 * minimum/maximum, minLength).
 */

type Schema = Record<string, any>;
const s = spec as any;

function deref(schema: Schema): Schema {
  if (schema && typeof schema.$ref === 'string') {
    const target = schema.$ref
      .replace(/^#\//, '')
      .split('/')
      .reduce((node: any, part: string) => node?.[part], s);
    expect(target, schema.$ref).toBeDefined();
    return deref(target);
  }
  return schema;
}

function typeOf(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
}

/** Errors of `value` against `schema`, as `path: reason` strings. */
function validate(value: unknown, schema: Schema, path = '$'): string[] {
  const sc = deref(schema);
  const errors: string[] = [];
  if (sc.oneOf) {
    const ok = sc.oneOf.filter((alt: Schema) => validate(value, alt, path).length === 0).length;
    if (ok !== 1) errors.push(`${path}: matches ${ok} of oneOf`);
    return errors;
  }
  if (sc.allOf) {
    // Merge the parts into one object schema, so one part's fields are not
    // "unknown" to the other.
    const parts = sc.allOf.map(deref);
    const merged = {
      type: 'object',
      required: parts.flatMap((p: Schema) => p.required ?? []),
      properties: Object.assign({}, ...parts.map((p: Schema) => p.properties ?? {})),
    };
    return validate(value, merged, path);
  }
  if (sc.type) {
    const types = Array.isArray(sc.type) ? sc.type : [sc.type];
    const t = typeOf(value);
    if (!types.includes(t) && !(t === 'integer' && types.includes('number'))) {
      return [`${path}: ${t} is not ${types.join('|')}`];
    }
  }
  if (sc.enum && !sc.enum.includes(value)) errors.push(`${path}: ${JSON.stringify(value)} not in enum`);
  if (typeof value === 'string') {
    if (sc.pattern && !new RegExp(sc.pattern).test(value)) errors.push(`${path}: does not match ${sc.pattern}`);
    if (sc.minLength !== undefined && value.length < sc.minLength) errors.push(`${path}: too short`);
    if (sc.maxLength !== undefined && value.length > sc.maxLength) errors.push(`${path}: too long`);
  }
  if (typeof value === 'number') {
    if (sc.minimum !== undefined && value < sc.minimum) errors.push(`${path}: below minimum`);
    if (sc.maximum !== undefined && value > sc.maximum) errors.push(`${path}: above maximum`);
  }
  if (typeOf(value) === 'object') {
    const obj = value as Record<string, unknown>;
    for (const key of sc.required ?? []) if (!(key in obj)) errors.push(`${path}: missing ${key}`);
    for (const [key, v] of Object.entries(obj)) {
      const prop = sc.properties?.[key];
      if (prop) errors.push(...validate(v, prop, `${path}.${key}`));
      else if (sc.properties && sc.additionalProperties !== true) errors.push(`${path}: unknown property ${key}`);
    }
  }
  if (Array.isArray(value) && sc.items) value.forEach((v, i) => errors.push(...validate(v, sc.items, `${path}[${i}]`)));
  return errors;
}

const RUN_OPS: Array<[string, string, string]> = [
  ['/runs', 'post', 'createRun'],
  ['/runs', 'get', 'listRuns'],
  ['/runs/{id}', 'get', 'getRun'],
  ['/runs/{id}/events', 'get', 'getRunEvents'],
  ['/runs/{id}/cancel', 'post', 'cancelRun'],
];
const WS_OPS: Array<[string, string, string]> = [
  ['/api/workspaces', 'get', 'listWorkspaces'],
  ['/api/workspaces/{id}', 'get', 'getWorkspace'],
];
const op = (path: string, method: string) => s.paths[path][method];

describe('openapi.json: Runs and Workspaces tags', () => {
  it('declares both tags with a link to their guide', () => {
    const tags = Object.fromEntries(s.tags.map((t: any) => [t.name, t.description]));
    expect(tags.Runs).toContain('https://nan.builders/docs/runs');
    expect(tags.Workspaces).toContain('https://nan.builders/docs/workspaces');
  });

  it.each([...RUN_OPS.map((o) => [...o, 'Runs']), ...WS_OPS.map((o) => [...o, 'Workspaces'])])(
    '%s %s (%s) is tagged %s',
    (path, method, id, tag) => {
      expect(op(path, method).operationId).toBe(id);
      expect(op(path, method).tags).toEqual([tag]);
    },
  );
});

describe('openapi.json: credentials', () => {
  const schemes = s.components.securitySchemes;

  it('documents the API key and the platform token as two bearer schemes', () => {
    expect(schemes.apiKey).toMatchObject({ type: 'http', scheme: 'bearer' });
    expect(schemes.apiKey.description).toContain('`sk-...`');
    expect(schemes.platformToken).toMatchObject({ type: 'http', scheme: 'bearer', bearerFormat: 'nan_pat_...' });
    expect(schemes.platformToken.description).toMatch(/never works for inference/);
    expect(schemes.platformToken.description).toContain('token_scope_denied');
  });

  it('inference operations take the API key only (the global default)', () => {
    expect(s.security).toEqual([{ apiKey: [] }]);
    for (const [path, item] of Object.entries(s.paths) as Array<[string, any]>) {
      if (path.startsWith('/runs') || path.startsWith('/api/')) continue;
      for (const method of ['get', 'post']) if (item[method]) expect(item[method].security, path).toBeUndefined();
    }
  });

  it.each(RUN_OPS)('%s %s accepts an API key or a platform token', (path, method) => {
    expect(op(path, method).security).toEqual([{ apiKey: [] }, { platformToken: [] }]);
    expect(op(path, method).description).toContain('a member API key (`sk-...`) or a platform token (`nan_pat_...`)');
  });

  it('the workspace list accepts both, one workspace by id only a platform token', () => {
    expect(op('/api/workspaces', 'get').security).toEqual([{ apiKey: [] }, { platformToken: [] }]);
    expect(op('/api/workspaces/{id}', 'get').security).toEqual([{ platformToken: [] }]);
    expect(op('/api/workspaces/{id}', 'get').description).toMatch(/API keys \(`sk-\.\.\.`\) are not accepted/);
  });

  it('the overview explains platform tokens', () => {
    expect(s.info.description).toContain('### Platform tokens');
    expect(s.info.description).toMatch(/never works for inference/);
  });
});

describe('openapi.json: the Runs contract (cloud-api)', () => {
  const body = s.components.schemas.CreateRunRequest;

  it('POST /runs body: fields, limits and defaults', () => {
    expect(body.required).toEqual(['workspace', 'agent', 'prompt']);
    expect(body.additionalProperties).toBe(false);
    expect(Object.keys(body.properties)).toEqual([
      'workspace', 'agent', 'prompt', 'cwd', 'git_isolation', 'timeout_seconds', 'model', 'trigger',
    ]);
    expect(body.properties.agent.enum).toEqual(['pi', 'hermes']);
    expect(body.properties.prompt.description).toContain('32768 bytes');
    expect(body.properties.cwd.default).toBe('/home/nan');
    expect(body.properties.git_isolation.type).toEqual(['boolean', 'null']);
    expect(body.properties.timeout_seconds).toMatchObject({ minimum: 60, maximum: 7200, default: 1800 });
    expect(body.properties.trigger).toMatchObject({ enum: ['api', 'cli', 'ui'], default: 'api' });
    expect(body.properties.model.pattern).toBe('^[A-Za-z0-9._:/-]{1,128}$');
  });

  it('POST /runs: Idempotency-Key, 201/200 and every documented error code', () => {
    const create = op('/runs', 'post');
    const idem = create.parameters.find((p: any) => p.name === 'Idempotency-Key');
    expect(idem).toMatchObject({ in: 'header', required: false });
    expect(idem.schema.pattern).toBe('^[A-Za-z0-9._:-]{1,128}$');
    expect(Object.keys(create.responses).sort()).toEqual(['200', '201', '400', '401', '403', '404', '409', '429']);
    const text = JSON.stringify(create.responses);
    for (const code of [
      'tier_restricted', 'workspace_key_not_allowed', 'workspace_not_running', 'agent_not_installed',
      'no_inference_key', 'idempotency_conflict', 'run_queue_full', 'rate_limited',
    ]) {
      expect(text, code).toContain(code);
    }
    expect(create.description).toMatch(/20 queued runs per workspace and 50 in total/);
    expect(create.description).toMatch(/60 new runs per rolling hour/);
  });

  it('GET /runs: filters and the list object', () => {
    const params = Object.fromEntries(op('/runs', 'get').parameters.map((p: any) => [p.name, p]));
    expect(Object.keys(params)).toEqual(['workspace', 'state', 'limit', 'cursor']);
    expect(params.limit.schema).toMatchObject({ minimum: 1, maximum: 100, default: 20 });
    expect(params.state.schema.enum).toEqual(['queued', 'starting', 'running', 'succeeded', 'failed', 'cancelled', 'timed_out']);
    expect(Object.keys(s.components.schemas.RunList.properties)).toEqual(['object', 'data', 'next_cursor']);
  });

  it('the Run object has the fields the handler renders, in its order', () => {
    expect(Object.keys(s.components.schemas.Run.properties)).toEqual([
      'id', 'object', 'workspace', 'agent', 'model', 'trigger', 'state', 'queue_position', 'prompt_preview',
      'prompt', 'cwd', 'git_isolation', 'timeout_seconds', 'cancel_requested', 'exit_code', 'error_code',
      'result', 'usage', 'last_seq', 'created_at', 'started_at', 'finished_at',
    ]);
    expect(Object.keys(s.components.schemas.RunResult.properties)).toEqual([
      'status', 'summary', 'branch', 'commit', 'changed_files', 'artifacts',
    ]);
  });

  it('events: the ten event kinds, the message chunks and the page shape', () => {
    const event = s.components.schemas.RunEvent;
    expect(Object.keys(event.properties)).toEqual(['seq', 'ts', 'type', 'data']);
    expect(event.properties.type.enum).toEqual([
      'started', 'log', 'message', 'tool_call', 'tool_result', 'usage', 'artifact', 'error', 'truncated', 'finished',
    ]);
    expect(event.properties.data.oneOf).toHaveLength(10);
    expect(s.components.schemas.RunEventDataMessage.description).toMatch(/incrementally.*`final: true`/s);
    expect(Object.keys(s.components.schemas.RunEventPage.properties)).toEqual(['data', 'next_after', 'done']);
  });

  it('events: SSE frames, heartbeat, resume, lifetime and stream cap', () => {
    const events = op('/runs/{id}/events', 'get');
    for (const needle of ['event: run_event', 'event: state', 'event: end', '`: hb`', '15 seconds', 'Last-Event-ID', '30 minutes', '10 open streams']) {
      expect(events.description, needle).toContain(needle);
    }
    expect(Object.keys(events.responses['200'].content)).toEqual(['text/event-stream', 'application/json']);
    const params = Object.fromEntries(events.parameters.map((p: any) => [p.name, p]));
    expect(params.limit.schema).toMatchObject({ minimum: 1, maximum: 1000, default: 500 });
    expect(params['Last-Event-ID'].in).toBe('header');
    expect(JSON.stringify(events.responses['429'])).toContain('too_many_streams');
    const sse = events.responses['200'].content['text/event-stream'].example as string;
    expect(sse).toMatch(/^id: 1\nevent: run_event\ndata: \{/);
    expect(sse).toContain(': hb\n\n');
  });

  it('cancel: 202 accepted, 200 when the run had already ended', () => {
    expect(Object.keys(op('/runs/{id}/cancel', 'post').responses).sort()).toEqual(['200', '202', '401', '403', '404']);
  });
});

describe('openapi.json: the Workspaces contract (cloud-api)', () => {
  it('both routes live on api.nan.builders, outside /v1, and nothing else under /api', () => {
    const apiPaths = Object.keys(s.paths).filter((p) => p.startsWith('/api/'));
    expect(apiPaths).toEqual(['/api/workspaces', '/api/workspaces/{id}']);
    for (const p of apiPaths) {
      expect(s.paths[p].servers).toEqual([expect.objectContaining({ url: 'https://api.nan.builders' })]);
      expect(Object.keys(s.paths[p]).filter((k) => k !== 'servers')).toEqual(['get']);
    }
    expect(JSON.stringify(s)).not.toContain('cloud-api.nan.builders');
  });

  it('only the caller\'s own workspaces, and never a secret', () => {
    expect(op('/api/workspaces', 'get').description).toMatch(/Your own workspaces, and only yours/);
    expect(op('/api/workspaces/{id}', 'get').description).toMatch(/Only your own workspaces are returned/);
    const props = Object.keys(s.components.schemas.Workspace.properties);
    for (const secret of ['agent_configs', 'hermes_env', 'member_uuid', 'api_key', 'token']) {
      expect(props).not.toContain(secret);
    }
    expect(s.components.schemas.WorkspaceDetail.allOf[1].properties.env_var_keys.description).toMatch(/Never the values/);
  });
});

describe('openapi.json: every Runs and Workspaces example matches its schema', () => {
  const cases: Array<[string, unknown, Schema]> = [];
  for (const [path, method] of [...RUN_OPS, ...WS_OPS]) {
    const o = op(path, method);
    const req = o.requestBody?.content?.['application/json'];
    if (req?.example) cases.push([`${method} ${path} request`, req.example, req.schema]);
    for (const [status, r] of Object.entries(o.responses) as Array<[string, any]>) {
      const json = r.content?.['application/json'];
      if (!json) continue;
      if (json.example !== undefined) cases.push([`${method} ${path} ${status}`, json.example, json.schema]);
      for (const [name, ex] of Object.entries(json.examples ?? {}) as Array<[string, any]>) {
        cases.push([`${method} ${path} ${status} ${name}`, ex.value, json.schema]);
      }
    }
  }
  cases.push(['RunEvent example', s.components.schemas.RunEvent.example, s.components.schemas.RunEvent]);

  it('finds the examples to check', () => {
    expect(cases.length).toBeGreaterThan(20);
  });

  it.each(cases)('%s', (_name, example, schema) => {
    expect(validate(example, schema)).toEqual([]);
  });

  it('the SSE example frames carry valid events', () => {
    const sse = op('/runs/{id}/events', 'get').responses['200'].content['text/event-stream'].example as string;
    const frames = sse.split('\n\n').filter((f) => f.includes('event: run_event'));
    expect(frames.length).toBeGreaterThan(0);
    for (const frame of frames) {
      const data = JSON.parse(/^data: (.*)$/m.exec(frame)![1]);
      expect(validate(data, { $ref: '#/components/schemas/RunEvent' })).toEqual([]);
      expect(frame).toContain(`id: ${data.seq}\n`);
    }
  });

  it('the validator itself rejects a wrong example', () => {
    expect(validate({ workspace: 'w', agent: 'codex', prompt: 'x' }, s.components.schemas.CreateRunRequest)).not.toEqual([]);
    expect(validate({ workspace: 'w', agent: 'pi', prompt: 'x', extra: 1 }, s.components.schemas.CreateRunRequest)).not.toEqual([]);
    expect(validate({ timeout_seconds: 30 }, s.components.schemas.CreateRunRequest)).not.toEqual([]);
  });
});

describe('the text the docs API serves for the reference', () => {
  it('includes the Runs and Workspaces operations', () => {
    const text = openapiToText(resolveSpec(DEFAULT_RATE_LIMITS));
    for (const heading of [
      '### POST /runs: Create a run',
      '### GET /runs/{id}/events: Follow a run',
      '### POST /runs/{id}/cancel: Cancel a run',
      '### GET /api/workspaces: List workspaces',
      '### GET /api/workspaces/{id}: Retrieve a workspace',
    ]) {
      expect(text, heading).toContain(heading);
    }
  });

  it('no em-dashes in what this PR adds', () => {
    const added = JSON.stringify([
      s.tags.filter((t: any) => ['Runs', 'Workspaces'].includes(t.name)),
      ...[...RUN_OPS, ...WS_OPS].map(([p, m]) => op(p, m)),
      s.components.securitySchemes,
      Object.entries(s.components.schemas).filter(([k]) => /^(Run|Workspace|CreateRun|PlatformError)/.test(k)),
    ]);
    expect(added).not.toContain('—');
  });
});
