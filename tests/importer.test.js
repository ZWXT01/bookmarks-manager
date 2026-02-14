"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const importer_1 = require("../src/importer");
(0, vitest_1.describe)('parseImportContent', () => {
    (0, vitest_1.describe)('Netscape HTML format', () => {
        (0, vitest_1.it)('should parse standard Netscape bookmark HTML', () => {
            const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
  <DT><A HREF="https://example.com">Example</A>
  <DT><A HREF="https://test.com">Test</A>
</DL><p>`;
            const items = (0, importer_1.parseImportContent)(html);
            (0, vitest_1.expect)(items).toHaveLength(2);
            (0, vitest_1.expect)(items[0].url).toBe('https://example.com');
            (0, vitest_1.expect)(items[0].title).toBe('Example');
            (0, vitest_1.expect)(items[0].categoryName).toBeNull();
        });
        (0, vitest_1.it)('should extract folder hierarchy as categoryName', () => {
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
            const items = (0, importer_1.parseImportContent)(html);
            (0, vitest_1.expect)(items).toHaveLength(1);
            (0, vitest_1.expect)(items[0].categoryName).toBe('Tech/Programming');
        });
        (0, vitest_1.it)('should decode HTML entities in titles', () => {
            const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<DL><p>
  <DT><A HREF="https://example.com">Tom &amp; Jerry &lt;Show&gt;</A>
</DL><p>`;
            const items = (0, importer_1.parseImportContent)(html);
            (0, vitest_1.expect)(items[0].title).toBe('Tom & Jerry <Show>');
        });
        (0, vitest_1.it)('should handle single-quoted HREF attributes', () => {
            const html = `<DL><p>
  <DT><A HREF='https://single-quote.com'>Single</A>
</DL><p>`;
            const items = (0, importer_1.parseImportContent)(html);
            (0, vitest_1.expect)(items).toHaveLength(1);
            (0, vitest_1.expect)(items[0].url).toBe('https://single-quote.com');
        });
    });
    (0, vitest_1.describe)('JSON format', () => {
        (0, vitest_1.it)('should parse JSON array with url and title', () => {
            const json = JSON.stringify([
                { url: 'https://a.com', title: 'A' },
                { url: 'https://b.com', title: 'B', category: 'Tech' },
            ]);
            const items = (0, importer_1.parseImportContent)(json);
            (0, vitest_1.expect)(items).toHaveLength(2);
            (0, vitest_1.expect)(items[0].url).toBe('https://a.com');
            (0, vitest_1.expect)(items[0].title).toBe('A');
            (0, vitest_1.expect)(items[0].categoryName).toBeNull();
            (0, vitest_1.expect)(items[1].categoryName).toBe('Tech');
        });
        (0, vitest_1.it)('should parse JSON with href field instead of url', () => {
            const json = JSON.stringify([
                { href: 'https://c.com', title: 'C' },
            ]);
            const items = (0, importer_1.parseImportContent)(json);
            (0, vitest_1.expect)(items).toHaveLength(1);
            (0, vitest_1.expect)(items[0].url).toBe('https://c.com');
        });
        (0, vitest_1.it)('should parse nested JSON with bookmarks key', () => {
            const json = JSON.stringify({
                bookmarks: [
                    { url: 'https://nested.com', title: 'Nested' },
                ],
            });
            const items = (0, importer_1.parseImportContent)(json);
            (0, vitest_1.expect)(items).toHaveLength(1);
            (0, vitest_1.expect)(items[0].url).toBe('https://nested.com');
        });
        (0, vitest_1.it)('should return empty array for invalid JSON', () => {
            const items = (0, importer_1.parseImportContent)('{ broken json');
            (0, vitest_1.expect)(items).toHaveLength(0);
        });
        (0, vitest_1.it)('should skip entries without url or href', () => {
            const json = JSON.stringify([
                { title: 'No URL' },
                { url: 'https://valid.com', title: 'Valid' },
            ]);
            const items = (0, importer_1.parseImportContent)(json);
            (0, vitest_1.expect)(items).toHaveLength(1);
            (0, vitest_1.expect)(items[0].url).toBe('https://valid.com');
        });
    });
    (0, vitest_1.describe)('Plain text format', () => {
        (0, vitest_1.it)('should extract URLs from plain text lines', () => {
            const text = `https://example.com
https://test.com
`;
            const items = (0, importer_1.parseImportContent)(text);
            (0, vitest_1.expect)(items).toHaveLength(2);
            (0, vitest_1.expect)(items[0].url).toBe('https://example.com');
        });
        (0, vitest_1.it)('should extract URL from mixed text lines', () => {
            const text = `Check this out https://mixed.com for info`;
            const items = (0, importer_1.parseImportContent)(text);
            (0, vitest_1.expect)(items).toHaveLength(1);
            (0, vitest_1.expect)(items[0].url).toBe('https://mixed.com');
        });
        (0, vitest_1.it)('should skip empty lines', () => {
            const text = `
https://a.com

https://b.com

`;
            const items = (0, importer_1.parseImportContent)(text);
            (0, vitest_1.expect)(items).toHaveLength(2);
        });
    });
});
