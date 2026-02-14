import { describe, it, expect } from 'vitest';
import { parseImportContent } from '../src/importer';

describe('parseImportContent', () => {
    describe('Netscape HTML format', () => {
        it('should parse standard Netscape bookmark HTML', () => {
            const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
  <DT><A HREF="https://example.com">Example</A>
  <DT><A HREF="https://test.com">Test</A>
</DL><p>`;
            const items = parseImportContent(html);
            expect(items).toHaveLength(2);
            expect(items[0].url).toBe('https://example.com');
            expect(items[0].title).toBe('Example');
            expect(items[0].categoryName).toBeNull();
        });

        it('should extract folder hierarchy as categoryName', () => {
            const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<DL><p>
  <DT><H3>Tech</H3>
  <DL><p>
    <DT><H3>Programming</H3>
    <DL><p>
      <DT><A HREF="https://dev.to">Dev</A>
    </DL><p>
  </DL><p>
</DL><p>`;
            const items = parseImportContent(html);
            expect(items).toHaveLength(1);
            expect(items[0].categoryName).toBe('Tech/Programming');
        });

        it('should decode HTML entities in titles', () => {
            const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<DL><p>
  <DT><A HREF="https://example.com">Tom &amp; Jerry &lt;Show&gt;</A>
</DL><p>`;
            const items = parseImportContent(html);
            expect(items[0].title).toBe('Tom & Jerry <Show>');
        });

        it('should handle single-quoted HREF attributes', () => {
            const html = `<DL><p>
  <DT><A HREF='https://single-quote.com'>Single</A>
</DL><p>`;
            const items = parseImportContent(html);
            expect(items).toHaveLength(1);
            expect(items[0].url).toBe('https://single-quote.com');
        });
    });

    describe('JSON format', () => {
        it('should parse JSON array with url and title', () => {
            const json = JSON.stringify([
                { url: 'https://a.com', title: 'A' },
                { url: 'https://b.com', title: 'B', category: 'Tech' },
            ]);
            const items = parseImportContent(json);
            expect(items).toHaveLength(2);
            expect(items[0].url).toBe('https://a.com');
            expect(items[0].title).toBe('A');
            expect(items[0].categoryName).toBeNull();
            expect(items[1].categoryName).toBe('Tech');
        });

        it('should parse JSON with href field instead of url', () => {
            const json = JSON.stringify([
                { href: 'https://c.com', title: 'C' },
            ]);
            const items = parseImportContent(json);
            expect(items).toHaveLength(1);
            expect(items[0].url).toBe('https://c.com');
        });

        it('should parse nested JSON with bookmarks key', () => {
            const json = JSON.stringify({
                bookmarks: [
                    { url: 'https://nested.com', title: 'Nested' },
                ],
            });
            const items = parseImportContent(json);
            expect(items).toHaveLength(1);
            expect(items[0].url).toBe('https://nested.com');
        });

        it('should return empty array for invalid JSON', () => {
            const items = parseImportContent('{ broken json');
            expect(items).toHaveLength(0);
        });

        it('should skip entries without url or href', () => {
            const json = JSON.stringify([
                { title: 'No URL' },
                { url: 'https://valid.com', title: 'Valid' },
            ]);
            const items = parseImportContent(json);
            expect(items).toHaveLength(1);
            expect(items[0].url).toBe('https://valid.com');
        });
    });

    describe('Plain text format', () => {
        it('should extract URLs from plain text lines', () => {
            const text = `https://example.com
https://test.com
`;
            const items = parseImportContent(text);
            expect(items).toHaveLength(2);
            expect(items[0].url).toBe('https://example.com');
        });

        it('should extract URL from mixed text lines', () => {
            const text = `Check this out https://mixed.com for info`;
            const items = parseImportContent(text);
            expect(items).toHaveLength(1);
            expect(items[0].url).toBe('https://mixed.com');
        });

        it('should skip empty lines', () => {
            const text = `
https://a.com

https://b.com

`;
            const items = parseImportContent(text);
            expect(items).toHaveLength(2);
        });
    });
});
