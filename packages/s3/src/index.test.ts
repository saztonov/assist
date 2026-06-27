import { describe, it, expect } from 'vitest';
import { S3Client } from '@aws-sdk/client-s3';
import { createS3Client } from './index.js';

describe('s3', () => {
  it('constructs an S3 client without performing network I/O', () => {
    const client = createS3Client({
      endpoint: 'https://s3.example.local',
      region: 'ru-central1',
      accessKeyId: 'key',
      secretAccessKey: 'secret',
    });
    expect(client).toBeInstanceOf(S3Client);
  });
});
