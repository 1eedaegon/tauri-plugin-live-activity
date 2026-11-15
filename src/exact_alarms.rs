//! The system's setting for exact alarms, which a scheduled start on Android needs to begin at its time. Only
//! Android has one, and only the plugin's own side there can open it: the backend of the liveactivity crate has
//! no call for it.

use liveactivity::BackendFuture;
use std::sync::Arc;

/// The side of a platform that opens the setting.
pub(crate) trait ExactAlarms: Send + Sync + 'static {
    /// Opens the setting where the person allows the app exact alarms and answers when they are back, or at once
    /// where there is nothing to allow.
    fn open_settings(&self) -> BackendFuture<'_, ()>;
}

impl<T: ExactAlarms + ?Sized> ExactAlarms for Arc<T> {
    fn open_settings(&self) -> BackendFuture<'_, ()> {
        (**self).open_settings()
    }
}

/// A platform without the setting, which is every one but Android: a request for it answers the error that the
/// function makes.
#[cfg(not(target_os = "android"))]
pub(crate) struct NoSetting(pub(crate) fn() -> crate::Error);

#[cfg(not(target_os = "android"))]
impl ExactAlarms for NoSetting {
    fn open_settings(&self) -> BackendFuture<'_, ()> {
        Box::pin(std::future::ready(Err((self.0)())))
    }
}
