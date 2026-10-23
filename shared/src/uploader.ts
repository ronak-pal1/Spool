import { ApiError, type SpoolApi } from './api';
import type { CompletedPart, CompleteUploadRequest, VideoDetail } from './types';

export interface UploadProgress {
  uploadedBytes: number;
  queuedBytes: number;
  partsCompleted: number;
  partsQueued: number;
  finalizing: boolean;
}

export interface StreamingUploaderOptions {
  api: SpoolApi;
  videoId: string;
  partSize: number;
  concurrency?: number;
  maxRetries?: number;
  onProgress?: (progress: UploadProgress) => void;
}

interface PendingPart {
  partNumber: number;
  blob: Blob;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function putPart(url: string, blob: Blob, onBytes: (loaded: number) => void, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onBytes(event.loaded);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const etag = xhr.getResponseHeader('ETag');
        if (!etag) {
          reject(new ApiError(xhr.status, 'Storage did not expose the ETag header. Add "ETag" to the bucket CORS ExposeHeaders.', 'missing_etag'));
          return;
        }
        resolve(etag.replace(/"/g, ''));
      } else {
        reject(new ApiError(xhr.status, `Part upload failed with HTTP ${xhr.status}`, 'part_upload_failed'));
      }
    };
    xhr.onerror = () => reject(new ApiError(0, 'Network error while uploading', 'network_error'));
    xhr.onabort = () => reject(new DOMException('Upload aborted', 'AbortError'));
    signal.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(blob);
  });
}

/**
 * Streams arbitrarily-sized blobs (MediaRecorder chunks or a File) into an S3-compatible
 * multipart upload. Parts are cut at `partSize` boundaries and uploaded concurrently while
 * new data keeps arriving, so the upload is nearly finished the moment recording stops.
 */
export class StreamingMultipartUploader {
  private readonly api: SpoolApi;
  private readonly videoId: string;
  private readonly partSize: number;
  private readonly concurrency: number;
  private readonly maxRetries: number;
  private readonly onProgress?: (progress: UploadProgress) => void;
  private readonly controller = new AbortController();

  private buffer: Blob[] = [];
  private bufferedBytes = 0;
  private nextPartNumber = 1;
  private readonly queue: PendingPart[] = [];
  private readonly inflight = new Map<number, Promise<void>>();
  private readonly partBytes = new Map<number, number>();
  private readonly loadedBytes = new Map<number, number>();
  private readonly completed: CompletedPart[] = [];
  private failure: Error | null = null;
  private finished = false;
  private finalizing = false;

  constructor(options: StreamingUploaderOptions) {
    this.api = options.api;
    this.videoId = options.videoId;
    this.partSize = Math.max(5 * 1024 * 1024, options.partSize);
    this.concurrency = Math.max(1, options.concurrency ?? 3);
    this.maxRetries = options.maxRetries ?? 4;
    this.onProgress = options.onProgress;
  }

  get error(): Error | null {
    return this.failure;
  }

  append(chunk: Blob): void {
    if (this.finished || this.controller.signal.aborted) return;
    if (chunk.size === 0) return;
    this.buffer.push(chunk);
    this.bufferedBytes += chunk.size;
    while (this.bufferedBytes >= this.partSize) {
      const combined = new Blob(this.buffer);
      this.enqueue(combined.slice(0, this.partSize));
      const remainder = combined.slice(this.partSize);
      this.buffer = remainder.size > 0 ? [remainder] : [];
      this.bufferedBytes = remainder.size;
    }
    this.pump();
  }

  private enqueue(blob: Blob): void {
    const partNumber = this.nextPartNumber++;
    this.queue.push({ partNumber, blob });
    this.partBytes.set(partNumber, blob.size);
    this.emit();
  }

  private emit(): void {
    if (!this.onProgress) return;
    let queuedBytes = this.bufferedBytes;
    for (const size of this.partBytes.values()) queuedBytes += size;
    let uploadedBytes = 0;
    for (const loaded of this.loadedBytes.values()) uploadedBytes += loaded;
    this.onProgress({
      uploadedBytes,
      queuedBytes,
      partsCompleted: this.completed.length,
      partsQueued: this.nextPartNumber - 1,
      finalizing: this.finalizing,
    });
  }

  private pump(): void {
    while (this.inflight.size < this.concurrency && this.queue.length > 0 && !this.failure) {
      const part = this.queue.shift() as PendingPart;
      const task = this.uploadWithRetry(part)
        .catch((error: unknown) => {
          if (!this.controller.signal.aborted) this.failure = error instanceof Error ? error : new Error(String(error));
        })
        .finally(() => {
          this.inflight.delete(part.partNumber);
          this.pump();
        });
      this.inflight.set(part.partNumber, task);
    }
  }

  private async uploadWithRetry(part: PendingPart): Promise<void> {
    let attempt = 0;
    for (;;) {
      if (this.controller.signal.aborted) throw new DOMException('Upload aborted', 'AbortError');
      try {
        const { urls } = await this.api.presignParts(this.videoId, [part.partNumber]);
        const target = urls.find((u) => u.partNumber === part.partNumber);
        if (!target) throw new ApiError(500, 'Server did not return a signed URL for the part');
        const etag = await putPart(
          target.url,
          part.blob,
          (loaded) => {
            this.loadedBytes.set(part.partNumber, loaded);
            this.emit();
          },
          this.controller.signal,
        );
        this.loadedBytes.set(part.partNumber, part.blob.size);
        this.completed.push({ partNumber: part.partNumber, etag });
        this.emit();
        return;
      } catch (error) {
        if ((error as Error).name === 'AbortError') throw error;
        attempt++;
        this.loadedBytes.set(part.partNumber, 0);
        if (attempt > this.maxRetries) throw error;
        await sleep(Math.min(16000, 500 * 2 ** attempt));
      }
    }
  }

  private async drain(): Promise<void> {
    while (this.inflight.size > 0 || this.queue.length > 0) {
      if (this.failure) throw this.failure;
      if (this.inflight.size === 0) this.pump();
      await Promise.race(this.inflight.values());
    }
    if (this.failure) throw this.failure;
  }

  /** Flushes the trailing partial part, waits for all parts and completes the multipart upload. */
  async finish(extra: Omit<CompleteUploadRequest, 'parts'> = {}): Promise<VideoDetail> {
    if (this.finished) throw new Error('Upload already finished');
    this.finished = true;
    this.finalizing = true;
    if (this.bufferedBytes > 0 || this.nextPartNumber === 1) {
      const blob = new Blob(this.buffer);
      this.buffer = [];
      this.bufferedBytes = 0;
      if (blob.size === 0) throw new ApiError(400, 'Nothing was recorded', 'empty_upload');
      this.enqueue(blob);
    }
    this.pump();
    await this.drain();
    this.emit();
    const parts = [...this.completed].sort((a, b) => a.partNumber - b.partNumber);
    return this.api.completeUpload(this.videoId, { ...extra, parts });
  }

  async abort(): Promise<void> {
    this.finished = true;
    this.controller.abort();
    this.queue.length = 0;
    try {
      await this.api.abortUpload(this.videoId);
    } catch {
      // The server reclaims orphaned multipart uploads during cleanup; abort is best-effort here.
    }
  }
}
