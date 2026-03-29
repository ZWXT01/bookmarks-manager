import { randomUUID } from 'crypto';

import type { Db } from './db';

type LoggerLike = {
  error: (obj: any, msg?: string) => void;
  warn?: (obj: any, msg?: string) => void;
  info?: (obj: any, msg?: string) => void;
};

let jobQueueLogger: LoggerLike | null = null;

export function setJobQueueLogger(logger: LoggerLike): void {
  jobQueueLogger = logger;
}

export type ActiveJobType = 'import' | 'check' | 'ai_organize';
export type LegacyJobType = 'ai_classify' | 'ai_simplify';
export type JobType = ActiveJobType | LegacyJobType;
export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'canceled';

export type JobRow = {
  id: string;
  type: JobType;
  status: JobStatus;
  total: number;
  processed: number;
  inserted: number;
  skipped: number;
  failed: number;
  message: string | null;
  created_at: string;
  updated_at: string;
};

export type JobFailureRow = {
  id: number;
  job_id: string;
  input: string;
  reason: string;
};

type Subscriber = (job: JobRow) => void;
type EventSubscriber = (eventName: string, data: any) => void;

const subscribers = new Map<string, Set<Subscriber>>();
const eventSubscribers = new Map<string, Set<EventSubscriber>>();

export function subscribeJob(jobId: string, fn: Subscriber): () => void {
  const set = subscribers.get(jobId) ?? new Set<Subscriber>();
  set.add(fn);
  subscribers.set(jobId, set);

  return () => {
    const cur = subscribers.get(jobId);
    if (!cur) return;
    cur.delete(fn);
    if (cur.size === 0) subscribers.delete(jobId);
  };
}

export function subscribeJobEvent(jobId: string, fn: EventSubscriber): () => void {
  const set = eventSubscribers.get(jobId) ?? new Set<EventSubscriber>();
  set.add(fn);
  eventSubscribers.set(jobId, set);
  return () => {
    const cur = eventSubscribers.get(jobId);
    if (!cur) return;
    cur.delete(fn);
    if (cur.size === 0) eventSubscribers.delete(jobId);
  };
}

export function publishJobEvent(jobId: string, eventName: string, data: any): void {
  const set = eventSubscribers.get(jobId);
  if (!set) return;
  for (const fn of set) fn(eventName, data);
}

function publish(job: JobRow): void {
  const set = subscribers.get(job.id);
  if (!set) return;
  for (const fn of set) fn(job);
}

export function getJob(db: Db, jobId: string): JobRow | null {
  const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId) as JobRow | undefined;
  return row ?? null;
}

export function listJobFailures(db: Db, jobId: string, limit = 200): JobFailureRow[] {
  return db
    .prepare('SELECT id, job_id, input, reason FROM job_failures WHERE job_id = ? ORDER BY id DESC LIMIT ?')
    .all(jobId, limit) as JobFailureRow[];
}

export function countJobFailures(db: Db, jobId: string): number {
  const row = db.prepare('SELECT COUNT(1) AS cnt FROM job_failures WHERE job_id = ?').get(jobId) as { cnt: number } | undefined;
  return row ? row.cnt : 0;
}

export function listJobFailuresPaged(db: Db, jobId: string, limit: number, offset: number): JobFailureRow[] {
  return db
    .prepare('SELECT id, job_id, input, reason FROM job_failures WHERE job_id = ? ORDER BY id DESC LIMIT ? OFFSET ?')
    .all(jobId, limit, offset) as JobFailureRow[];
}

function pruneJobs(db: Db, keepDoneFailed: number): void {
  const running = db
    .prepare("SELECT id FROM jobs WHERE status IN ('queued','running') ORDER BY created_at DESC")
    .all() as Array<{ id: string }>;

  const finished = db
    .prepare("SELECT id FROM jobs WHERE status IN ('done','failed','canceled') ORDER BY created_at DESC LIMIT ?")
    .all(keepDoneFailed) as Array<{ id: string }>;

  const keepIds = Array.from(new Set([...running.map((x) => x.id), ...finished.map((x) => x.id)]));
  if (keepIds.length === 0) return;

  const placeholders = keepIds.map(() => '?').join(',');
  db.prepare(`DELETE FROM jobs WHERE id NOT IN (${placeholders})`).run(...keepIds);
}

export function pruneJobsToRecent(db: Db, keepDoneFailed = 10): void {
  pruneJobs(db, keepDoneFailed);
}

export function createJob(db: Db, type: ActiveJobType, message: string | null, total?: number): JobRow {
  const id = randomUUID();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO jobs (id, type, status, total, processed, inserted, skipped, failed, message, created_at, updated_at)
     VALUES (?, ?, 'queued', ?, 0, 0, 0, 0, ?, ?, ?)`,
  ).run(id, type, total ?? 0, message, now, now);

  const job = getJob(db, id);
  if (!job) throw new Error('create job failed');
  publish(job);
  return job;
}

export function updateJob(db: Db, jobId: string, patch: Partial<Omit<JobRow, 'id' | 'type' | 'created_at'>>): JobRow {
  const now = new Date().toISOString();

  const current = getJob(db, jobId);
  if (!current) throw new Error('job not found');

  const next: JobRow = {
    ...current,
    ...patch,
    updated_at: now,
  };

  db.prepare(
    `UPDATE jobs
     SET status = ?, total = ?, processed = ?, inserted = ?, skipped = ?, failed = ?, message = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    next.status,
    next.total,
    next.processed,
    next.inserted,
    next.skipped,
    next.failed,
    next.message,
    next.updated_at,
    jobId,
  );

  const job = getJob(db, jobId);
  if (!job) throw new Error('job update failed');
  publish(job);

  if (patch.status === 'done' || patch.status === 'failed' || patch.status === 'canceled') {
    try {
      pruneJobs(db, 10);
    } catch (err) {
      if (jobQueueLogger) jobQueueLogger.warn?.({ err }, 'prune jobs failed');
    }
  }
  return job;
}

export function addJobFailure(db: Db, jobId: string, input: string, reason: string): void {
  db.prepare('INSERT INTO job_failures (job_id, input, reason) VALUES (?, ?, ?)').run(jobId, input, reason);
}

export class JobQueue {
  private running = false;
  private queue: Array<{ jobId: string; fn: () => Promise<void> }> = [];
  private currentJobId: string | null = null;
  private canceledJobs = new Set<string>();
  private idleResolvers = new Set<() => void>();

  enqueue(jobId: string, fn: () => Promise<void>): void {
    this.queue.push({ jobId, fn });
    this.tryRun().catch((err) => {
      if (jobQueueLogger) jobQueueLogger.error({ err }, 'job queue runner crashed');
    });
  }

  cancelJob(jobId: string): void {
    this.canceledJobs.add(jobId);
    // 从队列中移除
    this.queue = this.queue.filter((item) => item.jobId !== jobId);
    this.resolveIdle();
  }

  cancelAll(): void {
    // 取消所有排队的任务
    for (const item of this.queue) {
      this.canceledJobs.add(item.jobId);
    }

    this.queue = [];

    // 标记当前正在运行的任务为取消
    if (this.currentJobId) {
      this.canceledJobs.add(this.currentJobId);
    }

    this.resolveIdle();
  }

  onIdle(): Promise<void> {
    if (this.isIdle()) return Promise.resolve();

    return new Promise((resolve) => {
      this.idleResolvers.add(resolve);
    });
  }

  clearForTests(): void {
    this.queue = [];
    this.currentJobId = null;
    this.canceledJobs.clear();
    this.running = false;
    this.resolveIdle();
  }

  private isIdle(): boolean {
    return !this.running && this.queue.length === 0 && this.currentJobId === null;
  }

  private resolveIdle(): void {
    if (!this.isIdle()) return;
    for (const resolve of this.idleResolvers) resolve();
    this.idleResolvers.clear();
  }

  isCanceled(jobId: string): boolean {
    return this.canceledJobs.has(jobId);
  }

  clearCanceled(jobId: string): void {
    this.canceledJobs.delete(jobId);
  }

  private async tryRun(): Promise<void> {
    if (this.running) return;
    this.running = true;

    try {
      while (this.queue.length > 0) {
        const item = this.queue.shift();
        if (!item) continue;
        
        // 检查是否已被取消
        if (this.canceledJobs.has(item.jobId)) {
          this.canceledJobs.delete(item.jobId);
          continue;
        }

        this.currentJobId = item.jobId;
        try {
          await item.fn();
        } catch (err) {
          if (jobQueueLogger) jobQueueLogger.error({ err }, 'job queue task failed');
        } finally {
          this.currentJobId = null;
        }
      }
    } finally {
      this.running = false;
    }
  }
}

export const jobQueue = new JobQueue();

export function clearJobSubscriptionsForTests(): void {
  subscribers.clear();
  eventSubscribers.clear();
}

export async function resetJobRuntimeForTests(): Promise<void> {
  jobQueue.cancelAll();
  await jobQueue.onIdle();
  jobQueue.clearForTests();
  clearJobSubscriptionsForTests();
}
