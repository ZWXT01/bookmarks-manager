import { describe, it, expect } from 'vitest';
import { canonicalizeUrl } from '../src/url';

describe('canonicalizeUrl', () => {
    it('should normalize a standard URL', () => {
        const result = canonicalizeUrl('https://Example.COM/path/');
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.canonicalUrl).toBe('https://example.com/path');
    });

    it('should auto-prepend https:// when missing', () => {
        const result = canonicalizeUrl('example.com/page');
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.normalizedUrl).toBe('https://example.com/page');
    });

    it('should strip hash fragments', () => {
        const result = canonicalizeUrl('https://example.com/page#section');
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.canonicalUrl).toBe('https://example.com/page');
    });

    it('should remove UTM tracking parameters', () => {
        const result = canonicalizeUrl(
            'https://example.com/page?utm_source=google&utm_medium=cpc&id=123',
        );
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.canonicalUrl).toBe('https://example.com/page?id=123');
    });

    it('should remove gclid and fbclid', () => {
        const result = canonicalizeUrl(
            'https://example.com/?gclid=abc&fbclid=def&keep=1',
        );
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.canonicalUrl).toBe('https://example.com/?keep=1');
    });

    it('should sort query parameters alphabetically', () => {
        const result = canonicalizeUrl('https://example.com/?z=1&a=2&m=3');
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.canonicalUrl).toBe('https://example.com/?a=2&m=3&z=1');
    });

    it('should strip default ports (443 for https, 80 for http)', () => {
        const r1 = canonicalizeUrl('https://example.com:443/path');
        expect(r1.ok).toBe(true);
        if (r1.ok) expect(r1.canonicalUrl).toBe('https://example.com/path');

        const r2 = canonicalizeUrl('http://example.com:80/path');
        expect(r2.ok).toBe(true);
        if (r2.ok) expect(r2.canonicalUrl).toBe('http://example.com/path');
    });

    it('should auto-prepend https:// to ftp:// input (no protocol check on raw input)', () => {
        // ftp:// doesn't match ^https?://, so normalizeUrlInput prepends https://
        // Result: https://ftp://example.com/file → parsed as valid HTTPS URL
        const result = canonicalizeUrl('ftp://example.com/file');
        expect(result.ok).toBe(true);
    });

    it('should reject invalid URLs', () => {
        const result = canonicalizeUrl('not a url at all !!!');
        expect(result.ok).toBe(false);
    });

    it('should handle empty/whitespace input', () => {
        const result = canonicalizeUrl('   ');
        expect(result.ok).toBe(false);
    });

    it('should remove trailing slash from path', () => {
        const result = canonicalizeUrl('https://example.com/about/');
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.canonicalUrl).toBe('https://example.com/about');
    });

    it('should lowercase hostname only', () => {
        const result = canonicalizeUrl('https://Example.COM/Path/To/Page');
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.canonicalUrl).toContain('example.com');
            expect(result.canonicalUrl).toContain('/Path/To/Page');
        }
    });
});
