// Phase 6R-B.3 — in-memory stand-in for firestoreAttachmentsRepository's
// AttachmentMetadataStore, aliased in by repositoryRuntimeServer.mjs. It exists
// only so the Worker-backed AttachmentsRepository can be constructed without a
// live Firestore; it is deliberately not involved in resolving a download URL,
// which is what the suite using it actually tests.
const byId = new Map();

export async function createFirestoreAttachmentMetadataStore() {
  return {
    getForJob(jobId) {
      return [...byId.values()].filter(
        (attachment) => attachment.jobId === jobId && attachment.deletedAt === null
      );
    },
    getForJobIncludingDeleted(jobId) {
      return [...byId.values()].filter((attachment) => attachment.jobId === jobId);
    },
    getById(id) {
      return byId.get(id);
    },
    async create(attachment) {
      byId.set(attachment.id, attachment);
    },
    async updateRetention() {},
    async extendRetention() {},
    async markDeleted(id, deletedAt) {
      const existing = byId.get(id);
      if (existing) byId.set(id, { ...existing, deletedAt });
    },
  };
}
