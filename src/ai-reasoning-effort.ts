export const AI_REASONING_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const;

export type AIReasoningEffort = typeof AI_REASONING_EFFORTS[number];

const AI_REASONING_EFFORT_SET = new Set<string>(AI_REASONING_EFFORTS);

export function formatAiReasoningEffort(value: unknown): AIReasoningEffort | '' {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!raw || raw === 'default' || raw === 'auto') return '';
  return AI_REASONING_EFFORT_SET.has(raw) ? raw as AIReasoningEffort : '';
}

export function withAiReasoningEffort<T extends Record<string, unknown>>(
  request: T,
  reasoningEffort: unknown,
): T & { reasoning_effort?: AIReasoningEffort } {
  const effort = formatAiReasoningEffort(reasoningEffort);
  if (!effort) return request;
  return { ...request, reasoning_effort: effort };
}
