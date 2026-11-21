export { BindingsScanner, createBindingsScanner, toView, walkProjectFiles } from './scanner.js';
export type { BindingsEventPublisher, BindingsScannerOptions, ScanOptions } from './scanner.js';
export { classifyFile, isSupportedBindingFile } from './classify.js';
export { explainBinding, explainHeuristic } from './explain.js';
export {
  EXTRACTORS,
  extractFile,
  backendExtractor,
  databaseExtractor,
  frontendExtractor,
} from './extractors/index.js';
export {
  MatchCache,
  buildMatchContext,
  defaultMatchCache,
  findDatabaseField,
  findMatchingEntity,
  findMatchingField,
  linkKey,
  matchedBackendLink,
  similarBackendField,
} from './matcher.js';
export type { AmbiguousPair, BuildMatchOptions, MatchContext, SemanticLink } from './matcher.js';
export { buildMatrix } from './matrix.js';
export {
  canonicalTokens,
  isAuxiliaryTypeName,
  levenshtein,
  nameSimilarity,
  normalizeEntityName,
  normalizeFieldName,
  normalizeType,
  semanticKey,
  singularize,
  splitWords,
  tokenSimilarity,
  typesCompatible,
} from './names.js';
export { combineExtracts } from './project-map.js';
export { evaluateRules, pathsMatch, routeMatches } from './rules.js';
export type {
  BindingExplanation,
  BindingMatrix,
  BindingsScanResult,
  BindingsStreamMessage,
  EndpointInfo,
  EntityField,
  EntityInfo,
  ExtractContext,
  FileExtract,
  Finding,
  FindingRuleId,
  FrontendCall,
  ImportRef,
  LayerExtractor,
  MatrixCell,
  MatrixRow,
  MigrationField,
  MigrationTable,
  ProjectMap,
  RouteInfo,
  ScanBindingView,
  SourceRef,
} from './types.js';
