import type { Db } from './db';
import { addJobFailure, updateJob } from './jobs';
import { canonicalizeUrl } from './url';

export type CheckOptions = {
  concurrency: number;
  timeoutMs: number;
  retries?: number;
  retryDelayMs?: number;
  logger?: any;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function checkOnce(url: string, method: 'HEAD' | 'GET', timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      method,
      redirect: 'follow',
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'accept-language': 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7',
        'accept-encoding': 'gzip, deflate, br',
        'cache-control': 'no-cache',
        'pragma': 'no-cache',
        'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'document',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-site': 'none',
        'sec-fetch-user': '?1',
        'upgrade-insecure-requests': '1',
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function checkUrlWithRetry(
  url: string,
  timeoutMs: number,
  retries: number,
  retryDelayMs: number,
): Promise<{ ok: boolean; httpCode: number | null; error: string | null }> {
  let last: { ok: boolean; httpCode: number | null; error: string | null } = { ok: false, httpCode: null, error: '未知错误' };

  const attempts = Math.max(1, retries + 1);
  for (let i = 0; i < attempts; i += 1) {
    last = await checkUrl(url, timeoutMs);
    if (last.ok) return last;
    if (i < attempts - 1 && retryDelayMs > 0) {
      await sleep(retryDelayMs);
    }
  }

  return last;
}

export async function checkUrl(url: string, timeoutMs: number): Promise<{ ok: boolean; httpCode: number | null; error: string | null }> {
  const raw = String(url || '').trim();
  if (!raw) return { ok: false, httpCode: null, error: 'URL为空' };

  const canon = canonicalizeUrl(raw);
  const hasScheme = /^https?:\/\//i.test(raw);
  const candidates: string[] = canon.ok ? [canon.normalizedUrl] : [raw];
  if (!hasScheme) {
    candidates.push(`http://${raw}`);
  }

  let lastErr: { ok: boolean; httpCode: number | null; error: string | null } = { ok: false, httpCode: null, error: '网络错误' };
  for (const candidate of candidates) {
    try {
      const head = await checkOnce(candidate, 'HEAD', timeoutMs);

      if (
        head.status === 405 ||
        head.status === 501 ||
        head.status === 403 ||
        head.status === 503 ||
        head.status === 429
      ) {
        const get = await checkOnce(candidate, 'GET', timeoutMs);
        const ok = get.status >= 200 && get.status < 400;
        const res = { ok, httpCode: get.status, error: ok ? null : `HTTP ${get.status}` };
        lastErr = res;
        if (ok) return res;
        continue;
      }

      const ok = head.status >= 200 && head.status < 400;
      const res = { ok, httpCode: head.status, error: ok ? null : `HTTP ${head.status}` };
      lastErr = res;
      if (ok) return res;
    } catch (e: any) {
      const msg = typeof e?.name === 'string' && e.name === 'AbortError' ? '超时' : '网络错误';
      lastErr = { ok: false, httpCode: null, error: msg };
    }
  }

  return lastErr;
}

export async function runCheckJob(db: Db, jobId: string, bookmarkIds: number[], options: CheckOptions): Promise<void> {
  const base = db.prepare('SELECT failed FROM jobs WHERE id = ?').get(jobId) as { failed: number } | undefined;
  const baseFailed = base ? base.failed : 0;

  const statusStmt = db.prepare('SELECT status FROM jobs WHERE id = ?');
  let canceled = false;

  const retries = Math.max(0, Math.min(5, options.retries ?? 0));
  const retryDelayMs = Math.max(0, Math.min(10_000, options.retryDelayMs ?? 0));

  updateJob(db, jobId, {
    status: 'running',
    message: '正在检查',
    total: bookmarkIds.length,
    processed: 0,
  });

  const selectStmt = db.prepare('SELECT id, url FROM bookmarks WHERE id = ?');
  const updateStmt = db.prepare(
    'UPDATE bookmarks SET last_checked_at = ?, check_status = ?, check_http_code = ?, check_error = ? WHERE id = ?',
  );

  let processed = 0;
  let okCount = 0;
  let failed = 0;

  const queue = [...bookmarkIds];

  async function worker(): Promise<void> {
    while (true) {
      if (canceled) return;
      const st = statusStmt.get(jobId) as { status: string } | undefined;
      if (st && st.status === 'canceled') {
        canceled = true;
        queue.length = 0;
        return;
      }

      const id = queue.shift();
      if (!id) return;

      const row = selectStmt.get(id) as { id: number; url: string } | undefined;
      if (!row) {
        processed += 1;
        failed += 1;
        addJobFailure(db, jobId, String(id), '书签不存在');
        continue;
      }

      const res = await checkUrlWithRetry(row.url, options.timeoutMs, retries, retryDelayMs);
      const now = new Date().toISOString();

      if (res.ok) {
        okCount += 1;
        updateStmt.run(now, 'ok', res.httpCode, null, row.id);
      } else {
        failed += 1;
        updateStmt.run(now, 'fail', res.httpCode, res.error, row.id);
        addJobFailure(db, jobId, row.url, res.error || '不可用');
      }

      processed += 1;
      if (processed % 10 === 0 || processed === bookmarkIds.length) {
        updateJob(db, jobId, {
          processed,
          inserted: okCount,
          failed: baseFailed + failed,
        });
      }
    }
  }

  const workers = Array.from({ length: Math.max(1, options.concurrency) }, () => worker());
  await Promise.all(workers);

  if (canceled) {
    updateJob(db, jobId, {
      status: 'canceled',
      message: '已取消',
      processed,
      inserted: okCount,
      failed: baseFailed + failed,
    });
    return;
  }

  updateJob(db, jobId, {
    status: 'done',
    message: '检查完成',
    processed,
    inserted: okCount,
    failed: baseFailed + failed,
  });
}
