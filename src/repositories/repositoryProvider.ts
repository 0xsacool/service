import type {
  AttachmentsRepository,
  CustomersRepository,
  ProductImportRepository,
  ProductKnowledgeRepository,
  ProductMasterRepository,
  ProductsRepository,
  RegisteredProductsRepository,
  SearchRepository,
  ServiceJobsRepository,
  ServiceReportsRepository,
} from './types';
import type { ApprovalConsoleRepository } from './workerServiceReportReadRepository';
import type { BrandId } from '../types';
import type { WorkerTokenProvider } from '../auth/workerTokenProvider';
import { backendKind } from '../config/backend';
import { createMockApprovalConsoleRepository } from './mockApprovalConsoleRepository';
import { filesBackendKind } from '../config/filesBackend';
import { attachmentsRepository } from './attachmentsRepository';
import { customersRepository } from './customersRepository';
import { createMockProductImportRepository } from './mockProductImportRepository';
import { productKnowledgeRepository } from './productKnowledgeRepository';
import { productMasterRepository } from './productMasterRepository';
import { productsRepository } from './productsRepository';
import { registeredProductsRepository } from './registeredProductsRepository';
import { searchRepository } from './searchRepository';
import { serviceJobsRepository } from './serviceJobsRepository';
import { serviceReportsRepository } from './serviceReportsRepository';
import {
  clearFirestoreInitDiagnostics,
  describeFirestoreInitError,
  recordFirestoreInitFailure,
  type FirestoreRepositoryName,
} from './firestoreInitDiagnostics';

export interface RepositoryProvider {
  serviceJobs: ServiceJobsRepository;
  customers: CustomersRepository;
  products: ProductsRepository;
  search: SearchRepository;
  registeredProducts: RegisteredProductsRepository;
  productMaster: ProductMasterRepository;
  productImport: ProductImportRepository;
  productKnowledge: ProductKnowledgeRepository;
  attachments: AttachmentsRepository;
  serviceReports: ServiceReportsRepository;
  approvalConsole: ApprovalConsoleRepository;
}

export function createMockRepositoryProvider(): RepositoryProvider {
  return {
    serviceJobs: serviceJobsRepository,
    customers: customersRepository,
    products: productsRepository,
    search: searchRepository,
    registeredProducts: registeredProductsRepository,
    productMaster: productMasterRepository,
    productImport: createMockProductImportRepository(),
    productKnowledge: productKnowledgeRepository,
    attachments: attachmentsRepository,
    serviceReports: serviceReportsRepository,
    approvalConsole: createMockApprovalConsoleRepository(),
  };
}

function unavailableError(): Error {
  return new Error('Staff data is unavailable until its ownership model is approved');
}

function createUnavailableRepositoryProvider(): RepositoryProvider {
  const reject = async <T>(): Promise<T> => Promise.reject(unavailableError());
  const fail = (): never => {
    throw unavailableError();
  };
  return {
    serviceJobs: {
      getAll: () => [],
      getById: () => undefined,
      getByTrackingNumber: () => undefined,
      create: reject,
      update: reject,
      issuePublicTrackingCode: reject,
    },
    customers: { getAll: () => [] },
    products: { getAll: () => [] },
    search: {
      search: () => [],
      getRecentSearches: () => [],
      getRecentCustomers: () => [],
    },
    registeredProducts: { getForCustomer: () => [] },
    productMaster: {
      getCategories: () => [],
      getProducts: () => [],
      getProductById: () => undefined,
      getAccessoriesForProduct: () => [],
      getCommonProblemsForProduct: () => [],
      createProduct: fail,
      updateProduct: fail,
      refreshFromServer: reject,
    },
    productImport: { commit: reject },
    productKnowledge: {
      getAllAccessories: () => [],
      getAccessoriesByIds: () => [],
      createAccessory: fail,
      getAllCommonProblems: () => [],
      getCommonProblemsByIds: () => [],
      createCommonProblem: fail,
      updateCommonProblem: fail,
    },
    attachments: {
      getForJob: () => [],
      upload: reject,
      getDownloadUrl: reject,
      deleteAttachment: reject,
    },
    serviceReports: {
      fetchHistoryForServiceJob: reject,
      listForServiceJob: () => [],
      getById: () => undefined,
      createDraft: reject,
      updateDraft: reject,
      finalize: reject,
      createDraftV2: reject,
      updateDraftV2: reject,
      finalizeV2: reject,
      decideV2: reject,
      createSuccessorV2: reject,
      trustedPrint: reject,
    },
    approvalConsole: {
      fetchPendingApprovalQueue: reject,
      fetchApprovalReview: reject,
    },
  };
}

async function resolveAttachmentsRepository(
  serviceJobs: ServiceJobsRepository,
  tokenProvider: WorkerTokenProvider
): Promise<AttachmentsRepository> {
  if (filesBackendKind === 'mock') {
    return attachmentsRepository;
  }
  const { createWorkerAttachmentsRepository } =
    await import('./workerAttachmentsRepository');
  return await createWorkerAttachmentsRepository(serviceJobs, tokenProvider);
}

// F5d-52: wraps each repository's activation so a synchronous throw or
// rejected factory promise (the only cases that actually propagate out of
// activateFirestoreRepositories() today — see firestoreInitDiagnostics.ts's
// 'factory' stage comment) is recorded with its repository name before being
// rethrown completely unchanged. This does not alter which error reaches the
// caller, only what's observable in local-dev diagnostics on the way there.
async function activateWithDiagnostics<T>(
  repository: FirestoreRepositoryName,
  factory: () => Promise<T>
): Promise<T> {
  try {
    return await factory();
  } catch (error) {
    recordFirestoreInitFailure(describeFirestoreInitError(error, repository, 'factory'));
    throw error;
  }
}

async function createFirestoreBackedRepositoryProvider(
  brandId: BrandId,
  tokenProvider: WorkerTokenProvider
): Promise<RepositoryProvider> {
  const { createFirestoreServiceJobRepository } =
    await import('./firestoreServiceJobRepository');
  const { createFirestoreCustomersRepository } =
    await import('./firestoreCustomersRepository');
  const { createFirestoreProductMasterRepository } =
    await import('./firestoreProductMasterRepository');
  const { createWorkerProductImportRepository } =
    await import('./workerProductImportRepository');
  const { createFirestoreServiceReportsRepository } =
    await import('./firestoreServiceReportsRepository');
  const { createWorkerApprovalConsoleRepository } =
    await import('./workerServiceReportReadRepository');
  const { createFirestoreRegisteredProductsRepository } =
    await import('./firestoreRegisteredProductsRepository');
  const { createFirestoreSearchRepository } = await import('./firestoreSearchRepository');
  const serviceJobs = await activateWithDiagnostics('serviceJobs', () =>
    createFirestoreServiceJobRepository(brandId, tokenProvider)
  );
  const customers = await activateWithDiagnostics('customers', () =>
    createFirestoreCustomersRepository(brandId)
  );
  return {
    ...createUnavailableRepositoryProvider(),
    serviceJobs,
    customers,
    productMaster: await activateWithDiagnostics('productMaster', () =>
      createFirestoreProductMasterRepository()
    ),
    productImport: createWorkerProductImportRepository(tokenProvider),
    attachments: await activateWithDiagnostics('attachments', () =>
      resolveAttachmentsRepository(serviceJobs, tokenProvider)
    ),
    serviceReports: await activateWithDiagnostics('serviceReports', () =>
      createFirestoreServiceReportsRepository(serviceJobs, tokenProvider)
    ),
    approvalConsole: createWorkerApprovalConsoleRepository(tokenProvider),
    registeredProducts: createFirestoreRegisteredProductsRepository(
      customers,
      serviceJobs
    ),
    search: createFirestoreSearchRepository(customers, serviceJobs),
  };
}

export let repositories: RepositoryProvider =
  backendKind === 'mock'
    ? createMockRepositoryProvider()
    : createUnavailableRepositoryProvider();

export async function activateFirestoreRepositories(
  brandId: BrandId,
  tokenProvider: WorkerTokenProvider
): Promise<void> {
  if (backendKind === 'mock') {
    repositories = createMockRepositoryProvider();
    return;
  }
  if (backendKind !== 'firestore') {
    repositories = createUnavailableRepositoryProvider();
    throw unavailableError();
  }
  // F5d-52: each activation attempt gets its own diagnostic slate — a
  // diagnostic left over from a prior failed attempt (e.g. a retry after
  // sign-out/sign-in) must never be misread as describing this attempt.
  clearFirestoreInitDiagnostics();
  repositories = await createFirestoreBackedRepositoryProvider(brandId, tokenProvider);
}

export function resetRepositoriesForSession(): void {
  repositories =
    backendKind === 'mock'
      ? createMockRepositoryProvider()
      : createUnavailableRepositoryProvider();
}
