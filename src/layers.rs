//! Layers over a backend: what an app puts between the plugin's commands and the backend under them, such as a
//! renderer of what Android leaves out of a layout, a log, or a stand-in for tests. A layer overrides the calls it
//! changes, and every other call goes to the backend under it unchanged: leaving a method out never turns a feature
//! off, as it would in a backend of its own, where the defaults of `LiveActivityBackend` answer that the backend draws
//! no layouts or stores no images.

use liveactivity::{
    ActivityRecord, BackendContext, BackendFuture, Capabilities, EndInput, LayoutActivityRecord,
    LayoutEndInput, LayoutStartInput, LayoutUpdateInput, LiveActivityBackend, PermissionKind,
    Permissions, PushTokens, Result, StartInput, UpdateInput,
};
use std::sync::Arc;

/// A layer over the backend under it, for [`Builder::layer`](crate::Builder::layer). Each method gets the call and
/// that backend, `next`, and by default passes the call on unchanged, so a layer overrides only what it changes. One
/// method stands for each of `LiveActivityBackend`'s.
pub trait BackendLayer: Send + Sync + 'static {
    /// Takes where to send the events, the taps among them, before any command. A layer that watches them gives
    /// `next` a context of its own, [`BackendContext::new`] with a sink that hands each [`Event`](crate::Event) on to
    /// `events`.
    fn attach(&self, events: BackendContext, next: &dyn LiveActivityBackend) -> Result<()> {
        next.attach(events)
    }

    /// What the backend can do on this device.
    fn capabilities<'a>(
        &'a self,
        next: &'a dyn LiveActivityBackend,
    ) -> BackendFuture<'a, Capabilities> {
        next.capabilities()
    }

    /// The operating system's permissions.
    fn permissions<'a>(
        &'a self,
        next: &'a dyn LiveActivityBackend,
    ) -> BackendFuture<'a, Permissions> {
        next.permissions()
    }

    /// Starts a progress or timer activity.
    fn start<'a>(
        &'a self,
        input: StartInput,
        next: &'a dyn LiveActivityBackend,
    ) -> BackendFuture<'a, ActivityRecord> {
        next.start(input)
    }

    /// Replaces the content of a progress or timer activity.
    fn update<'a>(
        &'a self,
        input: UpdateInput,
        next: &'a dyn LiveActivityBackend,
    ) -> BackendFuture<'a, ActivityRecord> {
        next.update(input)
    }

    /// Ends a progress or timer activity.
    fn end<'a>(
        &'a self,
        input: EndInput,
        next: &'a dyn LiveActivityBackend,
    ) -> BackendFuture<'a, ActivityRecord> {
        next.end(input)
    }

    /// The progress and timer activities.
    fn list<'a>(
        &'a self,
        next: &'a dyn LiveActivityBackend,
    ) -> BackendFuture<'a, Vec<ActivityRecord>> {
        next.list()
    }

    /// Asks the operating system for a permission.
    fn request_permissions<'a>(
        &'a self,
        kind: PermissionKind,
        next: &'a dyn LiveActivityBackend,
    ) -> BackendFuture<'a, Permissions> {
        next.request_permissions(kind)
    }

    /// Starts a layout activity.
    fn start_layout<'a>(
        &'a self,
        input: LayoutStartInput,
        next: &'a dyn LiveActivityBackend,
    ) -> BackendFuture<'a, LayoutActivityRecord> {
        next.start_layout(input)
    }

    /// Replaces the values of a layout activity.
    fn update_layout<'a>(
        &'a self,
        input: LayoutUpdateInput,
        next: &'a dyn LiveActivityBackend,
    ) -> BackendFuture<'a, LayoutActivityRecord> {
        next.update_layout(input)
    }

    /// Ends a layout activity.
    fn end_layout<'a>(
        &'a self,
        input: LayoutEndInput,
        next: &'a dyn LiveActivityBackend,
    ) -> BackendFuture<'a, LayoutActivityRecord> {
        next.end_layout(input)
    }

    /// The layout activities.
    fn list_layout<'a>(
        &'a self,
        next: &'a dyn LiveActivityBackend,
    ) -> BackendFuture<'a, Vec<LayoutActivityRecord>> {
        next.list_layout()
    }

    /// Stores a checked PNG under `name` for the `image` nodes that name it.
    fn write_image<'a>(
        &'a self,
        name: String,
        png: Vec<u8>,
        next: &'a dyn LiveActivityBackend,
    ) -> BackendFuture<'a, ()> {
        next.write_image(name, png)
    }

    /// The push tokens held since launch.
    fn push_tokens<'a>(
        &'a self,
        next: &'a dyn LiveActivityBackend,
    ) -> BackendFuture<'a, PushTokens> {
        next.push_tokens()
    }

    /// Sends the events that the platform queued to the event sink. The plugin calls it nowhere: on Android its own
    /// thread drains the platform's backend, and a backend of the app's own sends its events through the context
    /// that `attach` gives it.
    fn sync_events<'a>(&'a self, next: &'a dyn LiveActivityBackend) -> BackendFuture<'a, ()> {
        next.sync_events()
    }
}

/// A layer that the app keeps a handle to, such as one whose state it reads, or one it chooses at run time as an
/// `Arc<dyn BackendLayer>`.
impl<T: BackendLayer + ?Sized> BackendLayer for Arc<T> {
    fn attach(&self, events: BackendContext, next: &dyn LiveActivityBackend) -> Result<()> {
        (**self).attach(events, next)
    }

    fn capabilities<'a>(
        &'a self,
        next: &'a dyn LiveActivityBackend,
    ) -> BackendFuture<'a, Capabilities> {
        (**self).capabilities(next)
    }

    fn permissions<'a>(
        &'a self,
        next: &'a dyn LiveActivityBackend,
    ) -> BackendFuture<'a, Permissions> {
        (**self).permissions(next)
    }

    fn start<'a>(
        &'a self,
        input: StartInput,
        next: &'a dyn LiveActivityBackend,
    ) -> BackendFuture<'a, ActivityRecord> {
        (**self).start(input, next)
    }

    fn update<'a>(
        &'a self,
        input: UpdateInput,
        next: &'a dyn LiveActivityBackend,
    ) -> BackendFuture<'a, ActivityRecord> {
        (**self).update(input, next)
    }

    fn end<'a>(
        &'a self,
        input: EndInput,
        next: &'a dyn LiveActivityBackend,
    ) -> BackendFuture<'a, ActivityRecord> {
        (**self).end(input, next)
    }

    fn list<'a>(
        &'a self,
        next: &'a dyn LiveActivityBackend,
    ) -> BackendFuture<'a, Vec<ActivityRecord>> {
        (**self).list(next)
    }

    fn request_permissions<'a>(
        &'a self,
        kind: PermissionKind,
        next: &'a dyn LiveActivityBackend,
    ) -> BackendFuture<'a, Permissions> {
        (**self).request_permissions(kind, next)
    }

    fn start_layout<'a>(
        &'a self,
        input: LayoutStartInput,
        next: &'a dyn LiveActivityBackend,
    ) -> BackendFuture<'a, LayoutActivityRecord> {
        (**self).start_layout(input, next)
    }

    fn update_layout<'a>(
        &'a self,
        input: LayoutUpdateInput,
        next: &'a dyn LiveActivityBackend,
    ) -> BackendFuture<'a, LayoutActivityRecord> {
        (**self).update_layout(input, next)
    }

    fn end_layout<'a>(
        &'a self,
        input: LayoutEndInput,
        next: &'a dyn LiveActivityBackend,
    ) -> BackendFuture<'a, LayoutActivityRecord> {
        (**self).end_layout(input, next)
    }

    fn list_layout<'a>(
        &'a self,
        next: &'a dyn LiveActivityBackend,
    ) -> BackendFuture<'a, Vec<LayoutActivityRecord>> {
        (**self).list_layout(next)
    }

    fn write_image<'a>(
        &'a self,
        name: String,
        png: Vec<u8>,
        next: &'a dyn LiveActivityBackend,
    ) -> BackendFuture<'a, ()> {
        (**self).write_image(name, png, next)
    }

    fn push_tokens<'a>(
        &'a self,
        next: &'a dyn LiveActivityBackend,
    ) -> BackendFuture<'a, PushTokens> {
        (**self).push_tokens(next)
    }

    fn sync_events<'a>(&'a self, next: &'a dyn LiveActivityBackend) -> BackendFuture<'a, ()> {
        (**self).sync_events(next)
    }
}

/// A layer and the backend under it, as one backend.
pub(crate) struct Layered<L> {
    layer: L,
    next: Arc<dyn LiveActivityBackend>,
}

impl<L: BackendLayer> Layered<L> {
    pub(crate) fn new(layer: L, next: Arc<dyn LiveActivityBackend>) -> Self {
        Self { layer, next }
    }
}

impl<L: BackendLayer> LiveActivityBackend for Layered<L> {
    fn attach(&self, events: BackendContext) -> Result<()> {
        self.layer.attach(events, self.next.as_ref())
    }

    fn capabilities(&self) -> BackendFuture<'_, Capabilities> {
        self.layer.capabilities(self.next.as_ref())
    }

    fn permissions(&self) -> BackendFuture<'_, Permissions> {
        self.layer.permissions(self.next.as_ref())
    }

    fn start(&self, input: StartInput) -> BackendFuture<'_, ActivityRecord> {
        self.layer.start(input, self.next.as_ref())
    }

    fn update(&self, input: UpdateInput) -> BackendFuture<'_, ActivityRecord> {
        self.layer.update(input, self.next.as_ref())
    }

    fn end(&self, input: EndInput) -> BackendFuture<'_, ActivityRecord> {
        self.layer.end(input, self.next.as_ref())
    }

    fn list(&self) -> BackendFuture<'_, Vec<ActivityRecord>> {
        self.layer.list(self.next.as_ref())
    }

    fn request_permissions(&self, kind: PermissionKind) -> BackendFuture<'_, Permissions> {
        self.layer.request_permissions(kind, self.next.as_ref())
    }

    fn start_layout(&self, input: LayoutStartInput) -> BackendFuture<'_, LayoutActivityRecord> {
        self.layer.start_layout(input, self.next.as_ref())
    }

    fn update_layout(&self, input: LayoutUpdateInput) -> BackendFuture<'_, LayoutActivityRecord> {
        self.layer.update_layout(input, self.next.as_ref())
    }

    fn end_layout(&self, input: LayoutEndInput) -> BackendFuture<'_, LayoutActivityRecord> {
        self.layer.end_layout(input, self.next.as_ref())
    }

    fn list_layout(&self) -> BackendFuture<'_, Vec<LayoutActivityRecord>> {
        self.layer.list_layout(self.next.as_ref())
    }

    fn write_image(&self, name: String, png: Vec<u8>) -> BackendFuture<'_, ()> {
        self.layer.write_image(name, png, self.next.as_ref())
    }

    fn push_tokens(&self) -> BackendFuture<'_, PushTokens> {
        self.layer.push_tokens(self.next.as_ref())
    }

    fn sync_events(&self) -> BackendFuture<'_, ()> {
        self.layer.sync_events(self.next.as_ref())
    }
}
