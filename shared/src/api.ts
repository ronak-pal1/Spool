import type {
  ApiErrorBody,
  AuthResponse,
  ChatMessage,
  ChatStreamEvent,
  CompleteUploadRequest,
  CreateUploadRequest,
  CreateUploadResponse,
  EditConfig,
  ListVideosQuery,
  MeResponse,
  PresignPartsResponse,
  SearchResult,
  ShareResponse,
  ShareUnlockResponse,
  SystemStatus,
  Tag,
  UpdateVideoRequest,
  VideoAnalytics,
  VideoDetail,
  VideoListItem,
  ViewSession,
  Workspace,
  WorkspaceMember,
  WorkspaceRole,
} from './types';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  readonly details: unknown;

  constructor(status: number, message: string, code?: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export interface SpoolApiOptions {
  baseUrl: string;
  getToken: () => string | null;
  getWorkspaceId?: () => string | null;
  onUnauthorized?: () => void;
  fetchImpl?: typeof fetch;
}

interface RequestOptions {
  body?: unknown;
  query?: Record<string, string | number | undefined | null>;
  shareToken?: string | null;
  viewerSession?: string | null;
  signal?: AbortSignal;
  auth?: boolean;
}

export interface ChatStreamOptions {
  shareToken?: string | null;
  viewerSession: string;
  signal?: AbortSignal;
  onDelta: (text: string) => void;
}

export interface ViewHeartbeat {
  watchedSeconds: number;
  position: number;
  duration: number;
  buckets: number[];
}

export class SpoolApi {
  private readonly options: SpoolApiOptions;

  constructor(options: SpoolApiOptions) {
    this.options = options;
  }

  get baseUrl(): string {
    return this.options.baseUrl.replace(/\/+$/, '');
  }

  private headers(opts: RequestOptions, json: boolean): Headers {
    const headers = new Headers();
    if (json) headers.set('Content-Type', 'application/json');
    headers.set('Accept', 'application/json');
    if (opts.auth !== false) {
      const token = this.options.getToken();
      if (token) headers.set('Authorization', `Bearer ${token}`);
      const workspaceId = this.options.getWorkspaceId?.();
      if (workspaceId) headers.set('X-Workspace-Id', workspaceId);
    }
    if (opts.shareToken) headers.set('X-Share-Token', opts.shareToken);
    if (opts.viewerSession) headers.set('X-Viewer-Session', opts.viewerSession);
    return headers;
  }

  private url(path: string, query?: RequestOptions['query']): string {
    const url = new URL(`${this.baseUrl}${path}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  private async raw(method: string, path: string, opts: RequestOptions = {}): Promise<Response> {
    const fetcher = this.options.fetchImpl ?? fetch;
    const hasBody = opts.body !== undefined;
    let response: Response;
    try {
      response = await fetcher(this.url(path, opts.query), {
        method,
        headers: this.headers(opts, hasBody),
        body: hasBody ? JSON.stringify(opts.body) : undefined,
        signal: opts.signal,
      });
    } catch (error) {
      if ((error as Error).name === 'AbortError') throw error;
      throw new ApiError(0, `Unable to reach the Spool API at ${this.baseUrl}. Check your connection.`, 'network_error');
    }
    if (!response.ok) {
      let body: ApiErrorBody | null = null;
      try {
        body = (await response.json()) as ApiErrorBody;
      } catch {
        body = null;
      }
      if (response.status === 401 && opts.auth !== false && this.options.getToken()) this.options.onUnauthorized?.();
      throw new ApiError(response.status, body?.error ?? response.statusText ?? 'Request failed', body?.code, body?.details);
    }
    return response;
  }

  private async request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
    const response = await this.raw(method, path, opts);
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  health(): Promise<SystemStatus> {
    return this.request('GET', '/api/health', { auth: false });
  }

  register(input: { name: string; email: string; password: string }): Promise<AuthResponse> {
    return this.request('POST', '/api/auth/register', { body: input, auth: false });
  }

  login(input: { email: string; password: string }): Promise<AuthResponse> {
    return this.request('POST', '/api/auth/login', { body: input, auth: false });
  }

  me(): Promise<MeResponse> {
    return this.request('GET', '/api/auth/me');
  }

  updateMe(input: { name?: string; currentPassword?: string; newPassword?: string }): Promise<MeResponse> {
    return this.request('PATCH', '/api/auth/me', { body: input });
  }

  listWorkspaces(): Promise<Workspace[]> {
    return this.request('GET', '/api/workspaces');
  }

  createWorkspace(name: string): Promise<Workspace> {
    return this.request('POST', '/api/workspaces', { body: { name } });
  }

  updateWorkspace(id: string, name: string): Promise<Workspace> {
    return this.request('PATCH', `/api/workspaces/${id}`, { body: { name } });
  }

  listMembers(workspaceId: string): Promise<WorkspaceMember[]> {
    return this.request('GET', `/api/workspaces/${workspaceId}/members`);
  }

  inviteMember(workspaceId: string, email: string, role: WorkspaceRole): Promise<WorkspaceMember> {
    return this.request('POST', `/api/workspaces/${workspaceId}/members`, { body: { email, role } });
  }

  removeMember(workspaceId: string, userId: string): Promise<void> {
    return this.request('DELETE', `/api/workspaces/${workspaceId}/members/${userId}`);
  }

  listVideos(query: ListVideosQuery = {}): Promise<VideoListItem[]> {
    return this.request('GET', '/api/videos', { query: { ...query } });
  }

  getVideo(id: string): Promise<VideoDetail> {
    return this.request('GET', `/api/videos/${id}`);
  }

  updateVideo(id: string, input: UpdateVideoRequest): Promise<VideoDetail> {
    return this.request('PATCH', `/api/videos/${id}`, { body: input });
  }

  deleteVideo(id: string): Promise<void> {
    return this.request('DELETE', `/api/videos/${id}`);
  }

  saveEdit(id: string, edit: EditConfig): Promise<VideoDetail> {
    return this.request('PUT', `/api/videos/${id}/edit`, { body: edit });
  }

  renderVideo(id: string): Promise<VideoDetail> {
    return this.request('POST', `/api/videos/${id}/render`);
  }

  reprocessAi(id: string): Promise<VideoDetail> {
    return this.request('POST', `/api/videos/${id}/reprocess`);
  }

  getAnalytics(id: string): Promise<VideoAnalytics> {
    return this.request('GET', `/api/videos/${id}/analytics`);
  }

  listTags(): Promise<Tag[]> {
    return this.request('GET', '/api/tags');
  }

  createTag(name: string, color: string): Promise<Tag> {
    return this.request('POST', '/api/tags', { body: { name, color } });
  }

  deleteTag(id: string): Promise<void> {
    return this.request('DELETE', `/api/tags/${id}`);
  }

  search(q: string, signal?: AbortSignal): Promise<SearchResult[]> {
    return this.request('GET', '/api/search', { query: { q }, signal });
  }

  createUpload(input: CreateUploadRequest): Promise<CreateUploadResponse> {
    return this.request('POST', '/api/uploads', { body: input });
  }

  presignParts(videoId: string, partNumbers: number[]): Promise<PresignPartsResponse> {
    return this.request('POST', `/api/uploads/${videoId}/parts`, { body: { partNumbers } });
  }

  completeUpload(videoId: string, input: CompleteUploadRequest): Promise<VideoDetail> {
    return this.request('POST', `/api/uploads/${videoId}/complete`, { body: input });
  }

  abortUpload(videoId: string): Promise<void> {
    return this.request('DELETE', `/api/uploads/${videoId}`);
  }

  getShare(shareId: string, shareToken?: string | null): Promise<ShareResponse> {
    return this.request('GET', `/api/share/${shareId}`, { shareToken });
  }

  unlockShare(shareId: string, password: string): Promise<ShareUnlockResponse> {
    return this.request('POST', `/api/share/${shareId}/unlock`, { body: { password }, auth: false });
  }

  chatHistory(shareId: string, viewerSession: string, shareToken?: string | null): Promise<ChatMessage[]> {
    return this.request('GET', `/api/share/${shareId}/chat`, { shareToken, viewerSession });
  }

  clearChat(shareId: string, viewerSession: string, shareToken?: string | null): Promise<void> {
    return this.request('DELETE', `/api/share/${shareId}/chat`, { shareToken, viewerSession });
  }

  /** Streams an AI answer over server-sent events; resolves with the persisted messages. */
  async chat(shareId: string, message: string, opts: ChatStreamOptions): Promise<{ message: ChatMessage; userMessage: ChatMessage }> {
    const response = await this.raw('POST', `/api/share/${shareId}/chat`, {
      body: { message },
      shareToken: opts.shareToken,
      viewerSession: opts.viewerSession,
      signal: opts.signal,
    });
    if (!response.body) throw new ApiError(500, 'Streaming is not supported by this environment');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let result: { message: ChatMessage; userMessage: ChatMessage } | null = null;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf('\n\n');
        const data = frame
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n');
        if (!data) continue;
        const event = JSON.parse(data) as ChatStreamEvent;
        if (event.type === 'delta') opts.onDelta(event.content);
        else if (event.type === 'done') result = { message: event.message, userMessage: event.userMessage };
        else if (event.type === 'error') throw new ApiError(502, event.error, 'ai_error');
      }
    }
    if (!result) throw new ApiError(502, 'The AI response ended unexpectedly', 'ai_error');
    return result;
  }

  startView(shareId: string, viewerSession: string, shareToken?: string | null): Promise<ViewSession> {
    return this.request('POST', `/api/share/${shareId}/views`, { shareToken, viewerSession });
  }

  heartbeatView(viewId: string, heartbeat: ViewHeartbeat, viewerSession: string): Promise<void> {
    return this.request('PATCH', `/api/views/${viewId}`, { body: heartbeat, viewerSession, auth: false });
  }
}
