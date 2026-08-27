use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

/// Lets a Stop click (or a topic switch — see the Data tab) interrupt a
/// message fetch that's already running in `fetch_messages`'s blocking poll
/// loop, instead of only hiding its result once it eventually finishes.
///
/// The loop already polls in half-second slices (`POLL_TIMEOUT`) to bound
/// how long a fetch can hang waiting for the broker, so checking a flag once
/// per slice adds real cancellation for the cost of one atomic load —
/// cancelling stops the broker round trips too, not just the UI update.
///
/// Keyed by the frontend-generated `request_id` used elsewhere to tell one
/// fetch's messages apart from another's, since a Data tab can only ever
/// have one fetch in flight at a time but the backend serves every tab's
/// requests through the same command.
#[derive(Default)]
pub struct FetchCancellations {
    flags: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl FetchCancellations {
    /// Registers a new fetch under `request_id`, returning the flag its
    /// poll loop should check on every iteration. Callers must pair this
    /// with [`Self::finish`] once the fetch is done — win, lose, or
    /// cancelled — or its entry leaks for the life of the app.
    pub fn begin(&self, request_id: &str) -> Arc<AtomicBool> {
        let flag = Arc::new(AtomicBool::new(false));
        self.flags.lock().unwrap().insert(request_id.to_string(), Arc::clone(&flag));
        flag
    }

    /// Signals the named fetch's poll loop to stop at its next check. A
    /// no-op if the fetch already finished (or was never registered) —
    /// Stop racing the fetch's own completion is the ordinary case, not an
    /// error.
    pub fn cancel(&self, request_id: &str) {
        if let Some(flag) = self.flags.lock().unwrap().get(request_id) {
            flag.store(true, Ordering::Relaxed);
        }
    }

    /// Forgets a finished fetch's flag.
    pub fn finish(&self, request_id: &str) {
        self.flags.lock().unwrap().remove(request_id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_freshly_registered_fetch_is_not_cancelled() {
        let cancellations = FetchCancellations::default();
        let flag = cancellations.begin("req-1");
        assert!(!flag.load(Ordering::Relaxed));
    }

    #[test]
    fn cancelling_a_registered_fetch_sets_its_flag() {
        let cancellations = FetchCancellations::default();
        let flag = cancellations.begin("req-1");
        cancellations.cancel("req-1");
        assert!(flag.load(Ordering::Relaxed));
    }

    #[test]
    fn cancelling_an_unknown_request_id_is_a_no_op() {
        // Stop can race a fetch that already finished and was `finish`ed,
        // or one that never existed (a stale button click) — neither should
        // panic or affect anything else.
        let cancellations = FetchCancellations::default();
        cancellations.cancel("no-such-request");
    }

    #[test]
    fn finishing_a_fetch_removes_its_flag_so_a_later_cancel_is_a_no_op() {
        let cancellations = FetchCancellations::default();
        let flag = cancellations.begin("req-1");
        cancellations.finish("req-1");
        cancellations.cancel("req-1");
        assert!(!flag.load(Ordering::Relaxed));
    }

    #[test]
    fn tracks_multiple_fetches_independently() {
        let cancellations = FetchCancellations::default();
        let flag1 = cancellations.begin("req-1");
        let flag2 = cancellations.begin("req-2");
        cancellations.cancel("req-1");

        assert!(flag1.load(Ordering::Relaxed));
        assert!(!flag2.load(Ordering::Relaxed));
    }

    #[test]
    fn a_second_fetch_reusing_the_same_request_id_after_finish_starts_uncancelled() {
        let cancellations = FetchCancellations::default();
        let first = cancellations.begin("req-1");
        cancellations.cancel("req-1");
        cancellations.finish("req-1");

        let second = cancellations.begin("req-1");
        assert!(first.load(Ordering::Relaxed));
        assert!(!second.load(Ordering::Relaxed));
    }
}
