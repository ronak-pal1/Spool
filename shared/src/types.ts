export type Visibility = 'public' | 'password' | 'workspace';
export type VideoStatus = 'uploading' | 'processing' | 'ready' | 'failed';
export type PipelineStage =
  | 'uploading'
  | 'queued'
  | 'transcoding'
  | 'transcribing'
  | 'summarizing'
  | 'indexing'
  | 'complete'
  | 'failed';
export type AiStatus = 'pending' | 'processing' | 'ready' | 'unavailable' | 'failed';
export type RenderStatus = 'idle' | 'queued' | 'rendering' | 'ready' | 'failed';
export type RecordingSource = 'extension' | 'desktop' | 'web' | 'upload';
export type WorkspaceRole = 'owner' | 'admin' | 'member';

export interface User {
  id: string;
  email: string;
  name: string;
  avatarColor: string;
  createdAt: string;
}

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  role: WorkspaceRole;
  memberCount: number;
}

export interface WorkspaceMember {
  user: User;
  role: WorkspaceRole;
  joinedAt: string;
}

export interface AuthResponse {
  token: string;
  user: User;
  workspaces: Workspace[];
}

export interface MeResponse {
  user: User;
  workspaces: Workspace[];
}

/** All rectangle and point coordinates are normalized to the 0..1 range of the video frame. */
export interface NormalizedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface NormalizedPoint {
  x: number;
  y: number;
}

export interface TimeRange {
  start: number;
  end: number;
}

export interface BlurRegion {
  id: string;
  start: number;
  end: number;
  rect: NormalizedRect;
  /** 1 (subtle) .. 10 (opaque pixelation-level blur). */
  intensity: number;
}

export interface ZoomSegment {
  id: string;
  start: number;
  end: number;
  focus: NormalizedPoint;
  /** Magnification factor, 1.1 .. 3. */
  scale: number;
  source: 'auto' | 'manual';
}

/** Non-destructive edit decision list. Every timestamp is expressed in source-video seconds. */
export interface EditConfig {
  version: 1;
  trim: TimeRange;
  splits: number[];
  cuts: TimeRange[];
  blurs: BlurRegion[];
  zooms: ZoomSegment[];
}

export interface ClickEvent {
  /** Seconds since the recording started (excluding paused time). */
  t: number;
  x: number;
  y: number;
}

export interface WordTimestamp {
  word: string;
  start: number;
  end: number;
  confidence?: number;
}

export interface TranscriptSegment {
  id: number;
  start: number;
  end: number;
  text: string;
  words: WordTimestamp[];
}

export interface Transcript {
  language: string;
  provider: string;
  segments: TranscriptSegment[];
}

export interface Chapter {
  title: string;
  start: number;
  summary: string;
}

export interface ActionItem {
  text: string;
  timestamp: number | null;
  owner: string | null;
}

export interface VideoSummary {
  tldr: string;
  takeaways: string[];
  actionItems: ActionItem[];
  chapters: Chapter[];
  topics: string[];
  suggestedTitle: string;
}

export interface Tag {
  id: string;
  name: string;
  color: string;
  videoCount?: number;
}

export interface StoryboardMeta {
  url: string;
  frames: number;
  frameWidth: number;
  frameHeight: number;
  interval: number;
}

export interface VideoOwner {
  id: string;
  name: string;
  avatarColor: string;
}

export interface VideoListItem {
  id: string;
  title: string;
  status: VideoStatus;
  source: RecordingSource;
  durationSec: number;
  editedDurationSec: number;
  width: number;
  height: number;
  thumbnailUrl: string | null;
  storyboard: StoryboardMeta | null;
  visibility: Visibility;
  shareId: string;
  viewCount: number;
  aiStatus: AiStatus;
  pipelineStage: PipelineStage;
  tags: Tag[];
  owner: VideoOwner;
  createdAt: string;
  updatedAt: string;
}

export interface VideoDetail extends VideoListItem {
  description: string;
  workspaceId: string;
  playbackUrl: string | null;
  edit: EditConfig;
  clickEvents: ClickEvent[];
  transcript: Transcript | null;
  summary: VideoSummary | null;
  pipelineError: string | null;
  hasPassword: boolean;
  renderStatus: RenderStatus;
  renderUrl: string | null;
  renderError: string | null;
  permissions: {
    canEdit: boolean;
    canManage: boolean;
    canChat: boolean;
  };
}

export interface ShareGateResponse {
  locked: true;
  reason: 'password' | 'workspace';
  title: string | null;
  owner: VideoOwner | null;
}

export type ShareResponse = { locked: false; video: VideoDetail } | ShareGateResponse;

export interface ShareUnlockResponse {
  shareToken: string;
  expiresAt: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

export type ChatStreamEvent =
  | { type: 'delta'; content: string }
  | { type: 'done'; message: ChatMessage; userMessage: ChatMessage }
  | { type: 'error'; error: string };

export interface ViewSession {
  /** Null when the viewer is the creator (their own views are not counted). */
  viewId: string | null;
}

export interface VideoAnalytics {
  totalViews: number;
  uniqueViewers: number;
  totalWatchSeconds: number;
  averageWatchSeconds: number;
  averageCompletion: number;
  completionRate: number;
  viewsByDay: { date: string; views: number }[];
  retention: number[];
  recentViewers: { name: string; avatarColor: string | null; watchedPercent: number; viewedAt: string }[];
}

export interface SearchMatch {
  kind: 'title' | 'transcript' | 'semantic' | 'summary';
  text: string;
  start: number | null;
  score: number;
}

export interface SearchResult {
  video: VideoListItem;
  matches: SearchMatch[];
  score: number;
}

export interface CreateUploadRequest {
  title?: string;
  mimeType: string;
  source: RecordingSource;
}

export interface CreateUploadResponse {
  videoId: string;
  shareId: string;
  uploadId: string;
  partSize: number;
}

export interface PresignPartsResponse {
  urls: { partNumber: number; url: string }[];
}

export interface CompletedPart {
  partNumber: number;
  etag: string;
}

export interface CompleteUploadRequest {
  parts: CompletedPart[];
  durationHint?: number;
  clickEvents?: ClickEvent[];
}

export interface SystemStatus {
  ok: boolean;
  version: string;
  storage: 's3' | 'local';
  transcription: string | null;
  llm: string | null;
  embeddings: string | null;
  maxRecordingSeconds: number;
  /** Public origin of the web app; recorders open `${webUrl}/s/${shareId}` after an upload. */
  webUrl: string;
}

export interface ListVideosQuery {
  q?: string;
  tag?: string;
  status?: VideoStatus | 'all';
  sort?: 'newest' | 'oldest' | 'title' | 'views' | 'duration';
}

export interface UpdateVideoRequest {
  title?: string;
  description?: string;
  visibility?: Visibility;
  password?: string | null;
  tagIds?: string[];
}

export interface ApiErrorBody {
  error: string;
  code?: string;
  details?: unknown;
}
