/**
 * @extrudo/core: the document model and everything that is pure data.
 * See docs/02-architecture.md §4 and ADR-0003. Must not use the DOM or WASM.
 */

export * from './attachments';
export * from './chamfer';
export * from './coil';
export * from './combine';
export {
  applyCommand,
  type Command,
  CommandError,
  type CommandFactory,
  type CommandResult,
  type DocumentDraft,
  defineCommand,
} from './commands';
export * from './construction';
export * from './customizer';
export { createDocument, type NewDocumentOptions } from './document';
export * from './document-commands';
export * from './draft';
export * from './emboss';
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
export * from './fillet';
export { FILE_EXTENSION, FORMAT_NAME, FORMAT_VERSION } from './format';
export * from './groups';
export { type HistoryEntry, type HistoryOptions, UndoHistory } from './history';
export * from './hole';
export * from './ids';
export * from './loft';
export {
  DocumentLoadError,
  type DocumentLoadErrorCode,
  type JsonObject,
  type LoadResult,
  loadDocument,
  loadNotice,
  MIGRATIONS,
  type Migration,
  type MigrationContext,
} from './migrations';
export * from './mirror';
export * from './move';
export * from './offset-face';
export * from './pattern';
export * from './place-on-bed';
export * from './primitives';
export * from './remove';
export * from './revolve';
export * from './rib';
export * from './scale';
export * from './schema';
export * from './shell';
export * from './sketch/commands';
export * from './sketch/curves';
export * from './sketch/dimensions';
export * from './sketch/feature';
export * from './sketch/planes';
export * from './sketch/projection';
export * from './sketch/schema';
export * from './sketch/text';
export * from './sketch/text-layout';
export * from './split-body';
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
export * from './sweep';
export * from './thread';
export * from './timeline';
export * from './tolerance';
