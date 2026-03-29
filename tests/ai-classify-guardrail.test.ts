import { describe, expect, it } from 'vitest';

import { selectDeterministicSingleClassifyCategory, selectSingleClassifyCategory } from '../src/ai-classify-guardrail';

describe('single classify semantic guardrail', () => {
    const developerPaths = [
        '框架与库',
        '框架与库/前端框架',
        '学习资源',
        '学习资源/官方文档',
        '学习资源/系列教程',
        '学习资源/代码示例',
        '技术社区',
        '技术社区/GitHub',
    ];

    it('keeps the topical framework bucket when there is no stronger learning signal', () => {
        expect(selectSingleClassifyCategory({
            rawCategory: '框架与库/前端框架/React',
            allowedPaths: developerPaths,
            title: 'React 官网',
            url: 'https://react.dev/',
        })).toBe('框架与库/前端框架');
    });

    it('reranks a valid but semantically weaker framework result into official docs when docs signals are strong', () => {
        expect(selectSingleClassifyCategory({
            rawCategory: '框架与库/前端框架',
            allowedPaths: developerPaths,
            title: 'React useState Reference',
            url: 'https://react.dev/reference/react/useState',
        })).toBe('学习资源/官方文档');
    });

    it('rescues an unmapped provider result into code examples when example signals are strong', () => {
        expect(selectSingleClassifyCategory({
            rawCategory: '完全不存在/随便',
            allowedPaths: developerPaths,
            title: 'TanStack Query Examples',
            url: 'https://tanstack.com/query/latest/docs/framework/react/examples/basic',
        })).toBe('学习资源/代码示例');
    });

    it('uses host signals to recover community categories even when the provider output is noisy', () => {
        expect(selectSingleClassifyCategory({
            rawCategory: '其他/社区',
            allowedPaths: developerPaths,
            title: 'facebook/react',
            url: 'https://github.com/facebook/react',
        })).toBe('技术社区/GitHub');
    });

    it('can classify from deterministic signals alone when the provider is unavailable', () => {
        expect(selectDeterministicSingleClassifyCategory({
            allowedPaths: developerPaths,
            title: 'React useState Reference',
            url: 'https://react.dev/reference/react/useState',
        })).toBe('学习资源/官方文档');
    });
});
