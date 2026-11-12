//! Button taps on their way from the native side to the handlers of `on_action`.
//!
//! On iOS the taps come from activitykit's events, whose acknowledgement holds the tap's intent:
//! [`Actions::tap`] queues the tap with it, and the dispatcher lets it go once the handlers have
//! run and the event has gone to JavaScript. On Android liveupdate's receiver has stored the tap
//! before the plugin drains it, so nothing holds it. JavaScript listeners are not awaited. One
//! plugin thread runs the handlers, so a handler may call the plugin synchronously.

use crate::{ActionEvent, Error, Result};
use std::{
    collections::VecDeque,
    panic::{AssertUnwindSafe, catch_unwind},
    sync::{Arc, Mutex, PoisonError, mpsc},
    thread,
};

/// Taps kept while no handler is registered yet.
const MAX_PENDING: usize = 16;

type Handler = Arc<dyn Fn(ActionEvent) + Send + Sync>;
type Handlers = Arc<Mutex<Vec<Handler>>>;

enum Message {
    /// A tap, and what holds it: dropped once the handlers have run and the tap was emitted. On
    /// iOS it is activitykit's acknowledgement.
    Tap(ActionEvent, Box<dyn Send>),
    Subscribed,
}

/// The sending side: registers handlers and accepts taps. Clones share both.
#[derive(Clone)]
pub(crate) struct Actions {
    handlers: Handlers,
    queue: mpsc::Sender<Message>,
}

/// The receiving side, run on a thread of the plugin.
pub(crate) struct Dispatcher {
    handlers: Handlers,
    queue: mpsc::Receiver<Message>,
}

fn channel() -> (Actions, Dispatcher) {
    let (sender, queue) = mpsc::channel();
    let handlers = Handlers::default();
    let actions = Actions {
        handlers: handlers.clone(),
        queue: sender,
    };
    (actions, Dispatcher { handlers, queue })
}

/// Runs the handlers on a thread of the plugin, where every tap then goes to `emit`.
pub(crate) fn spawn(emit: impl Fn(&ActionEvent) + Send + 'static) -> Result<Actions> {
    let (actions, dispatcher) = channel();
    thread::Builder::new()
        .name("live-activity-actions".into())
        .spawn(move || dispatcher.run(emit))
        .map_err(|_| Error::native())?;
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

    /// Queues one tap for the handlers and returns at once. `hold` is dropped once the handlers
    /// registered now have run and the tap was emitted, or at once when the plugin is gone.
    pub(crate) fn tap(&self, event: ActionEvent, hold: impl Send + 'static) {
        // The dispatcher ends only with the plugin, and then nothing is left to deliver.
        let _ = self.queue.send(Message::Tap(event, Box::new(hold)));
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
                    // Tauri runs the app's Rust listeners inline: one that panics must not end the taps.
                    let _ = catch_unwind(AssertUnwindSafe(|| emit(&event)));
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
    use std::time::{Duration, Instant};

    type Log = Arc<Mutex<Vec<String>>>;

    fn tap(action: &str) -> ActionEvent {
        ActionEvent {
            action_id: action.into(),
            activity_id: "id".into(),
            activity_key: None,
        }
    }

    fn record(log: &Log, entry: String) {
        log.lock().unwrap().push(entry);
    }

    fn handler(actions: &Actions, log: &Log, name: &'static str) {
        let log = log.clone();
        actions.subscribe(move |event| record(&log, format!("{name}:{}", event.action_id)));
    }

    /// A channel whose dispatcher runs on its own thread and logs what it emits.
    fn running(log: &Log) -> (Actions, thread::JoinHandle<()>) {
        let (actions, dispatcher) = channel();
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

    // TP-ACTION-1, TP-ACTION-2
    #[test]
    fn every_handler_sees_a_tap_before_it_is_emitted() {
        let log = Log::default();
        let (actions, runner) = running(&log);
        handler(&actions, &log, "first");
        handler(&actions, &log, "second");
        let (caller, threads) = (thread::current().id(), Log::default());
        let seen = threads.clone();
        actions.subscribe(move |event| {
            let elsewhere = thread::current().id() != caller;
            record(&seen, format!("{:?}:{elsewhere}", event.activity_key));
        });
        actions.tap(tap("play"), ());
        let stop = ActionEvent {
            activity_key: Some("job:1".into()),
            ..tap("stop")
        };
        actions.clone().tap(stop, ());
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

    // TP-ACTION-2
    #[test]
    fn a_panicking_handler_does_not_stop_delivery() {
        let log = Log::default();
        let (actions, runner) = running(&log);
        actions.subscribe(|event| assert_ne!(event.action_id, "boom", "raised by this test"));
        handler(&actions, &log, "next");
        actions.tap(tap("boom"), ());
        actions.tap(tap("play"), ());
        assert_eq!(
            finish(actions, runner, &log),
            ["next:boom", "emit:boom", "next:play", "emit:play"]
        );
    }

    // TP-ACTION-2
    #[test]
    fn taps_before_the_first_handler_wait_for_it() {
        let log = Log::default();
        let (actions, runner) = running(&log);
        let early = MAX_PENDING + 2;
        let started = Instant::now();
        for index in 0..early {
            actions.tap(tap(&index.to_string()), ());
        }
        // Queuing never waits; without a handler every tap is emitted on arrival.
        assert!(started.elapsed() < Duration::from_secs(1));
        while log.lock().unwrap().len() < early {
            thread::sleep(Duration::from_millis(5));
        }
        handler(&actions, &log, "late");
        actions.tap(tap("live"), ());
        let log = finish(actions, runner, &log);
        // The handler gets the newest waiting taps in order.
        assert_eq!(log.len(), early + MAX_PENDING + 2);
        assert_eq!(log[early - 1], format!("emit:{}", early - 1));
        assert_eq!(log[early], "late:2");
        assert_eq!(log[early + MAX_PENDING - 1], format!("late:{}", early - 1));
        assert_eq!(log[early + MAX_PENDING..], ["late:live", "emit:live"]);
    }

    // TP-ACTION-2, TP-PUSH-6
    #[test]
    fn a_panicking_rust_listener_of_the_event_does_not_stop_the_taps() {
        let log = Log::default();
        let (actions, dispatcher) = channel();
        let sink = log.clone();
        let runner = thread::spawn(move || {
            dispatcher.run(|event| {
                // Tauri runs the app's Rust listeners inline in the emit.
                assert_ne!(event.action_id, "boom", "raised by this test");
                record(&sink, format!("emit:{}", event.action_id));
            });
        });
        handler(&actions, &log, "rust");
        actions.tap(tap("boom"), Release(log.clone(), Instant::now()));
        actions.tap(tap("play"), ());
        assert_eq!(
            finish(actions, runner, &log),
            ["rust:boom", "released after 0 ms", "rust:play", "emit:play"]
        );
    }

    // TP-ACTION-2
    #[test]
    fn a_handler_may_register_another_handler() {
        let log = Log::default();
        let (actions, dispatcher) = channel();
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
        actions.tap(tap("one"), ());
        actions.tap(tap("two"), ());
        assert_eq!(
            finish(actions, runner, &log),
            ["outer:one", "outer:two", "inner:two"]
        );
    }

    /// Records when it is dropped, as activitykit's acknowledgement lets the tap's intent go.
    struct Release(Log, Instant);

    impl Drop for Release {
        fn drop(&mut self) {
            record(
                &self.0,
                format!(
                    "released after {} ms",
                    self.1.elapsed().as_millis() / 1000 * 1000
                ),
            );
        }
    }

    // TP-ACTION-1, TP-ACTION-3
    #[test]
    fn a_tap_from_activitykit_reaches_the_handlers_and_then_the_event_and_is_released_after_them() {
        let log = Log::default();
        let (actions, runner) = running(&log);
        handler(&actions, &log, "rust");
        let started = Instant::now();
        let event = ActionEvent {
            action_id: "pet".into(),
            activity_id: "la-ios-layout-1".into(),
            activity_key: Some("mochi:buttons".into()),
        };
        actions.tap(event.clone(), Release(log.clone(), started));
        // Queuing does not wait: activitykit's events thread goes on reading.
        assert!(started.elapsed() < Duration::from_secs(1));
        assert_eq!(
            finish(actions, runner, &log),
            ["rust:pet", "emit:pet", "released after 0 ms"]
        );
        let spawned = spawn(|_| {}).unwrap();
        spawned.tap(event, ());
    }

    // TP-ACTION-3
    #[test]
    fn a_tap_waits_for_a_rust_handler_that_takes_a_second() {
        let log = Log::default();
        let (actions, runner) = running(&log);
        let slow = log.clone();
        actions.subscribe(move |event| {
            thread::sleep(Duration::from_secs(1));
            record(&slow, format!("slow:{}", event.action_id));
        });
        let started = Instant::now();
        actions.tap(
            ActionEvent {
                action_id: "pet".into(),
                activity_id: "a".into(),
                activity_key: None,
            },
            Release(log.clone(), started),
        );
        let entries = finish(actions, runner, &log);
        assert_eq!(entries, ["slow:pet", "emit:pet", "released after 1000 ms"]);
    }
}
