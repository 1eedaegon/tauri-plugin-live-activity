use crate::{Error, Result, models::*, validation::Validate};
use serde::{Serialize, de::DeserializeOwned};
use tauri::{
    AppHandle, Runtime,
    plugin::{PluginApi, PluginHandle},
};

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_live_activity);

pub(crate) fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    api: PluginApi<R, C>,
) -> Result<LiveActivity<R>> {
    #[cfg(target_os = "android")]
    let handle =
        api.register_android_plugin("io.github.eedaegon.liveactivity", "LiveActivityPlugin");
    #[cfg(target_os = "ios")]
    let handle = api.register_ios_plugin(init_plugin_live_activity);
    handle.map(LiveActivity).map_err(|_| Error::native())
}

pub struct LiveActivity<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> LiveActivity<R> {
    fn call<T: DeserializeOwned>(&self, command: &str, input: impl Serialize) -> Result<T> {
        let reply = self
            .0
            .run_mobile_plugin(command, input)
            .map_err(|_| Error::native())?;
        crate::bridge::decode(reply)
    }

    pub fn get_capabilities(&self) -> Result<Capabilities> {
        self.call("getCapabilities", serde_json::json!({}))
    }
    pub fn check_permissions(&self) -> Result<Permissions> {
        self.call("checkPermissions", serde_json::json!({}))
    }
    pub fn request_permissions(&self, kind: PermissionKind) -> Result<Permissions> {
        self.call("requestPermissions", serde_json::json!({"kind":kind}))
    }
    pub fn start(&self, input: StartInput) -> Result<ActivityRecord> {
        input.validate()?;
        self.call("start", input)
    }
    pub fn update(&self, input: UpdateInput) -> Result<ActivityRecord> {
        input.validate()?;
        self.call("update", input)
    }
    pub fn end(&self, input: EndInput) -> Result<ActivityRecord> {
        input.validate()?;
        self.call("end", input)
    }
    pub fn list(&self) -> Result<Vec<ActivityRecord>> {
        self.call("list", serde_json::json!({}))
    }
}
