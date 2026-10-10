import { describe, expect, test } from 'vitest';
import { isCommentOnly, mdxToText } from '../../lib/mdxToText';

/**
 * Docs pages carry `{/* SCREENSHOT: ... *\/}` placeholders where a capture is
 * still to come. The extractor behind /api/docs refused every MDX expression,
 * so one such comment would have taken the whole page down. A comment renders
 * nothing, so it must serve nothing; any other expression is still refused.
 */
describe('MDX comments in the docs text extractor', () => {
  test('a block comment on its own line is dropped', async () => {
    const text = await mdxToText('# Title\n\n{/* SCREENSHOT: runs tab */}\n\nAfter.\n');
    expect(text).toContain('After.');
    expect(text).not.toContain('SCREENSHOT');
  });

  test('a multi-line comment is dropped too', async () => {
    const text = await mdxToText('Before.\n\n{/*\n  TODO: picture\n*/}\n\nAfter.\n');
    expect(text).not.toContain('TODO');
    expect(text).toContain('Before.');
  });

  test('any other expression is still refused', async () => {
    await expect(mdxToText('Value: {1 + 1}\n')).rejects.toThrow(/Unexpected MDX expression/);
    await expect(mdxToText('{/* a */ 1}\n')).rejects.toThrow(/Unexpected MDX expression/);
  });

  test('isCommentOnly accepts a single comment and nothing else', () => {
    expect(isCommentOnly('/* x */')).toBe(true);
    expect(isCommentOnly('/* a */ + /* b */')).toBe(false);
    expect(isCommentOnly('x')).toBe(false);
  });
});
