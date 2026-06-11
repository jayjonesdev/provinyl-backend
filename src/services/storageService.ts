import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../config/env';

/* Object storage (Cloudflare R2 / any S3-compatible) for user-uploaded item
 * images. Image bytes never flow through Express on upload — clients PUT
 * directly to a presigned URL. All keys are namespaced by userId. */

export function isStorageConfigured(): boolean {
  return Boolean(env.R2_ENDPOINT && env.R2_BUCKET && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY);
}

let client: S3Client | null = null;
function s3(): S3Client {
  if (!isStorageConfigured()) throw new Error('Object storage is not configured');
  if (!client) {
    client = new S3Client({
      region: env.R2_REGION,
      endpoint: env.R2_ENDPOINT,
      forcePathStyle: true,
      credentials: {
        accessKeyId: env.R2_ACCESS_KEY_ID!,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
      },
    });
  }
  return client;
}

const bucket = (): string => env.R2_BUCKET!;

/** Short-lived presigned PUT for a direct client→bucket upload. */
export function presignPut(key: string, contentType: string, ttlSeconds = 300): Promise<string> {
  return getSignedUrl(s3(), new PutObjectCommand({ Bucket: bucket(), Key: key, ContentType: contentType }), {
    expiresIn: ttlSeconds,
  });
}

/** Short-lived presigned GET for private display (never a public URL). */
export function presignGet(key: string, ttlSeconds = 300): Promise<string> {
  return getSignedUrl(s3(), new GetObjectCommand({ Bucket: bucket(), Key: key }), {
    expiresIn: ttlSeconds,
  });
}

export async function getObject(key: string): Promise<Buffer> {
  const out = await s3().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
  const bytes = await out.Body!.transformToByteArray();
  return Buffer.from(bytes);
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  await s3().send(new PutObjectCommand({ Bucket: bucket(), Key: key, Body: body, ContentType: contentType }));
}

export async function deleteObject(key: string): Promise<void> {
  await s3().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
}
