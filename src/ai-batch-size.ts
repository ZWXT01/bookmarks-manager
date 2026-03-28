import { VALID_BATCH_SIZES, type BatchSize } from './ai-organize';

export const DEFAULT_AI_BATCH_SIZE: BatchSize = 30;

export function parseAiBatchSize(value: unknown): BatchSize | null {
  const raw = typeof value === 'string' ? value.trim() : value;
  if (raw === '' || raw === null || raw === undefined) return null;

  const numeric = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isInteger(numeric)) return null;
  if (!VALID_BATCH_SIZES.includes(numeric as BatchSize)) return null;
  return numeric as BatchSize;
}

export function getConfiguredAiBatchSize(value: unknown, fallback: BatchSize = DEFAULT_AI_BATCH_SIZE): BatchSize {
  return parseAiBatchSize(value) ?? fallback;
}

export function formatAiBatchSize(value: unknown, fallback: BatchSize = DEFAULT_AI_BATCH_SIZE): string {
  return String(getConfiguredAiBatchSize(value, fallback));
}
