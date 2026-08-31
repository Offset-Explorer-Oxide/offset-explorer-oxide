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
    /// Which connection each registered fetch is reading from, so
    /// disconnecting a cluster can stop the fetches still running against it
    /// — see [`Self::cancel_all_for_connection`]. Separate from `flags`
    /// because a cancel may be recorded for a request id the backend has not
    /// registered yet, and such a fetch has no known connection.
    owners: Mutex<HashMap<String, String>>,
}

impl FetchCancellations {
    /// Registers a new fetch under `request_id`, returning the flag its
    /// poll loop should check on every iteration. Callers must pair this
    /// with [`Self::finish`] once the fetch is done — win, lose, or
    /// cancelled — or its entry leaks for the life of the app.
    /// Deliberately reuses an entry a [`Self::cancel`] already created rather
    /// than overwriting it with a fresh `false`: the request id is generated
    /// by the frontend and can be cancelled before the backend has finished
    /// registering it (see the test), and a fetch that has already been told
    /// to stop must start stopped.
    pub fn begin(&self, request_id: &str) -> Arc<AtomicBool> {
        Arc::clone(
            self.flags
                .lock()
                .unwrap()
                .entry(request_id.to_string())
                .or_insert_with(|| Arc::new(AtomicBool::new(false))),
        )
    }

    /// [`Self::begin`], recording which connection the fetch reads from so
    /// [`Self::cancel_all_for_connection`] can find it later.
    pub fn begin_for_connection(&self, request_id: &str, connection_id: &str) -> Arc<AtomicBool> {
        self.owners
            .lock()
            .unwrap()
            .insert(request_id.to_string(), connection_id.to_string());
        self.begin(request_id)
    }

    /// Signals every fetch currently reading from `connection_id` to stop.
    ///
    /// Disconnecting drops the pooled client so no *new* request can reach the
    /// cluster, but a fetch already inside its poll loop holds its own
    /// consumer and would keep pulling from a cluster the user has just
    /// disconnected from — for as long as its filter takes to satisfy, with
    /// the UI that started it already cleared away. Returns the ids it
    /// cancelled, for logging.
    pub fn cancel_all_for_connection(&self, connection_id: &str) -> Vec<String> {
        let request_ids: Vec<String> = self
            .owners
            .lock()
            .unwrap()
            .iter()
            .filter(|(_, owner)| owner.as_str() == connection_id)
            .map(|(request_id, _)| request_id.clone())
            .collect();
        for request_id in &request_ids {
            self.cancel(request_id);
        }
        request_ids
    }

    /// Signals the named fetch's poll loop to stop at its next check.
    ///
    /// Records the cancellation even when no fetch is registered under this
    /// id yet, so a Stop that beats its own fetch into the backend still
    /// takes effect — `connection_fetch_messages` reads the connection out
    /// of SQLite before it registers, and a cancel arriving in that window
    /// used to be dropped on the floor, leaving a fetch nothing could stop.
    /// The entry is cleared by [`Self::finish`] like any other.
    pub fn cancel(&self, request_id: &str) {
        self.flags
            .lock()
            .unwrap()
            .entry(request_id.to_string())
            .or_insert_with(|| Arc::new(AtomicBool::new(false)))
            .store(true, Ordering::Relaxed);
    }

    /// Forgets a finished fetch's flag, and which connection it belonged to.
    pub fn finish(&self, request_id: &str) {
        self.flags.lock().unwrap().remove(request_id);
        self.owners.lock().unwrap().remove(request_id);
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

    /// The bug this exists for: a Stop click could be silently discarded.
    ///
    /// `connection_fetch_messages` looks the connection up in SQLite before
    /// it registers the fetch here, so there is a real window between the
    /// frontend generating a request id (and being able to cancel it) and
    /// this map knowing that id. A cancel landing in that window used to
    /// find nothing, do nothing, and be forgotten — and the `begin` that
    /// followed handed the poll loop a fresh, un-cancelled flag. The fetch
    /// then ran to completion against the broker with nothing able to stop
    /// it, which is exactly "I pressed Stop and the backend kept fetching".
    ///
    /// Cancellation is therefore recorded whether or not the fetch has
    /// registered yet, and `begin` inherits it.
    #[test]
    fn disconnecting_a_connection_cancels_every_fetch_running_against_it() {
        let cancellations = FetchCancellations::default();
        let mine_a = cancellations.begin_for_connection("req-a", "conn-1");
        let mine_b = cancellations.begin_for_connection("req-b", "conn-1");
        let other = cancellations.begin_for_connection("req-c", "conn-2");

        let cancelled = cancellations.cancel_all_for_connection("conn-1");

        assert!(mine_a.load(Ordering::Relaxed));
        assert!(mine_b.load(Ordering::Relaxed));
        assert!(
            !other.load(Ordering::Relaxed),
            "disconnecting one cluster must not stop another cluster's fetch"
        );
        assert_eq!(cancelled.len(), 2);
    }

    #[test]
    fn a_finished_fetch_is_no_longer_cancellable_by_connection() {
        let cancellations = FetchCancellations::default();
        cancellations.begin_for_connection("req-a", "conn-1");
        cancellations.finish("req-a");

        assert!(cancellations.cancel_all_for_connection("conn-1").is_empty());
    }

    #[test]
    fn cancelling_a_connection_with_no_fetches_is_a_no_op() {
        let cancellations = FetchCancellations::default();
        assert!(cancellations.cancel_all_for_connection("conn-1").is_empty());
    }

    #[test]
    fn a_cancel_that_arrives_before_the_fetch_registers_still_cancels_it() {
        let cancellations = FetchCancellations::default();

        cancellations.cancel("req-1");
        let flag = cancellations.begin("req-1");

        assert!(
            flag.load(Ordering::Relaxed),
            "a fetch registering after its own cancel must start already cancelled"
        );
    }

    #[test]
    fn a_fetch_registering_after_an_unrelated_cancel_is_not_cancelled() {
        let cancellations = FetchCancellations::default();

        cancellations.cancel("some-other-request");
        let flag = cancellations.begin("req-1");

        assert!(!flag.load(Ordering::Relaxed));
    }

    /// Otherwise every cancel that raced a fetch would leave an entry behind
    /// for the life of the app.
    #[test]
    fn finishing_clears_a_cancellation_that_arrived_before_the_fetch_registered() {
        let cancellations = FetchCancellations::default();

        cancellations.cancel("req-1");
        cancellations.begin("req-1");
        cancellations.finish("req-1");

        assert!(!cancellations.begin("req-1").load(Ordering::Relaxed));
        cancellations.finish("req-1");
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
