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

export interface AIChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
}

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
