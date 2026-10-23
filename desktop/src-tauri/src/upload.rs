//! Direct multipart upload to the Spool API.
//!
//! Parts are cut at the server's part size (at least 5 MiB). Earlier parts are
//! full; the final part may be shorter. Three parts are in flight at once.

use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug)]
pub struct ApiAuth {
    pub base: String,
    pub token: String,
    pub workspace_id: Option<String>,
}

impl ApiAuth {
    pub fn new(base: &str, token: &str, workspace_id: Option<String>) -> Result<Self, String> {
        let base = base.trim().trim_end_matches('/').to_string();
        if !(base.starts_with("http://") || base.starts_with("https://")) {
            return Err("The API URL must start with http:// or https://.".into());
        }
        if token.trim().is_empty() {
            return Err("Sign in before recording.".into());
        }
        Ok(Self {
            base,
            token: token.trim().to_string(),
            workspace_id: workspace_id.filter(|id| !id.is_empty()),
        })
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct ClickEvent {
    pub t: f64,
    pub x: f64,
    pub y: f64,
}

#[derive(Clone, Debug)]
pub struct PreparedUpload {
    pub video_id: String,
    pub share_id: String,
    pub part_size: usize,
    pub web_url: String,
    pub max_seconds: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CompletedPart {
    part_number: u32,
    etag: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HealthBody {
    max_recording_seconds: u64,
    web_url: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateBody {
    video_id: String,
    share_id: String,
    part_size: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PresignBody {
    urls: Vec<PresignUrl>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PresignUrl {
    url: String,
}

pub async fn prepare(client: &reqwest::Client, auth: &ApiAuth, title: Option<String>) -> Result<PreparedUpload, String> {
    let health: HealthBody = send(client, client.get(format!("{}/api/health", auth.base)), None).await?;
    let created: CreateBody = send(
        client,
        client.post(format!("{}/api/uploads", auth.base)).json(&serde_json::json!({
            "mimeType": "video/mp2t",
            "source": "desktop",
            "title": title.filter(|value| !value.trim().is_empty()).unwrap_or_else(|| "Desktop recording".into()),
        })),
        Some(auth),
    )
    .await?;
    if created.video_id.is_empty() || created.share_id.is_empty() {
        return Err("The API returned an incomplete upload.".into());
    }
    Ok(PreparedUpload {
        video_id: created.video_id,
        share_id: created.share_id,
        part_size: (created.part_size as usize).max(5 * 1024 * 1024),
        web_url: health.web_url.trim_end_matches('/').to_string(),
        max_seconds: health.max_recording_seconds.max(30),
    })
}

pub async fn abort_upload(client: &reqwest::Client, auth: &ApiAuth, video_id: &str) -> Result<(), String> {
    let response = authorized(client.delete(format!("{}/api/uploads/{video_id}", auth.base)), auth)
        .send()
        .await
        .map_err(|e| format!("Could not cancel the upload: {e}"))?;
    if response.status().is_success() || response.status().as_u16() == 404 {
        return Ok(());
    }
    Err(error_text(response).await)
}

pub struct PartUploader {
    client: reqwest::Client,
    auth: ApiAuth,
    video_id: String,
    part_size: usize,
    buffer: Vec<u8>,
    next: u32,
    inflight: Vec<tokio::task::JoinHandle<Result<CompletedPart, String>>>,
    done: Vec<CompletedPart>,
    abort: Arc<AtomicBool>,
    uploaded: Arc<AtomicU64>,
}

impl PartUploader {
    pub fn new(client: reqwest::Client, auth: ApiAuth, video_id: String, part_size: usize, abort: Arc<AtomicBool>, uploaded: Arc<AtomicU64>) -> Self {
        Self {
            client,
            auth,
            video_id,
            part_size: part_size.max(5 * 1024 * 1024),
            buffer: Vec::new(),
            next: 1,
            inflight: Vec::new(),
            done: Vec::new(),
            abort,
            uploaded,
        }
    }

    pub async fn push(&mut self, bytes: &[u8]) -> Result<(), String> {
        if bytes.is_empty() || self.abort.load(Ordering::Relaxed) {
            return Ok(());
        }
        self.buffer.extend_from_slice(bytes);
        self.drain_full().await
    }

    pub async fn finish(mut self, duration: f64, clicks: Vec<ClickEvent>) -> Result<(), String> {
        if self.abort.load(Ordering::Relaxed) {
            return Err("Upload cancelled.".into());
        }
        if !self.buffer.is_empty() {
            let part = std::mem::take(&mut self.buffer);
            self.spawn(part).await?;
        }
        self.wait_all().await?;
        if self.done.is_empty() {
            return Err("The recording was empty.".into());
        }
        if self.abort.load(Ordering::Relaxed) {
            return Err("Upload cancelled.".into());
        }
        self.done.sort_by_key(|part| part.part_number);
        let _: serde_json::Value = send(
            &self.client,
            self.client
                .post(format!("{}/api/uploads/{}/complete", self.auth.base, self.video_id))
                .json(&serde_json::json!({
                    "parts": self.done,
                    "durationHint": duration.max(0.0),
                    "clickEvents": clicks,
                })),
            Some(&self.auth),
        )
        .await?;
        Ok(())
    }

    async fn drain_full(&mut self) -> Result<(), String> {
        while self.buffer.len() >= self.part_size {
            let part = self.buffer.drain(..self.part_size).collect::<Vec<_>>();
            self.spawn(part).await?;
        }
        Ok(())
    }

    async fn spawn(&mut self, bytes: Vec<u8>) -> Result<(), String> {
        self.reap().await?;
        while self.inflight.len() >= 3 {
            self.wait_one().await?;
        }
        let part_number = self.next;
        self.next = self.next.saturating_add(1);
        let client = self.client.clone();
        let auth = self.auth.clone();
        let video_id = self.video_id.clone();
        let abort = self.abort.clone();
        let uploaded = self.uploaded.clone();
        self.inflight.push(tokio::spawn(async move {
            let part = upload_part(&client, &auth, &video_id, part_number, bytes, &abort).await?;
            uploaded.fetch_add(part.1, Ordering::Relaxed);
            Ok(part.0)
        }));
        Ok(())
    }

    async fn reap(&mut self) -> Result<(), String> {
        let mut index = 0;
        while index < self.inflight.len() {
            if self.inflight[index].is_finished() {
                let handle = self.inflight.remove(index);
                self.done.push(flatten(handle).await?);
            } else {
                index += 1;
            }
        }
        Ok(())
    }

    async fn wait_one(&mut self) -> Result<(), String> {
        if self.inflight.is_empty() {
            return Ok(());
        }
        let handle = self.inflight.remove(0);
        self.done.push(flatten(handle).await?);
        Ok(())
    }

    async fn wait_all(&mut self) -> Result<(), String> {
        while !self.inflight.is_empty() {
            self.wait_one().await?;
        }
        Ok(())
    }
}

async fn flatten(handle: tokio::task::JoinHandle<Result<CompletedPart, String>>) -> Result<CompletedPart, String> {
    match handle.await {
        Ok(result) => result,
        Err(error) => Err(format!("Upload task stopped: {error}")),
    }
}

async fn upload_part(
    client: &reqwest::Client,
    auth: &ApiAuth,
    video_id: &str,
    part_number: u32,
    bytes: Vec<u8>,
    abort: &AtomicBool,
) -> Result<(CompletedPart, u64), String> {
    let len = bytes.len() as u64;
    let mut last = String::from("Part upload failed.");
    for attempt in 1..=4 {
        if abort.load(Ordering::Relaxed) {
            return Err("Upload cancelled.".into());
        }
        match upload_part_once(client, auth, video_id, part_number, bytes.clone()).await {
            Ok(etag) => {
                return Ok((
                    CompletedPart { part_number, etag },
                    len,
                ));
            }
            Err(error) => {
                last = error;
                if attempt < 4 {
                    tokio::time::sleep(std::time::Duration::from_millis(200 * attempt)).await;
                }
            }
        }
    }
    Err(last)
}

async fn upload_part_once(client: &reqwest::Client, auth: &ApiAuth, video_id: &str, part_number: u32, bytes: Vec<u8>) -> Result<String, String> {
    let presign: PresignBody = send(
        client,
        client
            .post(format!("{}/api/uploads/{video_id}/parts", auth.base))
            .json(&serde_json::json!({ "partNumbers": [part_number] })),
        Some(auth),
    )
    .await?;
    let url = presign
        .urls
        .into_iter()
        .next()
        .ok_or_else(|| format!("The API did not return an upload URL for part {part_number}."))?
        .url;
    let response = client
        .put(url)
        .body(bytes)
        .send()
        .await
        .map_err(|e| format!("Part {part_number} failed: {e}"))?;
    if !response.status().is_success() {
        return Err(error_text(response).await);
    }
    let etag = response
        .headers()
        .get("etag")
        .and_then(|value| value.to_str().ok())
        .map(|value| value.trim_matches('"').to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Storage did not return an ETag. Add \"ETag\" to the bucket CORS ExposeHeaders.".to_string())?;
    Ok(etag)
}

pub fn segment_files(dir: &Path) -> Vec<std::path::PathBuf> {
    let Ok(entries) = std::fs::read_dir(dir) else { return Vec::new() };
    let mut files: Vec<_> = entries
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| path.extension().and_then(|ext| ext.to_str()) == Some("ts"))
        .collect();
    files.sort();
    files
}

pub fn dir_has_video(dir: &Path) -> bool {
    segment_files(dir).iter().any(|path| std::fs::metadata(path).map(|meta| meta.len() > 0).unwrap_or(false))
}

pub async fn upload_directory(
    client: &reqwest::Client,
    auth: &ApiAuth,
    prepared: &PreparedUpload,
    dir: &Path,
    duration: f64,
    clicks: Vec<ClickEvent>,
    abort: Arc<AtomicBool>,
    uploaded: Arc<AtomicU64>,
) -> Result<(), String> {
    let mut uploader = PartUploader::new(client.clone(), auth.clone(), prepared.video_id.clone(), prepared.part_size, abort, uploaded);
    for path in segment_files(dir) {
        let bytes = tokio::fs::read(&path).await.map_err(|e| format!("Could not read {}: {e}", path.display()))?;
        uploader.push(&bytes).await?;
    }
    uploader.finish(duration, clicks).await
}

fn authorized(builder: reqwest::RequestBuilder, auth: &ApiAuth) -> reqwest::RequestBuilder {
    let builder = builder.bearer_auth(&auth.token);
    if let Some(workspace) = &auth.workspace_id {
        builder.header("X-Workspace-Id", workspace)
    } else {
        builder
    }
}

async fn send<T: for<'de> Deserialize<'de>>(client: &reqwest::Client, builder: reqwest::RequestBuilder, auth: Option<&ApiAuth>) -> Result<T, String> {
    let _ = client;
    let builder = match auth {
        Some(auth) => authorized(builder, auth),
        None => builder,
    };
    let response = builder.send().await.map_err(|e| format!("Could not reach the Spool API: {e}"))?;
    if !response.status().is_success() {
        return Err(error_text(response).await);
    }
    if response.status() == reqwest::StatusCode::NO_CONTENT {
        return serde_json::from_str("null").map_err(|e| e.to_string());
    }
    response.json::<T>().await.map_err(|e| format!("The API returned an unexpected response: {e}"))
}

async fn error_text(response: reqwest::Response) -> String {
    let status = response.status();
    let text = response.text().await.unwrap_or_default();
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) {
        if let Some(message) = value.get("error").and_then(|item| item.as_str()) {
            return format!("{message} ({status})");
        }
    }
    if text.is_empty() {
        format!("The API returned HTTP {status}.")
    } else {
        format!("The API returned HTTP {status}: {text}")
    }
}

/// Pull full parts out of a byte buffer. The tail stays in `buffer`.
pub fn drain_full_parts(buffer: &mut Vec<u8>, part_size: usize) -> Vec<Vec<u8>> {
    let mut parts = Vec::new();
    if part_size == 0 {
        return parts;
    }
    while buffer.len() >= part_size {
        parts.push(buffer.drain(..part_size).collect());
    }
    parts
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parts_split_on_the_size_boundary() {
        let mut buffer = vec![1u8, 2, 3, 4, 5, 6, 7, 8, 9, 10];
        let parts = drain_full_parts(&mut buffer, 4);
        assert_eq!(parts.len(), 2);
        assert_eq!(parts[0], vec![1, 2, 3, 4]);
        assert_eq!(parts[1], vec![5, 6, 7, 8]);
        assert_eq!(buffer, vec![9, 10]);
    }

    #[test]
    fn auth_rejects_a_bare_host() {
        let error = ApiAuth::new("localhost:4000", "token", None).unwrap_err();
        assert!(error.contains("http"));
    }
}
