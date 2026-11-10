//! What joins the plugin to activitykit besides the calls themselves (`crate::ios`): the kit's settings, the requests
//! that the plugin's specs become, and the setup that hands each tap, with what holds its intent, to the `on_action`
//! handlers and each event of the pushes to JavaScript. Plain functions over activitykit's types and the [`Kit`]
//! trait, so that the tests run them on the host.

use super::{
    Apple, EndSpec, Kit, KitEvent, StartSpec, UpdateSpec, push_token_event, updated_event,
};
use crate::{
    Config, Error, Result,
    actions::{self, Actions},
    layout::{ActionEvent, LayoutPush},
    models::EndPolicy,
    pushes::{PushEvent, PushToStartTokenEvent, TokenBook},
};
use activitykit::{ActivityKit, Builder, ChannelId, End, Push, Start, Update};
use std::{
    panic::{AssertUnwindSafe, catch_unwind},
    sync::Arc,
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

/// 9999-12-31T23:59:59.999Z in epoch milliseconds: a cap every platform's `SystemTime` holds. On Windows a much later
/// one overflows.
pub(crate) const LATEST_MILLIS: u64 = 253_402_300_799_999;

/// The time of `millis` epoch milliseconds, clamped to [`LATEST_MILLIS`].
pub(crate) fn time(millis: u64) -> SystemTime {
    UNIX_EPOCH + Duration::from_millis(millis.min(LATEST_MILLIS))
}

/// `at` in epoch milliseconds, when it is after the epoch and fits.
pub(crate) fn millis(at: SystemTime) -> Option<u64> {
    u64::try_from(at.duration_since(UNIX_EPOCH).ok()?.as_millis()).ok()
}

/// activitykit's settings: the receipts and the push-to-start watch that the plugin configuration names.
pub(crate) fn builder(config: Option<&Config>) -> Builder {
    let push_to_start = config
        .and_then(|config| config.push_to_start)
        .unwrap_or(false);
    ActivityKit::builder()
        .receipts(super::receipts(config))
        .push_to_start(push_to_start)
}

/// activitykit's start, or `INVALID_INPUT` for a channel that is no id, which the check of the request keeps out.
pub(crate) fn start_of(spec: StartSpec) -> activitykit::Result<Start> {
    let mut start = Start::new(spec.layout, spec.values)
        .key(spec.key)
        .revision(spec.revision);
    if let Some(at) = spec.stale_at {
        start = start.stale_at(time(at));
    }
    if let Some(at) = spec.timestamp {
        start = start.timestamp(time(at));
    }
    Ok(match spec.push {
        Some(LayoutPush::Token) => start.push(Push::Token),
        Some(LayoutPush::Channel(id)) => start.push(Push::Channel(ChannelId::new(id)?)),
        None => start,
    })
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

/// What the plugin takes of a kit's events: each event that `take` turns into one of the plugin's, in order, until
/// `next` ends; the other events pass. `crate::ios` reads activitykit's events with it.
pub(crate) fn events_of<E, H, A>(
    mut next: impl FnMut() -> Option<E> + Send + 'static,
    take: impl Fn(E) -> Option<KitEvent<H, A>> + Send + 'static,
) -> impl Iterator<Item = KitEvent<H, A>> + Send + 'static
where
    E: 'static,
    H: 'static,
    A: 'static,
{
    std::iter::from_fn(move || {
        loop {
            if let Some(found) = take(next()?) {
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

/// Hands every tap of `events` to the handlers with what holds it, and every event of the pushes to `push`, noted in
/// `book` first, until the events end. Nothing here waits: a tap is queued, and the pushes' events go out as they
/// come. Tauri runs the app's Rust listeners inline in `push`: one that panics is caught, so that the events go on.
fn forward<H: super::Handle, A: Acknowledge>(
    events: impl Iterator<Item = KitEvent<H, A>>,
    actions: &Actions,
    book: &TokenBook,
    push: &impl Fn(&PushEvent),
) {
    let send = |event: PushEvent| {
        book.note(&event);
        let _ = catch_unwind(AssertUnwindSafe(|| push(&event)));
    };
    for event in events {
        match event {
            KitEvent::Tap(tap, acknowledgement) => actions.tap(tap, Release(acknowledgement)),
            KitEvent::PushToken { activity, token } => {
                send(PushEvent::Token(push_token_event(&activity, token)));
            }
            KitEvent::PushToStartToken { token } => {
                send(PushEvent::PushToStartToken(PushToStartTokenEvent { token }));
            }
            KitEvent::Updated(activity) => {
                if let Some(updated) = updated_event(&activity) {
                    send(PushEvent::Updated(updated));
                }
            }
        }
    }
}

/// The plugin on the kit that activitykit built, or setup's failure with activitykit's error: a kit that already runs
/// with other settings answers `CONFLICT`. The plugin subscribes to the kit's events first, so that a tap which
/// launched the app finds a subscriber as early as the plugin can be, and one thread reads them from then on and hands
/// every tap to the handlers of `on_action` and then to `emit`, and every event of the pushes to `push` as it comes,
/// its token kept in the book returned.
pub(crate) fn setup<K: Kit>(
    built: activitykit::Result<K>,
    emit: impl Fn(&ActionEvent) + Send + 'static,
    push: impl Fn(&PushEvent) + Send + 'static,
) -> Result<(Arc<Apple<K>>, Actions, TokenBook)> {
    setup_with(built, || actions::spawn(emit), push)
}

/// [`setup`] with the start of the handlers' thread given, so that a test sees what comes first.
pub(crate) fn setup_with<K: Kit>(
    built: activitykit::Result<K>,
    spawn: impl FnOnce() -> Result<Actions>,
    push: impl Fn(&PushEvent) + Send + 'static,
) -> Result<(Arc<Apple<K>>, Actions, TokenBook)> {
    let kit = built?;
    let events = kit.events();
    let actions = spawn()?;
    let forwarding = actions.clone();
    let book = TokenBook::default();
    let noting = book.clone();
    thread::Builder::new()
        .name("live-activity-events".into())
        .spawn(move || forward(events, &forwarding, &noting, &push))
        .map_err(|_| Error::native())?;
    Ok((Arc::new(Apple::new(kit)), actions, book))
}
