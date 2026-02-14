"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const exporter_1 = require("../src/exporter");
(0, vitest_1.describe)('buildNetscapeHtml', () => {
    (0, vitest_1.it)('should generate valid Netscape bookmark HTML header', () => {
        const html = (0, exporter_1.buildNetscapeHtml)([]);
        (0, vitest_1.expect)(html).toContain('NETSCAPE-Bookmark-file-1');
        (0, vitest_1.expect)(html).toContain('<TITLE>Bookmarks</TITLE>');
        (0, vitest_1.expect)(html).toContain('<H1>Bookmarks</H1>');
    });
    (0, vitest_1.it)('should export bookmarks without category at root level', () => {
        const rows = [
            { url: 'https://example.com', title: 'Example', category_name: null, created_at: '2024-01-01' },
        ];
        const html = (0, exporter_1.buildNetscapeHtml)(rows);
        (0, vitest_1.expect)(html).toContain('<A HREF="https://example.com">Example</A>');
    });
    (0, vitest_1.it)('should create nested folder structure for categorized bookmarks', () => {
        const rows = [
            { url: 'https://dev.to', title: 'Dev', category_name: '技术/编程', created_at: '2024-01-01' },
        ];
        const html = (0, exporter_1.buildNetscapeHtml)(rows);
        (0, vitest_1.expect)(html).toContain('<H3>技术</H3>');
        (0, vitest_1.expect)(html).toContain('<H3>编程</H3>');
        (0, vitest_1.expect)(html).toContain('<A HREF="https://dev.to">Dev</A>');
    });
    (0, vitest_1.it)('should escape HTML special characters', () => {
        const rows = [
            { url: 'https://example.com/?a=1&b=2', title: 'A & B <test>', category_name: null, created_at: '2024-01-01' },
        ];
        const html = (0, exporter_1.buildNetscapeHtml)(rows);
        (0, vitest_1.expect)(html).toContain('&amp;');
        (0, vitest_1.expect)(html).toContain('&lt;test&gt;');
    });
    (0, vitest_1.it)('should group multiple bookmarks under the same folder', () => {
        const rows = [
            { url: 'https://a.com', title: 'A', category_name: '技术', created_at: '2024-01-01' },
            { url: 'https://b.com', title: 'B', category_name: '技术', created_at: '2024-01-02' },
        ];
        const html = (0, exporter_1.buildNetscapeHtml)(rows);
        // Only one folder header for "技术"
        const matches = html.match(/<H3>技术<\/H3>/g);
        (0, vitest_1.expect)(matches).toHaveLength(1);
        (0, vitest_1.expect)(html).toContain('https://a.com');
        (0, vitest_1.expect)(html).toContain('https://b.com');
    });
    (0, vitest_1.it)('should handle empty category_name as root level', () => {
        const rows = [
            { url: 'https://x.com', title: 'X', category_name: '', created_at: '2024-01-01' },
            { url: 'https://y.com', title: 'Y', category_name: '   ', created_at: '2024-01-01' },
        ];
        const html = (0, exporter_1.buildNetscapeHtml)(rows);
        (0, vitest_1.expect)(html).toContain('<A HREF="https://x.com">X</A>');
        (0, vitest_1.expect)(html).toContain('<A HREF="https://y.com">Y</A>');
    });
});
