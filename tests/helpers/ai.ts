import type { Db } from '../../src/db';
import type {
    AIChatCompletionRequest,
    AIChatCompletionResponse,
    AIClientFactory,
    AIClientFactoryOptions,
} from '../../src/ai-client';

export interface SeedAISettingsOptions {
    baseUrl?: string;
    apiKey?: string;
    model?: string;
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

function upsertSetting(db: Db, key: string, value: string): void {
    db.prepare(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    ).run(key, value);
}

export function seedAISettings(db: Db, options: SeedAISettingsOptions = {}): {
    baseUrl: string;
    apiKey: string;
    model: string;
} {
    const config = {
        baseUrl: options.baseUrl ?? 'https://mock-ai.example.test/v1',
        apiKey: options.apiKey ?? 'test-ai-key',
        model: options.model ?? 'mock-model',
    };

    upsertSetting(db, 'ai_base_url', config.baseUrl);
    upsertSetting(db, 'ai_api_key', config.apiKey);
    upsertSetting(db, 'ai_model', config.model);

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
