import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from './helpers/db.ts';
import type { Db } from '../src/db';
import {
  createPlan,
  getPlan,
  updatePlan,
  deletePlan,
  transitionStatus,
  getActivePlan,
  PlanError,
  recoverStalePlans,
} from '../src/ai-organize-plan';
import { createJob, getJob } from '../src/jobs';

type LogRow = { plan_id: string; from_status: string | null; to_status: string; reason: string; created_at: string };

function getLogs(db: Db, planId: string): LogRow[] {
  return db.prepare('SELECT * FROM plan_state_logs WHERE plan_id = ? ORDER BY id').all(planId) as LogRow[];
}

describe('ai-organize-plan', () => {
  let db: Db;
  let cleanup: () => void;

  beforeEach(() => {
    const ctx = createTestDb();
    db = ctx.db;
    cleanup = ctx.cleanup;
  });

  afterEach(() => cleanup());

  describe('createPlan timeout cleanup', () => {
    it('should clean up designing plan older than 2h and allow new plan', () => {
      const old = createPlan(db, 'all');
      // backdate created_at to 2h+1ms ago
      const past = new Date(Date.now() - 7_200_001).toISOString();
      db.prepare('UPDATE ai_organize_plans SET created_at = ? WHERE id = ?').run(past, old.id);

      const fresh = createPlan(db, 'all');
      expect(fresh.id).not.toBe(old.id);
      expect(getPlan(db, old.id)!.status).toBe('error');

      const logs = getLogs(db, old.id);
      expect(logs.some(l => l.to_status === 'error' && l.reason === 'timeout')).toBe(true);
    });

    it('should clean up assigning plan older than 2h', () => {
      const old = createPlan(db, 'all');
      transitionStatus(db, old.id, 'assigning');
      const past = new Date(Date.now() - 7_200_001).toISOString();
      db.prepare('UPDATE ai_organize_plans SET created_at = ? WHERE id = ?').run(past, old.id);

      const fresh = createPlan(db, 'all');
      expect(fresh.id).not.toBe(old.id);
      expect(getPlan(db, old.id)!.status).toBe('error');
    });

    it('should NOT clean up preview plan even if old', () => {
      const old = createPlan(db, 'all');
      transitionStatus(db, old.id, 'preview');
      const past = new Date(Date.now() - 7_200_001).toISOString();
      db.prepare('UPDATE ai_organize_plans SET created_at = ? WHERE id = ?').run(past, old.id);

      // Preview plans are not checked by createPlan's timeout cleanup (only 'assigning' status)
      // So this should succeed and create a new plan
      const fresh = createPlan(db, 'all');
      expect(fresh.id).not.toBe(old.id);
      // Old plan should remain in preview status (not cleaned up)
      expect(getPlan(db, old.id)!.status).toBe('preview');
    });

    it('should not clean up designing plan within 2h', () => {
      const old = createPlan(db, 'all');
      // backdate to comfortably within the window (avoid timing flake)
      const past = new Date(Date.now() - 7_140_000).toISOString();
      db.prepare('UPDATE ai_organize_plans SET created_at = ? WHERE id = ?').run(past, old.id);

      expect(() => createPlan(db, 'all')).toThrow('active plan already exists');
    });

    it('should not fail timeout cleanup when job record is missing', () => {
      const old = createPlan(db, 'all');
      // Manually create and link a job, then delete it to simulate orphaned reference
      const jobId = 'test-job-' + Date.now();
      const now = new Date().toISOString();
      db.prepare('INSERT INTO jobs (id, type, status, total, processed, inserted, skipped, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
        jobId, 'ai_organize', 'running', 0, 0, 0, 0, now, now
      );
      db.prepare('UPDATE ai_organize_plans SET job_id = ? WHERE id = ?').run(jobId, old.id);
      db.prepare('DELETE FROM jobs WHERE id = ?').run(jobId);

      const past = new Date(Date.now() - 7_200_001).toISOString();
      db.prepare('UPDATE ai_organize_plans SET created_at = ? WHERE id = ?').run(past, old.id);

      const fresh = createPlan(db, 'all');
      expect(fresh.id).not.toBe(old.id);
      expect(getPlan(db, old.id)!.status).toBe('error');
    });

    it('should attach activePlanId on 409 error', () => {
      const plan = createPlan(db, 'all');
      try {
        createPlan(db, 'all');
        expect.unreachable('should have thrown');
      } catch (e: any) {
        expect(e).toBeInstanceOf(PlanError);
        expect(e.statusCode).toBe(409);
        expect(e.activePlanId).toBe(plan.id);
      }
    });
  });

  describe('createPlan logging', () => {
    it('should log plan_created on new plan', () => {
      const plan = createPlan(db, 'all');
      const logs = getLogs(db, plan.id);
      expect(logs).toHaveLength(1);
      expect(logs[0].from_status).toBeNull();
      expect(logs[0].to_status).toBe('assigning');
      expect(logs[0].reason).toBe('plan_created');
    });
  });

  describe('transitionStatus logging', () => {
    it('should log state changes with default reasons', () => {
      const plan = createPlan(db, 'all');
      // Plan already starts in 'assigning' status
      transitionStatus(db, plan.id, 'preview');

      const logs = getLogs(db, plan.id);
      // plan_created + preview = 2 logs
      expect(logs).toHaveLength(2);
      expect(logs[1].from_status).toBe('assigning');
      expect(logs[1].to_status).toBe('preview');
      expect(logs[1].reason).toBe('assignment_complete');
    });

    it('should use custom reason when provided', () => {
      const plan = createPlan(db, 'all');
      transitionStatus(db, plan.id, 'canceled', 'user_abort');
      const logs = getLogs(db, plan.id);
      expect(logs[1].reason).toBe('user_abort');
    });

    it('should not log on no-op transitions', () => {
      const plan = createPlan(db, 'all');
      transitionStatus(db, plan.id, 'canceled');
      const before = getLogs(db, plan.id).length;
      // canceled is terminal, transitioning again is no-op
      transitionStatus(db, plan.id, 'canceled');
      expect(getLogs(db, plan.id).length).toBe(before);
    });

    it('should maintain log chain consistency', () => {
      const plan = createPlan(db, 'all');
      // Plan already starts in 'assigning' status
      transitionStatus(db, plan.id, 'preview');
      transitionStatus(db, plan.id, 'applied');

      const logs = getLogs(db, plan.id);
      for (let i = 1; i < logs.length; i++) {
        expect(logs[i].from_status).toBe(logs[i - 1].to_status);
      }
    });

    it('should reject retrying to assigning when another plan is already assigning', () => {
      const failedPlan = createPlan(db, 'all');
      transitionStatus(db, failedPlan.id, 'canceled');
      updatePlan(db, failedPlan.id, { status: 'failed', phase: null });
      const activePlan = createPlan(db, 'all');

      expect(() => transitionStatus(db, failedPlan.id, 'assigning')).toThrowError(PlanError);

      try {
        transitionStatus(db, failedPlan.id, 'assigning');
        expect.unreachable('should have thrown');
      } catch (e: any) {
        expect(e).toBeInstanceOf(PlanError);
        expect(e.statusCode).toBe(409);
        expect(e.activePlanId).toBe(activePlan.id);
      }
    });

    it('should surface not found as a 404 plan error', () => {
      expect(() => transitionStatus(db, 'missing-plan', 'canceled')).toThrowError(PlanError);

      try {
        transitionStatus(db, 'missing-plan', 'canceled');
        expect.unreachable('should have thrown');
      } catch (e: any) {
        expect(e).toBeInstanceOf(PlanError);
        expect(e.statusCode).toBe(404);
        expect(e.message).toBe('plan not found');
      }
    });
  });

  describe('getActivePlan', () => {
    it('should return null when no active plan', () => {
      expect(getActivePlan(db)).toBeNull();
    });

    it('should return null when only terminal plans exist', () => {
      const plan = createPlan(db, 'all');
      transitionStatus(db, plan.id, 'canceled');
      expect(getActivePlan(db)).toBeNull();
    });

    it('should return the active plan', () => {
      const plan = createPlan(db, 'all');
      const active = getActivePlan(db);
      expect(active).not.toBeNull();
      expect(active!.id).toBe(plan.id);
    });
  });

  describe('cascade delete', () => {
    it('should delete logs when plan is deleted', () => {
      const plan = createPlan(db, 'all');
      transitionStatus(db, plan.id, 'canceled');
      expect(getLogs(db, plan.id).length).toBeGreaterThan(0);

      deletePlan(db, plan.id);
      expect(getLogs(db, plan.id)).toHaveLength(0);
    });
  });

  describe('recoverStalePlans', () => {
    it('marks assigning plans as error after restart and fails linked jobs', () => {
      const job = createJob(db, 'ai_organize', 'restart recovery', 0);
      const plan = createPlan(db, 'all');
      updatePlan(db, plan.id, { job_id: job.id });

      const recovered = recoverStalePlans(db);

      expect(recovered).toBe(1);
      expect(getPlan(db, plan.id)!.status).toBe('error');
      expect(getPlan(db, plan.id)!.phase).toBeNull();
      expect(getJob(db, job.id)!.status).toBe('failed');
      expect(getJob(db, job.id)!.message).toBe('server restart');

      const logs = getLogs(db, plan.id);
      expect(logs.some(l => l.to_status === 'error' && l.reason === 'server_restart')).toBe(true);
    });
  });
});
