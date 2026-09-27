/**
 * Document storage adapter: "local" disk in dev, S3-compatible in production.
 *
 * Two rules enforced here rather than trusted to callers:
 *  1. The stored filename is generated, never taken from the upload. A client
 *     controlled name is how "../" and "shell.php" get on to a disk.
 *  2. Uploads are served back only through an authenticated API route, so a
 *     provider's licence or a job report is never a guessable public URL.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { env } from '../env.js';

const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
]);

export const isAllowedMime = (m) => ALLOWED_MIME.has(m);
export const allowedMimeList = () => [...ALLOWED_MIME];

const extFor = (mime, originalName) => {
  const known = {
    'application/pdf': '.pdf',
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/heic': '.heic',
  };
  return known[mime] || path.extname(originalName || '').slice(0, 10) || '';
};

const localRoot = () => path.resolve(env.uploadDir);

/**
 * Resolve a storage key to an absolute path, refusing anything that escapes
 * the upload root even if a key in the database was tampered with.
 */
function localPathFor(key) {
  const root = localRoot();
  const abs = path.resolve(root, key);
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new Error('Refusing to resolve a storage key outside the upload root');
  }
  return abs;
}

/**
 * @param {{buffer:Buffer, mimetype:string, originalname:string}} file
 * @param {string} prefix logical folder, e.g. `providers/<id>` or `jobs/<id>`
 * @returns {Promise<{storageKey:string, sizeBytes:number}>}
 */
export async function putObject(file, prefix) {
  const safePrefix = String(prefix).replace(/[^a-zA-Z0-9/_-]/g, '');
  const key = `${safePrefix}/${crypto.randomUUID()}${extFor(file.mimetype, file.originalname)}`;

  if (env.storageDriver === 's3') {
    const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
    const client = new S3Client({
      region: env.s3Region,
      endpoint: env.s3Endpoint || undefined,
      credentials: { accessKeyId: env.s3AccessKeyId, secretAccessKey: env.s3SecretAccessKey },
    });
    await client.send(
      new PutObjectCommand({
        Bucket: env.s3Bucket,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
      }),
    );
    return { storageKey: key, sizeBytes: file.buffer.length };
  }

  const abs = localPathFor(key);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, file.buffer);
  return { storageKey: key, sizeBytes: file.buffer.length };
}

/** Read an object back as a Buffer for an authenticated download route. */
export async function getObject(key) {
  if (env.storageDriver === 's3') {
    const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3');
    const client = new S3Client({
      region: env.s3Region,
      endpoint: env.s3Endpoint || undefined,
      credentials: { accessKeyId: env.s3AccessKeyId, secretAccessKey: env.s3SecretAccessKey },
    });
    const res = await client.send(new GetObjectCommand({ Bucket: env.s3Bucket, Key: key }));
    return Buffer.from(await res.Body.transformToByteArray());
  }
  return fs.readFile(localPathFor(key));
}

export async function deleteObject(key) {
  if (env.storageDriver === 's3') {
    const { S3Client, DeleteObjectCommand } = await import('@aws-sdk/client-s3');
    const client = new S3Client({
      region: env.s3Region,
      endpoint: env.s3Endpoint || undefined,
      credentials: { accessKeyId: env.s3AccessKeyId, secretAccessKey: env.s3SecretAccessKey },
    });
    await client.send(new DeleteObjectCommand({ Bucket: env.s3Bucket, Key: key }));
    return;
  }
  await fs.unlink(localPathFor(key)).catch(() => {});
}
