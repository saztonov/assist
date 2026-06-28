/** S3-compatible object storage adapter. NODE-ONLY. Presigned URLs are NEVER logged. */
import { randomUUID } from 'node:crypto';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export interface S3Config {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean;
}

export function createS3Client(cfg: S3Config): S3Client {
  return new S3Client({
    endpoint: cfg.endpoint,
    region: cfg.region,
    forcePathStyle: cfg.forcePathStyle ?? true,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
  });
}

export async function putObject(
  client: S3Client,
  bucket: string,
  key: string,
  body: Uint8Array,
  contentType?: string,
): Promise<void> {
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ...(contentType ? { ContentType: contentType } : {}),
    }),
  );
}

/** Generates a presigned GET URL. The returned URL MUST NOT be logged. */
export async function getPresignedGetUrl(
  client: S3Client,
  bucket: string,
  key: string,
  expiresIn = 900,
): Promise<string> {
  return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn });
}

/** Generates a presigned PUT URL for direct browser→S3 upload. MUST NOT be logged. */
export async function getPresignedPutUrl(
  client: S3Client,
  bucket: string,
  key: string,
  contentType?: string,
  expiresIn = 900,
): Promise<string> {
  return getSignedUrl(
    client,
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ...(contentType ? { ContentType: contentType } : {}),
    }),
    { expiresIn },
  );
}

export interface ObjectHead {
  size?: number;
  etag?: string;
}

/** Verifies an object exists; returns its metadata, or `null` if missing. */
export async function headObject(
  client: S3Client,
  bucket: string,
  key: string,
): Promise<ObjectHead | null> {
  try {
    const res = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return {
      ...(typeof res.ContentLength === 'number' ? { size: res.ContentLength } : {}),
      ...(res.ETag ? { etag: res.ETag } : {}),
    };
  } catch (err) {
    const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
    const name = (err as { name?: string })?.name;
    if (status === 404 || name === 'NotFound' || name === 'NoSuchKey') return null;
    throw err;
  }
}

/** Fetches an object's bytes (used by the document worker). */
export async function getObjectBytes(
  client: S3Client,
  bucket: string,
  key: string,
): Promise<Uint8Array> {
  const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const body = res.Body as { transformToByteArray?: () => Promise<Uint8Array> } | undefined;
  if (!body?.transformToByteArray) throw new Error('S3 GetObject returned no readable body');
  return body.transformToByteArray();
}

/** Sanitizes a filename for use inside an object key. */
function safeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'file';
  const cleaned = base.replace(/[^\w.-]+/g, '_').replace(/_+/g, '_');
  return cleaned.slice(0, 120) || 'file';
}

export interface BuildObjectKeyInput {
  filename: string;
  /** Optional prefix segment (e.g. department). */
  prefix?: string;
}

/** Builds a collision-free object key: `documents/<prefix?>/<uuid>/<safe-filename>`. */
export function buildObjectKey(input: BuildObjectKeyInput): string {
  const segments = ['documents'];
  if (input.prefix) segments.push(input.prefix.replace(/[^\w.-]+/g, '_'));
  segments.push(randomUUID(), safeFilename(input.filename));
  return segments.join('/');
}

// ── Document storage port (injected into routes/worker; tests pass a fake) ────

export interface DocumentStoragePort {
  buildObjectKey(input: BuildObjectKeyInput): string;
  presignPut(key: string, contentType?: string): Promise<string>;
  /** Server-side upload of bytes the backend already holds (e.g. mail attachments). */
  putObject(key: string, bytes: Uint8Array, contentType?: string): Promise<void>;
  headObject(key: string): Promise<ObjectHead | null>;
  getObjectBytes(key: string): Promise<Uint8Array>;
}

export interface S3DocumentStorageOptions {
  bucket: string;
  presignExpirySeconds?: number;
}

export function createS3DocumentStorage(
  client: S3Client,
  opts: S3DocumentStorageOptions,
): DocumentStoragePort {
  const expiry = opts.presignExpirySeconds ?? 900;
  return {
    buildObjectKey,
    presignPut: (key, contentType) => getPresignedPutUrl(client, opts.bucket, key, contentType, expiry),
    putObject: (key, bytes, contentType) => putObject(client, opts.bucket, key, bytes, contentType),
    headObject: (key) => headObject(client, opts.bucket, key),
    getObjectBytes: (key) => getObjectBytes(client, opts.bucket, key),
  };
}
