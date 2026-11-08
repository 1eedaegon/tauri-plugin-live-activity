//! The iOS backend: the plugin's commands on activitykit.
//!
//! It is generic over [`Kit`], which `activitykit::ActivityKit` implements on iOS (`crate::ios`) and a fake implements
//! in the tests, so that what the plugin adds to activitykit runs on the host too: the revision rules of contract v2,
//! the lookup of a handle by its id, the repeated start, the records, and the progress and timer templates of
//! contract v1, which become layout activities ([`template`]).

pub(crate) mod template;

#[cfg(test)]
mod fake;
#[cfg(test)]
mod tests;

use crate::{
    Error, Result,
    layout::{
        ActionEvent, LayoutActivityRecord, LayoutEndInput, LayoutSnapshot, LayoutStartInput,
        LayoutUpdateInput,
    },
    models::*,
    validation::Validate,
};
use activitykit::{State, Values};
use std::{
    collections::HashMap,
    future::Future,
    pin::pin,
    sync::{Arc, Mutex, MutexGuard, PoisonError},
    task::{Context, Poll, Wake, Waker},
    thread,
};

/// What the plugin needs of activitykit's `ActivityKit`.
pub(crate) trait Kit: Send + Sync + 'static {
    type Handle: Handle;
    fn authorization(&self) -> Authorization;
    fn start(
        &self,
        start: StartSpec,
    ) -> impl Future<Output = activitykit::Result<Self::Handle>> + Send;
    fn activities(&self) -> impl Future<Output = activitykit::Result<Vec<Self::Handle>>> + Send;
    fn write_image(&self, name: &str, png: &[u8]) -> activitykit::Result<()>;
}

/// What the plugin needs of activitykit's `Activity`. Times are epoch milliseconds.
pub(crate) trait Handle: Clone + Send + Sync + 'static {
    fn id(&self) -> &str;
    fn key(&self) -> &str;
    fn state(&self) -> State;
    fn values(&self) -> Values;
    fn revision(&self) -> Option<u64>;
    fn stale_at(&self) -> Option<u64>;
    fn degraded_features(&self) -> Vec<String>;
    fn update(&self, update: UpdateSpec) -> impl Future<Output = activitykit::Result<()>> + Send;
    fn end(&self, end: EndSpec) -> impl Future<Output = activitykit::Result<()>> + Send;
}

/// activitykit's `Authorization`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Authorization {
    pub(crate) supported: bool,
    pub(crate) enabled: bool,
    pub(crate) buttons: bool,
}

/// A start: activitykit's `Start` with a key and a stale date.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct StartSpec {
    pub(crate) key: String,
    pub(crate) layout: activitykit::Layout,
    pub(crate) values: Values,
    pub(crate) stale_at: Option<u64>,
}

/// An update: activitykit's `Update` with a stale date and a timestamp.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct UpdateSpec {
    pub(crate) values: Values,
    pub(crate) stale_at: Option<u64>,
    pub(crate) timestamp: Option<u64>,
}

/// An end: activitykit's `End` with its policy and the final content, when given.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct EndSpec {
    pub(crate) policy: EndPolicy,
    pub(crate) values: Option<Values>,
    pub(crate) stale_at: Option<u64>,
    pub(crate) timestamp: Option<u64>,
}

/// Which contract version an activity belongs to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Kind {
    Layout,
    Template(Template),
}

impl Kind {
    fn is_layout(self) -> bool {
        self == Self::Layout
    }

    fn is_template(self) -> bool {
        matches!(self, Self::Template(_))
    }
}

/// What a snapshot's revision asks for, against the accepted one.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Revision {
    Send,
    Same,
    Stale,
    Conflict,
}

/// The repeated start: the request of a start of this launch, by its key, and the activity it started.
struct Started {
    request: LayoutStartInput,
    id: String,
}

pub(crate) struct Apple<K: Kit> {
    kit: K,
    /// Every handle this launch has seen, by id: started, listed, or named by an event.
    handles: Mutex<HashMap<String, K::Handle>>,
    starts: Mutex<HashMap<String, Started>>,
    /// `receipts: "redacted"` in the plugin configuration.
    redacted: bool,
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

fn not_found() -> Error {
    Error::new("NOT_FOUND", "No active activity has this handle.")
}

fn stale() -> Error {
    Error::new(
        "STALE_REVISION",
        "The revision is older than the current activity state.",
    )
}

fn conflict() -> Error {
    Error::new(
        "CONFLICT",
        "This revision already contains different state.",
    )
}

fn redacted() -> Error {
    Error::new(
        "CONFIGURATION_REQUIRED",
        "Redacted receipts are not available on iOS with this version: remove receipts from the plugin configuration",
    )
}

/// An activity that is or may still become visible.
fn live(state: State) -> bool {
    matches!(state, State::Pending | State::Active | State::Stale)
}

fn ended(state: State) -> bool {
    matches!(state, State::Ended | State::Dismissed)
}

fn state(state: State) -> ActivityState {
    match state {
        State::Pending => ActivityState::Pending,
        State::Active => ActivityState::Active,
        State::Stale => ActivityState::Stale,
        State::Ended => ActivityState::Ended,
        State::Dismissed => ActivityState::Dismissed,
        _ => ActivityState::Unknown,
    }
}

/// The revision rules of contract v2 for a snapshot at `sent`, against the `accepted` revision and its content.
fn revision(sent: u64, accepted: Option<u64>, same: bool) -> Revision {
    match accepted {
        Some(accepted) if sent < accepted => Revision::Stale,
        Some(accepted) if sent == accepted && same => Revision::Same,
        Some(accepted) if sent == accepted => Revision::Conflict,
        _ => Revision::Send,
    }
}

fn kind<H: Handle>(handle: &H) -> Kind {
    template::of(&handle.values()).map_or(Kind::Layout, Kind::Template)
}

/// The tap of a button of `handle` as JavaScript and the handlers get it.
pub(crate) fn action_event<H: Handle>(handle: &H, action: String) -> ActionEvent {
    let key = handle.key();
    ActionEvent {
        action_id: action,
        activity_id: handle.id().to_owned(),
        activity_key: (!key.is_empty()).then(|| key.to_owned()),
    }
}

fn layout_record<H: Handle>(handle: &H) -> LayoutActivityRecord {
    LayoutActivityRecord {
        id: handle.id().to_owned(),
        activity_key: handle.key().to_owned(),
        schema_version: 2,
        snapshot: LayoutSnapshot {
            revision: handle.revision().unwrap_or(0),
            values: handle.values().into_inner(),
            stale_at: handle.stale_at(),
            timestamp: None,
        },
        backend: Backend::ActivityKit,
        state: state(handle.state()),
        visibility: Visibility::Unknown,
        degraded_features: handle.degraded_features(),
        promotion_requested: false,
        promotion_state: PromotionState::NotApplicable,
    }
}

fn template_record<H: Handle>(handle: &H) -> Option<ActivityRecord> {
    let revision = handle.revision().unwrap_or(0);
    let (template, snapshot) = template::snapshot(revision, &handle.values(), handle.stale_at())?;
    Some(ActivityRecord {
        id: handle.id().to_owned(),
        activity_key: handle.key().to_owned(),
        schema_version: 1,
        template,
        snapshot,
        backend: Backend::ActivityKit,
        state: state(handle.state()),
        visibility: Visibility::Unknown,
        degraded_features: handle.degraded_features(),
        promotion_requested: false,
        promotion_state: PromotionState::NotApplicable,
    })
}

impl<K: Kit> Apple<K> {
    pub(crate) fn new(kit: K, redacted: bool) -> Self {
        Self {
            kit,
            handles: Mutex::default(),
            starts: Mutex::default(),
            redacted,
        }
    }

    pub(crate) fn capabilities(&self) -> Capabilities {
        let authorization = self.kit.authorization();
        let support = |yes: bool| {
            if yes {
                FeatureSupport::Supported
            } else {
                FeatureSupport::Unsupported
            }
        };
        let supported = support(authorization.supported);
        Capabilities {
            platform: "ios".into(),
            backend: if authorization.supported {
                Backend::ActivityKit
            } else {
                Backend::Unsupported
            },
            start: supported,
            update: supported,
            end: supported,
            progress: supported,
            timer: supported,
            actions: support(authorization.supported && authorization.buttons),
            state_observation: supported,
            silent_update: supported,
            native_live_activity: supported,
            max_payload_bytes: 4096,
            layout: supported,
        }
    }

    /// Live Activities are a switch in Settings: there is no prompt, so a request reports `settingsRequired`.
    pub(crate) fn permissions(&self, request: bool) -> Permissions {
        let authorization = self.kit.authorization();
        let live_activities = match (authorization.supported, authorization.enabled, request) {
            (false, _, _) => PermissionState::NotApplicable,
            (true, true, _) => PermissionState::Granted,
            (true, false, true) => PermissionState::SettingsRequired,
            (true, false, false) => PermissionState::Denied,
        };
        Permissions {
            notifications: PermissionState::NotApplicable,
            live_activities,
            promotion: PermissionState::NotApplicable,
        }
    }

    pub(crate) fn request_permissions(&self, kind: PermissionKind) -> Result<Permissions> {
        match kind {
            PermissionKind::LiveActivities => Ok(self.permissions(true)),
            _ => Err(Error::new(
                "UNSUPPORTED_FEATURE",
                "This backend only exposes Live Activity settings.",
            )),
        }
    }

    pub(crate) fn write_image(&self, name: &str, png: &[u8]) -> Result<()> {
        crate::image::check_image(name, png)?;
        Ok(self.kit.write_image(name, png)?)
    }

    /// Keeps a handle that an event named, so that a later command finds it without a list.
    pub(crate) fn remember(&self, handle: &K::Handle) {
        lock(&self.handles).insert(handle.id().to_owned(), handle.clone());
    }

    pub(crate) async fn start_layout(
        &self,
        input: LayoutStartInput,
    ) -> Result<LayoutActivityRecord> {
        input.validate()?;
        Ok(layout_record(&self.start(input).await?))
    }

    pub(crate) async fn update_layout(
        &self,
        input: LayoutUpdateInput,
    ) -> Result<LayoutActivityRecord> {
        input.validate()?;
        self.writable()?;
        let handle = self.find(&input.id, Kind::is_layout, false).await?;
        self.update(&handle, input.snapshot).await?;
        Ok(layout_record(&handle))
    }

    pub(crate) async fn end_layout(&self, input: LayoutEndInput) -> Result<LayoutActivityRecord> {
        input.validate()?;
        self.writable()?;
        let handle = self.find(&input.id, Kind::is_layout, true).await?;
        self.end(&handle, input.policy, input.snapshot).await?;
        Ok(layout_record(&handle))
    }

    pub(crate) async fn list_layout(&self) -> Result<Vec<LayoutActivityRecord>> {
        let handles = self.refresh().await?;
        Ok(handles
            .iter()
            .filter(|handle| kind(*handle) == Kind::Layout)
            .map(layout_record)
            .collect())
    }

    pub(crate) async fn start_template(&self, input: StartInput) -> Result<ActivityRecord> {
        input.validate()?;
        let request = template::start(&input);
        request.validate()?;
        let handle = self.start(request).await?;
        template_record(&handle).ok_or_else(Error::native)
    }

    pub(crate) async fn update_template(&self, input: UpdateInput) -> Result<ActivityRecord> {
        input.validate()?;
        self.writable()?;
        let (template, snapshot) = template::layout_snapshot(&input.snapshot);
        let handle = self.find(&input.id, Kind::is_template, false).await?;
        // The other template's fields would change the keys of the start.
        if kind(&handle) != Kind::Template(template) {
            return Err(Error::invalid());
        }
        self.update(&handle, snapshot).await?;
        template_record(&handle).ok_or_else(Error::native)
    }

    pub(crate) async fn end_template(&self, input: EndInput) -> Result<ActivityRecord> {
        input.validate()?;
        self.writable()?;
        let handle = self.find(&input.id, Kind::is_template, true).await?;
        self.end(&handle, input.policy, None).await?;
        template_record(&handle).ok_or_else(Error::native)
    }

    pub(crate) async fn list_templates(&self) -> Result<Vec<ActivityRecord>> {
        let handles = self.refresh().await?;
        Ok(handles.iter().filter_map(template_record).collect())
    }

    fn writable(&self) -> Result<()> {
        if self.redacted {
            Err(redacted())
        } else {
            Ok(())
        }
    }

    /// Starts `request`, or returns the activity that the same request started in this launch while it runs.
    /// activitykit's own check of a repeated start covers the content's timestamp, which differs on every start.
    async fn start(&self, request: LayoutStartInput) -> Result<K::Handle> {
        self.writable()?;
        if let Some(handle) = self.running(&request) {
            return Ok(handle);
        }
        let layout = activitykit::Layout {
            lock_screen: request.layout.lock_screen.clone(),
            island: request.layout.island.clone(),
            background: request.layout.background.clone(),
            keyline: request.layout.keyline.clone(),
            styles: request.styles.clone().unwrap_or_default(),
        };
        let start = StartSpec {
            key: request.activity_key.clone(),
            layout,
            values: request.snapshot.values.clone().into(),
            stale_at: request.snapshot.stale_at,
        };
        let handle = self.kit.start(start).await?;
        self.remember(&handle);
        let started = Started {
            request,
            id: handle.id().to_owned(),
        };
        lock(&self.starts).insert(started.request.activity_key.clone(), started);
        Ok(handle)
    }

    fn running(&self, request: &LayoutStartInput) -> Option<K::Handle> {
        let starts = lock(&self.starts);
        let started = starts
            .get(&request.activity_key)
            .filter(|started| started.request == *request)?;
        let handle = lock(&self.handles).get(&started.id).cloned()?;
        live(handle.state()).then_some(handle)
    }

    /// The handle `id` of the version `wanted` takes: one this launch knows, or else one that activitykit lists. An
    /// ended activity is not found, unless `ended_too`: ending it again answers its record, as activitykit does.
    async fn find(&self, id: &str, wanted: fn(Kind) -> bool, ended_too: bool) -> Result<K::Handle> {
        let known = lock(&self.handles).get(id).cloned();
        let handle = match known {
            // A handle that only an event named has no values yet, so its version is unknown.
            Some(handle) if handle.revision().is_some() => handle,
            _ => {
                self.refresh().await?;
                lock(&self.handles).get(id).cloned().ok_or_else(not_found)?
            }
        };
        if !wanted(kind(&handle)) || (ended(handle.state()) && !ended_too) {
            return Err(not_found());
        }
        Ok(handle)
    }

    async fn refresh(&self) -> Result<Vec<K::Handle>> {
        let handles = self.kit.activities().await?;
        let mut known = lock(&self.handles);
        for handle in &handles {
            known.insert(handle.id().to_owned(), handle.clone());
        }
        Ok(handles)
    }

    fn same(handle: &K::Handle, snapshot: &LayoutSnapshot) -> bool {
        *handle.values() == snapshot.values && handle.stale_at() == snapshot.stale_at
    }

    async fn update(&self, handle: &K::Handle, snapshot: LayoutSnapshot) -> Result<()> {
        match revision(
            snapshot.revision,
            handle.revision(),
            Self::same(handle, &snapshot),
        ) {
            Revision::Stale => Err(stale()),
            Revision::Conflict => Err(conflict()),
            Revision::Same => Ok(()),
            Revision::Send => {
                let update = UpdateSpec {
                    values: snapshot.values.into(),
                    stale_at: snapshot.stale_at,
                    timestamp: snapshot.timestamp,
                };
                Ok(handle.update(update).await?)
            }
        }
    }

    async fn end(
        &self,
        handle: &K::Handle,
        policy: EndPolicy,
        snapshot: Option<LayoutSnapshot>,
    ) -> Result<()> {
        let mut end = EndSpec {
            policy,
            values: None,
            stale_at: None,
            timestamp: None,
        };
        if let Some(snapshot) = snapshot {
            match revision(
                snapshot.revision,
                handle.revision(),
                Self::same(handle, &snapshot),
            ) {
                Revision::Stale => return Err(stale()),
                Revision::Conflict => return Err(conflict()),
                Revision::Same | Revision::Send => {}
            }
            end.values = Some(snapshot.values.into());
            end.stale_at = snapshot.stale_at;
            end.timestamp = snapshot.timestamp;
        }
        Ok(handle.end(end).await?)
    }
}

/// Drives `future` to its end on this thread. The plugin's blocking methods use it; never call it on the main thread,
/// where activitykit answers.
pub(crate) fn block_on<F: Future>(future: F) -> F::Output {
    struct Unpark(thread::Thread);
    impl Wake for Unpark {
        fn wake(self: Arc<Self>) {
            self.0.unpark();
        }
    }
    let waker = Waker::from(Arc::new(Unpark(thread::current())));
    let mut context = Context::from_waker(&waker);
    let mut future = pin!(future);
    loop {
        if let Poll::Ready(output) = future.as_mut().poll(&mut context) {
            return output;
        }
        thread::park();
    }
}
