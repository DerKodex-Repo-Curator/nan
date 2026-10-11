import { expect } from 'vitest';
import spec from '../../data/openapi.json';

/**
 * A small JSON Schema validator for the examples of the API reference.
 *
 * There is no OpenAPI validator among the dependencies, so the examples are
 * checked against their schemas with this: enough of JSON Schema for what the
 * spec uses ($ref, type, enum, required, properties, additionalProperties:
 * false, items, oneOf, allOf, pattern, minimum/maximum, minLength/maxLength).
 * An object property the schema does not declare is an error unless the
 * schema says `additionalProperties: true`.
 */
export type Schema = Record<string, any>;
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
export function validate(value: unknown, schema: Schema, path = '$'): string[] {
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

