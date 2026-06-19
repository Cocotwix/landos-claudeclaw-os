// LandOS storage policy contract.
//
// Tyler's laptop is the control center, not the warehouse. The repo holds code
// and lightweight build memory only; GitHub never holds property-specific work
// product. Large property reports, PDFs, screenshots, seller docs, source docs,
// voice transcripts, and market datasets must not pile up in the repo or on the
// laptop. Future storage uses adapters so LandOS can move data to cloud/db/
// shared storage WITHOUT rewriting department legs.
//
// This module is a contract + deterministic assertions only. It does not move,
// read, or write any data. Repo-exclusion is already enforced by .gitignore
// (data/, deals/, transcripts/, training/, *.pdf, *.csv, *.xlsx, *.mp3, ...);
// this policy formalizes the categories and the adapter direction.

export const STORAGE_CATEGORIES = [
  'local_runtime_cache',
  'build_memory',
  'deal_card_records',
  'property_reports',
  'property_media',
  'source_documents',
  'voice_transcripts',
  'market_datasets',
  'exports',
  'external_storage_required',
] as const;
export type StorageCategory = (typeof STORAGE_CATEGORIES)[number];

/** Where a category's data is allowed to live. */
export type StorageLocation =
  | 'repo_code_and_light_docs' // tracked in git: code + lightweight docs/memory
  | 'local_runtime_gitignored' // on disk locally, gitignored, never committed
  | 'external_storage_required'; // belongs in cloud/db/shared storage via adapter

export interface StorageCategoryPolicy {
  category: StorageCategory;
  location: StorageLocation;
  /** True only for code + lightweight docs/build memory. */
  allowedInRepo: boolean;
  /** True when local on-disk artifacts must be gitignored. */
  gitignored: boolean;
  /** True when this category should ultimately live in external storage. */
  prefersExternalAdapter: boolean;
  note: string;
}

export const STORAGE_POLICY: readonly StorageCategoryPolicy[] = [
  {
    category: 'local_runtime_cache',
    location: 'local_runtime_gitignored',
    allowedInRepo: false,
    gitignored: true,
    prefersExternalAdapter: false,
    note: 'Ephemeral runtime cache. Local only; never committed.',
  },
  {
    category: 'build_memory',
    location: 'repo_code_and_light_docs',
    allowedInRepo: true,
    gitignored: false,
    prefersExternalAdapter: false,
    note: 'Lightweight build memory / architecture docs (.agents/*). Tracked, but no property data.',
  },
  {
    category: 'deal_card_records',
    location: 'local_runtime_gitignored',
    allowedInRepo: false,
    gitignored: true,
    prefersExternalAdapter: true,
    note: 'Deal card records persist in the local SQLite store (store/, gitignored). Future: external adapter.',
  },
  {
    category: 'property_reports',
    location: 'external_storage_required',
    allowedInRepo: false,
    gitignored: true,
    prefersExternalAdapter: true,
    note: 'Large property reports/PDFs. Never in repo; should move to external storage via adapter.',
  },
  {
    category: 'property_media',
    location: 'external_storage_required',
    allowedInRepo: false,
    gitignored: true,
    prefersExternalAdapter: true,
    note: 'Satellite/street/plat/survey imagery and screenshots. Never in repo.',
  },
  {
    category: 'source_documents',
    location: 'external_storage_required',
    allowedInRepo: false,
    gitignored: true,
    prefersExternalAdapter: true,
    note: 'Seller docs and source documents. Never in repo.',
  },
  {
    category: 'voice_transcripts',
    location: 'external_storage_required',
    allowedInRepo: false,
    gitignored: true,
    prefersExternalAdapter: true,
    note: 'Voice transcripts. Never accumulate in repo.',
  },
  {
    category: 'market_datasets',
    location: 'external_storage_required',
    allowedInRepo: false,
    gitignored: true,
    prefersExternalAdapter: true,
    note: 'Market datasets. Never in repo.',
  },
  {
    category: 'exports',
    location: 'local_runtime_gitignored',
    allowedInRepo: false,
    gitignored: true,
    prefersExternalAdapter: true,
    note: 'Generated exports (PDFs, spreadsheets). Local only; delivered, not committed.',
  },
  {
    category: 'external_storage_required',
    location: 'external_storage_required',
    allowedInRepo: false,
    gitignored: true,
    prefersExternalAdapter: true,
    note: 'Catch-all for anything that must live in external/shared storage.',
  },
];

/** Categories that must never appear in the repo (everything except build_memory). */
export const REPO_FORBIDDEN_CATEGORIES: readonly StorageCategory[] = STORAGE_POLICY.filter(
  (p) => !p.allowedInRepo,
).map((p) => p.category);

export function getStoragePolicy(category: StorageCategory): StorageCategoryPolicy {
  const p = STORAGE_POLICY.find((x) => x.category === category);
  if (!p) throw new Error(`Unknown storage category: ${category}`);
  return p;
}

/** True when a category may be tracked in git. Only lightweight build memory. */
export function isAllowedInRepo(category: StorageCategory): boolean {
  return getStoragePolicy(category).allowedInRepo;
}

/** Future external-storage adapter direction (planning contract, no I/O). */
export interface StorageAdapterDirection {
  /** Adapters are pluggable so legs never rewrite when storage moves. */
  pluggable: true;
  /** Legs read/write via the storage contract, not direct file paths. */
  legsUseContractNotPaths: true;
  /** Targets a future adapter can resolve to. */
  supportedTargets: readonly string[];
  note: string;
}

export const STORAGE_ADAPTER_DIRECTION: StorageAdapterDirection = {
  pluggable: true,
  legsUseContractNotPaths: true,
  supportedTargets: ['local_runtime', 'cloud_object_store', 'database', 'shared_drive'],
  note:
    'Department legs reference storage by category, not by hardcoded path. A future adapter can move ' +
    'a category from local_runtime to cloud/db/shared storage without changing any department leg.',
};

/** Throws if any large property/business artifact category is repo-allowed. */
export function assertNoRepoBloat(): void {
  const bloat: StorageCategory[] = [
    'property_reports',
    'property_media',
    'source_documents',
    'voice_transcripts',
    'market_datasets',
  ];
  for (const c of bloat) {
    if (isAllowedInRepo(c)) {
      throw new Error(`Storage category ${c} must never be allowed in the repo.`);
    }
  }
}
