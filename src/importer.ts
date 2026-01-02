import type { Db } from './db';
import { canonicalizeUrl } from './url';
import { addJobFailure, updateJob } from './jobs';

export type ImportOptions = {
  defaultCategoryId: number | null;
  checkAfterImport: boolean;
  createCategories?: boolean;
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

function getOrCreateCategoryId(db: Db, name: string): number {
  const now = new Date().toISOString();
  db.prepare('INSERT OR IGNORE INTO categories (name, parent_id, created_at) VALUES (?, NULL, ?)').run(name, now);
  const row = db.prepare('SELECT id FROM categories WHERE name = ?').get(name) as { id: number } | undefined;
  if (!row) throw new Error('category create failed');
  return row.id;
}

function getOrCreateCategoryIdWithParent(db: Db, name: string, parentId: number | null): number {
  const row = db.prepare('SELECT id, parent_id FROM categories WHERE name = ?').get(name) as
    | { id: number; parent_id: number | null }
    | undefined;
  if (row) {
    if (parentId !== null && row.parent_id === null) {
      try {
        db.prepare('UPDATE categories SET parent_id = ? WHERE id = ? AND parent_id IS NULL').run(parentId, row.id);
      } catch {
      }
    }
    return row.id;
  }

  const now = new Date().toISOString();
  db.prepare('INSERT OR IGNORE INTO categories (name, parent_id, created_at) VALUES (?, ?, ?)').run(name, parentId, now);
  const created = db.prepare('SELECT id FROM categories WHERE name = ?').get(name) as { id: number } | undefined;
  if (!created) throw new Error('category create failed');
  return created.id;
}

function getOrCreateCategoryPathId(db: Db, path: string): number {
  const parts = path
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!parts.length) {
    return getOrCreateCategoryId(db, path);
  }

  let parentId: number | null = null;
  let curId: number | null = null;
  for (let i = 0; i < parts.length; i += 1) {
    const full = parts.slice(0, i + 1).join('/');
    curId = getOrCreateCategoryIdWithParent(db, full, parentId);
    parentId = curId;
  }
  if (curId === null) throw new Error('category create failed');
  return curId;
}

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

  const batchSize = 100;

  let processed = 0;
  let inserted = 0;
  let skipped = 0;
  let failed = 0;

  const createCategories = options.createCategories === true;

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

        let categoryId = options.defaultCategoryId;
        if (createCategories && item.categoryName) {
          categoryId = getOrCreateCategoryPathId(db, item.categoryName);
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
