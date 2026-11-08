//! A kit that answers as activitykit does, in memory: activitykit numbers the revisions (the next write sends the
//! accepted one plus one), an update of an ended activity is `NOT_FOUND`, an end without values ends with the last
//! ones, ending again answers the activity, and a second start under a running key is `CONFLICT` even with the same
//! content, because activitykit's fingerprint of a start covers the content's timestamp.

use super::{Authorization, EndSpec, Handle, Kit, StartSpec, UpdateSpec};
use activitykit::{Error, State, Values};
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone)]
pub(crate) struct Entry {
    pub(crate) id: String,
    pub(crate) key: String,
    pub(crate) state: State,
    pub(crate) values: Values,
    pub(crate) revision: u64,
    pub(crate) stale_at: Option<u64>,
}

#[derive(Default)]
pub(crate) struct Book {
    pub(crate) entries: Vec<Entry>,
    /// Every call, as `start key`, `update id`, `end id`, `list`, `image name`.
    pub(crate) calls: Vec<String>,
    pub(crate) starts: Vec<StartSpec>,
    pub(crate) updates: Vec<UpdateSpec>,
    pub(crate) ends: Vec<EndSpec>,
    /// The answer of the next call instead of its result.
    pub(crate) fail: Option<Error>,
    pub(crate) authorization: Option<Authorization>,
}

#[derive(Clone, Default)]
pub(crate) struct FakeKit(pub(crate) Arc<Mutex<Book>>);

#[derive(Clone)]
pub(crate) struct FakeHandle {
    id: String,
    key: String,
    book: Arc<Mutex<Book>>,
}

impl FakeKit {
    pub(crate) fn book(&self) -> std::sync::MutexGuard<'_, Book> {
        self.0.lock().unwrap()
    }

    pub(crate) fn calls(&self) -> Vec<String> {
        self.book().calls.clone()
    }

    pub(crate) fn fail_next(&self, error: Error) {
        self.book().fail = Some(error);
    }

    /// What the system does: the activity moves to `state`, as an event would tell the handle.
    pub(crate) fn set_state(&self, id: &str, state: State) {
        let mut book = self.book();
        book.entries
            .iter_mut()
            .filter(|entry| entry.id == id)
            .for_each(|entry| entry.state = state);
    }

    /// A kit of a later launch: the same activities, no handles of this launch.
    pub(crate) fn relaunched(&self) -> Self {
        let book = self.book();
        Self(Arc::new(Mutex::new(Book {
            entries: book.entries.clone(),
            ..Book::default()
        })))
    }

    /// The handle that an event would give: activitykit's tap names the activity's key.
    pub(crate) fn handle(&self, id: &str, key: &str) -> FakeHandle {
        FakeHandle {
            id: id.to_owned(),
            key: key.to_owned(),
            book: self.0.clone(),
        }
    }
}

fn take(book: &mut Book, call: String) -> Result<(), Error> {
    book.calls.push(call);
    book.fail.take().map_or(Ok(()), Err)
}

impl Kit for FakeKit {
    type Handle = FakeHandle;

    fn authorization(&self) -> Authorization {
        self.book().authorization.unwrap_or(Authorization {
            supported: true,
            enabled: true,
            buttons: true,
        })
    }

    fn start(
        &self,
        start: StartSpec,
    ) -> impl Future<Output = activitykit::Result<FakeHandle>> + Send {
        let book = self.0.clone();
        async move {
            let mut guard = book.lock().unwrap();
            take(&mut guard, format!("start {}", start.key))?;
            let running = guard.entries.iter().any(|entry| {
                entry.key == start.key
                    && matches!(entry.state, State::Active | State::Stale | State::Pending)
            });
            if running {
                return Err(Error::Conflict(
                    "An activity with this key already exists with different input.".into(),
                ));
            }
            let id = format!("la-ios-layout-{}", guard.entries.len() + 1);
            guard.entries.push(Entry {
                id: id.clone(),
                key: start.key.clone(),
                state: State::Active,
                values: start.values.clone(),
                revision: 0,
                stale_at: start.stale_at,
            });
            let key = start.key.clone();
            guard.starts.push(start);
            drop(guard);
            Ok(FakeHandle { id, key, book })
        }
    }

    fn activities(&self) -> impl Future<Output = activitykit::Result<Vec<FakeHandle>>> + Send {
        let book = self.0.clone();
        async move {
            let mut guard = book.lock().unwrap();
            take(&mut guard, "list".into())?;
            let named: Vec<(String, String)> = guard
                .entries
                .iter()
                .map(|entry| (entry.id.clone(), entry.key.clone()))
                .collect();
            drop(guard);
            Ok(named
                .into_iter()
                .map(|(id, key)| FakeHandle {
                    id,
                    key,
                    book: book.clone(),
                })
                .collect())
        }
    }

    fn write_image(&self, name: &str, _png: &[u8]) -> activitykit::Result<()> {
        take(&mut self.book(), format!("image {name}"))
    }
}

impl FakeHandle {
    fn entry(&self) -> Option<Entry> {
        self.book
            .lock()
            .unwrap()
            .entries
            .iter()
            .find(|entry| entry.id == self.id)
            .cloned()
    }
}

impl Handle for FakeHandle {
    fn id(&self) -> &str {
        &self.id
    }

    fn key(&self) -> &str {
        &self.key
    }

    fn state(&self) -> State {
        self.entry().map_or(State::Unknown, |entry| entry.state)
    }

    fn values(&self) -> Values {
        self.entry().map(|entry| entry.values).unwrap_or_default()
    }

    fn revision(&self) -> Option<u64> {
        self.entry().map(|entry| entry.revision)
    }

    fn stale_at(&self) -> Option<u64> {
        self.entry().and_then(|entry| entry.stale_at)
    }

    fn degraded_features(&self) -> Vec<String> {
        Vec::new()
    }

    fn update(&self, update: UpdateSpec) -> impl Future<Output = activitykit::Result<()>> + Send {
        let (book, id) = (self.book.clone(), self.id.clone());
        async move {
            let mut guard = book.lock().unwrap();
            take(&mut guard, format!("update {id}"))?;
            let entry = guard.entries.iter_mut().find(|entry| {
                entry.id == id && matches!(entry.state, State::Active | State::Stale)
            });
            let Some(entry) = entry else {
                return Err(Error::NotFound(
                    "The activity is no longer available.".into(),
                ));
            };
            entry.revision += 1;
            entry.values = update.values.clone();
            entry.stale_at = update.stale_at;
            guard.updates.push(update);
            Ok(())
        }
    }

    fn end(&self, end: EndSpec) -> impl Future<Output = activitykit::Result<()>> + Send {
        let (book, id) = (self.book.clone(), self.id.clone());
        async move {
            let mut guard = book.lock().unwrap();
            take(&mut guard, format!("end {id}"))?;
            let Some(entry) = guard.entries.iter_mut().find(|entry| entry.id == id) else {
                return Err(Error::NotFound(
                    "The activity is no longer available.".into(),
                ));
            };
            if !matches!(entry.state, State::Ended | State::Dismissed) {
                entry.revision += 1;
                entry.values = end.values.clone().unwrap_or_else(|| entry.values.clone());
                entry.stale_at = end.stale_at;
                entry.state = State::Ended;
            }
            guard.ends.push(end);
            Ok(())
        }
    }
}
