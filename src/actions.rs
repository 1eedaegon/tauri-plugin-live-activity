//! Button taps on their way from the native side to the handlers of `on_action`.
//!
//! The native side calls the channel closure on a thread of its own, never the main thread, and
//! acknowledges the tap when the closure returns; an app that the system launched for the tap
//! keeps running until then. The closure therefore queues the tap and waits, for a bounded time,
//! until the handlers registered at that moment have run. One plugin thread runs the handlers,
//! so a handler may call the plugin synchronously.

use crate::{ActionEvent, Error, Result};
use std::{
    collections::VecDeque,
    panic::{AssertUnwindSafe, catch_unwind},
    sync::{Arc, Mutex, PoisonError, mpsc},
    thread,
    time::Duration,
};
use tauri::ipc::{Channel, InvokeResponseBody};

/// The Tauri event that carries an [`ActionEvent`] to JavaScript.
pub(crate) const ACTION_EVENT: &str = "live-activity://action";
/// Taps kept while no handler is registered yet.
const MAX_PENDING: usize = 16;
/// How long the native side waits for the handlers of one tap. The intent template waits 5 s.
const HANDLER_WAIT: Duration = Duration::from_secs(4);

type Handler = Arc<dyn Fn(ActionEvent) + Send + Sync>;
type Handlers = Arc<Mutex<Vec<Handler>>>;

enum Message {
    /// A tap, and the sender whose drop tells `accept` that its handlers have run.
    Tap(ActionEvent, mpsc::Sender<()>),
    Subscribed,
}

/// The sending side: registers handlers and accepts taps. Clones share both.
#[derive(Clone)]
pub(crate) struct Actions {
    handlers: Handlers,
    queue: mpsc::Sender<Message>,
    wait: Duration,
}

/// The receiving side, run on a thread of the plugin.
pub(crate) struct Dispatcher {
    handlers: Handlers,
    queue: mpsc::Receiver<Message>,
}

fn channel(wait: Duration) -> (Actions, Dispatcher) {
    let (sender, queue) = mpsc::channel();
    let handlers = Handlers::default();
    let actions = Actions {
        handlers: handlers.clone(),
        queue: sender,
        wait,
    };
    (actions, Dispatcher { handlers, queue })
}

/// Runs the handlers on a thread of the plugin, where every tap then goes to `emit`, and hands
/// the channel of the taps to `register` on the calling thread. When `register` fails, no tap
/// arrives; the plugin works otherwise.
pub(crate) fn start(
    register: impl FnOnce(Channel) -> bool,
    emit: impl Fn(&ActionEvent) + Send + 'static,
) -> Result<Actions> {
    start_waiting(HANDLER_WAIT, register, emit)
}

fn start_waiting(
    wait: Duration,
    register: impl FnOnce(Channel) -> bool,
    emit: impl Fn(&ActionEvent) + Send + 'static,
) -> Result<Actions> {
    let (actions, dispatcher) = channel(wait);
    thread::Builder::new()
        .name("live-activity-actions".into())
        .spawn(move || dispatcher.run(emit))
        .map_err(|_| Error::native())?;
    let taps = actions.clone();
    let source = Channel::new(move |body| {
        taps.accept(body);
        Ok(())
    });
    if !register(source) {
        #[cfg(debug_assertions)]
        eprintln!("live-activity: the native side refused the action channel; no tap reaches Rust");
    }
    Ok(actions)
}

impl Actions {
    pub(crate) fn subscribe(&self, handler: impl Fn(ActionEvent) + Send + Sync + 'static) {
        self.handlers
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .push(Arc::new(handler));
        // The dispatcher ends only with the plugin, and then nothing is left to deliver.
        let _ = self.queue.send(Message::Subscribed);
    }

    /// Queues one payload of the native channel and returns once the handlers registered now
    /// have run for it, or after the wait; without a handler it returns at once. It never
    /// panics: the caller is a native callback that cannot unwind. A payload that is not an
    /// action event is dropped.
    pub(crate) fn accept(&self, body: InvokeResponseBody) {
        let InvokeResponseBody::Json(payload) = body else {
            return;
        };
        let Ok(event) = serde_json::from_str(&payload) else {
            return;
        };
        let (handled, done) = mpsc::channel();
        if self.queue.send(Message::Tap(event, handled)).is_ok() {
            let _ = done.recv_timeout(self.wait);
        }
    }
}

impl Dispatcher {
    /// Hands every tap to the handlers and then to `emit`, until every [`Actions`] is dropped.
    /// Taps that arrive before the first handler wait for it.
    pub(crate) fn run(self, emit: impl Fn(&ActionEvent)) {
        let mut pending = VecDeque::new();
        for message in self.queue {
            let handlers = self
                .handlers
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .clone();
            let deliver = |event: &ActionEvent| {
                for handler in &handlers {
                    // A handler that panics must not stop the taps that follow.
                    let _ = catch_unwind(AssertUnwindSafe(|| handler(event.clone())));
                }
            };
            match message {
                Message::Subscribed => pending.drain(..).for_each(|event| deliver(&event)),
                Message::Tap(event, handled) => {
                    deliver(&event);
                    emit(&event);
                    drop(handled);
                    if handlers.is_empty() {
                        if pending.len() == MAX_PENDING {
                            pending.pop_front();
                        }
                        pending.push_back(event);
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::time::Instant;

    type Log = Arc<Mutex<Vec<String>>>;
    const LONG: Duration = Duration::from_secs(60);

    fn tap(action: &str) -> InvokeResponseBody {
        InvokeResponseBody::Json(json!({"actionId":action,"activityId":"id"}).to_string())
    }

    fn record(log: &Log, entry: String) {
        log.lock().unwrap().push(entry);
    }

    fn handler(actions: &Actions, log: &Log, name: &'static str) {
        let log = log.clone();
        actions.subscribe(move |event| record(&log, format!("{name}:{}", event.action_id)));
    }

    /// A channel whose dispatcher runs on its own thread and logs what it emits.
    fn running(log: &Log, wait: Duration) -> (Actions, thread::JoinHandle<()>) {
        let (actions, dispatcher) = channel(wait);
        let sink = log.clone();
        let runner = thread::spawn(move || {
            dispatcher.run(|event| record(&sink, format!("emit:{}", event.action_id)));
        });
        (actions, runner)
    }

    /// Drops the sender and waits until the dispatcher has handled everything.
    fn finish(actions: Actions, runner: thread::JoinHandle<()>, log: &Log) -> Vec<String> {
        drop(actions);
        runner.join().unwrap();
        log.lock().unwrap().clone()
    }

    #[test]
    fn every_handler_sees_a_tap_before_it_is_emitted() {
        let log = Log::default();
        let (actions, runner) = running(&log, LONG);
        handler(&actions, &log, "first");
        handler(&actions, &log, "second");
        let (caller, threads) = (thread::current().id(), Log::default());
        let seen = threads.clone();
        actions.subscribe(move |event| {
            let elsewhere = thread::current().id() != caller;
            record(&seen, format!("{:?}:{elsewhere}", event.activity_key));
        });
        actions.accept(tap("play"));
        let stop = json!({"actionId":"stop","activityId":"id","activityKey":"job:1","later":1});
        actions
            .clone()
            .accept(InvokeResponseBody::Json(stop.to_string()));
        assert_eq!(
            finish(actions, runner, &log),
            [
                "first:play",
                "second:play",
                "emit:play",
                "first:stop",
                "second:stop",
                "emit:stop"
            ]
        );
        assert_eq!(
            *threads.lock().unwrap(),
            ["None:true", "Some(\"job:1\"):true"]
        );
    }

    #[test]
    fn payloads_that_are_not_action_events_are_dropped() {
        let log = Log::default();
        let (actions, runner) = running(&log, LONG);
        handler(&actions, &log, "only");
        for body in [
            InvokeResponseBody::Raw(vec![1, 2, 3]),
            InvokeResponseBody::Json("not json".into()),
            InvokeResponseBody::Json("null".into()),
            InvokeResponseBody::Json(json!({"actionId":"play"}).to_string()),
            InvokeResponseBody::Json(json!({"actionId":7,"activityId":"id"}).to_string()),
        ] {
            actions.accept(body);
        }
        assert!(finish(actions, runner, &log).is_empty());
    }

    #[test]
    fn a_panicking_handler_does_not_stop_delivery() {
        let log = Log::default();
        let (actions, runner) = running(&log, LONG);
        actions.subscribe(|event| assert_ne!(event.action_id, "boom", "raised by this test"));
        handler(&actions, &log, "next");
        actions.accept(tap("boom"));
        actions.accept(tap("play"));
        assert_eq!(
            finish(actions, runner, &log),
            ["next:boom", "emit:boom", "next:play", "emit:play"]
        );
    }

    #[test]
    fn taps_before_the_first_handler_wait_for_it() {
        let log = Log::default();
        let (actions, runner) = running(&log, LONG);
        let early = MAX_PENDING + 2;
        let started = Instant::now();
        for index in 0..early {
            actions.accept(tap(&index.to_string()));
        }
        // Without a handler nothing is waited for, and every tap is emitted on arrival.
        assert!(started.elapsed() < LONG / 2);
        assert_eq!(log.lock().unwrap().len(), early);
        handler(&actions, &log, "late");
        actions.accept(tap("live"));
        let log = finish(actions, runner, &log);
        // The handler gets the newest waiting taps in order.
        assert_eq!(log.len(), early + MAX_PENDING + 2);
        assert_eq!(log[early - 1], format!("emit:{}", early - 1));
        assert_eq!(log[early], "late:2");
        assert_eq!(log[early + MAX_PENDING - 1], format!("late:{}", early - 1));
        assert_eq!(log[early + MAX_PENDING..], ["late:live", "emit:live"]);
    }

    #[test]
    fn a_tap_is_accepted_once_its_handlers_have_run() {
        let log = Log::default();
        let (actions, runner) = running(&log, LONG);
        let slow = log.clone();
        actions.subscribe(move |event| {
            thread::sleep(Duration::from_millis(50));
            record(&slow, format!("slow:{}", event.action_id));
        });
        actions.accept(tap("play"));
        assert_eq!(*log.lock().unwrap(), ["slow:play", "emit:play"]);
        assert_eq!(finish(actions, runner, &log).len(), 2);
    }

    #[test]
    fn the_wait_for_a_handler_is_bounded() {
        let log = Log::default();
        let (actions, runner) = running(&log, Duration::from_millis(50));
        let (release, blocked) = mpsc::channel::<()>();
        let blocked = Mutex::new(blocked);
        actions.subscribe(move |_| {
            let _ = blocked.lock().unwrap().recv();
        });
        // Without the bound, `accept` would return only when this thread releases the handler.
        let releaser = thread::spawn(move || {
            thread::sleep(Duration::from_millis(1500));
            release.send(()).unwrap();
        });
        let started = Instant::now();
        actions.accept(tap("stuck"));
        assert!(started.elapsed() < Duration::from_secs(1));
        assert!(log.lock().unwrap().is_empty(), "the handler still runs");
        releaser.join().unwrap();
        assert_eq!(finish(actions, runner, &log), ["emit:stuck"]);
    }

    #[test]
    fn a_handler_may_register_another_handler() {
        let log = Log::default();
        let (actions, dispatcher) = channel(LONG);
        // The outer handler holds a sender, so the last tap clears the handlers to end the run.
        let handlers = actions.handlers.clone();
        let runner = thread::spawn(move || {
            dispatcher.run(|event| {
                if event.action_id == "two" {
                    handlers.lock().unwrap().clear();
                }
            });
        });
        let (outer, registry) = (log.clone(), actions.clone());
        actions.subscribe(move |event| {
            record(&outer, format!("outer:{}", event.action_id));
            handler(&registry, &outer, "inner");
        });
        actions.accept(tap("one"));
        actions.accept(tap("two"));
        assert_eq!(
            finish(actions, runner, &log),
            ["outer:one", "outer:two", "inner:two"]
        );
    }

    #[test]
    fn the_channel_is_registered_on_the_calling_thread_and_carries_taps() {
        let log = Log::default();
        let (caller, source) = (thread::current().id(), Arc::new(Mutex::new(None)));
        let (kept, sink) = (source.clone(), log.clone());
        let actions = start(
            |channel| {
                assert_eq!(thread::current().id(), caller);
                *kept.lock().unwrap() = Some(channel);
                true
            },
            move |event| record(&sink, format!("emit:{}", event.action_id)),
        )
        .unwrap();
        handler(&actions, &log, "rust");
        let channel = source.lock().unwrap().take().unwrap();
        channel.send(tap("play")).unwrap();
        assert_eq!(log.lock().unwrap()[0], "rust:play");
    }

    #[test]
    fn a_refused_channel_leaves_the_plugin_working() {
        let log = Log::default();
        let actions = start_waiting(LONG, |_| false, |_| {}).unwrap();
        handler(&actions, &log, "rust");
        actions.accept(tap("direct"));
        assert_eq!(*log.lock().unwrap(), ["rust:direct"]);
    }
}
