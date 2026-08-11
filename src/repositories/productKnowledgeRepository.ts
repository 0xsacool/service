import type { AccessoryDefinition, CommonProblemDefinition } from '../types';
import type { ProductKnowledgeRepository } from './types';
import { accessoriesMaster, commonProblemsMaster } from './mockData/productMaster.mock';

// Same session-only Map pattern as productMasterRepository — seeded once
// from the static catalog, mutated in place from there. This is now the
// single owner of accessory/common-problem state; productMasterRepository
// reads through it rather than filtering the static arrays itself, so
// there's exactly one place these can drift from what a product actually
// references.
const accessoriesById = new Map<string, AccessoryDefinition>(
  accessoriesMaster.map((accessory) => [accessory.id, accessory])
);
const commonProblemsById = new Map<string, CommonProblemDefinition>(
  commonProblemsMaster.map((problem) => [problem.id, problem])
);

function byIds<T>(store: Map<string, T>, ids: string[]): T[] {
  return ids.map((id) => store.get(id)).filter((item): item is T => item !== undefined);
}

export const productKnowledgeRepository: ProductKnowledgeRepository = {
  getAllAccessories() {
    return Array.from(accessoriesById.values());
  },
  getAccessoriesByIds(ids) {
    return byIds(accessoriesById, ids);
  },
  createAccessory(accessory) {
    accessoriesById.set(accessory.id, accessory);
    return accessory;
  },
  getAllCommonProblems() {
    return Array.from(commonProblemsById.values());
  },
  getCommonProblemsByIds(ids) {
    return byIds(commonProblemsById, ids);
  },
  createCommonProblem(problem) {
    commonProblemsById.set(problem.id, problem);
    return problem;
  },
  updateCommonProblem(id, patch) {
    const existing = commonProblemsById.get(id);
    if (!existing) {
      throw new Error(`Cannot update common problem "${id}": no such problem exists`);
    }
    const updated = { ...existing, ...patch };
    commonProblemsById.set(id, updated);
    return updated;
  },
};
