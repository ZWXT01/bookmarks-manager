import type { Db } from './db';
import { canonicalizeUrl } from './url';
import { addJobFailure, updateJob } from './jobs';
import { getOrCreateCategoryByPath } from './category-service';

export type ImportOptions = {
  defaultCategoryId: number | null;
  skipDuplicates?: boolean;  // 导入前检查 URL 是否已存在
  overrideCategory?: boolean;  // 是否忽略原有分类，使用 defaultCategoryId
  logger?: any;
};

export type ImportBookmarkItem = {
  url: string;
  title: string;
  categoryName: string | null;
};

function isProbablyNetscapeHtml(text: string): boolean {
  return /NETSCAPE-Bookmark-file-1/i.test(text) || (/<DL>/i.test(text) && /<A\s+HREF=/i.test(text));
}

function isProbablyJson(text: string): boolean {
  const t = text.trim();
  return t.startsWith('{') || t.startsWith('[');
}

function safeTitle(title: string, url: string): string {
  const t = title.trim();
  return t ? t : url;
}

function parseTextLines(text: string, categoryName: string | null): ImportBookmarkItem[] {
  const items: ImportBookmarkItem[] = [];
  const lines = text.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const urlMatch = trimmed.match(/https?:\/\/[^\s]+/i);
    if (urlMatch) {
      items.push({ url: urlMatch[0], title: safeTitle(trimmed.replace(urlMatch[0], '').trim(), urlMatch[0]), categoryName });
      continue;
    }

    items.push({ url: trimmed, title: trimmed, categoryName });
  }

  return items;
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_m, code) => {
      const n = Number(code);
      if (!Number.isFinite(n)) return _m;
      try {
        return String.fromCharCode(n);
      } catch {
        return _m;
      }
    });
}

function parseNetscapeHtml(html: string): ImportBookmarkItem[] {
  const items: ImportBookmarkItem[] = [];

  const folderStack: string[] = [];

  const re = /<H3[^>]*>([\s\S]*?)<\/H3>|<A[^>]*HREF\s*=\s*"([^"]+)"[^>]*>([\s\S]*?)<\/A>|<A[^>]*HREF\s*=\s*'([^']+)'[^>]*>([\s\S]*?)<\/A>|<\/DL>/gi;
  let m: RegExpExecArray | null;

  while ((m = re.exec(html)) !== null) {
    if (m[1] !== undefined) {
      const folderName = decodeHtmlEntities(m[1].replace(/<[^>]+>/g, '').trim());
      if (folderName) folderStack.push(folderName);
      continue;
    }

    const href = (m[2] || m[4] || '').trim();
    const titleRaw = (m[3] || m[5] || '').trim();
    if (href) {
      const title = decodeHtmlEntities(titleRaw.replace(/<[^>]+>/g, '').trim());
      const categoryName = folderStack.length ? folderStack.join('/') : null;
      items.push({ url: href, title: safeTitle(title, href), categoryName });
      continue;
    }

    if (m[0] && /<\/DL>/i.test(m[0])) {
      if (folderStack.length) folderStack.pop();
    }
  }

  return items;
}

function parseJson(text: string): ImportBookmarkItem[] {
  const parsed = JSON.parse(text) as any;

  if (Array.isArray(parsed)) {
    return parsed
      .map((x) => {
        if (!x) return null;
        const url = typeof x.url === 'string' ? x.url : typeof x.href === 'string' ? x.href : null;
        if (!url) return null;
        const title = typeof x.title === 'string' ? x.title : '';
        const categoryName = typeof x.category === 'string' ? x.category : typeof x.categoryName === 'string' ? x.categoryName : null;
        return { url, title: safeTitle(title, url), categoryName } satisfies ImportBookmarkItem;
      })
      .filter(Boolean) as ImportBookmarkItem[];
  }

  if (parsed && typeof parsed === 'object') {
    if (Array.isArray(parsed.bookmarks)) {
      return parseJson(JSON.stringify(parsed.bookmarks));
    }
  }

  return [];
}

export function parseImportContent(text: string): ImportBookmarkItem[] {
  if (isProbablyNetscapeHtml(text)) return parseNetscapeHtml(text);
  if (isProbablyJson(text)) {
    try {
      return parseJson(text);
    } catch {
      return [];
    }
  }
  return parseTextLines(text, null);
}

// 导入时使用 category-service 中的 getOrCreateCategoryByPath
// 它会自动处理路径格式（如 "技术/编程"）并建立正确的父子关系

export async function runImportJob(db: Db, jobId: string, items: ImportBookmarkItem[], options: ImportOptions): Promise<{ insertedIds: number[] }> {
  updateJob(db, jobId, {
    status: 'running',
    message: '正在导入',
    total: items.length,
    processed: 0,
  });

  const insertedIds: number[] = [];

  const insertStmt = db.prepare(
    'INSERT INTO bookmarks (url, canonical_url, title, category_id, created_at) VALUES (?, ?, ?, ?, ?)',
  );
  const existsStmt = db.prepare('SELECT id FROM bookmarks WHERE url = ?');

  const batchSize = 100;

  let processed = 0;
  let inserted = 0;
  let skipped = 0;
  let failed = 0;

  const skipDuplicates = options.skipDuplicates === true;

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);

    const tx = db.transaction(() => {
      for (const item of batch) {
        processed += 1;

        const canon = canonicalizeUrl(item.url);
        if (!canon.ok) {
          failed += 1;
          addJobFailure(db, jobId, item.url, canon.reason);
          continue;
        }

        // 显式去重检查（基于 URL）
        if (skipDuplicates) {
          const existing = existsStmt.get(canon.normalizedUrl);
          if (existing) {
            skipped += 1;
            continue;
          }
        }

        // 处理分类逻辑：
        // - 如果勾选了 overrideCategory，则统一使用 defaultCategoryId
        // - 否则优先使用书签文件中的分类信息，无分类信息时归为未分类
        let categoryId: number | null = null;
        if (options.overrideCategory) {
          // 忽略原有分类，统一使用选择的分类
          categoryId = options.defaultCategoryId;
        } else if (item.categoryName) {
          // 保留原有分类
          categoryId = getOrCreateCategoryByPath(db, item.categoryName);
        }

        try {
          const res = insertStmt.run(canon.normalizedUrl, canon.canonicalUrl, item.title, categoryId, new Date().toISOString());
          inserted += 1;
          insertedIds.push(Number(res.lastInsertRowid));
        } catch (e: any) {
          const msg = typeof e?.message === 'string' ? e.message : '';
          if (msg.includes('UNIQUE')) {
            skipped += 1;
          } else {
            failed += 1;
            addJobFailure(db, jobId, item.url, '入库失败');
          }
        }
      }
    });

    tx();

    updateJob(db, jobId, {
      total: items.length,
      processed,
      inserted,
      skipped,
      failed,
    });
  }

  updateJob(db, jobId, {
    message: '导入完成',
  });

  return { insertedIds };
}
