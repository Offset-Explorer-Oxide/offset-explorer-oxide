use std::sync::atomic::{AtomicU64, Ordering};

/// How far a fetch has got through the range it is reading.
///
/// A key search reads every message in its date range and keeps only the few
/// that match, so the ordinary signs of progress — rows appearing in the grid,
/// batches being emitted — can stay completely still for minutes while the
/// fetch is working normally. This is what the Data tab's count line reports
/// instead ("3 found — scanned 1,240,000 of 39,800,000"), and what tells the
/// user whether to wait or press Stop.
///
/// Two plain atomics rather than a channel message: the fetch loop touches
/// this once per polled message, on the hot path, and the reader is a timer
/// tick that only ever wants the latest value. `Relaxed` is right for both —
/// neither side orders any other memory by it, and a progress figure one poll
/// out of date is indistinguishable from a fresh one at the 100 ms the UI
/// reads it on.
#[derive(Debug, Default)]
pub struct ScanProgress {
    scanned: AtomicU64,
    total: AtomicU64,
}

impl ScanProgress {
    /// How many messages lie in the range this fetch resolved to — the
    /// denominator, known once the watermarks are in and never changed after.
    pub fn set_total(&self, total: u64) {
        self.total.store(total, Ordering::Relaxed);
    }

    /// How many messages have been examined so far, matching or not.
    pub fn set_scanned(&self, scanned: u64) {
        self.scanned.store(scanned, Ordering::Relaxed);
    }

    /// `(scanned, total)`, read together for one progress line.
    pub fn snapshot(&self) -> (u64, u64) {
        (self.scanned.load(Ordering::Relaxed), self.total.load(Ordering::Relaxed))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_fresh_counter_reports_nothing_scanned() {
        assert_eq!(ScanProgress::default().snapshot(), (0, 0));
    }

    #[test]
    fn scanned_and_total_are_reported_together() {
        let progress = ScanProgress::default();
        progress.set_total(4_000);
        progress.set_scanned(1_250);
        assert_eq!(progress.snapshot(), (1_250, 4_000));
    }

    /// The fetch loop writes while the event-emitting task reads, so the
    /// counter has to be shared behind an `Arc` without a lock.
    #[test]
    fn a_shared_counter_reports_what_another_holder_wrote() {
        let progress = std::sync::Arc::new(ScanProgress::default());
        let writer = std::sync::Arc::clone(&progress);
        writer.set_scanned(7);
        assert_eq!(progress.snapshot().0, 7);
    }
}
