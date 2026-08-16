import type { Env } from './env.ts';
import { getAccessToken } from './googleAuth.ts';
import type { RetentionStatus } from './attachmentRetention.ts';
import {
  parseServiceJobAuthorizationRecord,
  parseStaffProfile,
  type ServiceJobAuthorizationRecord,
  type StaffAuthorizationDataAccess,
  type StaffProfile,
} from './staffAuthorization.ts';
import {
  isPublicTrackingStatus,
  type PublicTrackingServiceJobRecord,
  type PublicTrackingCodeLookupRecord,
  type PublicTrackingTimelineEvent,
} from './publicTracking.ts';
import type { PublicTrackingTokenHashStore } from './publicTrackingIssuance.ts';
import {
  TransactionConflictError,
  type AllocationTransaction,
  type ServiceJobCreationDataAccess,
} from './serviceJobCreation.ts';
import type { ServiceJob } from '../../src/types/serviceJob.ts';
import {
  logAllocatorStageFailure,
  markAsLocalValidationError,
  runAllocatorStage,
  sanitizedGoogleErrorStatus,
  type AllocatorStage,
} from './allocatorDiagnostics.ts';

// F5d-5 — the narrow slice of the Firestore REST API this Worker needs for
// retention reconciliation. Deliberately not a generic Firestore client:
// two operations only, both scoped to the serviceJobAttachments collection,
// matching the review's explicit "keep it narrow" instruction. This is a
// separate implementation from src/repositories/firestoreAttachmentsRepository.ts
// on purpose — that one is built on the Firebase Web SDK, which does not
// run in the Workers runtime; this one talks to the same Firestore project
// over plain REST, using only fetch() and the Bearer token from
// googleAuth.ts (or no Authorization header at all, against the emulator).

export interface AttachmentRetentionRecord {
  // The Firestore document ID (the "/" -> "__" encoded R2 key, see
  // src/repositories/firestore/attachmentMapping.ts's attachmentDocId() —
  // duplicated in spirit only, not in code; this client reads it straight
  // off the REST response's `name` field rather than re-deriving it).
  docId: string;
  path: string;
  deleteAfter: string | null;
  retentionStatus: RetentionStatus;
  // F5d-17 — DECISIONS.md #025. null: the R2 object has not been
  // physically deleted. A timestamp: the R2 object was successfully
  // deleted and this metadata document is deliberately being retained
  // (never hard-deleted) as the permanent audit record. Distinct from
  // retentionStatus on purpose — see deletionSafety.ts's module comment
  // for why the two must never be conflated.
  deletedAt: string | null;
}

export class FirestoreRequestError extends Error {
  public readonly status: number;
  public readonly body: string;

  constructor(operation: string, status: number, body: string) {
    super(`Firestore ${operation} failed with ${status}: ${body}`);
    this.name = 'FirestoreRequestError';
    this.status = status;
    this.body = body;
  }
}

export interface FirestoreClient
  extends
    StaffAuthorizationDataAccess,
    PublicTrackingTokenHashStore,
    ServiceJobCreationDataAccess {
  listAttachments(): Promise<AttachmentRetentionRecord[]>;
  // F5d-15 — a single-document read, added for the deletion executor's
  // required "re-read current metadata immediately before deleting" step
  // (deletionSafety.ts's recheckEligibilityBeforeDelete() needs a fresh,
  // independently-obtained record, not a re-slice of a list read earlier).
  // Read-only — GET only, no request body, no write of any kind. Uses
  // datastore.entities.get, already granted by the existing custom IAM
  // role (worker/gcp/firestore-retention-sweeper-role.yaml) but unused
  // until now — no IAM change was needed to add this. Returns null on a
  // 404 (the document doesn't exist), which the executor treats as
  // "metadata missing" and fails closed on, never as permission to act.
  getAttachment(docId: string): Promise<AttachmentRetentionRecord | null>;
  getStaffProfile(uid: string): Promise<StaffProfile | null>;
  getServiceJobAuthorization(
    jobId: string
  ): Promise<ServiceJobAuthorizationRecord | null>;
  // A narrow, direct read used only by POST /public/tracking/{reference}.
  // It never lists serviceJobs, attachments, or any other collection.
  getPublicTrackingServiceJob(
    trackingReference: string
  ): Promise<PublicTrackingServiceJobRecord | null>;
  // PUB-TRACK-1 — a narrow direct lookup in the private publicTrackingCodes
  // index. It never lists the index or serviceJobs collection.
  getPublicTrackingCode(code: string): Promise<PublicTrackingCodeLookupRecord | null>;
  // Patches only retentionStatus via Firestore's updateMask — never
  // deleteAfter, never any other field. This is the one write operation
  // this whole Worker could perform against Firestore before F5d-17;
  // there is still no delete-a-document method on this client at all —
  // see markAttachmentDeleted() below for why deletion never becomes one.
  updateRetentionStatus(docId: string, retentionStatus: RetentionStatus): Promise<void>;
  // F5d-17 — DECISIONS.md #025. Patches only deletedAt via updateMask,
  // called by deletionExecutor.ts only after a real R2 object has been
  // confirmed gone (either just deleted this run, or found already
  // absent on a re-run). Never deletes the Firestore document itself —
  // that was explicitly rejected (Option A) in favor of retaining the
  // metadata permanently as an audit record.
  markAttachmentDeleted(docId: string, deletedAt: string): Promise<void>;
}

function resolveDatabasePath(env: Env): string {
  return `projects/${env.FIRESTORE_PROJECT_ID}/databases/(default)/documents`;
}

function resolveBaseUrl(env: Env): string {
  const databasePath = resolveDatabasePath(env);
  if (env.FIRESTORE_EMULATOR_HOST) {
    return `http://${env.FIRESTORE_EMULATOR_HOST}/v1/${databasePath}`;
  }
  return `https://firestore.googleapis.com/v1/${databasePath}`;
}

interface FirestoreValue {
  stringValue?: string;
  booleanValue?: boolean;
  integerValue?: string;
  nullValue?: null;
  arrayValue?: { values?: FirestoreValue[] };
  mapValue?: { fields?: Record<string, FirestoreValue> };
}

interface FirestoreDocument {
  name: string;
  fields?: Record<string, FirestoreValue>;
}

// F5d-56/F5d-56B: `allocatorStage`, when provided, tags this read for the
// allocator's own stage diagnostics (getIntakeKey/getSequence/
// getServiceJob's Firestore reads during POST /service-jobs). Every other
// caller (getStaffProfile, getServiceJobAuthorization, public tracking
// lookups) omits it and behaves exactly as before — this parameter adds
// diagnostics only for the allocator's own call sites, nothing else.
//
// F5d-56B (Terra F5d-56A blocker): the read itself — fetch(), the 404/
// not-ok checks, and response.json() — is now wrapped by
// runAllocatorStage() as one unit, so a rejected fetch() or a response
// body that fails to parse as JSON is attributed to `allocatorStage` too,
// not just a non-OK HTTP status (F5d-56's original, narrower coverage).
async function getDocument(
  env: Env,
  baseUrl: string,
  collection: string,
  documentId: string,
  transaction?: AllocationTransaction,
  allocatorStage?: AllocatorStage
): Promise<FirestoreDocument | null> {
  let token: string | null;
  try {
    token = await getAccessToken(env);
  } catch (error) {
    if (allocatorStage) logAllocatorStageFailure('oauth-token', error);
    throw error;
  }
  const readDocument = async (): Promise<FirestoreDocument | null> => {
    const url = new URL(`${baseUrl}/${collection}/${encodeURIComponent(documentId)}`);
    if (transaction) url.searchParams.set('transaction', transaction.id);
    const response = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new FirestoreRequestError(
        `get ${collection} document`,
        response.status,
        await response.text()
      );
    }
    return (await response.json()) as FirestoreDocument;
  };
  return allocatorStage
    ? await runAllocatorStage(allocatorStage, readDocument)
    : await readDocument();
}

function valueToJson(value: FirestoreValue | undefined): unknown {
  if (!value) return null;
  if (value.nullValue !== undefined) return null;
  if (typeof value.stringValue === 'string') return value.stringValue;
  if (typeof value.booleanValue === 'boolean') return value.booleanValue;
  if (typeof value.integerValue === 'string') return Number(value.integerValue);
  if (value.arrayValue) return (value.arrayValue.values ?? []).map(valueToJson);
  if (value.mapValue)
    return Object.fromEntries(
      Object.entries(value.mapValue.fields ?? {}).map(([key, entry]) => [
        key,
        valueToJson(entry),
      ])
    );
  return null;
}

function jsonToValue(value: unknown): FirestoreValue {
  if (value === null) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number' && Number.isInteger(value))
    return { integerValue: String(value) };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(jsonToValue) } };
  if (value && typeof value === 'object')
    return {
      mapValue: {
        fields: Object.fromEntries(
          Object.entries(value).map(([key, entry]) => [key, jsonToValue(entry)])
        ),
      },
    };
  throw new Error('Unsupported Firestore field value');
}

function parseServiceJobDocument(doc: FirestoreDocument): ServiceJob | null {
  const fields = Object.fromEntries(
    Object.entries(doc.fields ?? {}).map(([key, value]) => [key, valueToJson(value)])
  ) as Record<string, unknown>;
  const id = doc.name.split('/').pop() ?? '';
  if (
    !id ||
    typeof fields.brandId !== 'string' ||
    typeof fields.customerName !== 'string' ||
    typeof fields.status !== 'string'
  )
    return null;
  return { ...fields, id } as ServiceJob;
}

function authHeaders(token: string | null): HeadersInit {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function parseAttachmentDocument(doc: FirestoreDocument): AttachmentRetentionRecord {
  const docId = doc.name.split('/').pop() ?? doc.name;
  const fields = doc.fields ?? {};
  const path = fields.path?.stringValue ?? '';
  const deleteAfterField = fields.deleteAfter;
  const deleteAfter =
    !deleteAfterField || deleteAfterField.nullValue !== undefined
      ? null
      : (deleteAfterField.stringValue ?? null);
  const retentionStatus: RetentionStatus =
    fields.retentionStatus?.stringValue === 'expiring-soon' ? 'expiring-soon' : 'active';
  const deletedAtField = fields.deletedAt;
  const deletedAt =
    !deletedAtField || deletedAtField.nullValue !== undefined
      ? null
      : (deletedAtField.stringValue ?? null);
  return { docId, path, deleteAfter, retentionStatus, deletedAt };
}

function stringOrNull(value: FirestoreValue | undefined): string | null {
  return typeof value?.stringValue === 'string' ? value.stringValue : null;
}

function parsePublicTimeline(
  value: FirestoreValue | undefined
): PublicTrackingTimelineEvent[] {
  const values = value?.arrayValue?.values ?? [];
  const timeline: PublicTrackingTimelineEvent[] = [];
  for (const entry of values) {
    const fields = entry.mapValue?.fields;
    const status = stringOrNull(fields?.status);
    const date = stringOrNull(fields?.date);
    const time = stringOrNull(fields?.time);
    if (!isPublicTrackingStatus(status) || !date) continue;
    timeline.push({ status, occurredAt: time ? `${date}T${time}` : date });
  }
  return timeline;
}

function parsePublicTrackingServiceJobDocument(
  doc: FirestoreDocument
): PublicTrackingServiceJobRecord {
  const fields = doc.fields ?? {};
  return {
    id: doc.name.split('/').pop() ?? '',
    publicTrackingTokenHash: stringOrNull(fields.publicTrackingTokenHash),
    publicTrackingCodeHash: stringOrNull(fields.publicTrackingCodeHash),
    status: stringOrNull(fields.status),
    productName: stringOrNull(fields.product),
    productModelOrSku:
      stringOrNull(fields.productModelOrSku) ??
      stringOrNull(fields.productSku) ??
      stringOrNull(fields.productModel),
    serialNumber: stringOrNull(fields.serialNumber),
    timeline: parsePublicTimeline(fields.timeline),
    updatedAt: stringOrNull(fields.updatedAt),
  };
}

function parsePublicTrackingCodeDocument(
  doc: FirestoreDocument
): PublicTrackingCodeLookupRecord | null {
  const serviceJobId = doc.fields?.serviceJobId?.stringValue;
  return serviceJobId ? { serviceJobId } : null;
}

export function createFirestoreClient(env: Env): FirestoreClient {
  const baseUrl = resolveBaseUrl(env);
  // Firestore's `:commit` RPC identifies each write by a *resource name*
  // (`projects/{p}/databases/(default)/documents/{collection}/{id}`), never
  // by the HTTP URL used to reach it. `baseUrl` is the fetch() target (and
  // differs between the emulator and real Firestore); `resourcePath` is the
  // one thing `update.name` may ever contain. Conflating the two here was
  // F5d-33's B-1 finding — Firestore rejected the full URL with a 400
  // ("lacks \"projects\" at index 0") before any Rules/IAM check ran.
  const resourcePath = resolveDatabasePath(env);

  return {
    // F5d-56B (Terra F5d-56A blocker, Objective 4): the full body after
    // token acquisition — fetch(), the not-ok check, response.json(), and
    // the malformed-transaction-identifier check — is now one
    // runAllocatorStage('firestore-transaction-begin', ...) unit, so a
    // rejected fetch, an unparsable body, or a structurally malformed 200
    // response are all attributed, not just a non-OK HTTP status.
    async beginServiceJobTransaction() {
      let token: string | null;
      try {
        token = await getAccessToken(env);
      } catch (error) {
        logAllocatorStageFailure('oauth-token', error);
        throw error;
      }
      return await runAllocatorStage('firestore-transaction-begin', async () => {
        const response = await fetch(`${baseUrl}:beginTransaction`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
          body: '{}',
        });
        if (!response.ok) {
          throw new FirestoreRequestError(
            'beginServiceJobTransaction',
            response.status,
            await response.text()
          );
        }
        const body: unknown = await response.json();
        if (
          !body ||
          typeof body !== 'object' ||
          !('transaction' in body) ||
          typeof body.transaction !== 'string'
        )
          throw new Error('Firestore returned malformed transaction');
        return { id: body.transaction };
      });
    },

    async getIntakeKey(transaction, key) {
      const doc = await getDocument(
        env,
        baseUrl,
        'serviceJobIntakeKeys',
        key,
        transaction,
        'intake-key-read'
      );
      const value = doc?.fields?.serviceJobId?.stringValue;
      return typeof value === 'string' && value.length > 0 ? value : null;
    },

    // F5d-56B (Objective 5.E): getDocument()'s own runAllocatorStage call
    // (above) already covers the read itself (network/status/parse); this
    // outer wrap additionally covers the numeric-validation throw below,
    // which only ever occurs *after* a successful read returns. The two
    // wraps share the same stage and never double-log the same error —
    // see allocatorDiagnostics.ts's alreadyLoggedErrors dedup.
    async getSequence(transaction, brandId, type, year) {
      const id = `${brandId}__${type}__${year}`;
      const stage: AllocatorStage =
        type === 'tracking_number'
          ? 'tracking-sequence-read'
          : 'service-request-sequence-read';
      return await runAllocatorStage(stage, async () => {
        const doc = await getDocument(
          env,
          baseUrl,
          'numberSequences',
          id,
          transaction,
          stage
        );
        const value = doc?.fields?.currentValue?.integerValue;
        if (value === undefined) return null;
        const numeric = Number(value);
        if (!Number.isInteger(numeric) || numeric < 0)
          throw new Error('Firestore sequence is malformed');
        return numeric;
      });
    },

    // F5d-56D (Terra F5d-56C blocker, Objective 1): getDocument()'s own
    // runAllocatorStage call (below) covers the read itself (network/
    // status/parse-as-JSON); this outer wrap additionally covers
    // parseServiceJobDocument() — a structurally malformed-but-200-OK
    // response (e.g. `{}`) makes it throw a genuine TypeError
    // (`doc.name.split('/')` on an absent `name`), which previously
    // escaped both wraps entirely, reaching the client as an unattributed
    // generic 500. The parse call is caught and its error explicitly
    // marked via markAsLocalValidationError() — not replaced or
    // wrapped — solely so classifyAllocatorError() reports it as
    // 'invalid-response' rather than misreading its TypeError class as a
    // network failure (Objective 4); the original error's identity,
    // instanceof, and stack are all completely unchanged (Objective 2).
    async getServiceJob(transaction, id) {
      return await runAllocatorStage('occupied-id-read', async () => {
        const doc = await getDocument(
          env,
          baseUrl,
          'serviceJobs',
          id,
          transaction,
          'occupied-id-read'
        );
        if (!doc) return null;
        try {
          return parseServiceJobDocument(doc);
        } catch (error) {
          throw markAsLocalValidationError(error);
        }
      });
    },

    async serviceJobExists(transaction, id) {
      const doc = await getDocument(
        env,
        baseUrl,
        'serviceJobs',
        id,
        transaction,
        'occupied-id-read'
      );
      return doc !== null;
    },

    // F5d-56B (Objective 6): the full body after token acquisition —
    // request construction, fetch(), canonical-status discrimination, and the
    // not-ok check — is one runAllocatorStage('firestore-commit', ...)
    // unit. A rejected fetch is now attributed too, not just a non-OK
    // response. The commit's request body is JSON.stringify'd over values
    // already validated/constructed by this codebase (see
    // classifyAllocatorError's 'serialization-error' comment) — no
    // response body is parsed on the commit path, so there is no
    // response-parsing branch here to cover. The write set itself is
    // completely unchanged.
    async commitServiceJobCreation(transaction, input) {
      let token: string | null;
      try {
        token = await getAccessToken(env);
      } catch (error) {
        logAllocatorStageFailure('oauth-token', error);
        throw error;
      }
      await runAllocatorStage('firestore-commit', async () => {
        const trackingId = `${input.job.brandId}__tracking_number__${input.year}`;
        const requestId = `${input.job.brandId}__service_request__${input.year}`;
        const fields = (value: Record<string, unknown>) =>
          Object.fromEntries(
            Object.entries(value).map(([key, entry]) => [key, jsonToValue(entry)])
          );
        const resourceName = (collection: string, id: string) =>
          `${resourcePath}/${collection}/${encodeURIComponent(id)}`;
        const createWrite = (
          collection: string,
          id: string,
          value: Record<string, unknown>
        ) => ({
          update: { name: resourceName(collection, id), fields: fields(value) },
          currentDocument: { exists: false },
        });
        const response = await fetch(`${baseUrl}:commit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
          body: JSON.stringify({
            transaction: transaction.id,
            writes: [
              createWrite('serviceJobIntakeKeys', input.key, {
                serviceJobId: input.job.id,
              }),
              createWrite(
                'serviceJobs',
                input.job.id,
                input.job as unknown as Record<string, unknown>
              ),
              {
                update: {
                  name: resourceName('numberSequences', trackingId),
                  fields: fields({
                    brandId: input.job.brandId,
                    documentType: 'tracking_number',
                    year: input.year,
                    currentValue: input.trackingSequence,
                  }),
                },
              },
              {
                update: {
                  name: resourceName('numberSequences', requestId),
                  fields: fields({
                    brandId: input.job.brandId,
                    documentType: 'service_request',
                    year: input.year,
                    currentValue: input.serviceRequestSequence,
                  }),
                },
              },
              // F5d-65 — present only for a brand-new customer. Part of this
              // same :commit, so it succeeds or fails atomically with the
              // Service Job/intake key/sequence writes above — never a
              // separate request, never a partial/ghost customer. Create-only
              // (currentDocument.exists: false) via createWrite(), same
              // precondition style already used for the intake key and
              // Service Job writes.
              ...(input.newCustomer
                ? [
                    createWrite('customers', input.newCustomer.id, {
                      name: input.newCustomer.name,
                      phone: input.newCustomer.phone,
                      email: input.newCustomer.email,
                      brandIds: [input.newCustomer.brandId],
                    }),
                  ]
                : []),
            ],
          }),
        });
        if (!response.ok) {
          const body = await response.text();
          if (response.status === 409 && sanitizedGoogleErrorStatus(body) === 'ABORTED') {
            throw new TransactionConflictError();
          }
          throw new FirestoreRequestError(
            'commitServiceJobCreation',
            response.status,
            body
          );
        }
      });
    },
    async listAttachments() {
      const token = await getAccessToken(env);
      // pageSize is set explicitly rather than relying on the REST API's
      // default (which is small) — this project's serviceJobAttachments
      // collection is tiny today. A collection large enough to need real
      // pagination or a server-side structured query (runQuery with a
      // filter) is a reasonable future optimization, not needed yet — see
      // worker/README.md.
      const response = await fetch(`${baseUrl}/serviceJobAttachments?pageSize=300`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) {
        throw new FirestoreRequestError(
          'listAttachments',
          response.status,
          await response.text()
        );
      }
      const body = (await response.json()) as { documents?: FirestoreDocument[] };
      return (body.documents ?? []).map(parseAttachmentDocument);
    },

    async getAttachment(docId) {
      const token = await getAccessToken(env);
      const url = `${baseUrl}/serviceJobAttachments/${docId}`;
      const response = await fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (response.status === 404) {
        return null;
      }
      if (!response.ok) {
        throw new FirestoreRequestError(
          `getAttachment("${docId}")`,
          response.status,
          await response.text()
        );
      }
      const doc = (await response.json()) as FirestoreDocument;
      return parseAttachmentDocument(doc);
    },

    async getStaffProfile(uid) {
      const doc = await getDocument(env, baseUrl, 'staffProfiles', uid);
      if (!doc) {
        return null;
      }
      const documentUid = doc.name.split('/').pop() ?? '';
      return parseStaffProfile(uid, documentUid, doc.fields?.brandId?.stringValue);
    },

    async getServiceJobAuthorization(jobId) {
      const doc = await getDocument(env, baseUrl, 'serviceJobs', jobId);
      if (!doc) {
        return null;
      }
      const documentId = doc.name.split('/').pop() ?? '';
      return parseServiceJobAuthorizationRecord(
        documentId,
        doc.fields?.brandId?.stringValue
      );
    },

    async getPublicTrackingServiceJob(trackingReference) {
      const doc = await getDocument(env, baseUrl, 'serviceJobs', trackingReference);
      return doc ? parsePublicTrackingServiceJobDocument(doc) : null;
    },

    async getPublicTrackingCode(code) {
      const doc = await getDocument(env, baseUrl, 'publicTrackingCodes', code);
      return doc ? parsePublicTrackingCodeDocument(doc) : null;
    },

    async writeExistingPublicTrackingTokenHash(trackingReference, tokenHash) {
      const token = await getAccessToken(env);
      const url = new URL(
        `${baseUrl}/serviceJobs/${encodeURIComponent(trackingReference)}`
      );
      url.searchParams.set('updateMask.fieldPaths', 'publicTrackingTokenHash');
      url.searchParams.set('currentDocument.exists', 'true');
      const response = await fetch(url.toString(), {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          fields: {
            publicTrackingTokenHash:
              tokenHash === null ? { nullValue: null } : { stringValue: tokenHash },
          },
        }),
      });
      if (!response.ok) {
        throw new FirestoreRequestError(
          `writeExistingPublicTrackingTokenHash("${trackingReference}")`,
          response.status,
          await response.text()
        );
      }
    },

    async updateRetentionStatus(docId, retentionStatus) {
      const token = await getAccessToken(env);
      const url = `${baseUrl}/serviceJobAttachments/${docId}?updateMask.fieldPaths=retentionStatus`;
      const response = await fetch(url, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          fields: { retentionStatus: { stringValue: retentionStatus } },
        }),
      });
      if (!response.ok) {
        throw new FirestoreRequestError(
          `updateRetentionStatus("${docId}")`,
          response.status,
          await response.text()
        );
      }
    },

    async markAttachmentDeleted(docId, deletedAt) {
      const token = await getAccessToken(env);
      const url = new URL(`${baseUrl}/serviceJobAttachments/${docId}`);
      url.searchParams.set('updateMask.fieldPaths', 'deletedAt');
      url.searchParams.set('currentDocument.exists', 'true');
      const response = await fetch(url.toString(), {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          fields: { deletedAt: { stringValue: deletedAt } },
        }),
      });
      if (!response.ok) {
        throw new FirestoreRequestError(
          `markAttachmentDeleted("${docId}")`,
          response.status,
          await response.text()
        );
      }
    },
  };
}
