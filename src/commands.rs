use crate::{
    Error, LiveActivityExt, Result,
    layout::{self, LayoutActivityRecord},
    models::*,
    validation,
};
use serde_json::Value;
use tauri::{AppHandle, Runtime};

#[tauri::command]
pub(crate) async fn get_capabilities<R: Runtime>(app: AppHandle<R>) -> Result<Capabilities> {
    app.live_activity().get_capabilities()
}

#[tauri::command]
pub(crate) async fn check_permissions<R: Runtime>(app: AppHandle<R>) -> Result<Permissions> {
    app.live_activity().check_permissions()
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
    app.live_activity().start(validation::parse(input)?)
}

#[tauri::command]
pub(crate) async fn update<R: Runtime>(app: AppHandle<R>, input: Value) -> Result<ActivityRecord> {
    app.live_activity().update(validation::parse(input)?)
}

#[tauri::command]
pub(crate) async fn end<R: Runtime>(app: AppHandle<R>, input: Value) -> Result<ActivityRecord> {
    app.live_activity().end(validation::parse(input)?)
}

#[tauri::command]
pub(crate) async fn list<R: Runtime>(app: AppHandle<R>) -> Result<Vec<ActivityRecord>> {
    app.live_activity().list()
}

#[tauri::command]
pub(crate) async fn start_layout<R: Runtime>(
    app: AppHandle<R>,
    input: Value,
) -> Result<LayoutActivityRecord> {
    app.live_activity().start_layout(layout::parse(input)?)
}

#[tauri::command]
pub(crate) async fn update_layout<R: Runtime>(
    app: AppHandle<R>,
    input: Value,
) -> Result<LayoutActivityRecord> {
    app.live_activity().update_layout(layout::parse(input)?)
}

#[tauri::command]
pub(crate) async fn end_layout<R: Runtime>(
    app: AppHandle<R>,
    input: Value,
) -> Result<LayoutActivityRecord> {
    app.live_activity().end_layout(layout::parse(input)?)
}

#[tauri::command]
pub(crate) async fn list_layout<R: Runtime>(
    app: AppHandle<R>,
) -> Result<Vec<LayoutActivityRecord>> {
    app.live_activity().list_layout()
}
