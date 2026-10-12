/**
 * Navigation and search-index logic for the docs shell.
 *
 * It lives here rather than inline in Docs.astro so it can be unit-tested: a
 * layout is only reachable through a full SSR render, and these are exactly the
 * parts that break silently. The nav is what a reader uses to find anything,
 * and the anchors below are a contract with a third-party package.
 */

export interface DocsNavItem {
  slug: string;
  label: string;
  order: number;
  group: string;
  description: string;
  /**
   * Slug of the page this one is listed under, if any (same shape as `slug`).
   * A page with a parent appears as a sub-item right below it, in the
   * parent's group, and never at the top level as well.
   */
  parent?: string;
}

/** A nav entry with the pages nested under it, already in visual order. */
export interface DocsNavNode extends DocsNavItem {
  children: DocsNavNode[];
}

export interface DocsNavGroup {
  group: string;
  items: DocsNavNode[];
}

/** A search hit target: a heading inside a docs page. */
export interface DocsHeading {
  text: string;
  /** Fragment WITHOUT the leading '#'. */
  slug: string;
}

/**
 * Scalar's slug rules for a heading, reproduced.
 *
 * Verified against the rendered page: "Versioning & compatibility" becomes
 * `versioning-compatibility` and "Making requests" becomes `making-requests`.
 */
export function slugifyAnchor(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Where a heading of the API reference lives, as a fragment.
 *
 * Scalar has TWO anchor namespaces and they are not interchangeable: the
 * sections of the overview (which come from `info.description`) are addressed
 * as `description/<slug>`, and the endpoint groups as `tag/<slug>`. Sending a
 * reader to `tag/authentication` lands them on the page without scrolling,
 * because that id does not exist.
 *
 * This is a coupling to `@scalar/api-reference` that nothing else enforces, so
 * it is pinned by tests: if a version of Scalar changes the scheme, the search
 * results start pointing nowhere and no build fails.
 */
export function apiSearchHeadings(spec: {
  info?: { description?: string };
  tags?: Array<{ name?: string }>;
}): DocsHeading[] {
  const overview = (spec.info?.description ?? '')
    .split('\n')
    // `^##\s` only matches level 2: a `###` has a '#' where the space must be.
    .flatMap((line) => {
      const m = /^##\s+(.+)$/.exec(line);
      return m ? [m[1].trim()] : [];
    })
    .map((text) => ({ text, slug: `description/${slugifyAnchor(text)}` }));

  const tags = (spec.tags ?? [])
    .map((t) => t.name)
    .filter((name): name is string => Boolean(name))
    .map((name) => ({ text: name, slug: `tag/${slugifyAnchor(name)}` }));

  return [...overview, ...tags];
}

/**
 * Whether a nav entry should read as the current page.
 *
 * Prefix matching, not just equality, so a nested route highlights its parent.
 * The docs index (`/docs`, and `/es/docs` for Spanish) is excluded from the
 * prefix branch or it would highlight on every page of the section. Only
 * `/docs` used to be excluded, so the Spanish index lit up on every ES page.
 */
const DOCS_INDEX = /^(\/[a-z]{2})?\/docs$/;
export function isActiveDocPath(here: string, slug: string): boolean {
  const target = slug.replace(/\/+$/, '');
  const current = here.replace(/\/+$/, '') || '/docs';
  return current === target || (!DOCS_INDEX.test(target) && current.startsWith(`${target}/`));
}

/** The slug of a guide, from its collection id: `intro` is the docs index. */
export function docSlug(id: string, pfx = ''): string {
  return id === 'intro' ? `${pfx}/docs` : `${pfx}/docs/${id}`;
}

/**
 * A collection entry as a nav item. Shared by the layout and the tests so the
 * page and its render test cannot build the nav two different ways.
 *
 * `parent` is written in frontmatter as the parent's entry id; the nav speaks
 * slugs, so it is resolved here with the same locale prefix.
 */
export function docsNavItemFromEntry(
  entry: {
    id: string;
    data: { title: string; order: number; group: string; description: string; parent?: string };
  },
  pfx = '',
): DocsNavItem {
  return {
    slug: docSlug(entry.id, pfx),
    label: entry.data.title,
    order: entry.data.order,
    group: entry.data.group,
    description: entry.data.description,
    parent: entry.data.parent ? docSlug(entry.data.parent, pfx) : undefined,
  };
}

/**
 * The chain of parents of a page, outermost first.
 *
 * A `parent` that points nowhere, at the page itself, or into a cycle ends the
 * chain there: a typo in frontmatter must cost the nesting, never the page.
 */
export function docsNavAncestors(items: DocsNavItem[], slug: string): DocsNavItem[] {
  // First entry wins on a repeated slug, as in groupDocsNav.
  const bySlug = new Map<string, DocsNavItem>();
  for (const i of items) if (!bySlug.has(i.slug)) bySlug.set(i.slug, i);
  const chain: DocsNavItem[] = [];
  const seen = new Set<string>([slug]);
  let parent = bySlug.get(slug)?.parent;
  while (parent && !seen.has(parent)) {
    const node = bySlug.get(parent);
    if (!node) break;
    seen.add(parent);
    chain.unshift(node);
    parent = node.parent;
  }
  // Inside a cycle the walk comes back to a page already seen: the chain is
  // meaningless, so the page is treated as top level.
  return parent && seen.has(parent) ? [] : chain;
}

/**
 * Groups the nav, preserving the order the items already carry, and nests the
 * pages that declare a `parent` under it.
 *
 * The group order follows the lowest `order` among the top-level items of each
 * group rather than a list written by hand in the layout, so adding a guide
 * stays a matter of creating one file. A child always sits in its parent's
 * group, whatever its own `group` says, so a child alone cannot open a section.
 */
export function groupDocsNav(items: DocsNavItem[]): DocsNavGroup[] {
  const sorted = [...items].sort((a, b) => a.order - b.order);
  // Nodes are matched to items by position, not by slug: the slug is only
  // used to resolve `parent`, so two entries sharing one cannot swallow each
  // other.
  const nodes: DocsNavNode[] = sorted.map((i) => ({ ...i, children: [] }));
  const bySlug = new Map<string, DocsNavNode>();
  for (const n of nodes) if (!bySlug.has(n.slug)) bySlug.set(n.slug, n);
  const groups: DocsNavGroup[] = [];
  for (const node of nodes) {
    const ancestors = node.parent ? docsNavAncestors(sorted, node.slug) : [];
    if (ancestors.length > 0) {
      bySlug.get(ancestors[ancestors.length - 1].slug)!.children.push(node);
      continue;
    }
    const existing = groups.find((g) => g.group === node.group);
    if (existing) existing.items.push(node);
    else groups.push({ group: node.group, items: [node] });
  }
  return groups;
}

/**
 * Every page in the order the sidebar shows it: depth first, each child right
 * after its parent. Prev/next walk this list so they never jump around.
 */
export function flattenDocsNav(groups: DocsNavGroup[]): DocsNavItem[] {
  const out: DocsNavItem[] = [];
  const walk = (nodes: DocsNavNode[]) => {
    for (const { children, ...item } of nodes) {
      out.push(item);
      walk(children);
    }
  };
  for (const g of groups) walk(g.items);
  return out;
}

/** Whether the page or one of the pages nested under it is the current one. */
export function isActiveDocTrail(here: string, node: DocsNavNode): boolean {
  return isActiveDocPath(here, node.slug) || node.children.some((c) => isActiveDocTrail(here, c));
}
