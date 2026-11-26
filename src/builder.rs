//! The plugin on the platform's backend, on a backend of the app's own, or with layers over either.

use crate::layers::{BackendLayer, Layered};
use crate::{Config, Result, commands};
use liveactivity::LiveActivityBackend;
use std::fmt;
use std::sync::Arc;
use tauri::{
    Manager, Runtime,
    plugin::{Builder as PluginBuilder, TauriPlugin},
};

/// One layer, as what it makes of the backend under it.
type Layer = Box<dyn FnOnce(Arc<dyn LiveActivityBackend>) -> Arc<dyn LiveActivityBackend> + Send>;

/// What the app chose: a backend of its own or none, and the layers in their order. The platform's code makes the
/// backend that takes the commands of it with [`over`](Self::over).
#[derive(Default)]
pub(crate) struct Chosen {
    backend: Option<Arc<dyn LiveActivityBackend>>,
    layers: Vec<Layer>,
}

impl Chosen {
    /// The backend that takes the commands, under the layers: the app's, or else the one that `platform` builds,
    /// which is built only then. So a backend of the app's own runs without the platform's, and on iOS without a
    /// kit of the plugin's, whose settings would refuse a kit that the app built with others.
    pub(crate) fn over<B: LiveActivityBackend>(
        self,
        platform: impl FnOnce() -> Result<B>,
    ) -> Result<Arc<dyn LiveActivityBackend>> {
        let base: Arc<dyn LiveActivityBackend> = match self.backend {
            Some(backend) => backend,
            None => Arc::new(platform()?),
        };
        Ok(self
            .layers
            .into_iter()
            .fold(base, |next, layer| layer(next)))
    }
}

/// Builds the plugin. [`init`](crate::init) is `Builder::new().build()`: the commands go to the platform's backend,
/// ActivityKit on iOS, liveupdate on Android and one that answers `UNSUPPORTED_PLATFORM` on desktop.
/// [`backend`](Self::backend) puts a backend of the app's own in its place, and [`layer`](Self::layer) puts layers
/// over whichever it is. The plugin keeps its Tauri side around them: the commands, the events, the
/// `live-activity:` permissions and the configuration.
///
/// ```
/// use std::sync::Arc;
/// use std::sync::atomic::{AtomicUsize, Ordering};
/// use tauri_plugin_live_activity::{
///     BackendFuture, BackendLayer, Builder, Config, LayoutActivityRecord, LayoutStartInput,
///     LiveActivityBackend,
/// };
///
/// /// Counts the layout activities that start; every other call goes on unchanged.
/// #[derive(Default)]
/// struct Starts(AtomicUsize);
///
/// impl BackendLayer for Starts {
///     fn start_layout<'a>(
///         &'a self,
///         input: LayoutStartInput,
///         next: &'a dyn LiveActivityBackend,
///     ) -> BackendFuture<'a, LayoutActivityRecord> {
///         self.0.fetch_add(1, Ordering::Relaxed);
///         next.start_layout(input)
///     }
/// }
///
/// /// The plugin, for `tauri::Builder::plugin` in place of `tauri_plugin_live_activity::init()`, and the count,
/// /// which the app reads with `starts.0.load(Ordering::Relaxed)`.
/// fn plugin<R: tauri::Runtime>() -> (tauri::plugin::TauriPlugin<R, Option<Config>>, Arc<Starts>) {
///     let starts = Arc::new(Starts::default());
///     (Builder::new().layer(starts.clone()).build(), starts)
/// }
/// ```
#[derive(Default)]
#[must_use = "a Builder registers nothing until `build` and `tauri::Builder::plugin`"]
pub struct Builder {
    chosen: Chosen,
}

impl fmt::Debug for Builder {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Builder")
            .field("backend_of_the_app", &self.chosen.backend.is_some())
            .field("layers", &self.chosen.layers.len())
            .finish()
    }
}

impl Builder {
    /// The platform's backend, with no layer.
    pub fn new() -> Self {
        Self::default()
    }

    /// Sends the commands to `backend` in place of the platform's backend: it answers each of them, the permissions
    /// among them, and the events that it sends through the context that `attach` gives it, its taps among them,
    /// reach the app, and so does its answer to `open_promotion_settings`, which the trait defaults to
    /// `UNSUPPORTED_FEATURE`. The platform's backend is then not built, but on Android, where it still opens the
    /// setting for exact alarms; on iOS the configuration's `receipts` and `pushToStart` set no kit, and are `backend`'s to keep.
    /// A later call replaces an earlier one, and the layers go over it, wherever this call stands among theirs.
    pub fn backend(mut self, backend: impl LiveActivityBackend) -> Self {
        let backend: Arc<dyn LiveActivityBackend> = Arc::new(backend);
        self.chosen.backend = Some(backend);
        self
    }

    /// Puts `layer` over the backend and the layers before it: a later layer gets each call first. An `Arc` of a
    /// layer is a layer too, for one that the app keeps a handle to.
    pub fn layer(mut self, layer: impl BackendLayer) -> Self {
        self.chosen.layers.push(Box::new(
            move |next: Arc<dyn LiveActivityBackend>| -> Arc<dyn LiveActivityBackend> {
                Arc::new(Layered::new(layer, next))
            },
        ));
        self
    }

    /// The plugin, for `tauri::Builder::plugin`. `plugins.live-activity` in the Tauri configuration is optional;
    /// see [`Config`].
    #[must_use]
    pub fn build<R: Runtime>(self) -> TauriPlugin<R, Option<Config>> {
        let chosen = self.chosen();
        PluginBuilder::<R, Option<Config>>::new("live-activity")
            .invoke_handler(tauri::generate_handler![
                commands::get_capabilities,
                commands::check_permissions,
                commands::request_permissions,
                commands::open_exact_alarm_settings,
                commands::open_promotion_settings,
                commands::start,
                commands::update,
                commands::end,
                commands::list,
                commands::start_layout,
                commands::update_layout,
                commands::end_layout,
                commands::list_layout,
                commands::write_image,
                commands::push_tokens,
                commands::openings
            ])
            .setup(move |app, _api| {
                #[cfg(target_os = "android")]
                let plugin = crate::android::init(app, _api, chosen)?;
                #[cfg(target_os = "ios")]
                let plugin = crate::ios::init(app, _api, chosen)?;
                #[cfg(desktop)]
                let plugin = crate::service::connect(
                    app,
                    chosen.over(|| Ok(liveactivity::UnsupportedBackend))?,
                    crate::exact_alarms::NoSetting(crate::Error::unsupported),
                )?;
                app.manage(plugin);
                Ok(())
            })
            .build()
    }

    /// What the app chose, for the platform's code.
    pub(crate) fn chosen(self) -> Chosen {
        self.chosen
    }
}
