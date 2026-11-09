//! Android: the templates of contract v1 and the layouts of contract v2 both run on the liveupdate crate, whose
//! Android adapter the plugin's Kotlin side carries; the layouts are projected by `android_layout` and kept by
//! `android_layouts`. Permissions and the image folder come from the plugin's Kotlin side. Taps arrive through
//! liveupdate's events, which a thread of the plugin drains whenever the Kotlin side reports a stored one.

use crate::{
    Config, Error, Result,
    actions::{self, ACTION_EVENT, Actions},
    android_layouts::{FileStore, Layouts, Settings},
    android_liveupdate,
    image::{self, ImageFolder},
    layout::{
        ActionEvent, LayoutActivityRecord, LayoutEndInput, LayoutStartInput, LayoutUpdateInput,
    },
    models::*,
    validation::Validate,
};
use serde::{Serialize, de::DeserializeOwned};
use std::{
    path::PathBuf,
    sync::{Arc, Weak, mpsc},
    thread,
};
use tauri::{
    AppHandle, Emitter, Runtime,
    ipc::Channel,
    plugin::{PluginApi, PluginHandle},
};

/// The store of the layouts, under the app's files.
const LAYOUT_STORE: &str = "tauri-live-activity/layouts.json";

type Driver<R> = liveupdate::JsonDriver<android_liveupdate::TauriBridge<R>>;

pub(crate) fn init<R: Runtime>(
    app: &AppHandle<R>,
    api: PluginApi<R, Option<Config>>,
) -> Result<LiveActivity<R>> {
    let samsung_now_bar = api
        .config()
        .as_ref()
        .and_then(|config| config.android.as_ref())
        .and_then(|android| android.samsung_now_bar)
        .unwrap_or(false);
    let handle = api
        .register_android_plugin("io.github.eedaegon.liveactivity", "LiveActivityPlugin")
        .map_err(|_| Error::native())?;
    let images: ImageFolder = call(&handle, "imageDirectory", serde_json::json!({}))?;
    // The image folder is `<files>/tauri-live-activity/images`.
    let files = images
        .path
        .ancestors()
        .nth(2)
        .map(PathBuf::from)
        .ok_or_else(Error::native)?;
    let app = app.clone();
    let actions = actions::spawn({
        let app = app.clone();
        move |event| {
            let _ = app.emit(ACTION_EVENT, event);
        }
    })?;
    let settings = Settings {
        app_name: app.package_info().name.clone(),
        samsung_now_bar,
        files: Some(files.clone()),
    };
    let inner = Arc::new(Inner {
        updates: android_liveupdate::client(handle.clone()),
        layouts: Layouts::new(
            settings,
            FileStore {
                path: files.join(LAYOUT_STORE),
            },
        ),
        handle,
        actions,
        images: images.path,
    });
    let signal = drain_on_signal(Arc::downgrade(&inner))?;
    // The channel is handed over here, on the thread that registers every native plugin. The Kotlin side sends on
    // it from liveupdate's receivers, on the main thread: it only wakes the draining thread.
    let wake = signal.clone();
    let channel: Channel = Channel::new(move |_| {
        let _ = wake.send(());
        Ok(())
    });
    call::<serde_json::Value>(
        &inner.handle,
        "registerEvents",
        serde_json::json!({ "channel": channel }),
    )?;
    // Taps stored before the app ran, or before the channel, wait in liveupdate's queue.
    let _ = signal.send(());
    Ok(LiveActivity {
        inner,
        _signal: signal,
    })
}

/// A thread that drains liveupdate's events whenever it is woken, and hands the taps to the handlers. It ends at the
/// first wake after the plugin is gone.
fn drain_on_signal<R: Runtime>(inner: Weak<Inner<R>>) -> Result<mpsc::Sender<()>> {
    let (signal, woken) = mpsc::channel::<()>();
    thread::Builder::new()
        .name("live-activity-events".into())
        .spawn(move || {
            while woken.recv().is_ok() {
                // Signals that came meanwhile are served by this one drain.
                while woken.try_recv().is_ok() {}
                let Some(inner) = inner.upgrade() else { break };
                inner.drain();
            }
        })
        .map_err(|_| Error::native())?;
    Ok(signal)
}

fn call<T: DeserializeOwned>(
    handle: &PluginHandle<impl Runtime>,
    command: &str,
    input: impl Serialize,
) -> Result<T> {
    let reply = handle
        .run_mobile_plugin(command, input)
        .map_err(|_| Error::native())?;
    crate::bridge::decode(reply)
}

struct Inner<R: Runtime> {
    /// The one liveupdate client of the process, for templates and layouts.
    updates: android_liveupdate::Client<R>,
    layouts: Layouts<Driver<R>, FileStore>,
    handle: PluginHandle<R>,
    actions: Actions,
    /// The folder of `write_image`.
    images: PathBuf,
}

impl<R: Runtime> Inner<R> {
    fn drain(&self) {
        match self.layouts.taps(&self.updates) {
            Ok(taps) => taps.into_iter().for_each(|tap| self.actions.tap(tap, ())),
            Err(_) => {
                #[cfg(debug_assertions)]
                eprintln!("live-activity: liveupdate's events could not be drained");
            }
        }
    }
}

pub struct LiveActivity<R: Runtime> {
    inner: Arc<Inner<R>>,
    /// Keeps the draining thread waiting; it ends when the plugin does.
    _signal: mpsc::Sender<()>,
}

impl<R: Runtime> LiveActivity<R> {
    pub fn get_capabilities(&self) -> Result<Capabilities> {
        self.inner
            .updates
            .capabilities()
            .map(android_liveupdate::capabilities)
            .map_err(android_liveupdate::error)
    }
    pub fn check_permissions(&self) -> Result<Permissions> {
        call(
            &self.inner.handle,
            "checkPermissions",
            serde_json::json!({}),
        )
    }
    pub fn request_permissions(&self, kind: PermissionKind) -> Result<Permissions> {
        call(
            &self.inner.handle,
            "requestPermissions",
            serde_json::json!({"kind":kind}),
        )
    }
    pub fn start(&self, input: StartInput) -> Result<ActivityRecord> {
        input.validate()?;
        self.inner
            .updates
            .start(android_liveupdate::start_request(input))
            .map_err(android_liveupdate::error)
            .and_then(android_liveupdate::activity_record)
    }
    pub fn update(&self, input: UpdateInput) -> Result<ActivityRecord> {
        input.validate()?;
        self.inner
            .updates
            .update(&input.id, android_liveupdate::live_snapshot(input.snapshot))
            .map_err(android_liveupdate::error)
            .and_then(android_liveupdate::activity_record)
    }
    pub fn end(&self, input: EndInput) -> Result<ActivityRecord> {
        input.validate()?;
        self.inner
            .updates
            .end(&input.id, android_liveupdate::end_policy(input.policy))
            .map_err(android_liveupdate::error)
            .and_then(android_liveupdate::activity_record)
    }
    pub fn list(&self) -> Result<Vec<ActivityRecord>> {
        let records = self
            .inner
            .updates
            .list()
            .map_err(android_liveupdate::error)?;
        android_liveupdate::v1_records(records)
    }
    pub fn start_layout(&self, input: LayoutStartInput) -> Result<LayoutActivityRecord> {
        input.validate()?;
        self.inner.layouts.start(&self.inner.updates, input)
    }
    pub fn update_layout(&self, input: LayoutUpdateInput) -> Result<LayoutActivityRecord> {
        input.validate()?;
        self.inner.layouts.update(&self.inner.updates, input)
    }
    pub fn end_layout(&self, input: LayoutEndInput) -> Result<LayoutActivityRecord> {
        input.validate()?;
        self.inner.layouts.end(&self.inner.updates, input)
    }
    pub fn list_layout(&self) -> Result<Vec<LayoutActivityRecord>> {
        self.inner.layouts.list(&self.inner.updates)
    }

    /// Writes a PNG that `image` nodes with the source `{ "file": name }` show, replacing an
    /// earlier one of that name. See [`check_image`](crate::check_image) for the limits. On Android the file goes to
    /// the app's private files, where the first such image of a layout becomes the notification's large icon when it
    /// is at most 1024 pixels a side and 1 MiB.
    pub fn write_image(&self, name: &str, png: &[u8]) -> Result<()> {
        image::check_image(name, png)?;
        image::write(&self.inner.images, name, png)
    }

    /// Calls `handler` for every tap on a button node, on a thread of the plugin and never
    /// on the main thread, so the handler may call the plugin. Handlers stay for the life
    /// of the plugin. Taps that arrive before the first handler wait for it.
    ///
    /// Register handlers on the built `App`, before `App::run`, or in the setup of a plugin,
    /// and not in `Builder::setup`. On Android liveupdate's receiver stores each tap, also while the app does not
    /// run, and the plugin drains them as they come and when it starts. JavaScript listeners are not awaited.
    pub fn on_action(&self, handler: impl Fn(ActionEvent) + Send + Sync + 'static) {
        self.inner.actions.subscribe(handler);
    }
}
