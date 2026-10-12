import { describe, expect, it } from 'vitest';
import spec from '../data/openapi.json';
import { API_DOC_META, API_DOC_SLUG } from './apiDoc';
import {
  apiSearchHeadings,
  docsNavAncestors,
  flattenDocsNav,
  groupDocsNav,
  isActiveDocPath,
  isActiveDocTrail,
  slugifyAnchor,
  type DocsNavItem,
} from './docsNav';

/**
 * The docs navigation and the search index.
 *
 * None of this had a test until the shell was ported, and the port lost four
 * things in one go without a single check failing. The anchors below are the
 * part that worries most: they are a contract with `@scalar/api-reference`,
 * verified once by hand against the rendered page, and nothing else in the
 * build would notice if a version of Scalar changed the scheme.
 */

const item = (over: Partial<DocsNavItem> = {}): DocsNavItem => ({
  slug: '/docs/x',
  label: 'X',
  order: 0,
  group: 'Guides',
  description: '',
  ...over,
});

describe('isActiveDocPath', () => {
  it('matches the exact page', () => {
    expect(isActiveDocPath('/docs/models', '/docs/models')).toBe(true);
  });

  it('ignores a trailing slash on either side', () => {
    expect(isActiveDocPath('/docs/models/', '/docs/models')).toBe(true);
    expect(isActiveDocPath('/docs/models', '/docs/models/')).toBe(true);
  });

  /**
   * The port replaced this with plain equality. With today's flat collection
   * nothing looked broken, which is exactly what makes it worth pinning: the
   * regression would only surface the day a guide gets nested.
   */
  it('highlights a parent when the page is a nested route', () => {
    expect(isActiveDocPath('/docs/guides/deploy', '/docs/guides')).toBe(true);
  });

  it('does not let /docs highlight on every page of the section', () => {
    expect(isActiveDocPath('/docs/models', '/docs')).toBe(false);
    expect(isActiveDocPath('/docs', '/docs')).toBe(true);
  });

  it('does not let /es/docs highlight on every Spanish page either', () => {
    expect(isActiveDocPath('/es/docs/models', '/es/docs')).toBe(false);
    expect(isActiveDocPath('/es/docs', '/es/docs')).toBe(true);
    expect(isActiveDocPath('/es/docs/guides/deploy', '/es/docs/guides')).toBe(true);
  });

  it('does not match a sibling that merely shares a prefix', () => {
    expect(isActiveDocPath('/docs/models-old', '/docs/models')).toBe(false);
  });
});

describe('groupDocsNav', () => {
  it('orders groups by the lowest order inside each one', () => {
    const groups = groupDocsNav([
      item({ label: 'C', order: 5, group: 'Guides' }),
      item({ label: 'A', order: 0, group: 'Get started' }),
      item({ label: 'B', order: 2, group: 'Reference' }),
      item({ label: 'A2', order: 1, group: 'Get started' }),
    ]);
    expect(groups.map((g) => g.group)).toEqual(['Get started', 'Reference', 'Guides']);
    expect(groups[0].items.map((i) => i.label)).toEqual(['A', 'A2']);
  });

  it('keeps every item, without dropping or duplicating any', () => {
    const items = [item({ label: 'A' }), item({ label: 'B', group: 'Other' }), item({ label: 'C' })];
    const flat = groupDocsNav(items).flatMap((g) => g.items.map((i) => i.label));
    expect(flat.sort()).toEqual(['A', 'B', 'C']);
  });
});

/**
 * Nesting: a page can declare `parent` (the slug of another page) and it is
 * then listed as a sub-item right under that page instead of at the top level
 * of its group. Owner's ask: the PR gatekeeper guide belongs UNDER Automations.
 */
describe('groupDocsNav: nesting under a parent', () => {
  const guides = () => [
    item({ slug: '/docs/runs', label: 'Runs', order: 19 }),
    item({ slug: '/docs/automations', label: 'Automations', order: 20 }),
    item({ slug: '/docs/pr-gatekeeper', label: 'PR gatekeeper', order: 21, parent: '/docs/automations' }),
    item({ slug: '/docs/webhooks', label: 'Webhooks', order: 22 }),
  ];

  it('lists the child under its parent, not at the top level', () => {
    const [g] = groupDocsNav(guides());
    expect(g.items.map((i) => i.label)).toEqual(['Runs', 'Automations', 'Webhooks']);
    const automations = g.items.find((i) => i.label === 'Automations')!;
    expect(automations.children.map((c) => c.label)).toEqual(['PR gatekeeper']);
  });

  it('never lists a child twice', () => {
    const flat = flattenDocsNav(groupDocsNav(guides()));
    expect(flat.filter((i) => i.label === 'PR gatekeeper')).toHaveLength(1);
    expect(flat).toHaveLength(4);
  });

  it('gives top-level items an empty children list', () => {
    const [g] = groupDocsNav(guides());
    expect(g.items.find((i) => i.label === 'Runs')!.children).toEqual([]);
  });

  it('orders siblings under one parent by their own order, whatever the input order', () => {
    const [g] = groupDocsNav([
      item({ slug: '/docs/b', label: 'B', order: 5, parent: '/docs/p' }),
      item({ slug: '/docs/p', label: 'P', order: 1 }),
      item({ slug: '/docs/a', label: 'A', order: 3, parent: '/docs/p' }),
    ]);
    expect(g.items[0].children.map((c) => c.label)).toEqual(['A', 'B']);
  });

  it('follows the parent into its group, even if the child says otherwise', () => {
    const groups = groupDocsNav([
      item({ slug: '/docs/p', label: 'P', order: 0, group: 'Guides' }),
      item({ slug: '/docs/c', label: 'C', order: 1, parent: '/docs/p', group: 'Reference' }),
    ]);
    expect(groups.map((g) => g.group)).toEqual(['Guides']);
    expect(groups[0].items[0].children.map((c) => c.label)).toEqual(['C']);
  });

  it('does not open a group for a child alone', () => {
    const groups = groupDocsNav([
      item({ slug: '/docs/p', label: 'P', order: 5, group: 'Guides' }),
      item({ slug: '/docs/c', label: 'C', order: 0, parent: '/docs/p', group: 'Get started' }),
    ]);
    expect(groups.map((g) => g.group)).toEqual(['Guides']);
  });

  /** A typo in `parent` must not make the page vanish from the nav. */
  it('keeps a page whose parent does not exist at the top level', () => {
    const [g] = groupDocsNav([item({ slug: '/docs/orphan', label: 'Orphan', parent: '/docs/nope' })]);
    expect(g.items.map((i) => i.label)).toEqual(['Orphan']);
  });

  it('keeps a page that names itself as parent at the top level', () => {
    const [g] = groupDocsNav([item({ slug: '/docs/self', label: 'Self', parent: '/docs/self' })]);
    expect(g.items.map((i) => i.label)).toEqual(['Self']);
  });

  it('survives a parent cycle without dropping or duplicating pages', () => {
    const flat = flattenDocsNav(
      groupDocsNav([
        item({ slug: '/docs/a', label: 'A', order: 0, parent: '/docs/b' }),
        item({ slug: '/docs/b', label: 'B', order: 1, parent: '/docs/a' }),
      ]),
    );
    expect(flat.map((i) => i.label).sort()).toEqual(['A', 'B']);
  });

  it('nests more than one level deep', () => {
    const groups = groupDocsNav([
      item({ slug: '/docs/a', label: 'A', order: 0 }),
      item({ slug: '/docs/b', label: 'B', order: 1, parent: '/docs/a' }),
      item({ slug: '/docs/c', label: 'C', order: 2, parent: '/docs/b' }),
    ]);
    expect(groups[0].items[0].children[0].children.map((c) => c.label)).toEqual(['C']);
  });
});

describe('flattenDocsNav: the visual order, for prev/next', () => {
  it('puts each child right after its parent, before the parent\'s next sibling', () => {
    const flat = flattenDocsNav(
      groupDocsNav([
        item({ slug: '/docs/intro', label: 'Intro', order: 0, group: 'Get started' }),
        item({ slug: '/docs/automations', label: 'Automations', order: 20 }),
        item({ slug: '/docs/webhooks', label: 'Webhooks', order: 21 }),
        // Out of order on purpose: the visual order wins over the raw number.
        item({ slug: '/docs/pr-gatekeeper', label: 'PR gatekeeper', order: 22, parent: '/docs/automations' }),
      ]),
    );
    expect(flat.map((i) => i.label)).toEqual(['Intro', 'Automations', 'PR gatekeeper', 'Webhooks']);
  });
});

describe('isActiveDocTrail', () => {
  const [g] = groupDocsNav([
    item({ slug: '/docs/automations', label: 'Automations', order: 0 }),
    item({ slug: '/docs/pr-gatekeeper', label: 'PR gatekeeper', order: 1, parent: '/docs/automations' }),
    item({ slug: '/docs/webhooks', label: 'Webhooks', order: 2 }),
  ]);
  const automations = g.items[0];

  it('marks the parent as on the trail while a child is open', () => {
    expect(isActiveDocTrail('/docs/pr-gatekeeper', automations)).toBe(true);
  });

  it('also when the parent itself is open', () => {
    expect(isActiveDocTrail('/docs/automations', automations)).toBe(true);
  });

  it('not on an unrelated page', () => {
    expect(isActiveDocTrail('/docs/webhooks', automations)).toBe(false);
  });
});

describe('docsNavAncestors: for the breadcrumb', () => {
  const items = [
    item({ slug: '/docs/automations', label: 'Automations', order: 0 }),
    item({ slug: '/docs/pr-gatekeeper', label: 'PR gatekeeper', order: 1, parent: '/docs/automations' }),
  ];

  it('returns the parents of a nested page, outermost first', () => {
    expect(docsNavAncestors(items, '/docs/pr-gatekeeper').map((i) => i.label)).toEqual(['Automations']);
  });

  it('returns nothing for a top-level page or an unknown one', () => {
    expect(docsNavAncestors(items, '/docs/automations')).toEqual([]);
    expect(docsNavAncestors(items, '/docs/nope')).toEqual([]);
  });

  it('stops on a cycle instead of looping forever', () => {
    const cyclic = [
      item({ slug: '/docs/a', label: 'A', parent: '/docs/b' }),
      item({ slug: '/docs/b', label: 'B', parent: '/docs/a' }),
    ];
    expect(docsNavAncestors(cyclic, '/docs/a').length).toBeLessThanOrEqual(1);
  });
});

describe('slugifyAnchor', () => {
  // Comprobados uno a uno contra los ids que Scalar pinta en la página.
  it.each([
    ['Authentication', 'authentication'],
    ['Making requests', 'making-requests'],
    ['Rate limits', 'rate-limits'],
    ['Versioning & compatibility', 'versioning-compatibility'],
    ['Model catalog', 'model-catalog'],
    ['Images', 'images'],
  ])('%s -> %s', (input, expected) => {
    expect(slugifyAnchor(input)).toBe(expected);
  });
});

describe('apiSearchHeadings', () => {
  const headings = apiSearchHeadings(spec);

  /**
   * Scalar has TWO anchor namespaces and they are not interchangeable. The
   * first version of the search index labelled everything `tag/`, so searching
   * "Authentication" produced a link to an id that does not exist and the
   * reader landed on the page without scrolling.
   */
  it('addresses the overview sections as description/, not tag/', () => {
    const auth = headings.find((h) => h.text === 'Authentication');
    expect(auth?.slug).toBe('description/authentication');
    expect(headings.some((h) => h.slug === 'tag/authentication')).toBe(false);
  });

  it('addresses the endpoint groups as tag/', () => {
    for (const tag of spec.tags ?? []) {
      const hit = headings.find((h) => h.text === tag.name);
      expect(hit, tag.name).toBeDefined();
      expect(hit!.slug).toBe(`tag/${slugifyAnchor(tag.name!)}`);
    }
  });

  it('covers every tag the spec declares', () => {
    const tagSlugs = headings.filter((h) => h.slug.startsWith('tag/')).map((h) => h.text);
    expect(tagSlugs.sort()).toEqual((spec.tags ?? []).map((t) => t.name).sort());
  });

  it('takes only level-2 headings, not the level-3 ones nested under them', () => {
    const nested = apiSearchHeadings({
      info: { description: '## Rate limits\n\n### Per model\n\n#### Per key' },
    });
    expect(nested.map((h) => h.text)).toEqual(['Rate limits']);
  });
});

describe('the API reference entry of the nav', () => {
  it('carries a group per locale, so it does not split the Spanish nav', () => {
    expect(API_DOC_META.group.en).toBe('Reference');
    expect(API_DOC_META.group.es).toBe('Referencia');
  });

  it('keeps the slug the rest of the pipeline addresses it by', () => {
    expect(API_DOC_SLUG).toBe('api');
  });
});
