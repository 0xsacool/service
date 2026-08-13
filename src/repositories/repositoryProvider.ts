import type {
  AttachmentsRepository,
  CustomersRepository,
  ProductKnowledgeRepository,
  ProductMasterRepository,
  ProductsRepository,
  RegisteredProductsRepository,
  SearchRepository,
  ServiceJobsRepository,
  ServiceReportsRepository,
} from './types';
import type { BrandId } from '../types';
import type { WorkerTokenProvider } from '../auth/workerTokenProvider';
import { backendKind } from '../config/backend';
import { filesBackendKind } from '../config/filesBackend';
import { attachmentsRepository } from './attachmentsRepository';
import { customersRepository } from './customersRepository';
import { productKnowledgeRepository } from './productKnowledgeRepository';
import { productMasterRepository } from './productMasterRepository';
import { productsRepository } from './productsRepository';
import { registeredProductsRepository } from './registeredProductsRepository';
import { searchRepository } from './searchRepository';
import { serviceJobsRepository } from './serviceJobsRepository';
import { serviceReportsRepository } from './serviceReportsRepository';

export interface RepositoryProvider {
  serviceJobs: ServiceJobsRepository;
  customers: CustomersRepository;
  products: ProductsRepository;
  search: SearchRepository;
  registeredProducts: RegisteredProductsRepository;
  productMaster: ProductMasterRepository;
  productKnowledge: ProductKnowledgeRepository;
  attachments: AttachmentsRepository;
  serviceReports: ServiceReportsRepository;
}

export function createMockRepositoryProvider(): RepositoryProvider {
  return {
    serviceJobs: serviceJobsRepository,
    customers: customersRepository,
    products: productsRepository,
    search: searchRepository,
    registeredProducts: registeredProductsRepository,
    productMaster: productMasterRepository,
    productKnowledge: productKnowledgeRepository,
    attachments: attachmentsRepository,
    serviceReports: serviceReportsRepository,
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
    },
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
      listForServiceJob: () => [],
      getById: () => undefined,
      createDraft: reject,
      updateDraft: reject,
      finalize: reject,
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
  const { createFirestoreServiceReportsRepository } =
    await import('./firestoreServiceReportsRepository');
  const { createFirestoreRegisteredProductsRepository } =
    await import('./firestoreRegisteredProductsRepository');
  const serviceJobs = await createFirestoreServiceJobRepository(brandId, tokenProvider);
  return {
    ...createUnavailableRepositoryProvider(),
    serviceJobs,
    customers: await createFirestoreCustomersRepository(brandId),
    productMaster: await createFirestoreProductMasterRepository(),
    attachments: await resolveAttachmentsRepository(serviceJobs, tokenProvider),
    serviceReports: await createFirestoreServiceReportsRepository(serviceJobs),
    registeredProducts: createFirestoreRegisteredProductsRepository(serviceJobs),
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
  repositories = await createFirestoreBackedRepositoryProvider(brandId, tokenProvider);
}

export function resetRepositoriesForSession(): void {
  repositories =
    backendKind === 'mock'
      ? createMockRepositoryProvider()
      : createUnavailableRepositoryProvider();
}
