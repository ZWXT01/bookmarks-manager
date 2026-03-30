import type { Db } from '../../src/db';
import type {
    AIChatCompletionRequest,
    AIChatCompletionResponse,
    AIClientFactory,
    AIClientFactoryOptions,
} from '../../src/ai-client';
import { applyTemplate, createTemplate, type CategoryNode, type TemplateRow } from '../../src/template-service';

export interface SeedAISettingsOptions {
    baseUrl?: string;
    apiKey?: string;
    model?: string;
    batchSize?: number | string;
}

export interface MockAICall extends AIClientFactoryOptions, AIChatCompletionRequest {
    callIndex: number;
}

export type MockAIStep =
    | AIChatCompletionResponse
    | Error
    | ((call: MockAICall) => AIChatCompletionResponse | Promise<AIChatCompletionResponse>);

export interface QueuedAIHarness {
    aiClientFactory: AIClientFactory;
    calls: MockAICall[];
    remainingSteps: () => number;
}

export const AI_TEST_TEMPLATE_TREE: CategoryNode[] = [
    {
        name: '技术开发',
        children: [{ name: '前端' }, { name: '后端' }],
    },
    {
        name: '学习资源',
        children: [{ name: '文档' }],
    },
];

function upsertSetting(db: Db, key: string, value: string): void {
    db.prepare(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    ).run(key, value);
}

export function seedAISettings(db: Db, options: SeedAISettingsOptions = {}): {
    baseUrl: string;
    apiKey: string;
    model: string;
    batchSize: string;
} {
    const config = {
        baseUrl: options.baseUrl ?? 'https://mock-ai.example.test/v1',
        apiKey: options.apiKey ?? 'test-ai-key',
        model: options.model ?? 'mock-model',
        batchSize: String(options.batchSize ?? 30),
    };

    upsertSetting(db, 'ai_base_url', config.baseUrl);
    upsertSetting(db, 'ai_api_key', config.apiKey);
    upsertSetting(db, 'ai_model', config.model);
    upsertSetting(db, 'ai_batch_size', config.batchSize);

    return config;
}

function responseFromStep(step: MockAIStep, call: MockAICall): Promise<AIChatCompletionResponse> {
    if (step instanceof Error) return Promise.reject(step);
    if (typeof step === 'function') return Promise.resolve(step(call));
    return Promise.resolve(step);
}

export function createQueuedAIHarness(steps: MockAIStep[]): QueuedAIHarness {
    const queue = [...steps];
    const calls: MockAICall[] = [];

    return {
        aiClientFactory: (options) => ({
            createChatCompletion: async (request) => {
                const call: MockAICall = {
                    ...options,
                    ...request,
                    callIndex: calls.length,
                };
                calls.push(call);

                const step = queue.shift();
                if (!step) {
                    throw new Error(`missing AI fixture for call ${call.callIndex + 1}`);
                }

                return responseFromStep(step, call);
            },
        }),
        calls,
        remainingSteps: () => queue.length,
    };
}

export function activateAiTestTemplate(db: Db, name = 'AI 测试模板'): TemplateRow {
    const template = createTemplate(db, name, AI_TEST_TEMPLATE_TREE);
    applyTemplate(db, template.id);
    return template;
}

export function textCompletion(content: string): AIChatCompletionResponse {
    return {
        choices: [{
            message: { content },
        }],
    };
}

export function jsonCompletion(value: unknown): AIChatCompletionResponse {
    return textCompletion(JSON.stringify(value));
}

export function sseCompletion(chunks: string[]): AIChatCompletionResponse {
    const streamChunks = chunks.map((content, index) => `data: ${JSON.stringify({
        id: `chunk-${index + 1}`,
        object: 'chat.completion.chunk',
        created: 1,
        model: 'mock-model',
        choices: [{
            index: 0,
            delta: { content },
            finish_reason: null,
        }],
    })}`);
    streamChunks.push(`data: ${JSON.stringify({
        id: `chunk-${chunks.length + 1}`,
        object: 'chat.completion.chunk',
        created: 1,
        model: 'mock-model',
        choices: [{
            index: 0,
            delta: {},
            finish_reason: 'stop',
        }],
    })}`);
    streamChunks.push('data: [DONE]');
    return `${streamChunks.join('\n\n')}\n`;
}
