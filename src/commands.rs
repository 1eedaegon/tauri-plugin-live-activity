use crate::{
    Error, LiveActivityExt, Result,
    image::ImageInput,
    layout::{self, LayoutActivityRecord},
    models::*,
    validation,
};
use serde_json::Value;
use tauri::{AppHandle, Runtime};

/// The backend's answer to a command. On iOS the command awaits activitykit itself, without blocking a thread;
/// Android and desktop answer from the blocking methods of [`crate::LiveActivity`].
macro_rules! backend {
    ($app:expr, $sync:ident, $ios:ident($($input:expr),*)) => {{
        #[cfg(target_os = "ios")]
        let answer = $app.live_activity().apple.$ios($($input),*).await;
        #[cfg(not(target_os = "ios"))]
        let answer = $app.live_activity().$sync($($input),*);
        answer
    }};
}

#[tauri::command]
pub(crate) async fn get_capabilities<R: Runtime>(app: AppHandle<R>) -> Result<Capabilities> {
    app.live_activity().get_capabilities()
}

#[tauri::command]
pub(crate) async fn check_permissions<R: Runtime>(app: AppHandle<R>) -> Result<Permissions> {
    app.live_activity().check_permissions()
}

#[tauri::command]
pub(crate) async fn push_tokens<R: Runtime>(app: AppHandle<R>) -> Result<crate::PushTokens> {
    app.live_activity().push_tokens()
}

#[tauri::command]
pub(crate) async fn request_permissions<R: Runtime>(
    app: AppHandle<R>,
    kind: Value,
) -> Result<Permissions> {
    let kind = serde_json::from_value(kind).map_err(|_| Error::invalid())?;
    app.live_activity().request_permissions(kind)
}

#[tauri::command]
pub(crate) async fn start<R: Runtime>(app: AppHandle<R>, input: Value) -> Result<ActivityRecord> {
    let input: StartInput = validation::parse(input)?;
    backend!(app, start, start_template(input))
}

#[tauri::command]
pub(crate) async fn update<R: Runtime>(app: AppHandle<R>, input: Value) -> Result<ActivityRecord> {
    let input: UpdateInput = validation::parse(input)?;
    backend!(app, update, update_template(input))
}

#[tauri::command]
pub(crate) async fn end<R: Runtime>(app: AppHandle<R>, input: Value) -> Result<ActivityRecord> {
    let input: EndInput = validation::parse(input)?;
    backend!(app, end, end_template(input))
}

#[tauri::command]
pub(crate) async fn list<R: Runtime>(app: AppHandle<R>) -> Result<Vec<ActivityRecord>> {
    backend!(app, list, list_templates())
}

#[tauri::command]
pub(crate) async fn start_layout<R: Runtime>(
    app: AppHandle<R>,
    input: Value,
) -> Result<LayoutActivityRecord> {
    let input: layout::LayoutStartInput = layout::parse("start_layout", input)?;
    backend!(app, start_layout, start_layout(input))
}

#[tauri::command]
pub(crate) async fn update_layout<R: Runtime>(
    app: AppHandle<R>,
    input: Value,
) -> Result<LayoutActivityRecord> {
    let input: layout::LayoutUpdateInput = layout::parse("update_layout", input)?;
    backend!(app, update_layout, update_layout(input))
}

#[tauri::command]
pub(crate) async fn end_layout<R: Runtime>(
    app: AppHandle<R>,
    input: Value,
) -> Result<LayoutActivityRecord> {
    let input: layout::LayoutEndInput = layout::parse("end_layout", input)?;
    backend!(app, end_layout, end_layout(input))
}

#[tauri::command]
pub(crate) async fn write_image<R: Runtime>(app: AppHandle<R>, input: Value) -> Result<()> {
    let input: ImageInput = validation::parse(input)?;
    app.live_activity().write_image(&input.name, &input.png)
}

#[tauri::command]
pub(crate) async fn list_layout<R: Runtime>(
    app: AppHandle<R>,
) -> Result<Vec<LayoutActivityRecord>> {
    backend!(app, list_layout, list_layout())
}
