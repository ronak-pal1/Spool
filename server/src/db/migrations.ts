export interface Migration {
  version: number;
  sql: string;
}

export const migrations: Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        avatar_color TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL
      );

      CREATE TABLE workspace_members (
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
        created_at TEXT NOT NULL,
        PRIMARY KEY (workspace_id, user_id)
      );
      CREATE INDEX idx_members_user ON workspace_members(user_id);

      CREATE TABLE videos (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        title_is_default INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL,
        source TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        source_key TEXT NOT NULL,
        upload_id TEXT,
        playback_key TEXT,
        thumbnail_key TEXT,
        storyboard_key TEXT,
        storyboard_meta TEXT,
        duration REAL NOT NULL DEFAULT 0,
        width INTEGER NOT NULL DEFAULT 0,
        height INTEGER NOT NULL DEFAULT 0,
        size_bytes INTEGER NOT NULL DEFAULT 0,
        edit_config TEXT,
        click_events TEXT NOT NULL DEFAULT '[]',
        visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'password', 'workspace')),
        password_hash TEXT,
        share_id TEXT NOT NULL UNIQUE,
        pipeline_stage TEXT NOT NULL,
        pipeline_error TEXT,
        ai_status TEXT NOT NULL DEFAULT 'pending',
        render_status TEXT NOT NULL DEFAULT 'idle',
        render_key TEXT,
        render_error TEXT,
        view_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_videos_workspace ON videos(workspace_id, created_at DESC);
      CREATE INDEX idx_videos_status ON videos(status);

      CREATE TABLE transcripts (
        video_id TEXT PRIMARY KEY REFERENCES videos(id) ON DELETE CASCADE,
        language TEXT NOT NULL,
        provider TEXT NOT NULL,
        segments TEXT NOT NULL,
        full_text TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE summaries (
        video_id TEXT PRIMARY KEY REFERENCES videos(id) ON DELETE CASCADE,
        data TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE transcript_chunks (
        id TEXT PRIMARY KEY,
        video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
        start_time REAL NOT NULL,
        end_time REAL NOT NULL,
        text TEXT NOT NULL,
        embedding BLOB
      );
      CREATE INDEX idx_chunks_video ON transcript_chunks(video_id, start_time);

      CREATE VIRTUAL TABLE video_search USING fts5(
        video_id UNINDEXED,
        title,
        transcript,
        summary,
        tokenize = 'porter unicode61'
      );

      CREATE TABLE tags (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        color TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (workspace_id, name)
      );

      CREATE TABLE video_tags (
        video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
        tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        PRIMARY KEY (video_id, tag_id)
      );
      CREATE INDEX idx_video_tags_tag ON video_tags(tag_id);

      CREATE TABLE chat_messages (
        id TEXT PRIMARY KEY,
        video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
        conversation_key TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_chat_conversation ON chat_messages(video_id, conversation_key, created_at);

      CREATE TABLE views (
        id TEXT PRIMARY KEY,
        video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
        viewer_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        session_id TEXT NOT NULL,
        watched_seconds REAL NOT NULL DEFAULT 0,
        max_position REAL NOT NULL DEFAULT 0,
        duration REAL NOT NULL DEFAULT 0,
        buckets TEXT NOT NULL DEFAULT '[]',
        completed INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_views_video ON views(video_id, created_at);
    `,
  },
];
