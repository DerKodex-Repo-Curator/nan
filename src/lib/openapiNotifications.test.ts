import { describe, expect, it } from 'vitest';
import spec from '../data/openapi.json';
import { openapiToText } from './openapiToText';
import { validate, type Schema } from '../tests/helpers/openapiValidate';

/**
 * Notification channels in the API reference (devops
 * AGENT-AUTOMATIONS-PHASE3-NOTIFICATIONS.md §2 and §4, cloud-api PR #349,
 * 0.8.262).
 *
 * Shapes come from cloud-api origin/main 48ea25e:
 * handlers/notification_channels.go (MountV1NotificationChannelsRoutes,
 * channelView, deliveryView, the request types, failStatus, the write
 * bucket), notifications/service.go (codes, messages, limits) and
 * middleware/pat_scopes.go (the route -> scope table).
 */

const s = spec as any;
const op = (path: string, method: string) => s.paths[path][method];
const ref = (name: string): Schema => ({ $ref: `#/components/schemas/${name}` });

/** Every notification operation, the scope it needs and whether it spends the write bucket. */
const OPS: Array<[string, string, string, string, 'read' | 'write' | 'test']> = [
  ['/notification-channels', 'get', 'listNotificationChannels', 'notifications:read', 'read'],
  ['/notification-channels', 'post', 'createNotificationChannel', 'notifications:write', 'write'],
  ['/notification-channels/{id}', 'get', 'getNotificationChannel', 'notifications:read', 'read'],
  ['/notification-channels/{id}', 'patch', 'updateNotificationChannel', 'notifications:write', 'write'],
  ['/notification-channels/{id}', 'delete', 'deleteNotificationChannel', 'notifications:write', 'write'],
  ['/notification-channels/{id}/deliveries', 'get', 'listNotificationDeliveries', 'notifications:read', 'read'],
  ['/notification-channels/{id}/subscriptions', 'put', 'replaceNotificationSubscriptions', 'notifications:write', 'write'],
  ['/notification-channels/{id}/test', 'post', 'testNotificationChannel', 'notifications:write', 'test'],
  ['/notification-channels/{id}/rotate-signing-secret', 'post', 'rotateNotificationSigningSecret', 'notifications:write', 'write'],
];

/** middleware/write_credential.go credentialNotAllowedMessage. */
const credentialNotAllowed = (scope: string) =>
  `This endpoint needs a browser session, a CLI session (nan auth login) or a platform token with the "${scope}" scope. API keys (sk-), workspace keys and sessions from older clients are not accepted here: sign in again with the CLI or at cloud.nan.builders.`;

/** channelView (handlers/notification_channels.go), in order. */
const CHANNEL_FIELDS = [
  'id', 'object', 'name', 'kind', 'url_hint', 'enabled', 'disabled_reason', 'consecutive_failures', 'last_delivery_at',
  'last_delivery_status', 'subscriptions', 'signing', 'updated_by', 'created_at', 'updated_at',
];
/** deliveryView, in order. */
const DELIVERY_FIELDS = ['id', 'object', 'event', 'items', 'run_id', 'automation_id', 'attempt', 'status', 'http_status', 'error', 'created_at'];
const EVENTS = ['approval.pending', 'run.finished', 'run.failed', 'automation.disabled', 'trigger.failing'];

/** Every example of an operation's responses and request bodies, with its schema. */
function examples(o: any): Array<[string, unknown, Schema]> {
  const out: Array<[string, unknown, Schema]> = [];
  const add = (where: string, content: any) => {
    const c = content?.['application/json'];
    if (!c) return;
    if (c.example !== undefined) out.push([where, c.example, c.schema]);
    for (const [k, v] of Object.entries(c.examples ?? {})) out.push([`${where}/${k}`, (v as any).value, c.schema]);
  };
  for (const [status, r] of Object.entries(o.responses)) add(status, (r as any).content);
  add('request', o.requestBody?.content);
  return out;
}

describe('openapi.json: the Notifications tag', () => {
  it('sits right after Secrets and explains who may use it', () => {
    const names = s.tags.map((t: any) => t.name);
    expect(names[names.indexOf('Secrets') + 1]).toBe('Notifications');
    const tag = s.tags.find((t: any) => t.name === 'Notifications').description as string;
    expect(tag).toContain('https://nan.builders/docs/notifications');
    for (const e of EVENTS) expect(tag).toContain(`\`${e}\``);
    expect(tag).toContain('`notifications:read`');
    expect(tag).toContain('`notifications:write`');
    expect(tag).toContain('`404`');
    expect(tag).toMatch(/never returned/);
  });

  it('every /notification-channels path is in OPS, and nothing else is tagged Notifications', () => {
    const tagged: string[] = [];
    for (const [path, item] of Object.entries(s.paths)) {
      for (const [method, o] of Object.entries(item as any)) if ((o as any).tags?.includes('Notifications')) tagged.push(`${method} ${path}`);
    }
    expect(tagged.sort()).toEqual(OPS.map(([p, m]) => `${m} ${p}`).sort());
  });

  it('never documents the portal mount', () => {
    expect(JSON.stringify(s)).not.toMatch(/api\/account\/notification-channels/);
  });
});

describe('openapi.json: the notification operations', () => {
  it.each(OPS)('%s %s (%s) names the %s scope and refuses API keys', (path, method, id, scope) => {
    const o = op(path, method);
    expect(o.operationId).toBe(id);
    expect(o.tags).toEqual(['Notifications']);
    expect(o.security).toEqual([{ cliSession: [] }, { platformToken: [] }]);
    expect(o.description).toContain(
      `a CLI session (\`nan auth login\`) or a platform token (\`nan_pat_...\`) with the \`${scope}\` scope`,
    );
    expect(o.description).toMatch(/API key \(`sk-\.\.\.`\)/);
  });

  it.each(OPS)('%s %s: 401, and 403 for a missing scope, an API key and a workspace key', (path, method, _id, scope) => {
    const r = op(path, method).responses;
    expect(r['401']).toEqual({ $ref: '#/components/responses/RunsUnauthorized' });
    const ex = r['403'].content['application/json'].examples;
    expect(ex.token_scope_denied.value.error).toEqual({
      message: `This platform token does not have the "${scope}" scope this endpoint requires. Create a token with that scope in the Tokens section of Settings at cloud.nan.builders.`,
      type: 'permission_error',
      param: null,
      code: 'token_scope_denied',
    });
    expect(ex.credential_not_allowed.value.error).toEqual({
      message: credentialNotAllowed(scope),
      type: 'permission_error',
      param: null,
      code: 'credential_not_allowed',
    });
    expect(ex.workspace_key_not_allowed.value.error).toEqual({
      message: 'workspace keys cannot manage runs',
      type: 'invalid_request_error',
      param: null,
      code: 'workspace_key_not_allowed',
    });
  });

  it.each(OPS)('%s %s: 404 when the feature is off (writeRunsNotFound)', (path, method) => {
    const r404 = op(path, method).responses['404'].content['application/json'].examples;
    expect(r404.unavailable.value.error).toEqual({ message: 'Not found.', type: 'invalid_request_error', param: null, code: 'not_found' });
    if (path.includes('{id}')) {
      expect(r404.not_found.value.error).toEqual({ message: 'notification channel not found', type: 'invalid_request_error', param: null, code: 'not_found' });
    }
  });

  it.each(OPS)('%s %s: 429 on writes (30 then 120/h) and tests (5 then 1/min), never on reads', (path, method, _id, _scope, kind) => {
    const r = op(path, method).responses;
    if (kind === 'read') {
      expect(r['429']).toBeUndefined();
      return;
    }
    const e = r['429'].content['application/json'].example.error;
    expect(e).toMatchObject({ type: 'rate_limit_exceeded', param: null, code: 'rate_limited' });
    if (kind === 'write') {
      expect(r['429'].description).toMatch(/30 at once, then 120 per hour/);
      expect(e.message).toBe('Too many notification channel changes recently. Try again later.');
    } else {
      expect(r['429'].description).toMatch(/5 at once, then 1 a minute/);
      expect(e.message).toBe('too many notification requests recently; try again later');
    }
  });

  it.each(OPS)('%s %s: every example validates against its schema', (path, method) => {
    for (const [where, value, schema] of examples(op(path, method))) {
      expect(validate(value, schema), `${method} ${path} ${where}`).toEqual([]);
    }
  });

  it.each(OPS)('%s %s: every 200/201 says Cache-Control no-store', (path, method) => {
    for (const [status, r] of Object.entries(op(path, method).responses)) {
      if (!/^2/.test(status)) continue;
      expect((r as any).headers?.['Cache-Control']?.schema?.const, status).toBe('no-store');
    }
  });
});

describe('openapi.json: the notification contract', () => {
  const sc = s.components.schemas;

  it('the channel object: the fields channelView renders, in order, never a URL or a secret', () => {
    expect(Object.keys(sc.NotificationChannel.properties)).toEqual(CHANNEL_FIELDS);
    expect(sc.NotificationChannel.required).toEqual(CHANNEL_FIELDS);
    expect(sc.NotificationChannel.properties.kind.enum).toEqual(['slack', 'teams', 'discord', 'https']);
    expect(sc.NotificationChannel.properties.disabled_reason.enum).toEqual(['member', 'failing', 'invalid_url', null]);
    expect(sc.NotificationChannel.properties.last_delivery_status.enum).toEqual(['delivered', 'failed', null]);
    expect(sc.NotificationChannel.properties.updated_by.enum).toEqual(['browser_session', 'cli_session', 'platform_token']);
    expect(sc.NotificationChannel.properties.subscriptions.maxItems).toBe(50);
    expect(sc.NotificationSubscription.properties.event.enum).toEqual(EVENTS);
    expect(JSON.stringify(sc.NotificationChannel)).not.toMatch(/"url":|signing_secret/);
  });

  it('create answers 201 with signing_secret once; rotate returns it with previous_expires_at', () => {
    const created = op('/notification-channels', 'post').responses['201'];
    expect(created.content['application/json'].schema).toEqual(ref('NotificationChannelCreated'));
    expect(Object.keys(sc.NotificationChannelCreated.properties)).toEqual([...CHANNEL_FIELDS, 'signing_secret']);
    expect(created.content['application/json'].example.signing_secret).toMatch(/^nan_nsec_/);
    const rot = op('/notification-channels/{id}/rotate-signing-secret', 'post').responses;
    expect(Object.keys(sc.NotificationSigningSecretRotated.properties)).toEqual(['signing_secret', 'previous_expires_at']);
    expect(rot['409'].content['application/json'].example.error).toMatchObject({ code: 'signing_not_supported', message: 'only https channels have a signing secret' });
    expect(op('/notification-channels/{id}/rotate-signing-secret', 'post').description).toMatch(/24 hours/);
  });

  it('requests: write-only URL, strict fields, defaults, at least one PATCH field, up to 50 subscriptions', () => {
    const c = sc.CreateNotificationChannelRequest;
    expect(c.required).toEqual(['name', 'kind', 'url']);
    expect(Object.keys(c.properties)).toEqual(['name', 'kind', 'url', 'events', 'automation_id']);
    expect(c.properties.url.writeOnly).toBe(true);
    expect(c.properties.url.maxLength).toBe(2048);
    expect(c.properties.name.maxLength).toBe(64);
    expect(c.properties.events.description).toContain('Default `approval.pending`, `run.failed`, `automation.disabled`, `trigger.failing`');
    expect(Object.keys(sc.UpdateNotificationChannelRequest.properties)).toEqual(['name', 'enabled', 'url']);
    expect(sc.UpdateNotificationChannelRequest.minProperties).toBe(1);
    expect(sc.ReplaceNotificationSubscriptionsRequest.required).toEqual(['subscriptions']);
    expect(sc.ReplaceNotificationSubscriptionsRequest.properties.subscriptions.maxItems).toBe(50);
    for (const name of ['CreateNotificationChannelRequest', 'UpdateNotificationChannelRequest', 'ReplaceNotificationSubscriptionsRequest']) {
      expect(sc[name].additionalProperties, name).toBe(false);
    }
    expect(validate({ name: 'x', kind: 'slack', url: 'https://hooks.slack.com/services/x', extra: 1 }, ref('CreateNotificationChannelRequest')).length).toBeGreaterThan(0);
    expect(validate({ name: 'x', kind: 'email', url: 'https://x.example' }, ref('CreateNotificationChannelRequest')).length).toBeGreaterThan(0);
  });

  it('errors: the service codes with their real messages, statuses and params', () => {
    const post = op('/notification-channels', 'post').responses;
    const ex400 = post['400'].content['application/json'].examples;
    expect(ex400.invalid_url.value.error).toMatchObject({ code: 'invalid_url', param: 'url' });
    expect(ex400.invalid_url_address.value.error.message).toBe("the URL's host must resolve only to public addresses");
    expect(ex400.kind.value.error).toMatchObject({ code: 'invalid_request', param: 'kind', message: 'kind must be slack, teams, discord or https' });
    const ex409 = post['409'].content['application/json'].examples;
    expect(ex409.name_taken.value.error).toMatchObject({ code: 'name_taken', param: 'name', message: 'a notification channel with this name already exists' });
    expect(ex409.too_many_channels.value.error.message).toBe('a member can have at most 10 notification channels');
    expect(post['404'].content['application/json'].examples.automation_not_found.value.error).toMatchObject({ code: 'automation_not_found', param: 'automation_id' });
    expect(post['503'].content['application/json'].example.error).toEqual({
      message: 'notifications are temporarily unavailable; try again', type: 'server_error', param: null, code: 'notifications_unavailable',
    });
    const test409 = op('/notification-channels/{id}/test', 'post').responses['409'].content['application/json'].example.error;
    expect(test409).toMatchObject({ code: 'channel_disabled', message: 'the channel is disabled; enable it first' });
    const lim = op('/notification-channels/{id}/deliveries', 'get').responses['400'].content['application/json'].examples.limit.value.error;
    expect(lim).toMatchObject({ code: 'invalid_request', param: 'limit', message: 'limit must be 1 to 100' });
    expect(op('/notification-channels/{id}', 'delete').responses['204']).toBeDefined();
  });

  it('test result and deliveries: the closed sets of §4.1 and §4.4', () => {
    expect(Object.keys(sc.NotificationTestResult.properties)).toEqual(['delivered', 'status', 'http_status', 'error']);
    expect(sc.NotificationTestResult.properties.status.enum).toEqual(['delivered', 'failed', 'blocked', 'rate_limited']);
    expect(Object.keys(sc.NotificationDelivery.properties)).toEqual(DELIVERY_FIELDS);
    expect(sc.NotificationDelivery.properties.status.enum).toEqual(['delivered', 'retrying', 'failed', 'blocked', 'rate_limited', 'dropped']);
    expect(sc.NotificationDelivery.properties.event.enum).toEqual([...EVENTS, 'test', 'digest']);
    expect(sc.NotificationDelivery.properties.error.enum).toEqual([
      'timeout', 'connect', 'tls', 'dns', 'blocked_address', 'invalid_url', 'redirect', 'http_4xx', 'http_5xx', 'channel_disabled', 'rate_limited', null,
    ]);
    const limit = op('/notification-channels/{id}/deliveries', 'get').parameters.find((p: any) => p.name === 'limit');
    expect(limit.schema).toEqual({ type: 'integer', minimum: 1, maximum: 100, default: 50 });
  });
});

describe('openapi.json: notification scopes in the overview and the platform token', () => {
  const desc = s.info.description as string;
  const pt = s.components.securitySchemes.platformToken.description as string;

  it('the overview lists both scopes, independent, browser-only to mint', () => {
    expect(desc).toContain('`notifications:read` (read notification channels and their deliveries, never their URLs)');
    expect(desc).toContain('`notifications:write` does not include `notifications:read`');
    expect(desc).toContain('[Notifications](#tag/notifications)');
    expect(desc).toContain('an `automations:`, `secrets:` or `notifications:` scope');
  });

  it('the platform token scheme names the route and the scopes', () => {
    expect(pt).toContain('Notifications (`/v1/notification-channels...`)');
    expect(pt).toContain('`notifications:read` or `notifications:write`');
  });

  it('the generated text reference carries the new routes', () => {
    const text = openapiToText(s);
    for (const [path, method] of OPS) expect(text, `${method} ${path}`).toContain(`### ${method.toUpperCase()} ${path}:`);
  });
});
