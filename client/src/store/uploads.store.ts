import { StreamingMultipartUploader, type UploadProgress } from '@spool/shared';
import { create } from 'zustand';
import { api, errorMessage, queryClient, queryKeys } from '@/lib/api';
import { createLocalId } from '@/lib/viewer';
import { toast } from './toast.store';

export type UploadState = 'preparing' | 'uploading' | 'finalizing' | 'done' | 'error';

export interface UploadEntry {
  id: string;
  name: string;
  size: number;
  state: UploadState;
  progress: number;
  videoId: string | null;
  shareId: string | null;
  error: string | null;
}

interface UploadsStore {
  uploads: UploadEntry[];
  uploadFile: (file: File) => void;
  dismiss: (id: string) => void;
  cancel: (id: string) => void;
}

const EXTENSION_MIME: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  ts: 'video/mp2t',
  avi: 'video/x-msvideo',
};

export const ACCEPTED_VIDEO = Object.keys(EXTENSION_MIME).map((e) => `.${e}`).join(',') + ',video/*';

function mimeFor(file: File): string | null {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  const fromExt = EXTENSION_MIME[ext];
  if (file.type && Object.values(EXTENSION_MIME).includes(file.type)) return file.type;
  return fromExt ?? null;
}

const uploaders = new Map<string, StreamingMultipartUploader>();

export const useUploadsStore = create<UploadsStore>((set, get) => {
  const patch = (id: string, changes: Partial<UploadEntry>) =>
    set({ uploads: get().uploads.map((u) => (u.id === id ? { ...u, ...changes } : u)) });

  return {
    uploads: [],
    uploadFile: (file) => {
      const mimeType = mimeFor(file);
      if (!mimeType) {
        toast.error('Unsupported file', `${file.name} is not a supported video format.`);
        return;
      }
      const id = createLocalId();
      const entry: UploadEntry = {
        id,
        name: file.name,
        size: file.size,
        state: 'preparing',
        progress: 0,
        videoId: null,
        shareId: null,
        error: null,
      };
      set({ uploads: [...get().uploads, entry] });

      void (async () => {
        try {
          const title = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim().slice(0, 120);
          const created = await api.createUpload({ title, mimeType, source: 'upload' });
          patch(id, { state: 'uploading', videoId: created.videoId, shareId: created.shareId });
          void queryClient.invalidateQueries({ queryKey: queryKeys.allVideos });
          const uploader = new StreamingMultipartUploader({
            api,
            videoId: created.videoId,
            partSize: created.partSize,
            concurrency: 4,
            onProgress: (p: UploadProgress) => {
              patch(id, {
                progress: file.size > 0 ? Math.min(1, p.uploadedBytes / file.size) : 0,
                state: p.finalizing && p.uploadedBytes >= file.size ? 'finalizing' : 'uploading',
              });
            },
          });
          uploaders.set(id, uploader);
          uploader.append(file);
          await uploader.finish();
          patch(id, { state: 'done', progress: 1 });
          toast.success('Upload complete', `${title} is processing now.`);
          void queryClient.invalidateQueries({ queryKey: queryKeys.allVideos });
          window.setTimeout(() => get().dismiss(id), 6000);
        } catch (error) {
          if ((error as Error).name === 'AbortError') return;
          patch(id, { state: 'error', error: errorMessage(error) });
          toast.error('Upload failed', errorMessage(error));
        } finally {
          uploaders.delete(id);
        }
      })();
    },
    cancel: (id) => {
      const uploader = uploaders.get(id);
      if (uploader) void uploader.abort().then(() => queryClient.invalidateQueries({ queryKey: queryKeys.allVideos }));
      uploaders.delete(id);
      set({ uploads: get().uploads.filter((u) => u.id !== id) });
    },
    dismiss: (id) => set({ uploads: get().uploads.filter((u) => u.id !== id) }),
  };
});
