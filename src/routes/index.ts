/**
 * Route modules index
 * 
 * Exports all route plugins for registration in main app
 */
export { bookmarkRoutes } from './bookmarks';
export { categoryRoutes } from './categories';
export { settingsRoutes } from './settings';
export { snapshotRoutes } from './snapshots';
export { backupRoutes } from './backups';
export { aiRoutes } from './ai';
export { authRoutes } from './auth';
export { jobsRoutes } from './jobs';
export { checkRoutes } from './check';
export { importRoutes } from './import';
export { pagesRoutes } from './pages';
export { formsRoutes } from './forms';
export { templateRoutes } from './templates';
export type { CategoryRow, CategoryEditRow, BookmarkRow, BookmarkEditRow } from './types';
