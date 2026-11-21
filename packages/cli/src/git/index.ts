export {
  GitRepository,
  isProbablyBinary,
  truncateDiff,
  type GitDiff,
  type GitFileChange,
  type GitRepositoryOptions,
} from './diff.js';
export { syncSnapshot, startHeadWatcher } from './snapshots.js';
export type { HeadWatcher, HeadWatcherOptions } from './snapshots.js';
