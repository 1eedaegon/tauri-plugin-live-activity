//! The openings of the app that nobody has taken yet.
//!
//! An event reaches only the listeners there are when it goes out, and the opening that launched the app is reported
//! before its page has loaded. No record holds an opening, as a record holds a state. So each one waits here until
//! it is taken. A page asks for what waits and says how far it has handed the openings to its handlers; only those
//! are let go, so that one which found no handler, or whose page went before it could say so, is still there for the
//! next. The app's Rust takes them outright.

use crate::OpenedEvent;
use serde::Serialize;
use std::{
    collections::VecDeque,
    sync::{Mutex, MutexGuard, PoisonError},
};

/// How many openings wait: the newest.
pub const OPENINGS_KEPT: usize = 16;

/// What a page is answered: the openings that wait, oldest first, and the number of the newest opening kept so far.
/// The openings are numbered in their order from 1, since the plugin started, and those that wait are the last
/// before `through`: so a page knows each one's number, and which it has handed over already.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WaitingOpenings {
    pub openings: Vec<OpenedEvent>,
    pub through: u64,
}

/// The openings that wait.
#[derive(Default)]
pub(crate) struct Openings {
    state: Mutex<State>,
}

#[derive(Default)]
struct State {
    /// Oldest first.
    waiting: VecDeque<OpenedEvent>,
    /// How many openings were kept so far: the number of the newest.
    kept: u64,
}

impl Openings {
    fn state(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Keeps `opening` until it is taken. The oldest goes when more than [`OPENINGS_KEPT`] wait.
    pub(crate) fn keep(&self, opening: OpenedEvent) {
        let mut state = self.state();
        if state.waiting.len() == OPENINGS_KEPT {
            state.waiting.pop_front();
        }
        state.waiting.push_back(opening);
        state.kept += 1;
    }

    /// Hands over what waits, oldest first: each opening is taken once.
    pub(crate) fn take(&self) -> Vec<OpenedEvent> {
        self.state().waiting.drain(..).collect()
    }

    /// Lets go of the openings numbered up to `taken`, which a page has handed to its handlers, and answers those
    /// that still wait. They stay until a page says that it has handed them over too.
    pub(crate) fn waiting(&self, taken: u64) -> WaitingOpenings {
        let mut state = self.state();
        let waiting = state.waiting.len() as u64;
        // The openings that wait are numbered from `kept - waiting + 1` to `kept`.
        let gone = taken.saturating_sub(state.kept - waiting).min(waiting);
        // `gone` is at most the length of the queue.
        state.waiting.drain(..gone as usize);
        WaitingOpenings {
            openings: state.waiting.iter().cloned().collect(),
            through: state.kept,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn opening(activity: usize, action: Option<&str>) -> OpenedEvent {
        OpenedEvent {
            activity_id: format!("la-{activity}"),
            activity_key: Some(format!("job:{activity}")),
            action_id: action.map(str::to_owned),
        }
    }

    // TP-EVENT-3
    #[test]
    fn openings_wait_until_they_are_taken_each_once_and_oldest_first() {
        let openings = Openings::default();
        assert_eq!(openings.take(), []);
        openings.keep(opening(1, None));
        openings.keep(opening(1, Some("link:1")));
        openings.keep(opening(2, None));
        assert_eq!(
            openings.take(),
            [
                opening(1, None),
                opening(1, Some("link:1")),
                opening(2, None)
            ]
        );
        // Taken is taken: the next take has only what came since.
        assert_eq!(openings.take(), []);
        openings.keep(opening(3, None));
        assert_eq!(openings.take(), [opening(3, None)]);
    }

    // TP-EVENT-3
    #[test]
    fn only_the_newest_openings_wait() {
        let openings = Openings::default();
        for activity in 0..OPENINGS_KEPT + 3 {
            openings.keep(opening(activity, None));
        }
        let expected: Vec<_> = (3..OPENINGS_KEPT + 3)
            .map(|activity| opening(activity, None))
            .collect();
        // The numbers go on past the ones that were dropped: the newest is the nineteenth.
        assert_eq!(
            openings.waiting(0),
            WaitingOpenings {
                openings: expected.clone(),
                through: 19
            }
        );
        assert_eq!(openings.take(), expected);
        assert_eq!(OPENINGS_KEPT, 16);
    }

    // TP-EVENT-3
    #[test]
    fn a_page_is_answered_what_waits_and_lets_go_what_it_has_handed_over() {
        let openings = Openings::default();
        let answer = |openings: Vec<OpenedEvent>, through| WaitingOpenings { openings, through };
        assert_eq!(openings.waiting(0), answer(vec![], 0));
        openings.keep(opening(1, None));
        openings.keep(opening(2, None));
        // Asking lets nothing go: a page that went before it handed them over leaves them for the next.
        assert_eq!(
            openings.waiting(0),
            answer(vec![opening(1, None), opening(2, None)], 2)
        );
        assert_eq!(
            openings.waiting(0),
            answer(vec![opening(1, None), opening(2, None)], 2)
        );
        // The page has handed over the first: that one goes.
        assert_eq!(openings.waiting(1), answer(vec![opening(2, None)], 2));
        // One that came meanwhile is answered with the question that lets the second go.
        openings.keep(opening(3, Some("link:1")));
        assert_eq!(
            openings.waiting(2),
            answer(vec![opening(3, Some("link:1"))], 3)
        );
        // A number that was let go before, and one beyond the newest, let go what there is and no more.
        assert_eq!(
            openings.waiting(1),
            answer(vec![opening(3, Some("link:1"))], 3)
        );
        assert_eq!(openings.waiting(u64::MAX), answer(vec![], 3));
        openings.keep(opening(4, None));
        assert_eq!(openings.waiting(3), answer(vec![opening(4, None)], 4));
        // Rust's take and a page's question are of one queue.
        assert_eq!(openings.take(), [opening(4, None)]);
        assert_eq!(openings.waiting(0), answer(vec![], 4));
    }

    // TP-EVENT-3
    #[test]
    fn the_answer_to_a_page_is_the_openings_and_the_number_of_the_newest() {
        let openings = Openings::default();
        openings.keep(opening(1, Some("link:1")));
        assert_eq!(
            serde_json::to_value(openings.waiting(0)).unwrap(),
            serde_json::json!({
                "openings": [{ "activityId": "la-1", "activityKey": "job:1", "actionId": "link:1" }],
                "through": 1
            })
        );
    }
}
