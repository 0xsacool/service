import { useState } from 'react';
import type {
  AccessoryDefinition,
  CommonProblemDefinition,
  ProductCategory,
  ProductMasterEntry,
} from '../types';
import { repositories } from '../repositories/repositoryProvider';
import { ProductKnowledgeManagementError } from '../repositories/types';
import {
  buildProductUpdateFromInput,
  type NewProductInput,
} from '../services/productMasterAdmin';
import type { NewCommonProblemInput } from '../services/productKnowledgeAdmin';
import {
  canManageProductCatalog,
  canMutateProductCatalog,
} from '../services/productCatalogAccess';
import { useAuthSession } from '../auth/authSessionContext';

export interface UseProductDetailResult {
  product: ProductMasterEntry | undefined;
  categories: ProductCategory[];
  brands: string[];
  allAccessories: AccessoryDefinition[];
  allCommonProblems: CommonProblemDefinition[];
  canEdit: boolean;
  canEditKnowledge: boolean;
  updateGeneral: (input: NewProductInput) => Promise<void>;
  setStatus: (status: ProductMasterEntry['status']) => Promise<void>;
  deleteProduct: () => Promise<void>;
  toggleAccessory: (accessoryId: string) => Promise<void>;
  addAccessory: (label: string) => Promise<void>;
  toggleCommonProblem: (problemId: string) => Promise<void>;
  addCommonProblem: (input: NewCommonProblemInput) => Promise<void>;
  updateCommonProblemDefinition: (
    id: string,
    patch: Partial<CommonProblemDefinition>
  ) => Promise<void>;
}

function productKnowledgeUiError(error: unknown): Error {
  if (error instanceof ProductKnowledgeManagementError) {
    if (error.code === 'conflict') {
      return new Error('มีรายการชื่อเดียวกันอยู่ในข้อมูลความรู้สินค้าแล้ว', {
        cause: error,
      });
    }
    if (error.code === 'forbidden') {
      return new Error('บัญชีนี้ไม่มีสิทธิ์จัดการข้อมูลความรู้สินค้า', {
        cause: error,
      });
    }
    if (error.code === 'not_found') {
      return new Error('ไม่พบสินค้าหรือรายการข้อมูลความรู้ที่ต้องการ', {
        cause: error,
      });
    }
    if (error.code === 'validation_failed') {
      return new Error('ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบแล้วลองอีกครั้ง', {
        cause: error,
      });
    }
  }
  return new Error('ไม่สามารถบันทึกข้อมูลความรู้สินค้าได้ กรุณาลองใหม่', {
    cause: error,
  });
}

// Everything a Product Detail page needs, backed by the productMaster
// (product identity) and productKnowledge (accessories/common problems
// master catalogs) repositories, resolved through the Repository Provider.
// Production writes are Worker-mediated through productKnowledgeManagement;
// the browser never writes Product Knowledge or Product associations directly.
export function useProductDetail(productId: string): UseProductDetailResult {
  const [product, setProduct] = useState<ProductMasterEntry | undefined>(() =>
    repositories.productMaster.getProductById(productId)
  );
  const [allAccessories, setAllAccessories] = useState<AccessoryDefinition[]>(() =>
    repositories.productKnowledge.getAllAccessories()
  );
  const [allCommonProblems, setAllCommonProblems] = useState<CommonProblemDefinition[]>(
    () => repositories.productKnowledge.getAllCommonProblems()
  );

  const categories = repositories.productMaster.getCategories();
  const brands = Array.from(
    new Set(repositories.productMaster.getProducts().map((p) => p.brand))
  ).sort();
  const { staffProfile } = useAuthSession();
  const canEdit = canManageProductCatalog(staffProfile?.canManageProducts ?? false);
  const canEditKnowledge = canEdit;

  const refreshProduct = () =>
    setProduct(repositories.productMaster.getProductById(productId));

  const refreshKnowledge = () => {
    setAllAccessories(repositories.productKnowledge.getAllAccessories());
    setAllCommonProblems(repositories.productKnowledge.getAllCommonProblems());
  };

  const refreshProductFromServer = async () => {
    await repositories.productMaster.refreshFromServer([productId]);
    refreshProduct();
  };

  const refreshKnowledgeFromServer = async () => {
    await repositories.productKnowledge.refreshFromServer();
    refreshKnowledge();
  };

  const updateGeneral = async (input: NewProductInput): Promise<void> => {
    if (!product) return;
    if (canMutateProductCatalog()) {
      repositories.productMaster.updateProduct(
        product.id,
        buildProductUpdateFromInput(input)
      );
      refreshProduct();
      return;
    }
    await repositories.productCatalogManagement.updateProduct(product.id, {
      version: 1,
      brand: input.brand,
      categoryId: input.categoryId,
      model: input.model,
      sku: input.sku || null,
      productName: input.productName,
      warrantyMonths: input.warrantyMonths,
      status: input.status,
    });
    await refreshProductFromServer();
  };

  const setStatus = async (status: ProductMasterEntry['status']): Promise<void> => {
    if (!product) return;
    await repositories.productCatalogManagement.setProductStatus(product.id, status);
    await refreshProductFromServer();
  };

  const deleteProduct = async (): Promise<void> => {
    if (!product) return;
    const currentProductId = product.id;
    await repositories.productCatalogManagement.deleteProduct(currentProductId);
    await repositories.productMaster.refreshFromServer([currentProductId]);
    setProduct(undefined);
  };

  const toggleAccessory = async (accessoryId: string): Promise<void> => {
    if (!product) return;
    try {
      await repositories.productKnowledgeManagement.setAccessoryAssociation(
        product.id,
        accessoryId,
        !product.accessoryIds.includes(accessoryId)
      );
      await refreshProductFromServer();
    } catch (error) {
      throw productKnowledgeUiError(error);
    }
  };

  const addAccessory = async (label: string): Promise<void> => {
    if (!product) return;
    try {
      await repositories.productKnowledgeManagement.createAccessory(product.id, {
        version: 1,
        label: label.trim(),
      });
      await Promise.all([refreshKnowledgeFromServer(), refreshProductFromServer()]);
    } catch (error) {
      throw productKnowledgeUiError(error);
    }
  };

  const toggleCommonProblem = async (problemId: string): Promise<void> => {
    if (!product) return;
    try {
      await repositories.productKnowledgeManagement.setCommonProblemAssociation(
        product.id,
        problemId,
        !product.commonProblemIds.includes(problemId)
      );
      await refreshProductFromServer();
    } catch (error) {
      throw productKnowledgeUiError(error);
    }
  };

  const addCommonProblem = async (input: NewCommonProblemInput): Promise<void> => {
    if (!product) return;
    try {
      await repositories.productKnowledgeManagement.createCommonProblem(product.id, {
        version: 1,
        label: input.label.trim(),
        status: input.status,
        description: input.description?.trim() || null,
      });
      await Promise.all([refreshKnowledgeFromServer(), refreshProductFromServer()]);
    } catch (error) {
      throw productKnowledgeUiError(error);
    }
  };

  const updateCommonProblemDefinition = async (
    id: string,
    patch: Partial<CommonProblemDefinition>
  ): Promise<void> => {
    const existing = allCommonProblems.find((problem) => problem.id === id);
    if (!existing) return;
    try {
      await repositories.productKnowledgeManagement.updateCommonProblem(id, {
        version: 1,
        label: (patch.label ?? existing.label).trim(),
        status: patch.status ?? existing.status,
        description:
          patch.description === undefined
            ? (existing.description ?? null)
            : patch.description?.trim() || null,
      });
      await refreshKnowledgeFromServer();
    } catch (error) {
      throw productKnowledgeUiError(error);
    }
  };

  return {
    product,
    categories,
    brands,
    allAccessories,
    allCommonProblems,
    canEdit,
    canEditKnowledge,
    updateGeneral,
    setStatus,
    deleteProduct,
    toggleAccessory,
    addAccessory,
    toggleCommonProblem,
    addCommonProblem,
    updateCommonProblemDefinition,
  };
}
