import { describe, expect, it } from 'vitest';

import { extractAICompletionText } from '../src/ai-client';

describe('ai client response parsing', () => {
    it('extracts text from standard completion responses', () => {
        expect(extractAICompletionText({
            choices: [{
                message: { content: '学习资源/官方文档' },
            }],
        })).toBe('学习资源/官方文档');
    });

    it('extracts the final answer from sse-style think responses', () => {
        const raw = [
            'data: {"choices":[{"delta":{"content":"<think>\\n"}}]}',
            'data: {"choices":[{"delta":{"content":"browse_page {\\"url\\":\\"https://react.dev/reference/react/useState\\"}\\n"}}]}',
            'data: {"choices":[{"delta":{"content":"</think>\\n"}}]}',
            'data: {"choices":[{"delta":{"content":"学习资源"}}]}',
            'data: {"choices":[{"delta":{"content":"/"}}]}',
            'data: {"choices":[{"delta":{"content":"官方文档"}}]}',
            'data: [DONE]',
        ].join('\n\n');

        expect(extractAICompletionText(raw)).toBe('学习资源/官方文档');
    });

    it('keeps json payloads returned through sse chunks', () => {
        const raw = [
            'data: {"choices":[{"delta":{"content":"<think>ignore</think>"}}]}',
            'data: {"choices":[{"delta":{"content":"{\\"assignments\\":[{\\"index\\":1,\\"category\\":\\"技术开发/前端\\"}]}"}}]}',
            'data: [DONE]',
        ].join('\n\n');

        expect(extractAICompletionText(raw)).toBe('{"assignments":[{"index":1,"category":"技术开发/前端"}]}');
    });
});
