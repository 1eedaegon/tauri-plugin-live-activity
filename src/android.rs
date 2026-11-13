//! Android: the default backend of the `liveactivity` crate over the plugin's Kotlin side, which carries
//! liveupdate's Android adapter. The plugin adds what needs an Activity or Tauri: the permissions and their dialog,
//! the folder of the app's files, and the thread that drains the events ([`crate::drain`]), with the signal that
//! wakes it.

use crate::{
    Config, Error, LiveActivity, PermissionKind, Permissions, Result,
    drain::{self, Wake},
    service,
};
use liveactivity::{
    ActivityRecord, BackendContext, BackendFuture, Capabilities, EndInput, LayoutActivityRecord,
    LayoutEndInput, LayoutStartInput, LayoutUpdateInput, LiveActivityBackend, PushTokens,
    StartInput, UpdateInput,
    android::{AndroidFiles, LiveUpdateBackend},
    liveupdate,
};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use std::{
    path::PathBuf,
    sync::{Arc, mpsc},
};
use tauri::{
    AppHandle, Runtime,
    ipc::Channel,
    plugin::{PluginApi, PluginHandle},
};

/// The folders of the plugin under the app's files, as every version of the plugin has named them.
const LAYOUT_STORE: &str = "tauri-live-activity/layouts.json";
const IMAGE_FOLDER: &str = "tauri-live-activity/images";

/// liveupdate's string transport on Tauri's call to the Kotlin side.
struct TauriBridge<R: Runtime> {
    handle: PluginHandle<R>,
}

impl<R: Runtime> liveupdate::Bridge for TauriBridge<R> {
    fn invoke(&self, command: &str, payload: &str) -> liveupdate::Result<String> {
        let failed = || {
            liveupdate::Error::new(
                liveupdate::ErrorCode::NativeError,
                "The Android live update adapter failed.",
            )
        };
        let reply = self
            .handle
            .run_mobile_plugin(
                "liveUpdate",
                serde_json::json!({ "command": command, "payload": payload }),
            )
            .map_err(|_| failed())?;
        crate::bridge::decode(reply).map_err(|_| failed())
    }
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

/// The answer of the Kotlin side's `imageDirectory`.
#[derive(Deserialize)]
struct ImageFolder {
    path: PathBuf,
}

type Engine<R> = LiveUpdateBackend<liveupdate::JsonDriver<TauriBridge<R>>>;

/// The default backend, with the permissions of the plugin's Kotlin side, which knows whether a dialog was shown
/// and can show one.
struct Android<R: Runtime> {
    engine: Engine<R>,
    handle: PluginHandle<R>,
    /// Wakes the thread that drains the events.
    wake: mpsc::Sender<Wake>,
}

impl<R: Runtime> Android<R> {
    /// After a call that may have changed which state is due next and when, such as a start with a stale time: has
    /// the draining thread look at that time again. The states the call itself made due were reported by it.
    fn called<T>(&self, answer: Result<T>) -> Result<T> {
        let _ = self.wake.send(Wake::Called);
        answer
    }
}

impl<R: Runtime> drain::Source for Android<R> {
    fn drain(&self) -> bool {
        self.engine.pump_events().is_ok()
    }

    fn next_check(&self) -> Option<liveupdate::NextCheck> {
        self.engine.next_check().ok()
    }
}

impl<R: Runtime> LiveActivityBackend for Android<R> {
    fn attach(&self, events: BackendContext) -> Result<()> {
        self.engine.attach(events)
    }

    fn permissions(&self) -> BackendFuture<'_, Permissions> {
        Box::pin(async move { call(&self.handle, "checkPermissions", serde_json::json!({})) })
    }

    fn request_permissions(&self, kind: PermissionKind) -> BackendFuture<'_, Permissions> {
        Box::pin(async move {
            call(
                &self.handle,
                "requestPermissions",
                serde_json::json!({ "kind": kind }),
            )
        })
    }

    fn capabilities(&self) -> BackendFuture<'_, Capabilities> {
        self.engine.capabilities()
    }

    fn start(&self, input: StartInput) -> BackendFuture<'_, ActivityRecord> {
        Box::pin(async move { self.called(self.engine.start(input).await) })
    }

    fn update(&self, input: UpdateInput) -> BackendFuture<'_, ActivityRecord> {
        Box::pin(async move { self.called(self.engine.update(input).await) })
    }

    fn end(&self, input: EndInput) -> BackendFuture<'_, ActivityRecord> {
        Box::pin(async move { self.called(self.engine.end(input).await) })
    }

    fn list(&self) -> BackendFuture<'_, Vec<ActivityRecord>> {
        self.engine.list()
    }

    fn start_layout(&self, input: LayoutStartInput) -> BackendFuture<'_, LayoutActivityRecord> {
        Box::pin(async move { self.called(self.engine.start_layout(input).await) })
    }

    fn update_layout(&self, input: LayoutUpdateInput) -> BackendFuture<'_, LayoutActivityRecord> {
        Box::pin(async move { self.called(self.engine.update_layout(input).await) })
    }

    fn end_layout(&self, input: LayoutEndInput) -> BackendFuture<'_, LayoutActivityRecord> {
        Box::pin(async move { self.called(self.engine.end_layout(input).await) })
    }

    fn list_layout(&self) -> BackendFuture<'_, Vec<LayoutActivityRecord>> {
        self.engine.list_layout()
    }

    fn write_image(&self, name: String, png: Vec<u8>) -> BackendFuture<'_, ()> {
        self.engine.write_image(name, png)
    }

    fn push_tokens(&self) -> BackendFuture<'_, PushTokens> {
        self.engine.push_tokens()
    }

    fn sync_events(&self) -> BackendFuture<'_, ()> {
        self.engine.sync_events()
    }
}

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
    let bridge = TauriBridge {
        handle: handle.clone(),
    };
    let engine = LiveUpdateBackend::over_bridge(bridge).with_files(AndroidFiles {
        layout_store: LAYOUT_STORE.into(),
        image_folder: IMAGE_FOLDER.into(),
        samsung_now_bar,
        ..AndroidFiles::new(app.package_info().name.clone(), files)
    });
    // The thread that drains the events holds the backend weakly, and the backend what wakes the thread: the
    // thread ends at its first wake or wait after the plugin, which holds the backend, is gone.
    let (signal, woken) = mpsc::channel();
    let backend = Arc::new(Android {
        engine,
        handle,
        wake: signal.clone(),
    });
    drain::spawn(Arc::downgrade(&backend), woken).map_err(|_| Error::native())?;
    let plugin = service::connect(app, backend.clone())?;
    // The channel is handed over here, on the thread that registers every native plugin. The Kotlin side sends on
    // it from liveupdate's receivers, on the main thread: it only wakes the draining thread.
    let wake = signal.clone();
    let channel: Channel = Channel::new(move |_| {
        let _ = wake.send(Wake::Stored);
        Ok(())
    });
    call::<serde_json::Value>(
        &backend.handle,
        "registerEvents",
        serde_json::json!({ "channel": channel }),
    )?;
    // Taps stored before the app ran, or before the channel, wait in liveupdate's queue, and so do the states
    // that came meanwhile.
    let _ = signal.send(Wake::Stored);
    Ok(plugin)
}
