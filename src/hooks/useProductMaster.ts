import { useState } from 'react';
import type { ProductCategory, ProductMasterEntry } from '../types';
import { repositories } from '../repositories/repositoryProvider';
import type { ImportPreviewRow } from '../imports/shared';
import type {
  ExistingProductRecord,
  ProductImportContext,
  ProductImportRecord,
} from '../imports/products';
import {
  buildProductMasterEntry,
  type NewProductInput,
} from '../services/productMasterAdmin';
import {
  canImportProductCatalog,
  canMutateProductCatalog,
} from '../services/productCatalogAccess';
import { computeCatalogFingerprint } from '../services/productCatalogFingerprint';
import {
  buildCanonicalRequestString,
  parseProductImportRequest,
  sanitizeImportFileName,
  type ProductImportRequest,
  type ProductImportRequestRow,
} from '../services/productImportRequest';
import {
  clearPersistedAttempt,
  persistAttempt,
  readPersistedAttempt,
} from '../services/productImportPendingAttempt';
import { ProductImportError } from '../repositories/types';
import { useAuthSession } from '../auth/authSessionContext';

export interface ImportCommitResult {
  created: number;
  updated: number;
}

export interface UseProductMasterResult {
  products: ProductMasterEntry[];
  categories: ProductCategory[];
  brands: string[];
  isLoading: false;
  error: null;
  canEdit: boolean;
  canImportProductCatalog: boolean;
  addProduct: (input: NewProductInput) => ProductMasterEntry;
  buildImportContext: () => ProductImportContext;
  commitImportRows: (
    rows: ImportPreviewRow<ProductImportRecord>[],
    idempotencyKey: string,
    fileName: string | null
  ) => Promise<ImportCommitResult>;
  // PI-3 Slice 2 reconciliation (#A2) — stale_catalog recovery must not
  // re-preview against the same in-memory products state that was stale
  // enough to cause the rejection. This forces a server-confirmed refresh
  // and returns a context built from the freshly-fetched list directly
  // (not from React state, which wouldn't reflect the refresh until the
  // next render) — see ImportProductsWizard.tsx's handleRefreshAfterStale.
  refreshAndRebuildImportContext: () => Promise<ProductImportContext>;
}

// PI-3 — projects a catalog entry into the shared CatalogProduct shape the
// identity layer matches against.
//
// Note what changed: this previously collapsed a missing SKU into the model
// code (`product.sku ?? product.model`), which made a SKU-less product
// indistinguishable from one whose SKU genuinely equals its model. The
// shared matcher needs that distinction — a blank-SKU import row may match
// only a genuinely SKU-less product — so the real `null` is preserved here
// and the model fallback is applied inside matchCatalogProduct instead,
// where it is scoped to exactly the legacy case it exists for.
function toExistingProductRecord(product: ProductMasterEntry): ExistingProductRecord {
  return {
    id: product.id,
    sku: product.sku ?? null,
    brand: product.brand,
    model: product.model,
    productName: product.name,
    categoryId: product.categoryId || null,
  };
}

function toRequestRow(
  row: ImportPreviewRow<ProductImportRecord>
): ProductImportRequestRow | null {
  if (!row.record) return null;
  const sku = row.record.sku.trim();
  return {
    rowNumber: row.rowNumber,
    brand: row.record.brand,
    sku: sku.length > 0 ? sku : null,
    model: row.record.model,
    productName: row.record.productName,
    category: row.record.categoryRaw ?? null,
  };
}

// Other data-access hooks (useServiceJobs) stay stateless — their pages
// never re-list after writing. This page lists its own writes immediately
// (Add Product, Import commit), so the hook holds local state and resyncs
// it from the repository after every mutation, rather than requiring the
// page itself to manage a refresh trigger.
export function useProductMaster(): UseProductMasterResult {
  const [products, setProducts] = useState<ProductMasterEntry[]>(() =>
    repositories.productMaster.getProducts()
  );
  const categories = repositories.productMaster.getCategories();
  const brands = Array.from(new Set(products.map((p) => p.brand))).sort();
  const canEdit = canMutateProductCatalog();
  const { staffProfile } = useAuthSession();
  const canImport = canImportProductCatalog(staffProfile?.canImportProducts ?? false);

  const addProduct = (input: NewProductInput): ProductMasterEntry => {
    const existingIds = new Set(products.map((p) => p.id));
    const entry = buildProductMasterEntry(input, existingIds);
    repositories.productMaster.createProduct(entry);
    setProducts(repositories.productMaster.getProducts());
    return entry;
  };

  const buildImportContext = (): ProductImportContext => ({
    existingProducts: products.map(toExistingProductRecord),
    knownCategories: categories,
  });

  // PI-3 Slice 2 reconciliation (#A2) — used only for stale_catalog
  // recovery. Forces a full server-confirmed refresh (no known list of
  // which ids changed — that's the whole reason stale_catalog fired), syncs
  // the hook's own state, and returns a context built from the just-fetched
  // list directly so the caller's re-preview never races the next render.
  const refreshAndRebuildImportContext = async (): Promise<ProductImportContext> => {
    await repositories.productMaster.refreshFromServer();
    const fresh = repositories.productMaster.getProducts();
    setProducts(fresh);
    return {
      existingProducts: fresh.map(toExistingProductRecord),
      knownCategories: categories,
    };
  };

  // PI-3 Slice 2 — commitImportRows delegates the actual write to the
  // ProductImportRepository seam (mock or Worker-backed): the request's
  // rows are reclassified server-side (mock: mockProductImportRepository;
  // production: worker/src/productImport.ts) against the authoritative
  // catalog, so this hook no longer re-matches rows to existing products
  // itself — the repository's classification already resolved that.
  //
  // Reconciliation (#A1/#A3) added two things beyond the original Slice 2
  // pass:
  //   - #A1: after a successful (or safely replayed) commit, the canonical
  //     product list is refreshed from a genuine Firestore server read
  //     (repositories.productMaster.refreshFromServer), not merely
  //     whatever the browser's own onSnapshot listener happened to have
  //     received by this point — the Worker's HTTP response and that
  //     listener's next event have no ordering guarantee relative to each
  //     other.
  //   - #A3: the idempotencyKey argument is a CANDIDATE key, not
  //     unconditionally final. Before it is used, sessionStorage is
  //     checked for a persisted attempt whose normalized request is
  //     canonically IDENTICAL to the one about to be submitted; if found,
  //     that attempt's key is reused instead, so an ambiguous failure's
  //     retry survives a component remount or a full page refresh in the
  //     same browser session, not just a still-mounted component's own
  //     closure. The persisted attempt is cleared on every settled outcome
  //     except an ambiguous one (network failure, or a 5xx/no-status
  //     ProductImportError) — including stale_catalog, which must never
  //     reuse a key after the classification it was minted for is stale.
  const commitImportRows = async (
    rows: ImportPreviewRow<ProductImportRecord>[],
    idempotencyKey: string,
    fileName: string | null
  ): Promise<ImportCommitResult> => {
    const requestRows = rows
      .map(toRequestRow)
      .filter((row): row is ProductImportRequestRow => row !== null);
    const catalogFingerprint = await computeCatalogFingerprint(
      products.map(toExistingProductRecord)
    );
    const candidateRequest: ProductImportRequest = {
      version: 1,
      // PI-4 correction — the actual selected file's sanitized basename,
      // never a bare null. sanitizeImportFileName strips any path
      // component, control characters, and formula-injection prefixes, and
      // degrades to null on anything unsafe/oversized rather than failing
      // the whole import over a cosmetic audit field.
      fileName: fileName ? sanitizeImportFileName(fileName) : null,
      catalogFingerprint,
      rows: requestRows,
    };

    // PI-4 correction — the freshly-built request is validated through the
    // SAME authoritative parser persistAttempt/the Worker use, and every
    // downstream use (persistence, the canonical-match comparison, and the
    // actual commit call) uses the parser's own canonical (NFC-normalized,
    // trimmed, bounded) value — never the locally-constructed object as-is.
    // This is what keeps the persisted-attempt comparison meaningful: both
    // sides of that comparison must be canonicalized the same way, or a
    // purely cosmetic difference (e.g. NFD vs NFC) could produce a false
    // key-reuse miss.
    const validated = parseProductImportRequest(candidateRequest);
    if (!validated.ok || !validated.value) {
      // Should not happen — buildImportContext/the CSV importer already
      // bound every field within the wire contract's own limits — but if
      // it ever does, this is a conclusive, never-safe-to-retry local
      // failure, not an ambiguous one; retrying an inherently malformed
      // request would only loop forever.
      throw new ProductImportError(
        `This import request failed local validation${validated.detail ? `: ${validated.detail}` : ''}`,
        400,
        'validation_failed'
      );
    }
    const request = validated.value;

    const persisted = readPersistedAttempt();
    const canonicalRequest = buildCanonicalRequestString(request);
    const matchesPersisted =
      persisted !== null &&
      buildCanonicalRequestString(persisted.request) === canonicalRequest;
    const effectiveKey = matchesPersisted ? persisted.idempotencyKey : idempotencyKey;
    if (!matchesPersisted) {
      persistAttempt(effectiveKey, request);
    }

    try {
      const result = await repositories.productImport.commit(request, effectiveKey);
      clearPersistedAttempt();
      await repositories.productMaster.refreshFromServer(
        result.rows.map((row) => row.productId)
      );
      setProducts(repositories.productMaster.getProducts());
      return { created: result.summary.created, updated: result.summary.updated };
    } catch (error) {
      const isAmbiguous = !(error instanceof ProductImportError) || !error.isConclusive;
      if (!isAmbiguous) {
        clearPersistedAttempt();
      }
      throw error;
    }
  };

  return {
    products,
    categories,
    brands,
    isLoading: false,
    error: null,
    canEdit,
    canImportProductCatalog: canImport,
    addProduct,
    buildImportContext,
    refreshAndRebuildImportContext,
    commitImportRows,
  };
}
