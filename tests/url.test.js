"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const url_1 = require("../src/url");
(0, vitest_1.describe)('canonicalizeUrl', () => {
    (0, vitest_1.it)('should normalize a standard URL', () => {
        const result = (0, url_1.canonicalizeUrl)('https://Example.COM/path/');
        (0, vitest_1.expect)(result.ok).toBe(true);
        if (!result.ok)
            return;
        (0, vitest_1.expect)(result.canonicalUrl).toBe('https://example.com/path');
    });
    (0, vitest_1.it)('should auto-prepend https:// when missing', () => {
        const result = (0, url_1.canonicalizeUrl)('example.com/page');
        (0, vitest_1.expect)(result.ok).toBe(true);
        if (!result.ok)
            return;
        (0, vitest_1.expect)(result.normalizedUrl).toBe('https://example.com/page');
    });
    (0, vitest_1.it)('should strip hash fragments', () => {
        const result = (0, url_1.canonicalizeUrl)('https://example.com/page#section');
        (0, vitest_1.expect)(result.ok).toBe(true);
        if (!result.ok)
            return;
        (0, vitest_1.expect)(result.canonicalUrl).toBe('https://example.com/page');
    });
    (0, vitest_1.it)('should remove UTM tracking parameters', () => {
        const result = (0, url_1.canonicalizeUrl)('https://example.com/page?utm_source=google&utm_medium=cpc&id=123');
        (0, vitest_1.expect)(result.ok).toBe(true);
        if (!result.ok)
            return;
        (0, vitest_1.expect)(result.canonicalUrl).toBe('https://example.com/page?id=123');
    });
    (0, vitest_1.it)('should remove gclid and fbclid', () => {
        const result = (0, url_1.canonicalizeUrl)('https://example.com/?gclid=abc&fbclid=def&keep=1');
        (0, vitest_1.expect)(result.ok).toBe(true);
        if (!result.ok)
            return;
        (0, vitest_1.expect)(result.canonicalUrl).toBe('https://example.com/?keep=1');
    });
    (0, vitest_1.it)('should sort query parameters alphabetically', () => {
        const result = (0, url_1.canonicalizeUrl)('https://example.com/?z=1&a=2&m=3');
        (0, vitest_1.expect)(result.ok).toBe(true);
        if (!result.ok)
            return;
        (0, vitest_1.expect)(result.canonicalUrl).toBe('https://example.com/?a=2&m=3&z=1');
    });
    (0, vitest_1.it)('should strip default ports (443 for https, 80 for http)', () => {
        const r1 = (0, url_1.canonicalizeUrl)('https://example.com:443/path');
        (0, vitest_1.expect)(r1.ok).toBe(true);
        if (r1.ok)
            (0, vitest_1.expect)(r1.canonicalUrl).toBe('https://example.com/path');
        const r2 = (0, url_1.canonicalizeUrl)('http://example.com:80/path');
        (0, vitest_1.expect)(r2.ok).toBe(true);
        if (r2.ok)
            (0, vitest_1.expect)(r2.canonicalUrl).toBe('http://example.com/path');
    });
    (0, vitest_1.it)('should auto-prepend https:// to ftp:// input (no protocol check on raw input)', () => {
        // ftp:// doesn't match ^https?://, so normalizeUrlInput prepends https://
        // Result: https://ftp://example.com/file → parsed as valid HTTPS URL
        const result = (0, url_1.canonicalizeUrl)('ftp://example.com/file');
        (0, vitest_1.expect)(result.ok).toBe(true);
    });
    (0, vitest_1.it)('should reject invalid URLs', () => {
        const result = (0, url_1.canonicalizeUrl)('not a url at all !!!');
        (0, vitest_1.expect)(result.ok).toBe(false);
    });
    (0, vitest_1.it)('should handle empty/whitespace input', () => {
        const result = (0, url_1.canonicalizeUrl)('   ');
        (0, vitest_1.expect)(result.ok).toBe(false);
    });
    (0, vitest_1.it)('should remove trailing slash from path', () => {
        const result = (0, url_1.canonicalizeUrl)('https://example.com/about/');
        (0, vitest_1.expect)(result.ok).toBe(true);
        if (result.ok)
            (0, vitest_1.expect)(result.canonicalUrl).toBe('https://example.com/about');
    });
    (0, vitest_1.it)('should lowercase hostname only', () => {
        const result = (0, url_1.canonicalizeUrl)('https://Example.COM/Path/To/Page');
        (0, vitest_1.expect)(result.ok).toBe(true);
        if (result.ok) {
            (0, vitest_1.expect)(result.canonicalUrl).toContain('example.com');
            (0, vitest_1.expect)(result.canonicalUrl).toContain('/Path/To/Page');
        }
    });
});
