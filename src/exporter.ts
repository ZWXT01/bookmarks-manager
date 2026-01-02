import type { Db } from './db';

export type ExportBookmarkRow = {
  url: string;
  title: string;
  category_name: string | null;
  created_at: string;
};

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

type FolderNode = {
  children: Map<string, FolderNode>;
  bookmarks: ExportBookmarkRow[];
};

function getOrCreateChild(node: FolderNode, name: string): FolderNode {
  const cur = node.children.get(name);
  if (cur) return cur;
  const next: FolderNode = { children: new Map(), bookmarks: [] };
  node.children.set(name, next);
  return next;
}

function renderNodeInsideDl(node: FolderNode, indent: string): string {
  let out = '';

  for (const b of node.bookmarks) {
    out += `${indent}<DT><A HREF="${escapeHtml(b.url)}">${escapeHtml(b.title)}</A>\n`;
  }

  const names = Array.from(node.children.keys()).sort((a, b) => a.localeCompare(b, 'zh-CN'));
  for (const name of names) {
    const child = node.children.get(name);
    if (!child) continue;
    out += `${indent}<DT><H3>${escapeHtml(name)}</H3>\n`;
    out += `${indent}<DL><p>\n`;

    out += renderNodeInsideDl(child, indent + '  ');
    out += `${indent}</DL><p>\n`;
  }
  return out;
}

export function buildNetscapeHtml(rows: ExportBookmarkRow[]): string {
  let out = '';
  out += '<!DOCTYPE NETSCAPE-Bookmark-file-1>\n';
  out += '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n';
  out += '<TITLE>Bookmarks</TITLE>\n';
  out += '<H1>Bookmarks</H1>\n';
  out += '<DL><p>\n';

  const root: FolderNode = { children: new Map(), bookmarks: [] };
  for (const r of rows) {
    const rawPath = (r.category_name && r.category_name.trim()) ? r.category_name.trim() : '';
    const parts = rawPath.split('/').map((s) => s.trim()).filter(Boolean);
    if (parts.length === 0) {
      root.bookmarks.push(r);
      continue;
    }

    let cur = root;
    for (const p of parts) {
      cur = getOrCreateChild(cur, p);
    }
    cur.bookmarks.push(r);
  }

  out += renderNodeInsideDl(root, '  ');
  out += '</DL><p>\n';
  return out;
}

export function queryExportRows(db: Db): ExportBookmarkRow[] {
  return db
    .prepare(
      `
      SELECT b.url AS url, b.title AS title, b.created_at AS created_at, c.name AS category_name
      FROM bookmarks b
      LEFT JOIN categories c ON c.id = b.category_id
      ORDER BY c.name, b.created_at DESC
      `,
    )
    .all() as ExportBookmarkRow[];
}
