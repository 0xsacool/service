import type { Env } from './env.ts';
import { getAccessToken } from './googleAuth.ts';
import {
  V2TransactionConflictError,
  type EvidenceObjectStore,
  type ServiceReportV2Store,
  type V2StoredDocument,
  type V2Transaction,
  type V2Write,
} from './serviceReportV2Operations.ts';
import type { DeletionObjectStore } from './attachmentDeletionCoordinatorV2.ts';

interface FirestoreValue {
  nullValue?: null;
  booleanValue?: boolean;
  integerValue?: string;
  doubleValue?: number;
  timestampValue?: string;
  stringValue?: string;
  arrayValue?: { values?: FirestoreValue[] };
  mapValue?: { fields?: Record<string, FirestoreValue> };
}

interface FirestoreDocument {
  name: string;
  fields?: Record<string, FirestoreValue>;
}

const TIMESTAMP_FIELDS = new Set([
  'createdAt',
  'completedAt',
  'updatedAt',
  'finalizedAt',
  'approvalDecidedAt',
  'decidedAt',
  'approvedEvidenceRetainUntil',
  'approvedAt',
  'retainUntil',
  'approvalRetainUntil',
  'r2ActionStartedAt',
  'leaseExpiresAt',
]);

function databasePath(env: Env): string {
  return `projects/${env.FIRESTORE_PROJECT_ID}/databases/(default)/documents`;
}

function baseUrl(env: Env): string {
  const path = databasePath(env);
  return env.FIRESTORE_EMULATOR_HOST
    ? `http://${env.FIRESTORE_EMULATOR_HOST}/v1/${path}`
    : `https://firestore.googleapis.com/v1/${path}`;
}

function resourceName(env: Env, collection: string, id: string): string {
  return `${databasePath(env)}/${collection}/${id}`;
}

function valueToJson(value: FirestoreValue): unknown {
  if (value.nullValue !== undefined) return null;
  if (value.booleanValue !== undefined) return value.booleanValue;
  if (value.integerValue !== undefined) return Number(value.integerValue);
  if (value.doubleValue !== undefined) return value.doubleValue;
  if (value.timestampValue !== undefined) return new Date(value.timestampValue).toISOString();
  if (value.stringValue !== undefined) return value.stringValue;
  if (value.arrayValue !== undefined) return (value.arrayValue.values ?? []).map(valueToJson);
  if (value.mapValue !== undefined) {
    return Object.fromEntries(
      Object.entries(value.mapValue.fields ?? {}).map(([key, entry]) => [key, valueToJson(entry)])
    );
  }
  throw new Error('Unsupported Firestore value');
}

function jsonToValue(value: unknown, fieldName?: string): FirestoreValue {
  if (value === null) return { nullValue: null };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Non-finite Firestore number');
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (typeof value === 'string') {
    return fieldName && TIMESTAMP_FIELDS.has(fieldName)
      ? { timestampValue: value }
      : { stringValue: value };
  }
  if (Array.isArray(value)) return { arrayValue: { values: value.map((entry) => jsonToValue(entry)) } };
  if (typeof value === 'object') {
    return {
      mapValue: {
        fields: Object.fromEntries(
          Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
            key,
            jsonToValue(entry, key),
          ])
        ),
      },
    };
  }
  throw new Error('Unsupported Firestore value');
}

function fields(value: Record<string, unknown>): Record<string, FirestoreValue> {
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, jsonToValue(entry, key)])
  );
}

function parseDocument(document: FirestoreDocument): V2StoredDocument {
  const segments = document.name.split('/');
  const id = segments.at(-1) ?? '';
  const collection = segments.at(-2) ?? '';
  return {
    collection,
    id,
    data: Object.fromEntries(
      Object.entries(document.fields ?? {}).map(([key, value]) => [key, valueToJson(value)])
    ),
  };
}

async function authorizationHeaders(env: Env): Promise<HeadersInit> {
  const token = await getAccessToken(env);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export class ServiceReportV2FirestoreError extends Error {
  readonly status: number;

  constructor(status: number) {
    super('Service Report Firestore dependency failed');
    this.name = 'ServiceReportV2FirestoreError';
    this.status = status;
  }
}

export function createServiceReportV2Store(env: Env): ServiceReportV2Store {
  const url = baseUrl(env);

  return {
    async beginTransaction(): Promise<V2Transaction> {
      const response = await fetch(`${url}:beginTransaction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authorizationHeaders(env)) },
        body: '{}',
      });
      if (!response.ok) throw new ServiceReportV2FirestoreError(response.status);
      const body = await response.json() as { transaction?: unknown };
      if (typeof body.transaction !== 'string' || body.transaction.length === 0) {
        throw new ServiceReportV2FirestoreError(502);
      }
      return { id: body.transaction };
    },

    async get(collection, id, transaction) {
      const target = new URL(`${url}/${collection}/${encodeURIComponent(id)}`);
      if (transaction) target.searchParams.set('transaction', transaction.id);
      const response = await fetch(target, { headers: await authorizationHeaders(env) });
      if (response.status === 404) return null;
      if (!response.ok) throw new ServiceReportV2FirestoreError(response.status);
      return parseDocument(await response.json() as FirestoreDocument);
    },

    async batchGet(addresses, transaction) {
      if (addresses.length === 0) return [];
      const response = await fetch(`${url}:batchGet`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authorizationHeaders(env)) },
        body: JSON.stringify({
          documents: addresses.map((address) => resourceName(env, address.collection, address.id)),
          ...(transaction ? { transaction: transaction.id } : {}),
        }),
      });
      if (!response.ok) throw new ServiceReportV2FirestoreError(response.status);
      const body = await response.json() as unknown;
      if (!Array.isArray(body)) throw new ServiceReportV2FirestoreError(502);
      const result: V2StoredDocument[] = [];
      for (const entry of body) {
        if (entry && typeof entry === 'object' && 'found' in entry) {
          result.push(parseDocument((entry as { found: FirestoreDocument }).found));
        }
      }
      return result;
    },

    async query(collection, field, operator, value, transaction) {
      const response = await fetch(`${url}:runQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authorizationHeaders(env)) },
        body: JSON.stringify({
          structuredQuery: {
            from: [{ collectionId: collection }],
            where: {
              fieldFilter: {
                field: { fieldPath: field },
                op: operator,
                value: jsonToValue(value, field),
              },
            },
          },
          ...(transaction ? { transaction: transaction.id } : {}),
        }),
      });
      if (!response.ok) throw new ServiceReportV2FirestoreError(response.status);
      const body = await response.json() as unknown;
      if (!Array.isArray(body)) throw new ServiceReportV2FirestoreError(502);
      const result: V2StoredDocument[] = [];
      for (const entry of body) {
        if (entry && typeof entry === 'object' && 'document' in entry) {
          result.push(parseDocument((entry as { document: FirestoreDocument }).document));
        }
      }
      return result;
    },

    async commit(transaction, writes) {
      const response = await fetch(`${url}:commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authorizationHeaders(env)) },
        body: JSON.stringify({
          transaction: transaction.id,
          writes: writes.map((write: V2Write) => {
            const update = {
              name: resourceName(env, write.collection, write.id),
              fields: fields(write.data),
            };
            return write.kind === 'create'
              ? { update, currentDocument: { exists: false } }
              : { update, updateMask: { fieldPaths: write.fieldPaths } };
          }),
        }),
      });
      if (!response.ok) {
        const body = await response.text();
        if (response.status === 409 && /\bABORTED\b/.test(body)) {
          throw new V2TransactionConflictError();
        }
        throw new ServiceReportV2FirestoreError(response.status);
      }
    },
  };
}

export function createEvidenceObjectStore(env: Env): EvidenceObjectStore & DeletionObjectStore {
  return {
    async head(key) {
      const object = await env.ATTACHMENTS_BUCKET.head(key);
      return object ? { key: object.key as typeof key, size: object.size } : null;
    },
    async delete(key) {
      await env.ATTACHMENTS_BUCKET.delete(key);
    },
  };
}
