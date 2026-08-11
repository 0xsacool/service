import { useState } from 'react';
import type {
  AccessoryDefinition,
  CommonProblemDefinition,
  ProductCategory,
  ProductMasterEntry,
} from '../types';
import { repositories } from '../repositories/repositoryProvider';
import {
  buildProductUpdateFromInput,
  type NewProductInput,
} from '../services/productMasterAdmin';
import {
  buildAccessoryDefinition,
  buildCommonProblemDefinition,
  type NewCommonProblemInput,
} from '../services/productKnowledgeAdmin';
import { canMutateProductCatalog } from '../services/productCatalogAccess';

export interface UseProductDetailResult {
  product: ProductMasterEntry | undefined;
  categories: ProductCategory[];
  brands: string[];
  allAccessories: AccessoryDefinition[];
  allCommonProblems: CommonProblemDefinition[];
  canEdit: boolean;
  updateGeneral: (input: NewProductInput) => void;
  toggleAccessory: (accessoryId: string) => void;
  addAccessory: (label: string) => void;
  toggleCommonProblem: (problemId: string) => void;
  addCommonProblem: (input: NewCommonProblemInput) => void;
  updateCommonProblemDefinition: (
    id: string,
    patch: Partial<CommonProblemDefinition>
  ) => void;
}

// Everything a Product Detail page needs, backed by the productMaster
// (product identity) and productKnowledge (accessories/common problems
// master catalogs) repositories, resolved through the Repository Provider —
// mirrors useProductMaster's local-state-plus-resync pattern so the page
// re-renders immediately after every mutation.
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
  const canEdit = canMutateProductCatalog();

  const refreshProduct = () =>
    setProduct(repositories.productMaster.getProductById(productId));

  const updateGeneral = (input: NewProductInput) => {
    if (!product) return;
    repositories.productMaster.updateProduct(
      product.id,
      buildProductUpdateFromInput(input)
    );
    refreshProduct();
  };

  const setProductAssociation = (
    field: 'accessoryIds' | 'commonProblemIds',
    id: string,
    include: boolean
  ) => {
    if (!product) return;
    const current = product[field];
    const next = include
      ? [...current, id]
      : current.filter((existing) => existing !== id);
    repositories.productMaster.updateProduct(product.id, { [field]: next });
    refreshProduct();
  };

  const toggleAccessory = (accessoryId: string) => {
    if (!product) return;
    setProductAssociation(
      'accessoryIds',
      accessoryId,
      !product.accessoryIds.includes(accessoryId)
    );
  };

  // Newly created accessories/problems are assumed relevant to the product
  // the admin was looking at when they added them, so they're associated
  // immediately rather than left for a second toggle.
  const addAccessory = (label: string) => {
    const existingIds = new Set(allAccessories.map((a) => a.id));
    const created = buildAccessoryDefinition(label, existingIds);
    repositories.productKnowledge.createAccessory(created);
    setAllAccessories(repositories.productKnowledge.getAllAccessories());
    setProductAssociation('accessoryIds', created.id, true);
  };

  const toggleCommonProblem = (problemId: string) => {
    if (!product) return;
    setProductAssociation(
      'commonProblemIds',
      problemId,
      !product.commonProblemIds.includes(problemId)
    );
  };

  const addCommonProblem = (input: NewCommonProblemInput) => {
    const existingIds = new Set(allCommonProblems.map((p) => p.id));
    const created = buildCommonProblemDefinition(input, existingIds);
    repositories.productKnowledge.createCommonProblem(created);
    setAllCommonProblems(repositories.productKnowledge.getAllCommonProblems());
    setProductAssociation('commonProblemIds', created.id, true);
  };

  const updateCommonProblemDefinition = (
    id: string,
    patch: Partial<CommonProblemDefinition>
  ) => {
    repositories.productKnowledge.updateCommonProblem(id, patch);
    setAllCommonProblems(repositories.productKnowledge.getAllCommonProblems());
  };

  return {
    product,
    categories,
    brands,
    allAccessories,
    allCommonProblems,
    canEdit,
    updateGeneral,
    toggleAccessory,
    addAccessory,
    toggleCommonProblem,
    addCommonProblem,
    updateCommonProblemDefinition,
  };
}
