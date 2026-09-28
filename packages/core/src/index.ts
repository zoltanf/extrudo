/**
 * @extrudo/core: the document model and everything that is pure data.
 * See docs/02-architecture.md §4 and ADR-0003. Must not use the DOM or WASM.
 */
export {
  applyCommand,
  type Command,
  CommandError,
  type CommandFactory,
  type CommandResult,
  type DocumentDraft,
  defineCommand,
} from './commands';
export { createDocument, type NewDocumentOptions } from './document';
export * from './document-commands';
export * from './expr/index';
export * from './extrude';
export * from './feature-inputs';
export {
  type FeatureCategory,
  type FeatureDefinition,
  type FeatureIssue,
  FeatureRegistry,
  nextFeatureName,
} from './features';
export { FILE_EXTENSION, FORMAT_NAME, FORMAT_VERSION } from './format';
export { type HistoryEntry, type HistoryOptions, UndoHistory } from './history';
export * from './ids';
export {
  DocumentLoadError,
  type DocumentLoadErrorCode,
  type JsonObject,
  type LoadResult,
  loadDocument,
  MIGRATIONS,
  type Migration,
  type MigrationContext,
} from './migrations';
export * from './primitives';
export * from './remove';
export * from './revolve';
export * from './schema';
export * from './sketch/commands';
export * from './sketch/curves';
export * from './sketch/dimensions';
export * from './sketch/feature';
export * from './sketch/planes';
export * from './sketch/projection';
export * from './sketch/schema';
export {
  createDocumentStore,
  createModelStore,
  createSessionStore,
  type DocumentState,
  type DocumentStore,
  type FeatureStatus,
  type ModelState,
  type ModelStats,
  type ModelStore,
  type ReferenceIssue,
  type SelectionItem,
  type SelectMode,
  type SessionState,
  type SessionStore,
} from './stores';
export * from './timeline';
