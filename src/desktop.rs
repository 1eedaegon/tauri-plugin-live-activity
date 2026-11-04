use crate::{Error, Result, models::*, validation::Validate};
use std::marker::PhantomData;
use tauri::Runtime;

/// The first alpha deliberately provides no desktop notification backend.
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
        })
    }

    pub fn check_permissions(&self) -> Result<Permissions> {
        use PermissionState::NotApplicable;
        Ok(Permissions {
            notifications: NotApplicable,
            live_activities: NotApplicable,
            promotion: NotApplicable,
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
}
