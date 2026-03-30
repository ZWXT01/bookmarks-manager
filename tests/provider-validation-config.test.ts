import { afterEach, describe, expect, it } from 'vitest';

import { loadValidationAIConfig, parseValidationProviderName } from '../src/provider-validation-config';
import { createTestDb } from './helpers/db';

describe('provider validation config', () => {
    const envKeys = ['H1_AI_BASE_URL', 'H1_AI_API_KEY', 'H1_AI_MODEL', 'H1_AI_BATCH_SIZE'] as const;

    afterEach(() => {
        for (const key of envKeys) delete process.env[key];
    });

    it('defaults to grok validation keys when present', () => {
        const { db, cleanup } = createTestDb();
        try {
            db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('validation_grok_api_key', 'grok-secret');

            const loaded = loadValidationAIConfig(db.name, 'grok');
            expect(loaded.provider).toBe('grok');
            expect(loaded.source).toBe('validation_grok_db');
            expect(loaded.config).toEqual({
                baseUrl: 'https://grok2api.1018666.xyz/v1',
                apiKey: 'grok-secret',
                model: 'grok-4',
                batchSize: '30',
            });
        } finally {
            cleanup();
        }
    });

    it('falls back to current settings when the active config already points to grok', () => {
        const { db, cleanup } = createTestDb();
        try {
            db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('ai_base_url', 'https://grok2api.1018666.xyz/v1');
            db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('ai_api_key', 'active-grok-key');
            db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('ai_model', 'grok-4');
            db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('ai_batch_size', '42');

            const loaded = loadValidationAIConfig(db.name, 'grok');
            expect(loaded.provider).toBe('grok');
            expect(loaded.source).toBe('settings_db');
            expect(loaded.config).toEqual({
                baseUrl: 'https://grok2api.1018666.xyz/v1',
                apiKey: 'active-grok-key',
                model: 'grok-4',
                batchSize: '42',
            });
        } finally {
            cleanup();
        }
    });

    it('reads the active provider when current is requested', () => {
        const { db, cleanup } = createTestDb();
        try {
            db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('ai_base_url', 'https://api.example.test/v1');
            db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('ai_api_key', 'current-key');
            db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('ai_model', 'current-model');
            db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('ai_batch_size', '18');

            const loaded = loadValidationAIConfig(db.name, 'current');
            expect(loaded.provider).toBe('current');
            expect(loaded.source).toBe('settings_db');
            expect(loaded.config).toEqual({
                baseUrl: 'https://api.example.test/v1',
                apiKey: 'current-key',
                model: 'current-model',
                batchSize: '18',
            });
        } finally {
            cleanup();
        }
    });

    it('accepts env overrides regardless of selected provider', () => {
        process.env.H1_AI_BASE_URL = 'https://env.example.test/v1';
        process.env.H1_AI_API_KEY = 'env-key';
        process.env.H1_AI_MODEL = 'env-model';
        process.env.H1_AI_BATCH_SIZE = '9';

        const loaded = loadValidationAIConfig('/missing.db', 'grok');
        expect(loaded.provider).toBe('grok');
        expect(loaded.source).toBe('env');
        expect(loaded.config).toEqual({
            baseUrl: 'https://env.example.test/v1',
            apiKey: 'env-key',
            model: 'env-model',
            batchSize: '9',
        });
    });

    it('parses supported provider names and rejects unknown ones', () => {
        expect(parseValidationProviderName(undefined)).toBe('grok');
        expect(parseValidationProviderName('grok')).toBe('grok');
        expect(parseValidationProviderName('current')).toBe('current');
        expect(() => parseValidationProviderName('openai')).toThrow('unknown provider: openai');
    });
});
