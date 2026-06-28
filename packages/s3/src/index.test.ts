import { describe, it, expect } from 'vitest';
import { S3Client } from '@aws-sdk/client-s3';
import {
  buildObjectKey,
  createS3Client,
  createS3DocumentStorage,
  getObjectBytes,
  getPresignedPutUrl,
  headObject,
} from './index.js';

const realClient = createS3Client({
  endpoint: 'https://s3.example.local',
  region: 'ru-central1',
  accessKeyId: 'key',
  secretAccessKey: 'secret',
});

describe('s3 client', () => {
  it('constructs an S3 client without performing network I/O', () => {
    expect(realClient).toBeInstanceOf(S3Client);
  });
});

describe('buildObjectKey', () => {
  it('builds a collision-free, sanitized key', () => {
    const key = buildObjectKey({ filename: 'отчёт 2026.pdf' });
    expect(key.startsWith('documents/')).toBe(true);
    expect(key.endsWith('.pdf')).toBe(true);
    expect(key).not.toContain(' ');
  });

  it('keeps two keys for the same filename distinct (uuid segment)', () => {
    expect(buildObjectKey({ filename: 'a.pdf' })).not.toBe(buildObjectKey({ filename: 'a.pdf' }));
  });

  it('strips path traversal from the filename', () => {
    const key = buildObjectKey({ filename: '../../etc/passwd' });
    expect(key).not.toContain('..');
    expect(key.endsWith('passwd')).toBe(true);
  });
});

describe('getPresignedPutUrl', () => {
  it('returns a signed URL containing the key (offline signing, no network)', async () => {
    const url = await getPresignedPutUrl(realClient, 'bucket', 'documents/x/file.pdf', 'application/pdf');
    expect(url).toContain('documents');
    expect(url).toContain('X-Amz-Signature');
  });
});

describe('headObject', () => {
  it('returns object metadata when present', async () => {
    const fake = {
      send: async () => ({ ContentLength: 42, ETag: '"abc"' }),
    } as unknown as S3Client;
    expect(await headObject(fake, 'bucket', 'k')).toEqual({ size: 42, etag: '"abc"' });
  });

  it('returns null when the object is missing (404/NotFound)', async () => {
    const fake = {
      send: async () => {
        throw { name: 'NotFound', $metadata: { httpStatusCode: 404 } };
      },
    } as unknown as S3Client;
    expect(await headObject(fake, 'bucket', 'k')).toBeNull();
  });

  it('rethrows non-404 errors', async () => {
    const fake = {
      send: async () => {
        throw { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } };
      },
    } as unknown as S3Client;
    await expect(headObject(fake, 'bucket', 'k')).rejects.toBeTruthy();
  });
});

describe('getObjectBytes', () => {
  it('returns the object bytes via transformToByteArray', async () => {
    const fake = {
      send: async () => ({ Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) } }),
    } as unknown as S3Client;
    expect(Array.from(await getObjectBytes(fake, 'bucket', 'k'))).toEqual([1, 2, 3]);
  });
});

describe('createS3DocumentStorage', () => {
  it('exposes the document storage port bound to a bucket', async () => {
    const storage = createS3DocumentStorage(realClient, { bucket: 'files' });
    const key = storage.buildObjectKey({ filename: 'a.pdf' });
    const url = await storage.presignPut(key, 'application/pdf');
    expect(url).toContain('X-Amz-Signature');
  });
});
