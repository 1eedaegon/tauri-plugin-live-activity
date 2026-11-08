use crate::{
    Error, Result,
    actions::{self, ACTION_EVENT, Actions},
    image::{self, ImageFolder},
    layout::{
        ActionEvent, LayoutActivityRecord, LayoutEndInput, LayoutStartInput, LayoutUpdateInput,
    },
    models::*,
    validation::Validate,
};
use serde::{Serialize, de::DeserializeOwned};
use std::{path::PathBuf, sync::OnceLock};
use tauri::{
    AppHandle, Emitter, Runtime,
    ipc::Channel,
    plugin::{PluginApi, PluginHandle},
};

pub(crate) fn init<R: Runtime, C: DeserializeOwned>(
    app: &AppHandle<R>,
    api: PluginApi<R, C>,
) -> Result<LiveActivity<R>> {
    let handle = api
        .register_android_plugin("io.github.eedaegon.liveactivity", "LiveActivityPlugin")
        .map_err(|_| Error::native())?;

    let app = app.clone();
    // The channel is handed over here, on the thread that registers every native plugin, while
    // the plugins after this one are still being registered. The native command resolves without
    // the main thread.
    let register = |channel: Channel| {
        let input = serde_json::json!({ "channel": channel });
        handle
            .run_mobile_plugin::<serde_json::Value>("registerActions", input)
            .ok()
            .is_some_and(|reply| crate::bridge::decode::<serde_json::Value>(reply).is_ok())
    };
    let actions = actions::start(register, move |event| {
        let _ = app.emit(ACTION_EVENT, event);
    })?;
    Ok(LiveActivity {
        handle,
        actions,
        images: OnceLock::new(),
    })
}

pub struct LiveActivity<R: Runtime> {
    handle: PluginHandle<R>,
    actions: Actions,
    /// The folder of `write_image`, once the native layer has named it.
    images: OnceLock<PathBuf>,
}

impl<R: Runtime> LiveActivity<R> {
    fn call<T: DeserializeOwned>(&self, command: &str, input: impl Serialize) -> Result<T> {
        let reply = self
            .handle
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
    pub fn start_layout(&self, input: LayoutStartInput) -> Result<LayoutActivityRecord> {
        input.validate()?;
        self.call("startLayout", input)
    }
    pub fn update_layout(&self, input: LayoutUpdateInput) -> Result<LayoutActivityRecord> {
        input.validate()?;
        self.call("updateLayout", input)
    }
    pub fn end_layout(&self, input: LayoutEndInput) -> Result<LayoutActivityRecord> {
        input.validate()?;
        self.call("endLayout", input)
    }
    pub fn list_layout(&self) -> Result<Vec<LayoutActivityRecord>> {
        self.call("listLayout", serde_json::json!({}))
    }

    /// Writes a PNG that `image` nodes with the source `{ "file": name }` show, replacing an
    /// earlier one of that name. The widget reads the file when it draws, which it does on start
    /// and on every update: write the new picture first, then send the update. See
    /// [`check_image`](crate::check_image) for the limits. On Android the file goes to the app's
    /// private files, where the first such image of a layout becomes the notification's large icon.
    pub fn write_image(&self, name: &str, png: &[u8]) -> Result<()> {
        image::check_image(name, png)?;
        image::write(&self.image_folder()?, name, png)
    }

    fn image_folder(&self) -> Result<PathBuf> {
        if let Some(folder) = self.images.get() {
            return Ok(folder.clone());
        }
        let folder: ImageFolder = self.call("imageDirectory", serde_json::json!({}))?;
        Ok(self.images.get_or_init(|| folder.path).clone())
    }

    /// Calls `handler` for every tap on a button node, on a thread of the plugin and never
    /// on the main thread, so the handler may call the plugin. Handlers stay for the life
    /// of the plugin. Taps that arrive before the first handler wait for it.
    ///
    /// Register handlers on the built `App`, before `App::run`, or in the setup of a plugin,
    /// and not in `Builder::setup`: when the system launches the app in the background for a
    /// tap, `Builder::setup` may never run. On iOS the tap's intent waits, for up to 4 seconds,
    /// until the handlers registered at the time of the tap have run, which keeps such an app
    /// running meanwhile.
    pub fn on_action(&self, handler: impl Fn(ActionEvent) + Send + Sync + 'static) {
        self.actions.subscribe(handler);
    }
}
