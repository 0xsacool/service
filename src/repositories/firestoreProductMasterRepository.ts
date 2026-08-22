import {
  collection,
  doc,
  getDocFromServer,
  getDocsFromServer,
  onSnapshot,
  type Unsubscribe,
} from 'firebase/firestore';
import { getFirestoreDb } from '../lib/firebase/firebase';
import type { ProductMasterEntry } from '../types';
import type { ProductMasterRepository } from './types';
import { productCategories } from './mockData/productMaster.mock';
import { productKnowledgeRepository } from './productKnowledgeRepository';
import { fromFirestoreData, PRODUCTS_COLLECTION } from './firestore/productMasterMapping';
import {
  describeFirestoreInitError,
  recordFirestoreInitFailure,
} from './firestoreInitDiagnostics';

export function rejectClientProductMutation(): never {
  throw new Error(
    'Client Product Master mutations are unavailable until a privileged catalog workflow is approved'
  );
}

// Firestore reads are inherently async; ProductMasterRepository's interface
// is synchronous (every hook/component built against it since Sprint P1
// assumes that, and this sprint's "no component changes" constraint rules
// out widening it to Promises). Instead, this repository keeps a local
// cache kept live via onSnapshot — every interface method reads/writes that
// cache synchronously, and the real Firestore read/write happens
// underneath it. Two consequences worth knowing:
//   1. This factory itself is async and awaits the first *server-confirmed*
//      snapshot before resolving, so by the time repositoryProvider.ts hands
//      this repository to a hook, getProducts() already reflects real data —
//      necessary because useProductMaster/useProductDetail seed their React
//      state from getProducts() exactly once at mount (`useState(() => ...)`)
//      and never re-subscribe to later cache changes on their own. Every
//      subsequent read stays synchronous; only this initial resolution
//      waits. Deliberately not the *first* snapshot event: Firestore can
//      deliver a stale, partial snapshot from local cache
//      (metadata.fromCache: true) before the real one — resolving on that
//      would leave getProducts() permanently wrong. If the listener itself
//      fails (e.g. permission-denied), the error is logged and this still
//      resolves — with an empty cache — rather than hanging forever.
//   2. createProduct/updateProduct return synchronously (matching the
//      interface) after updating the cache optimistically; the actual
//      Firestore write happens in the background and its failure can't be
//      reported back through the sync return value — it's only logged.
//      Because each hook re-reads getProducts() right after calling these
//      (see useProductMaster.ts/useProductDetail.ts), the optimistic cache
//      update is what the UI actually reflects, not the background write's
//      eventual outcome. See Known Limitations in the Sprint F2 report.
//
// Exported as a factory, not a ready-made singleton, so instantiating it
// (which starts talking to Firestore and triggers the seed migration) only
// happens when repositoryProvider.ts's 'firestore' case actually calls it —
// never merely by this module being imported.
export async function createFirestoreProductMasterRepository(): Promise<ProductMasterRepository> {
  const firestore = getFirestoreDb();
  let productsById = new Map<string, ProductMasterEntry>();

  // Ordering matters here (Sprint F2.1 review confirmed this is correct,
  // not incidental): the seed check-and-write is fully awaited *before*
  // the listener below attaches. Reversed — start listening first, seed
  // after — the listener's first server-confirmed snapshot could land on a
  // genuinely-empty collection just before the seed's write commits,
  // resolving this factory with zero products for the rest of the session.
  // Captured rather than discarded: this repository is a session-scoped
  // singleton (created once, lives for the page's lifetime, same as every
  // Mock repository) — there's no teardown hook in this architecture today
  // that would call it, but dropping the handle entirely would make one
  // impossible to add later without restructuring this function. Sprint
  // F2.1 hardening review item ("unsubscribe safety").
  let unsubscribe: Unsubscribe | undefined;

  await new Promise<void>((resolveFirstSnapshot) => {
    let settled = false;
    unsubscribe = onSnapshot(
      collection(firestore, PRODUCTS_COLLECTION),
      (snapshot) => {
        const next = new Map<string, ProductMasterEntry>();
        snapshot.forEach((docSnap) => {
          next.set(docSnap.id, fromFirestoreData(docSnap.id, docSnap.data()));
        });
        productsById = next;
        // Firestore's listener can deliver a stale, incomplete snapshot
        // from local cache (metadata.fromCache: true) before the real
        // server-confirmed one — confirmed live: a 16-doc collection's
        // first event came back as 1 cached doc, then 16 moments later.
        // Resolving on that first (possibly-cached) event would let
        // getProducts() return stale data for the repository's entire
        // lifetime, since nothing else re-syncs the caller's React state
        // afterward. Only resolve once a server-confirmed snapshot arrives.
        if (!settled && !snapshot.metadata.fromCache) {
          settled = true;
          resolveFirstSnapshot();
        }
      },
      (err) => {
        console.error(
          '[firestoreProductMasterRepository] snapshot listener failed:',
          err
        );
        recordFirestoreInitFailure(
          describeFirestoreInitError(
            err,
            'productMaster',
            settled ? 'listener' : 'initial-listener'
          )
        );
        if (!settled) {
          settled = true;
          resolveFirstSnapshot();
        }
      }
    );
  });
  void unsubscribe; // captured, not called — see comment above; no teardown path exists yet

  return {
    getCategories() {
      return productCategories;
    },
    getProducts() {
      return Array.from(productsById.values());
    },
    getProductById(id) {
      return productsById.get(id);
    },
    getAccessoriesForProduct(productId) {
      const product = productsById.get(productId);
      if (!product) return [];
      return productKnowledgeRepository.getAccessoriesByIds(product.accessoryIds);
    },
    getCommonProblemsForProduct(productId) {
      const product = productsById.get(productId);
      if (!product) return [];
      return productKnowledgeRepository.getCommonProblemsByIds(product.commonProblemIds);
    },
    createProduct() {
      return rejectClientProductMutation();
    },
    updateProduct() {
      return rejectClientProductMutation();
    },
    // PI-3 Slice 2 reconciliation — see ProductMasterRepository's interface
    // comment (types.ts) for why this exists. Targeted (ids given): one
    // getDocFromServer per id, in parallel, matching the exact pattern
    // firestoreServiceJobRepository.ts already uses after a Worker write.
    // Untargeted (no ids): a full getDocsFromServer collection re-read, used
    // when the caller has no specific list (stale_catalog recovery).
    async refreshFromServer(productIds) {
      if (productIds && productIds.length > 0) {
        const snapshots = await Promise.all(
          productIds.map((id) => getDocFromServer(doc(firestore, PRODUCTS_COLLECTION, id)))
        );
        for (const snapshot of snapshots) {
          if (snapshot.exists()) {
            productsById.set(snapshot.id, fromFirestoreData(snapshot.id, snapshot.data()));
          } else {
            productsById.delete(snapshot.id);
          }
        }
        return;
      }
      const snapshot = await getDocsFromServer(collection(firestore, PRODUCTS_COLLECTION));
      const next = new Map<string, ProductMasterEntry>();
      snapshot.forEach((docSnap) => {
        next.set(docSnap.id, fromFirestoreData(docSnap.id, docSnap.data()));
      });
      productsById = next;
    },
  };
}
