/** S3-compatible object storage adapter. NODE-ONLY. Presigned URLs are NEVER logged. */
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
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
): Promise<void> {
  await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body }));
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
