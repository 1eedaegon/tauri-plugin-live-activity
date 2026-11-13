use crate::{
    ActivityRecord, Capabilities, Error, ImageInput, LayoutActivityRecord, LiveActivityExt,
    Permissions, PushTokens, Result, parse_request,
};
use serde_json::Value;
use tauri::{AppHandle, Runtime};

/// The service that every command awaits. It is cheap to clone, and the clone outlives the borrow of the app.
fn live<R: Runtime>(app: &AppHandle<R>) -> liveactivity::LiveActivity {
    app.live_activity().live.clone()
}

#[tauri::command]
pub(crate) async fn get_capabilities<R: Runtime>(app: AppHandle<R>) -> Result<Capabilities> {
    live(&app).capabilities().await
}

#[tauri::command]
pub(crate) async fn check_permissions<R: Runtime>(app: AppHandle<R>) -> Result<Permissions> {
    live(&app).permissions().await
}

#[tauri::command]
pub(crate) async fn push_tokens<R: Runtime>(app: AppHandle<R>) -> Result<PushTokens> {
    live(&app).push_tokens().await
}

#[tauri::command]
pub(crate) async fn request_permissions<R: Runtime>(
    app: AppHandle<R>,
    kind: Value,
) -> Result<Permissions> {
    let kind = serde_json::from_value(kind).map_err(|_| Error::invalid())?;
    live(&app).request_permissions(kind).await
}

#[tauri::command]
pub(crate) async fn start<R: Runtime>(app: AppHandle<R>, input: Value) -> Result<ActivityRecord> {
    live(&app).start(parse_request("start", input)?).await
}

#[tauri::command]
pub(crate) async fn update<R: Runtime>(app: AppHandle<R>, input: Value) -> Result<ActivityRecord> {
    live(&app).update(parse_request("update", input)?).await
}

#[tauri::command]
pub(crate) async fn end<R: Runtime>(app: AppHandle<R>, input: Value) -> Result<ActivityRecord> {
    live(&app).end(parse_request("end", input)?).await
}

#[tauri::command]
pub(crate) async fn list<R: Runtime>(app: AppHandle<R>) -> Result<Vec<ActivityRecord>> {
    live(&app).list().await
}

#[tauri::command]
pub(crate) async fn start_layout<R: Runtime>(
    app: AppHandle<R>,
    input: Value,
) -> Result<LayoutActivityRecord> {
    live(&app)
        .start_layout(parse_request("start_layout", input)?)
        .await
}

#[tauri::command]
pub(crate) async fn update_layout<R: Runtime>(
    app: AppHandle<R>,
    input: Value,
) -> Result<LayoutActivityRecord> {
    live(&app)
        .update_layout(parse_request("update_layout", input)?)
        .await
}

#[tauri::command]
pub(crate) async fn end_layout<R: Runtime>(
    app: AppHandle<R>,
    input: Value,
) -> Result<LayoutActivityRecord> {
    live(&app)
        .end_layout(parse_request("end_layout", input)?)
        .await
}

#[tauri::command]
pub(crate) async fn write_image<R: Runtime>(app: AppHandle<R>, input: Value) -> Result<()> {
    let input: ImageInput = serde_json::from_value(input).map_err(|_| Error::invalid())?;
    live(&app).write_image(&input.name, &input.png).await
}

#[tauri::command]
pub(crate) async fn list_layout<R: Runtime>(
    app: AppHandle<R>,
) -> Result<Vec<LayoutActivityRecord>> {
    live(&app).list_layout().await
}
