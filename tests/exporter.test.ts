import { describe, it, expect } from 'vitest';
import { buildNetscapeHtml } from '../src/exporter';
import type { ExportBookmarkRow } from '../src/exporter';

describe('buildNetscapeHtml', () => {
    it('should generate valid Netscape bookmark HTML header', () => {
        const html = buildNetscapeHtml([]);
        expect(html).toContain('NETSCAPE-Bookmark-file-1');
        expect(html).toContain('<TITLE>Bookmarks</TITLE>');
        expect(html).toContain('<H1>Bookmarks</H1>');
    });

    it('should export bookmarks without category at root level', () => {
        const rows: ExportBookmarkRow[] = [
            { url: 'https://example.com', title: 'Example', category_name: null, created_at: '2024-01-01' },
        ];
        const html = buildNetscapeHtml(rows);
        expect(html).toContain('<A HREF="https://example.com">Example</A>');
    });

    it('should create nested folder structure for categorized bookmarks', () => {
        const rows: ExportBookmarkRow[] = [
            { url: 'https://dev.to', title: 'Dev', category_name: '技术/编程', created_at: '2024-01-01' },
        ];
        const html = buildNetscapeHtml(rows);
        expect(html).toContain('<H3>技术</H3>');
        expect(html).toContain('<H3>编程</H3>');
        expect(html).toContain('<A HREF="https://dev.to">Dev</A>');
    });

    it('should escape HTML special characters', () => {
        const rows: ExportBookmarkRow[] = [
            { url: 'https://example.com/?a=1&b=2', title: 'A & B <test>', category_name: null, created_at: '2024-01-01' },
        ];
        const html = buildNetscapeHtml(rows);
        expect(html).toContain('&amp;');
        expect(html).toContain('&lt;test&gt;');
    });

    it('should group multiple bookmarks under the same folder', () => {
        const rows: ExportBookmarkRow[] = [
            { url: 'https://a.com', title: 'A', category_name: '技术', created_at: '2024-01-01' },
            { url: 'https://b.com', title: 'B', category_name: '技术', created_at: '2024-01-02' },
        ];
        const html = buildNetscapeHtml(rows);
        // Only one folder header for "技术"
        const matches = html.match(/<H3>技术<\/H3>/g);
        expect(matches).toHaveLength(1);
        expect(html).toContain('https://a.com');
        expect(html).toContain('https://b.com');
    });

    it('should handle empty category_name as root level', () => {
        const rows: ExportBookmarkRow[] = [
            { url: 'https://x.com', title: 'X', category_name: '', created_at: '2024-01-01' },
            { url: 'https://y.com', title: 'Y', category_name: '   ', created_at: '2024-01-01' },
        ];
        const html = buildNetscapeHtml(rows);
        expect(html).toContain('<A HREF="https://x.com">X</A>');
        expect(html).toContain('<A HREF="https://y.com">Y</A>');
    });
});
