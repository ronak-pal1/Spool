import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListMultipartUploadsCommand,
  ListObjectsV2Command,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { CompletedPart } from '@spool/shared';
import { env } from '../config/env.js';
import { HttpError } from '../utils/http-error.js';
import { alignedExpiry, sign, verifySignature } from '../utils/signing.js';

export interface ReadUrlOptions {
  ttlSeconds?: number;
  downloadName?: string;
}

export interface StorageService {
  readonly driver: 's3' | 'local';
  createMultipartUpload(key: string, contentType: string): Promise<string>;
  presignPart(key: string, uploadId: string, partNumber: number): Promise<string>;
  completeMultipartUpload(key: string, uploadId: string, parts: CompletedPart[]): Promise<number>;
  abortMultipartUpload(key: string, uploadId: string): Promise<void>;
  downloadToFile(key: string, filePath: string): Promise<void>;
  uploadFile(key: string, filePath: string, contentType: string): Promise<void>;
  getReadUrl(key: string, options?: ReadUrlOptions): Promise<string>;
  deletePrefix(prefix: string): Promise<void>;
}

const DEFAULT_READ_TTL = 2 * 3600;
const PART_URL_TTL = 3600;

function assertSafeKey(key: string): void {
  if (!key || key.includes('..') || key.startsWith('/') || key.includes('\\')) {
    throw HttpError.badRequest('Invalid storage key');
  }
}

class S3StorageService implements StorageService {
  readonly driver = 's3' as const;
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor() {
    this.bucket = env.storage.bucket;
    this.client = new S3Client({
      region: env.storage.region,
      endpoint: env.storage.endpoint,
      forcePathStyle: env.storage.forcePathStyle,
    });
  }

  async createMultipartUpload(key: string, contentType: string): Promise<string> {
    const result = await this.client.send(
      new CreateMultipartUploadCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }),
    );
    if (!result.UploadId) throw new HttpError(502, 'S3 did not return an upload id', 'storage_error');
    return result.UploadId;
  }

  presignPart(key: string, uploadId: string, partNumber: number): Promise<string> {
    return getSignedUrl(
      this.client,
      new UploadPartCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId, PartNumber: partNumber }),
      { expiresIn: PART_URL_TTL },
    );
  }

  async completeMultipartUpload(key: string, uploadId: string, parts: CompletedPart[]): Promise<number> {
    await this.client.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: [...parts]
            .sort((a, b) => a.partNumber - b.partNumber)
            .map((part) => ({ ETag: `"${part.etag.replace(/"/g, '')}"`, PartNumber: part.partNumber })),
        },
      }),
    );
    const head = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
    return head.ContentLength ?? 0;
  }

  async abortMultipartUpload(key: string, uploadId: string): Promise<void> {
    await this.client.send(new AbortMultipartUploadCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId }));
  }

  async downloadToFile(key: string, filePath: string): Promise<void> {
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!result.Body) throw new HttpError(502, `Object ${key} has no body`, 'storage_error');
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    await pipeline(result.Body as Readable, fs.createWriteStream(filePath));
  }

  async uploadFile(key: string, filePath: string, contentType: string): Promise<void> {
    const upload = new Upload({
      client: this.client,
      params: {
        Bucket: this.bucket,
        Key: key,
        Body: fs.createReadStream(filePath),
        ContentType: contentType,
        CacheControl: 'private, max-age=31536000, immutable',
      },
      queueSize: 4,
      partSize: 16 * 1024 * 1024,
    });
    await upload.done();
  }

  async getReadUrl(key: string, options: ReadUrlOptions = {}): Promise<string> {
    const ttl = options.ttlSeconds ?? DEFAULT_READ_TTL;
    const expiresAt = alignedExpiry(ttl);
    const signingDate = new Date((expiresAt - ttl - 3600) * 1000);
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentDisposition: options.downloadName
          ? `attachment; filename="${options.downloadName.replace(/["\\]/g, '')}"`
          : undefined,
      }),
      { expiresIn: ttl + 3600, signingDate },
    );
  }

  async deletePrefix(prefix: string): Promise<void> {
    let token: string | undefined;
    do {
      const listed = await this.client.send(
        new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token }),
      );
      const objects = (listed.Contents ?? []).filter((o) => o.Key).map((o) => ({ Key: o.Key as string }));
      if (objects.length > 0) {
        await this.client.send(new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: objects, Quiet: true } }));
      }
      token = listed.IsTruncated ? listed.NextContinuationToken : undefined;
    } while (token);

    const uploads = await this.client.send(new ListMultipartUploadsCommand({ Bucket: this.bucket, Prefix: prefix }));
    for (const upload of uploads.Uploads ?? []) {
      if (upload.Key && upload.UploadId) await this.abortMultipartUpload(upload.Key, upload.UploadId);
    }
  }
}

/**
 * Disk-backed driver that mirrors the S3 multipart contract (signed part URLs returning ETags),
 * so every client exercises the exact same upload flow in development and on single-node installs.
 */
export class LocalStorageService implements StorageService {
  readonly driver = 'local' as const;

  constructor() {
    fs.mkdirSync(env.storage.localDir, { recursive: true });
    fs.mkdirSync(env.storage.uploadsDir, { recursive: true });
  }

  resolvePath(key: string): string {
    assertSafeKey(key);
    const resolved = path.resolve(env.storage.localDir, key);
    if (!resolved.startsWith(path.resolve(env.storage.localDir) + path.sep)) throw HttpError.badRequest('Invalid storage key');
    return resolved;
  }

  private uploadDir(uploadId: string): string {
    if (!/^[A-Za-z0-9_-]+$/.test(uploadId)) throw HttpError.badRequest('Invalid upload id');
    return path.join(env.storage.uploadsDir, uploadId);
  }

  async createMultipartUpload(key: string): Promise<string> {
    assertSafeKey(key);
    const uploadId = crypto.randomBytes(16).toString('hex');
    await fsp.mkdir(this.uploadDir(uploadId), { recursive: true });
    await fsp.writeFile(path.join(this.uploadDir(uploadId), 'key'), key);
    return uploadId;
  }

  async presignPart(_key: string, uploadId: string, partNumber: number): Promise<string> {
    const exp = Math.floor(Date.now() / 1000) + PART_URL_TTL;
    const sig = sign(`part:${uploadId}:${partNumber}:${exp}`);
    return `${env.publicApiUrl}/api/uploads/local/${uploadId}/${partNumber}?exp=${exp}&sig=${sig}`;
  }

  verifyPartSignature(uploadId: string, partNumber: number, exp: number, sig: string | undefined): boolean {
    if (!Number.isFinite(exp) || exp < Date.now() / 1000) return false;
    return verifySignature(`part:${uploadId}:${partNumber}:${exp}`, sig);
  }

  async writePart(uploadId: string, partNumber: number, body: Readable, maxBytes: number): Promise<string> {
    const dir = this.uploadDir(uploadId);
    if (!fs.existsSync(path.join(dir, 'key'))) throw HttpError.notFound('Upload not found or already completed');
    const target = path.join(dir, `${partNumber}.part`);
    const temp = `${target}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    const hash = crypto.createHash('md5');
    let size = 0;
    const output = fs.createWriteStream(temp);
    try {
      await pipeline(
        body,
        async function* (source: AsyncIterable<Buffer>) {
          for await (const chunk of source) {
            size += chunk.length;
            if (size > maxBytes) throw HttpError.badRequest('Part exceeds the maximum allowed size');
            hash.update(chunk);
            yield chunk;
          }
        },
        output,
      );
    } catch (error) {
      await fsp.rm(temp, { force: true });
      throw error;
    }
    await fsp.rename(temp, target);
    const etag = hash.digest('hex');
    await fsp.writeFile(`${target}.etag`, etag);
    return etag;
  }

  async completeMultipartUpload(key: string, uploadId: string, parts: CompletedPart[]): Promise<number> {
    const dir = this.uploadDir(uploadId);
    const destination = this.resolvePath(key);
    await fsp.mkdir(path.dirname(destination), { recursive: true });
    const ordered = [...parts].sort((a, b) => a.partNumber - b.partNumber);
    for (const part of ordered) {
      const etag = await fsp.readFile(path.join(dir, `${part.partNumber}.part.etag`), 'utf8').catch(() => null);
      if (!etag) throw HttpError.badRequest(`Part ${part.partNumber} was never uploaded`);
      if (etag !== part.etag.replace(/"/g, '')) throw HttpError.badRequest(`ETag mismatch for part ${part.partNumber}`);
    }
    const output = fs.createWriteStream(destination);
    try {
      for (const part of ordered) {
        await pipeline(fs.createReadStream(path.join(dir, `${part.partNumber}.part`)), output, { end: false });
      }
    } finally {
      await new Promise<void>((resolve, reject) => output.end((err?: Error | null) => (err ? reject(err) : resolve())));
    }
    await fsp.rm(dir, { recursive: true, force: true });
    const stats = await fsp.stat(destination);
    return stats.size;
  }

  async abortMultipartUpload(_key: string, uploadId: string): Promise<void> {
    await fsp.rm(this.uploadDir(uploadId), { recursive: true, force: true });
  }

  async downloadToFile(key: string, filePath: string): Promise<void> {
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    await fsp.copyFile(this.resolvePath(key), filePath);
  }

  async uploadFile(key: string, filePath: string): Promise<void> {
    const destination = this.resolvePath(key);
    await fsp.mkdir(path.dirname(destination), { recursive: true });
    await fsp.copyFile(filePath, destination);
  }

  async getReadUrl(key: string, options: ReadUrlOptions = {}): Promise<string> {
    assertSafeKey(key);
    const exp = alignedExpiry(options.ttlSeconds ?? DEFAULT_READ_TTL);
    const download = options.downloadName ?? '';
    const sig = sign(`media:${key}:${exp}:${download}`);
    const params = new URLSearchParams({ exp: String(exp), sig });
    if (download) params.set('download', download);
    const encodedKey = key.split('/').map(encodeURIComponent).join('/');
    return `${env.publicApiUrl}/media/${encodedKey}?${params.toString()}`;
  }

  verifyReadSignature(key: string, exp: number, download: string, sig: string | undefined): boolean {
    if (!Number.isFinite(exp) || exp < Date.now() / 1000) return false;
    return verifySignature(`media:${key}:${exp}:${download}`, sig);
  }

  async deletePrefix(prefix: string): Promise<void> {
    assertSafeKey(prefix);
    await fsp.rm(path.resolve(env.storage.localDir, prefix), { recursive: true, force: true });
  }
}

export const storage: StorageService = env.storage.driver === 's3' ? new S3StorageService() : new LocalStorageService();

export function localStorage(): LocalStorageService {
  if (!(storage instanceof LocalStorageService)) throw HttpError.notFound();
  return storage;
}

export const storageKeys = {
  prefix: (videoId: string) => `videos/${videoId}/`,
  source: (videoId: string, extension: string) => `videos/${videoId}/source.${extension}`,
  playback: (videoId: string) => `videos/${videoId}/playback.mp4`,
  thumbnail: (videoId: string) => `videos/${videoId}/thumbnail.jpg`,
  storyboard: (videoId: string) => `videos/${videoId}/storyboard.jpg`,
  render: (videoId: string, version: string) => `videos/${videoId}/render-${version}.mp4`,
};
