/**
 * Route modules index
 * 
 * Exports all route plugins for registration in main app
 */
export { bookmarkRoutes, type BookmarkRoutesOptions } from './bookmarks';
export { categoryRoutes, type CategoryRoutesOptions } from './categories';
export { settingsRoutes, type SettingsRoutesOptions } from './settings';
export { snapshotRoutes, type SnapshotRoutesOptions } from './snapshots';
export { backupRoutes, type BackupRoutesOptions } from './backups';
export { aiRoutes, type AIRoutesOptions } from './ai';
export { authRoutes, type AuthRoutesOptions } from './auth';
export { jobsRoutes, type JobsRoutesOptions } from './jobs';
export { checkRoutes, type CheckRoutesOptions } from './check';
export { importRoutes, type ImportRoutesOptions } from './import';
export { pagesRoutes, type PagesRoutesOptions } from './pages';
export { formsRoutes, type FormsRoutesOptions } from './forms';
export * from './types';
