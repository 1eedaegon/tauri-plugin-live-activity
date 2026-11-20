//! Android: the app's activities for a service of its own that runs without Tauri, as a recorder's service that a
//! notification's action started (liveupdate 0.8's targets) while no web view runs. The service's JNI entry builds a
//! client from the raw pointers it has, on the same store as the plugin: it starts, updates and ends the activities
//! that the plugin lists, with the plugin's names for the files. The client drains no events: the plugin does, once
//! Tauri runs, and hands them to `onAction`, `onHandled` and the rest.

use crate::{Result, files::FilesDirectory};
use liveactivity::android::LiveUpdateBackend;
use std::{ffi::c_void, path::PathBuf};

/// liveactivity's client, whose calls are those of the plugin's commands; [`block_on`] waits for one.
pub use liveactivity::{LiveActivity as Client, block_on};

/// The client of the app's activities, built from the process's `JavaVM` and a `Context` of the app, for a service
/// that runs its own Rust without Tauri. `files_dir` is `context.getFilesDir()`, `app_name` the app's name as Tauri
/// has it (`productName`, `app.package_info().name`) and `samsung_now_bar` the plugin's `android.samsungNowBar`, so
/// that the service writes what the plugin reads.
///
/// While Tauri runs in the same process, its commands are the way: two clients of one store do not see each
/// other's writes at once.
///
/// # Safety
///
/// `vm` must be the process's `JavaVM` and `context` an Android `Context`, both valid on the calling thread for the
/// call, as liveupdate's `AndroidBridge::from_raw` requires.
///
/// # Errors
///
/// `NATIVE_ERROR` when a pointer is null or the plugin's Android library is not in the app.
pub unsafe fn client_from_raw(
    vm: *mut c_void,
    context: *mut c_void,
    files_dir: impl Into<PathBuf>,
    app_name: impl Into<String>,
    samsung_now_bar: bool,
) -> Result<Client> {
    let files = FilesDirectory::new(files_dir.into()).for_app(app_name.into(), samsung_now_bar);
    // SAFETY: the caller keeps liveupdate's contract for the two pointers, which this passes on unchanged.
    let backend = unsafe { LiveUpdateBackend::android_from_raw(vm, context) }?.with_files(files);
    Client::builder().backend(backend).build()
}
