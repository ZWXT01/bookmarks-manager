import OpenAI from 'openai';

export interface AIChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AIChatCompletionRequest {
  model: string;
  messages: AIChatMessage[];
  temperature?: number;
  max_tokens?: number;
}

export interface AIChatCompletionMessage {
  content?: string | null | Array<{
    type?: string;
    text?: string | { value?: string | null } | null;
    content?: string | null;
  }>;
}

export interface AIChatCompletionChoice {
  message?: AIChatCompletionMessage;
  delta?: AIChatCompletionMessage;
  text?: string | null;
}

export interface StructuredAIChatCompletionResponse {
  choices?: AIChatCompletionChoice[];
}

export type AIChatCompletionResponse = StructuredAIChatCompletionResponse | string;

export interface AIClient {
  createChatCompletion(request: AIChatCompletionRequest): Promise<AIChatCompletionResponse>;
}

export interface AIClientFactoryOptions {
  apiKey: string;
  baseUrl: string;
  timeout: number;
  userAgent?: string;
}

export type AIClientFactory = (options: AIClientFactoryOptions) => AIClient;

export const DEFAULT_AI_USER_AGENT = 'bookmarks-manager/1.0';

function collectAICompletionParts(target: string[], content: unknown): void {
  if (!content) return;
  if (typeof content === 'string') {
    target.push(content);
    return;
  }
  if (!Array.isArray(content)) return;

  for (const part of content) {
    if (typeof part === 'string') {
      target.push(part);
      continue;
    }
    if (!part || typeof part !== 'object') continue;

    const rawText = (part as { text?: unknown }).text;
    if (typeof rawText === 'string' && rawText) {
      target.push(rawText);
      continue;
    }
    if (rawText && typeof rawText === 'object') {
      const nestedValue = (rawText as { value?: unknown }).value;
      if (typeof nestedValue === 'string' && nestedValue) {
        target.push(nestedValue);
        continue;
      }
    }

    const rawContent = (part as { content?: unknown }).content;
    if (typeof rawContent === 'string' && rawContent) {
      target.push(rawContent);
    }
  }
}

function cleanupAICompletionText(raw: string): string {
  return raw
    .replace(/<think>[\s\S]*?<\/think>/gi, ' ')
    .replace(/\r/g, '')
    .trim();
}

function extractSSECompletionText(rawResponse: string): string {
  const parts: string[] = [];
  let sawDataLine = false;

  for (const line of rawResponse.split(/\n+/)) {
    if (!line.startsWith('data:')) continue;
    sawDataLine = true;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;

    try {
      const parsed = JSON.parse(payload) as StructuredAIChatCompletionResponse;
      for (const choice of parsed.choices ?? []) {
        collectAICompletionParts(parts, choice.delta?.content);
        collectAICompletionParts(parts, choice.message?.content);
        if (typeof choice.text === 'string' && choice.text) parts.push(choice.text);
      }
    } catch {
      parts.push(payload);
    }
  }

  if (!sawDataLine) {
    return cleanupAICompletionText(rawResponse);
  }

  return cleanupAICompletionText(parts.join(''));
}

export function extractAICompletionText(response: AIChatCompletionResponse | null | undefined): string {
  if (!response) return '';
  if (typeof response === 'string') return extractSSECompletionText(response);

  const parts: string[] = [];
  for (const choice of response.choices ?? []) {
    collectAICompletionParts(parts, choice.message?.content);
    collectAICompletionParts(parts, choice.delta?.content);
    if (typeof choice.text === 'string' && choice.text) parts.push(choice.text);
  }
  return cleanupAICompletionText(parts.join(''));
}

export const createOpenAIClient: AIClientFactory = ({
  apiKey,
  baseUrl,
  timeout,
  userAgent = DEFAULT_AI_USER_AGENT,
}) => {
  const client = new OpenAI({
    apiKey,
    baseURL: baseUrl.replace(/\/+$/, ''),
    timeout,
    defaultHeaders: { 'User-Agent': userAgent },
  });

  return {
    async createChatCompletion(request: AIChatCompletionRequest): Promise<AIChatCompletionResponse> {
      return client.chat.completions.create(request as any) as Promise<AIChatCompletionResponse>;
    },
  };
};
