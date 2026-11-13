//! Android: the thread that hands liveupdate's stored events and the states of the activities to the plugin's sink.
//!
//! Android calls nobody. liveupdate's receivers store taps and dismissals and tell the plugin, and nothing tells
//! anyone that a stale time has come. So the thread drains when it is told that an event was stored, and by itself
//! at the time liveupdate names for the next state that no call brings (`next_check`). A call of the app may change
//! that time, so each one has the thread look at it again.

use liveactivity::liveupdate::NextCheck;
use std::{
    io,
    sync::{Weak, mpsc},
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

/// Why the thread wakes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Wake {
    /// Android stored an event, or the plugin starts: drain.
    Stored,
    /// The app called the plugin, which may have changed what is due and when: look at the time again.
    Called,
}

/// What the thread drains and asks.
pub(crate) trait Source: Send + Sync + 'static {
    /// Hands the sink what is stored and the states that are due. `false` when that failed.
    fn drain(&self) -> bool;
    /// When it is worth draining again without being told; `None` when that cannot be read.
    fn next_check(&self) -> Option<NextCheck>;
}

/// The waits, in turn, for what should be there by now: a post that Android has not shown yet, a state that a drain
/// did not hand over, a stale time that has passed. After the last one the thread waits to be told, so that a
/// drain that keeps failing is not asked for without end.
const SOON: [Duration; 5] = [
    Duration::from_millis(250),
    Duration::from_millis(500),
    Duration::from_secs(1),
    Duration::from_secs(2),
    Duration::from_secs(4),
];

/// How long the thread waits for a wake before it drains by itself; `None` to wait until it is told. `tries` counts
/// the waits of [`SOON`] it has taken in a row.
fn wait(check: Option<NextCheck>, now: u64, tries: &mut usize) -> Option<Duration> {
    match check {
        // The earliest stale time ahead: until then.
        Some(NextCheck::At(time)) if time > now => {
            *tries = 0;
            Some(Duration::from_millis(time - now))
        }
        // A state is due although the thread has just drained, a post is not shown yet, or a stale time has passed
        // and the activity is not stale yet: shortly, a little later each time, and no more after a few.
        Some(NextCheck::Now | NextCheck::Soon | NextCheck::At(_)) => {
            let step = SOON.get(*tries).copied();
            *tries = tries.saturating_add(1);
            step
        }
        Some(NextCheck::Never) | None => {
            *tries = 0;
            None
        }
    }
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |since| {
            u64::try_from(since.as_millis()).unwrap_or(u64::MAX)
        })
}

/// Starts the thread for `source`, which the senders of `woken` wake. It ends at the first wake or wait after
/// `source` is gone, or when nothing can wake it any more.
pub(crate) fn spawn<S: Source>(source: Weak<S>, woken: mpsc::Receiver<Wake>) -> io::Result<()> {
    thread::Builder::new()
        .name("live-activity-events".into())
        .spawn(move || run(&source, &woken, now))
        .map(|_| ())
}

fn run<S: Source>(source: &Weak<S>, woken: &mpsc::Receiver<Wake>, now: impl Fn() -> u64) {
    let mut tries = 0;
    let mut pause: Option<Duration> = None;
    loop {
        let wake = match pause {
            None => match woken.recv() {
                Ok(wake) => Some(wake),
                Err(_) => return,
            },
            Some(pause) => match woken.recv_timeout(pause) {
                Ok(wake) => Some(wake),
                Err(mpsc::RecvTimeoutError::Timeout) => None,
                Err(mpsc::RecvTimeoutError::Disconnected) => return,
            },
        };
        // Its own time has come, or an event was stored: drain. A call of the app alone only changes the time.
        let mut drain = wake != Some(Wake::Called);
        // Wakes that came meanwhile are served by this one turn.
        while let Ok(more) = woken.try_recv() {
            drain |= more == Wake::Stored;
        }
        let Some(source) = source.upgrade() else {
            return;
        };
        // Something happened: the waits for a post begin again.
        if wake.is_some() {
            tries = 0;
        }
        if drain && !source.drain() {
            #[cfg(debug_assertions)]
            eprintln!("live-activity: liveupdate's events could not be drained");
        }
        pause = wait(source.next_check(), now(), &mut tries);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    };

    /// A source that answers `checks` in turn, then `Never`, and says each drain on `drained`. While `failing`, its
    /// drains fail.
    struct Scripted {
        checks: Mutex<Vec<NextCheck>>,
        drained: mpsc::Sender<()>,
        failing: AtomicBool,
    }

    impl Scripted {
        fn then(&self, check: NextCheck) {
            self.checks.lock().unwrap().push(check);
        }
    }

    impl Source for Scripted {
        fn drain(&self) -> bool {
            self.drained.send(()).is_ok() && !self.failing.load(Ordering::SeqCst)
        }

        fn next_check(&self) -> Option<NextCheck> {
            let mut checks = self.checks.lock().unwrap();
            Some(if checks.is_empty() {
                NextCheck::Never
            } else {
                checks.remove(0)
            })
        }
    }

    fn scripted(checks: &[NextCheck]) -> (Arc<Scripted>, mpsc::Receiver<()>) {
        let (drained, drains) = mpsc::channel();
        let source = Scripted {
            checks: Mutex::new(checks.to_vec()),
            drained,
            failing: AtomicBool::new(false),
        };
        (Arc::new(source), drains)
    }

    /// Less than the first of the waits of [`SOON`]: a drain within it was not a wait's.
    const SHORTLY: Duration = Duration::from_millis(120);
    const LONG: Duration = Duration::from_secs(5);

    // TP-ANDROID-15
    #[test]
    fn the_wait_follows_what_liveupdate_says_of_the_next_state() {
        let mut tries = 0;
        // A stale time ahead: until then, however near.
        let ahead = wait(Some(NextCheck::At(61_000)), 1_000, &mut tries);
        assert_eq!(ahead, Some(Duration::from_secs(60)));
        let near = wait(Some(NextCheck::At(1_010)), 1_000, &mut tries);
        assert_eq!(near, Some(Duration::from_millis(10)));
        // Nothing ahead, or nothing that can be read: until the thread is told.
        assert_eq!(wait(Some(NextCheck::Never), 1_000, &mut tries), None);
        assert_eq!(wait(None, 1_000, &mut tries), None);
        // What should be there by now, a post that Android has not shown yet, a state that stays due or a stale
        // time that has passed: a little later each time, and no more after a few, whichever of them it is.
        let due = [NextCheck::Soon, NextCheck::At(900), NextCheck::Now];
        let waits: Vec<_> = (0..SOON.len() + 2)
            .map(|turn| wait(Some(due[turn % due.len()]), 1_000, &mut tries))
            .collect();
        let expected: Vec<_> = SOON.iter().copied().map(Some).chain([None, None]).collect();
        assert_eq!(waits, expected);
        // Another answer begins the waits again.
        assert_eq!(wait(Some(NextCheck::Never), 1_000, &mut tries), None);
        assert_eq!(
            wait(Some(NextCheck::At(1_000)), 1_000, &mut tries),
            Some(SOON[0])
        );
        assert_eq!(
            wait(Some(NextCheck::At(5_000)), 1_000, &mut tries),
            Some(Duration::from_secs(4))
        );
        assert_eq!(wait(Some(NextCheck::Now), 1_000, &mut tries), Some(SOON[0]));
    }

    // TP-ANDROID-15
    #[test]
    fn the_thread_drains_when_told_and_by_itself_when_a_stale_time_comes() {
        let (source, drains) = scripted(&[]);
        let (wake, woken) = mpsc::channel();
        spawn(Arc::downgrade(&source), woken).unwrap();
        // A stored event: one drain, at once. Nothing is ahead: no other until the thread is told.
        wake.send(Wake::Stored).unwrap();
        drains.recv_timeout(SHORTLY).unwrap();
        assert!(drains.recv_timeout(SHORTLY).is_err());
        // A call of the app drains nothing, with nothing ahead.
        wake.send(Wake::Called).unwrap();
        assert!(drains.recv_timeout(SHORTLY).is_err());
        // A call that set a stale time has the thread look at the time: it drains by itself when the time comes,
        // and not before.
        source.then(NextCheck::At(now() + 400));
        wake.send(Wake::Called).unwrap();
        assert!(drains.recv_timeout(SHORTLY).is_err());
        drains.recv_timeout(LONG).unwrap();
        assert!(drains.recv_timeout(SHORTLY).is_err());
        // A drain that fails is tried again after a wait, though nobody tells the thread.
        source.failing.store(true, Ordering::SeqCst);
        source.then(NextCheck::Now);
        let before = std::time::Instant::now();
        wake.send(Wake::Stored).unwrap();
        drains.recv_timeout(SHORTLY).unwrap();
        drains.recv_timeout(LONG).unwrap();
        assert!(before.elapsed() >= SOON[0]);

        // Several wakes that wait together are one drain.
        let (source, drains) = scripted(&[]);
        let (wake, woken) = mpsc::channel();
        for _ in 0..3 {
            wake.send(Wake::Stored).unwrap();
        }
        wake.send(Wake::Called).unwrap();
        let weak = Arc::downgrade(&source);
        let thread = thread::spawn(move || run(&weak, &woken, now));
        drains.recv_timeout(LONG).unwrap();
        assert!(drains.recv_timeout(SHORTLY).is_err());
        // The thread ends when nothing can wake it any more.
        drop(wake);
        thread.join().unwrap();
    }

    // TP-ANDROID-15
    #[test]
    fn the_thread_ends_once_the_plugin_is_gone() {
        let (source, drains) = scripted(&[]);
        let (wake, woken) = mpsc::channel();
        let weak = Arc::downgrade(&source);
        let thread = thread::spawn(move || run(&weak, &woken, now));
        drop(source);
        wake.send(Wake::Stored).unwrap();
        thread.join().unwrap();
        assert!(drains.try_recv().is_err());
    }
}
