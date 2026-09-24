export {
  collectAppRoutes,
  collectPlatformMountCoverage,
  invisibleMethodExports,
  loadCliRoutes,
  methodsOf,
  PLATFORM,
  type AppRoutes,
  type CliRoutes,
  type ParityInputs,
  type PlatformMount,
  type PlatformMountCoverage,
} from './cli-parity'
export {
  findCrossAppImports,
  findCrossSchemaQueries,
  scanCrossSchemaQueries,
  sourceFiles,
  importsOf,
  isDir,
  type CrossAppImport,
  type CrossSchemaQuery,
  type CrossSchemaScan,
  type CrossSchemaScanInput,
  type SchemaQueryAllowance,
} from './app-isolation'
export { appSlugs, platformPackageSources, type AppSlug } from './package-isolation'
export {
  appLedgers,
  ledgerKey,
  ledgerCollisions,
  DEFAULT_MIGRATIONS_SCHEMA,
  DEFAULT_MIGRATIONS_TABLE,
  type AppLedger,
} from './migration-ledger'
// Whether an integration suite runs, and what it says when it does not.
// The Phase 11 ruling on agent4's escalation lives in this file's header.
export {
  integrationDescribe,
  type DescribeLike,
  type IntegrationSuiteOptions,
} from './integration-suite'
export { readableText, stripComments, stripSpecifiers, type StrippedSource } from './source-text'
