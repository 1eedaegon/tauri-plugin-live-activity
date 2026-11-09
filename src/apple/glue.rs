//! What joins the plugin to activitykit besides the calls themselves (`crate::ios`): the kit's settings, the requests
//! that the plugin's specs become, and the setup that hands each tap, with what holds its intent, to the `on_action`
//! handlers. Plain functions over activitykit's types and the [`Kit`] trait, so that the tests run them on the host.

use super::{Apple, EndSpec, Kit, StartSpec, UpdateSpec};
use crate::{
    Config, Error, Result,
    actions::{self, Actions},
    layout::ActionEvent,
    models::EndPolicy,
};
use activitykit::{ActivityKit, Builder, End, Start, Update};
use std::{
    sync::Arc,
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

/// The time of `millis` epoch milliseconds.
pub(crate) fn time(millis: u64) -> SystemTime {
    UNIX_EPOCH + Duration::from_millis(millis)
}

/// `at` in epoch milliseconds, when it is after the epoch and fits.
pub(crate) fn millis(at: SystemTime) -> Option<u64> {
    u64::try_from(at.duration_since(UNIX_EPOCH).ok()?.as_millis()).ok()
}

/// activitykit's settings: the receipts that the plugin configuration names.
pub(crate) fn builder(config: Option<&Config>) -> Builder {
    ActivityKit::builder().receipts(super::receipts(config))
}

pub(crate) fn start_of(spec: StartSpec) -> Start {
    let mut start = Start::new(spec.layout, spec.values)
        .key(spec.key)
        .revision(spec.revision);
    if let Some(at) = spec.stale_at {
        start = start.stale_at(time(at));
    }
    if let Some(at) = spec.timestamp {
        start = start.timestamp(time(at));
    }
    start
}

pub(crate) fn update_of(spec: UpdateSpec) -> Update {
    let mut update = Update::new(spec.values).revision(spec.revision);
    if let Some(at) = spec.stale_at {
        update = update.stale_at(time(at));
    }
    if let Some(at) = spec.timestamp {
        update = update.timestamp(time(at));
    }
    update
}

pub(crate) fn end_of(spec: EndSpec) -> End {
    let mut end = match spec.policy {
        EndPolicy::Immediate {} => End::immediately(),
        EndPolicy::Default {} => End::default(),
        EndPolicy::After { at } => End::after(time(at)),
    };
    if let Some(values) = spec.values {
        end = end.values(values);
    }
    if let Some(revision) = spec.revision {
        end = end.revision(revision);
    }
    if let Some(at) = spec.stale_at {
        end = end.stale_at(time(at));
    }
    if let Some(at) = spec.timestamp {
        end = end.timestamp(time(at));
    }
    end
}

/// What holds a tap's intent, and with it an app that the system launched for the tap: activitykit's
/// `Acknowledgement`.
pub(crate) trait Acknowledge: Send + 'static {
    fn acknowledge(&self);
}

impl Acknowledge for activitykit::Acknowledgement {
    fn acknowledge(&self) {
        activitykit::Acknowledgement::acknowledge(self);
    }
}

/// The taps among a kit's events: each event that `tap` turns into a tap with what holds it, in order, until `next`
/// ends; the other events pass. `crate::ios` reads activitykit's events with it.
pub(crate) fn taps_of<E, A>(
    mut next: impl FnMut() -> Option<E> + Send + 'static,
    tap: impl Fn(E) -> Option<(ActionEvent, A)> + Send + 'static,
) -> impl Iterator<Item = (ActionEvent, A)> + Send + 'static
where
    E: 'static,
    A: 'static,
{
    std::iter::from_fn(move || {
        loop {
            if let Some(found) = tap(next()?) {
                return Some(found);
            }
        }
    })
}

/// Lets a tap's intent go when dropped. The dispatcher of [`Actions`] drops it once the `on_action` handlers have run
/// and the tap went to JavaScript.
pub(crate) struct Release<A: Acknowledge>(A);

impl<A: Acknowledge> Drop for Release<A> {
    fn drop(&mut self) {
        self.0.acknowledge();
    }
}

/// Hands every tap of `taps` to the handlers with what holds it, until the taps end.
fn forward<A: Acknowledge>(taps: impl Iterator<Item = (ActionEvent, A)>, actions: &Actions) {
    for (event, acknowledgement) in taps {
        actions.tap(event, Release(acknowledgement));
    }
}

/// The plugin on the kit that activitykit built, or setup's failure with activitykit's error: a kit that already runs
/// with other settings answers `CONFLICT`. The plugin subscribes to the kit's events first, so that a tap which
/// launched the app finds a subscriber as early as the plugin can be, and one thread reads them from then on and hands
/// every tap to the handlers of `on_action` and then to `emit`.
pub(crate) fn setup<K: Kit>(
    built: activitykit::Result<K>,
    emit: impl Fn(&ActionEvent) + Send + 'static,
) -> Result<(Arc<Apple<K>>, Actions)> {
    setup_with(built, || actions::spawn(emit))
}

/// [`setup`] with the start of the handlers' thread given, so that a test sees what comes first.
pub(crate) fn setup_with<K: Kit>(
    built: activitykit::Result<K>,
    spawn: impl FnOnce() -> Result<Actions>,
) -> Result<(Arc<Apple<K>>, Actions)> {
    let kit = built?;
    let taps = kit.taps();
    let actions = spawn()?;
    let forwarding = actions.clone();
    thread::Builder::new()
        .name("live-activity-events".into())
        .spawn(move || forward(taps, &forwarding))
        .map_err(|_| Error::native())?;
    Ok((Arc::new(Apple::new(kit)), actions))
}
