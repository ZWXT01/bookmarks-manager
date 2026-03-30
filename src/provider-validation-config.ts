import fs from 'fs';

import Database from 'better-sqlite3';

export interface ValidationAIConfig {
    baseUrl: string;
    apiKey: string;
    model: string;
    batchSize: string;
}

export type ValidationProviderName = 'grok' | 'current';
export type ValidationProviderSource = 'env' | 'validation_grok_db' | 'settings_db';

export interface LoadedValidationAIConfig {
    provider: ValidationProviderName;
    source: ValidationProviderSource;
    config: ValidationAIConfig;
}

const DEFAULT_BATCH_SIZE = '30';

const GROK_VALIDATION_DEFAULTS = {
    baseUrl: 'https://grok2api.1018666.xyz/v1',
    model: 'grok-4',
    batchSize: DEFAULT_BATCH_SIZE,
};

function normalizeBatchSize(value: string | null | undefined, fallback = DEFAULT_BATCH_SIZE): string {
    return (value ?? fallback).trim() || fallback;
}

function readCurrentConfig(map: Map<string, string>): ValidationAIConfig {
    return {
        baseUrl: (map.get('ai_base_url') ?? '').trim(),
        apiKey: (map.get('ai_api_key') ?? '').trim(),
        model: (map.get('ai_model') ?? '').trim(),
        batchSize: normalizeBatchSize(map.get('ai_batch_size')),
    };
}

function readValidationGrokConfig(map: Map<string, string>, current: ValidationAIConfig): ValidationAIConfig {
    const validationKey = (map.get('validation_grok_api_key') ?? '').trim();
    const currentLooksLikeGrok =
        current.baseUrl === GROK_VALIDATION_DEFAULTS.baseUrl &&
        current.model === GROK_VALIDATION_DEFAULTS.model &&
        Boolean(current.apiKey);

    return {
        baseUrl: (map.get('validation_grok_base_url') ?? '').trim() || current.baseUrl || GROK_VALIDATION_DEFAULTS.baseUrl,
        apiKey: validationKey || (currentLooksLikeGrok ? current.apiKey : ''),
        model: (map.get('validation_grok_model') ?? '').trim() || current.model || GROK_VALIDATION_DEFAULTS.model,
        batchSize: normalizeBatchSize(
            map.get('validation_grok_batch_size'),
            current.batchSize || GROK_VALIDATION_DEFAULTS.batchSize,
        ),
    };
}

export function parseValidationProviderName(rawValue: string | null | undefined): ValidationProviderName {
    const normalized = (rawValue ?? '').trim().toLowerCase();
    if (!normalized || normalized === 'grok') return 'grok';
    if (normalized === 'current') return 'current';
    throw new Error(`unknown provider: ${rawValue}`);
}

export function loadValidationAIConfig(
    sourceDbPath: string,
    provider: ValidationProviderName = 'grok',
): LoadedValidationAIConfig {
    const envBaseUrl = process.env.H1_AI_BASE_URL?.trim();
    const envApiKey = process.env.H1_AI_API_KEY?.trim();
    const envModel = process.env.H1_AI_MODEL?.trim();
    const envBatchSize = process.env.H1_AI_BATCH_SIZE?.trim();

    if (envBaseUrl && envApiKey && envModel) {
        return {
            provider,
            source: 'env',
            config: {
                baseUrl: envBaseUrl,
                apiKey: envApiKey,
                model: envModel,
                batchSize: normalizeBatchSize(envBatchSize),
            },
        };
    }

    if (!fs.existsSync(sourceDbPath)) {
        throw new Error(`source DB not found: ${sourceDbPath}`);
    }

    const db = new Database(sourceDbPath, { readonly: true });
    try {
        const rows = db.prepare('SELECT key, value FROM settings WHERE key IN (?,?,?,?,?,?,?,?)')
            .all(
                'ai_base_url',
                'ai_api_key',
                'ai_model',
                'ai_batch_size',
                'validation_grok_base_url',
                'validation_grok_api_key',
                'validation_grok_model',
                'validation_grok_batch_size',
            ) as Array<{ key: string; value: string }>;
        const map = new Map(rows.map((row) => [row.key, row.value]));
        const currentConfig = readCurrentConfig(map);

        if (provider === 'current') {
            if (!currentConfig.baseUrl || !currentConfig.apiKey || !currentConfig.model) {
                throw new Error('source DB does not contain a complete active AI configuration');
            }
            return { provider, source: 'settings_db', config: currentConfig };
        }

        const grokConfig = readValidationGrokConfig(map, currentConfig);
        if (!grokConfig.apiKey) {
            throw new Error(
                'source DB does not contain a complete Grok validation configuration; populate validation_grok_api_key or keep current ai_* settings pointed at Grok',
            );
        }

        const source: ValidationProviderSource = (map.get('validation_grok_api_key') ?? '').trim()
            ? 'validation_grok_db'
            : 'settings_db';
        return { provider, source, config: grokConfig };
    } finally {
        db.close();
    }
}
