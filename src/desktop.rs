use crate::{
    Error, Result,
    layout::{
        ActionEvent, LayoutActivityRecord, LayoutEndInput, LayoutStartInput, LayoutUpdateInput,
    },
    models::*,
    validation::Validate,
};
use std::marker::PhantomData;
use tauri::Runtime;

/// This version provides no desktop backend: `get_capabilities` and `check_permissions`
/// answer, the other methods return `UNSUPPORTED_PLATFORM`, and `on_action` drops its handler.
pub struct LiveActivity<R: Runtime>(PhantomData<fn() -> R>);

impl<R: Runtime> Default for LiveActivity<R> {
    fn default() -> Self {
        Self(PhantomData)
    }
}

impl<R: Runtime> LiveActivity<R> {
    pub fn get_capabilities(&self) -> Result<Capabilities> {
        use FeatureSupport::Unsupported;
        Ok(Capabilities {
            platform: std::env::consts::OS.into(),
            backend: Backend::Unsupported,
            start: Unsupported,
            update: Unsupported,
            end: Unsupported,
            progress: Unsupported,
            timer: Unsupported,
            actions: Unsupported,
            state_observation: Unsupported,
            silent_update: Unsupported,
            native_live_activity: Unsupported,
            max_payload_bytes: 0,
            layout: Unsupported,
            push: Unsupported,
        })
    }

    pub fn check_permissions(&self) -> Result<Permissions> {
        use PermissionState::NotApplicable;
        Ok(Permissions {
            notifications: NotApplicable,
            live_activities: NotApplicable,
            promotion: NotApplicable,
            frequent_pushes: NotApplicable,
        })
    }

    pub fn request_permissions(&self, _kind: PermissionKind) -> Result<Permissions> {
        Err(Error::unsupported())
    }

    pub fn start(&self, input: StartInput) -> Result<ActivityRecord> {
        input.validate()?;
        Err(Error::unsupported())
    }

    pub fn update(&self, input: UpdateInput) -> Result<ActivityRecord> {
        input.validate()?;
        Err(Error::unsupported())
    }

    pub fn end(&self, input: EndInput) -> Result<ActivityRecord> {
        input.validate()?;
        Err(Error::unsupported())
    }

    pub fn list(&self) -> Result<Vec<ActivityRecord>> {
        Err(Error::unsupported())
    }

    pub fn start_layout(&self, input: LayoutStartInput) -> Result<LayoutActivityRecord> {
        input.validate()?;
        Err(Error::unsupported())
    }

    pub fn update_layout(&self, input: LayoutUpdateInput) -> Result<LayoutActivityRecord> {
        input.validate()?;
        Err(Error::unsupported())
    }

    pub fn end_layout(&self, input: LayoutEndInput) -> Result<LayoutActivityRecord> {
        input.validate()?;
        Err(Error::unsupported())
    }

    pub fn list_layout(&self) -> Result<Vec<LayoutActivityRecord>> {
        Err(Error::unsupported())
    }

    /// Checks the PNG as on mobile, then returns `UNSUPPORTED_PLATFORM`.
    pub fn write_image(&self, name: &str, png: &[u8]) -> Result<()> {
        crate::image::check_image(name, png)?;
        Err(Error::unsupported())
    }

    /// Desktop shows no activity, so no button is ever tapped and the handler is dropped. On
    /// mobile, register handlers on the built `App` before `App::run` or in the setup of a
    /// plugin, not in `Builder::setup`, which may never run when the system launches the app
    /// for a tap.
    pub fn on_action(&self, _handler: impl Fn(ActionEvent) + Send + Sync + 'static) {}
}
