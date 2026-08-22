use std::collections::BTreeMap;

/// Per-partition message count used whenever the caller hasn't set an
/// explicit "max messages per partition" — see
/// `effective_max_messages_per_partition`'s doc comment for why this must
/// apply regardless of which start-offset-resolution path (unfiltered,
/// explicit offset, or timestamp) produced the fetch's start offsets.
pub const DEFAULT_MESSAGE_CAP: u32 = 100;

/// Resolves the per-partition cap to actually use: the caller's explicit
/// value if given, `DEFAULT_MESSAGE_CAP` otherwise. `partition_limits`
/// itself treats `max_per_partition: None` as "uncapped" (the right
/// behavior for a generic, pure utility), but `fetch_messages` must never
/// actually call it with `None` — a fetch scoped only by an explicit offset
/// or timestamp filter, with no count set, would otherwise try to pull
/// every message from that start point to the end of the partition. The
/// unfiltered ("newest-first") fetch path sidesteps this by picking a start
/// offset near the high watermark in the first place, but an offset/
/// timestamp filter deliberately picks its own start point, so it still
/// needs this same fallback cap applied downstream.
pub fn effective_max_messages_per_partition(max_messages_per_partition: Option<u32>) -> u32 {
    max_messages_per_partition.unwrap_or(DEFAULT_MESSAGE_CAP)
}

/// For each partition, how many messages to pull: `min(available, cap)`,
/// where `available = end_offset - start_offset` (never negative — clamped
/// to 0 for a partition with no messages in range). Pulled out as pure
/// logic (no rdkafka I/O) so the counting math is unit-testable without a
/// live broker, unlike the rest of this module's methods.
pub fn partition_limits(
    start_offsets: &BTreeMap<i32, i64>,
    end_offsets: &BTreeMap<i32, i64>,
    max_per_partition: Option<u32>,
) -> BTreeMap<i32, i64> {
    let cap = max_per_partition.map(i64::from).unwrap_or(i64::MAX);
    start_offsets
        .iter()
        .map(|(&partition, &start)| {
            let end = end_offsets.get(&partition).copied().unwrap_or(start);
            let available = (end - start).max(0);
            (partition, available.min(cap))
        })
        .collect()
}

/// Clamps a caller-provided `offset` into a partition's `[low, high]`
/// watermark range — Kafka rejects an assign at an offset outside that
/// range, so a stale or out-of-range value degrades to the nearest valid
/// boundary instead of erroring the whole fetch.
pub fn clamp_offset(offset: i64, low: i64, high: i64) -> i64 {
    offset.clamp(low, high)
}

/// When no explicit start offset or timestamp filter is given, resolves the
/// per-partition start offset to fetch the newest messages first: `max(low,
/// high - cap)` instead of scanning from the low watermark. Without this, an
/// unfiltered fetch on a large topic has to walk the entire history before
/// reaching anything recent.
pub fn newest_first_start_offset(low: i64, high: i64, cap: i64) -> i64 {
    (high - cap).max(low)
}

/// Applies an overall `max_total_messages` cap across the already
/// per-partition-capped limits, preserving relative partition order and
/// truncating whichever partitions come last once the total is exhausted.
pub fn apply_total_cap(limits: &BTreeMap<i32, i64>, max_total: Option<u32>) -> BTreeMap<i32, i64> {
    let Some(max_total) = max_total else {
        return limits.clone();
    };
    let mut remaining = i64::from(max_total);
    let mut result = BTreeMap::new();
    for (&partition, &limit) in limits {
        if remaining <= 0 {
            break;
        }
        let take = limit.min(remaining);
        result.insert(partition, take);
        remaining -= take;
    }
    result
}

/// Combines an explicit start offset with a from-timestamp-resolved start
/// offset into the single start offset that satisfies both simultaneously —
/// the later (higher) of the two, since a valid start point must be at or
/// after the explicit offset AND at or after the timestamp, and offsets are
/// monotonically non-decreasing with timestamp within a partition. `None`
/// means that source wasn't set at all; the result is `None` only when
/// neither was.
pub fn combined_start_offset(explicit_offset: Option<i64>, from_timestamp_offset: Option<i64>) -> Option<i64> {
    match (explicit_offset, from_timestamp_offset) {
        (Some(a), Some(b)) => Some(a.max(b)),
        (Some(a), None) => Some(a),
        (None, Some(b)) => Some(b),
        (None, None) => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn map(pairs: &[(i32, i64)]) -> BTreeMap<i32, i64> {
        pairs.iter().copied().collect()
    }

    #[test]
    fn limits_to_the_full_range_when_no_cap_is_given() {
        let start = map(&[(0, 100)]);
        let end = map(&[(0, 150)]);
        assert_eq!(partition_limits(&start, &end, None), map(&[(0, 50)]));
    }

    #[test]
    fn caps_at_max_per_partition_when_more_is_available() {
        let start = map(&[(0, 100)]);
        let end = map(&[(0, 1000)]);
        assert_eq!(partition_limits(&start, &end, Some(10)), map(&[(0, 10)]));
    }

    #[test]
    fn does_not_exceed_available_even_if_the_cap_is_higher() {
        let start = map(&[(0, 100)]);
        let end = map(&[(0, 105)]);
        assert_eq!(partition_limits(&start, &end, Some(50)), map(&[(0, 5)]));
    }

    #[test]
    fn clamps_to_zero_for_an_empty_or_inverted_range() {
        let start = map(&[(0, 100)]);
        let end = map(&[(0, 100)]);
        assert_eq!(partition_limits(&start, &end, None), map(&[(0, 0)]));
    }

    #[test]
    fn computes_each_partition_independently() {
        let start = map(&[(0, 0), (1, 50)]);
        let end = map(&[(0, 10), (1, 200)]);
        assert_eq!(partition_limits(&start, &end, Some(20)), map(&[(0, 10), (1, 20)]));
    }

    #[test]
    fn apply_total_cap_is_a_no_op_when_no_max_total_is_given() {
        let limits = map(&[(0, 10), (1, 20)]);
        assert_eq!(apply_total_cap(&limits, None), limits);
    }

    #[test]
    fn apply_total_cap_splits_the_budget_across_partitions_in_order() {
        let limits = map(&[(0, 10), (1, 20)]);
        assert_eq!(apply_total_cap(&limits, Some(15)), map(&[(0, 10), (1, 5)]));
    }

    #[test]
    fn apply_total_cap_drops_later_partitions_once_exhausted() {
        let limits = map(&[(0, 10), (1, 20)]);
        assert_eq!(apply_total_cap(&limits, Some(10)), map(&[(0, 10)]));
    }

    #[test]
    fn clamp_offset_passes_through_a_value_already_in_range() {
        assert_eq!(clamp_offset(50, 0, 100), 50);
    }

    #[test]
    fn clamp_offset_clamps_a_value_below_the_low_watermark() {
        assert_eq!(clamp_offset(-5, 10, 100), 10);
    }

    #[test]
    fn clamp_offset_clamps_a_value_above_the_high_watermark() {
        assert_eq!(clamp_offset(500, 10, 100), 100);
    }

    #[test]
    fn newest_first_start_offset_backs_off_from_the_high_watermark_by_the_cap() {
        assert_eq!(newest_first_start_offset(0, 1000, 100), 900);
    }

    #[test]
    fn newest_first_start_offset_clamps_to_low_when_the_cap_exceeds_available_history() {
        assert_eq!(newest_first_start_offset(950, 1000, 100), 950);
    }

    #[test]
    fn newest_first_start_offset_returns_high_when_cap_is_zero() {
        assert_eq!(newest_first_start_offset(0, 1000, 0), 1000);
    }

    #[test]
    fn effective_max_messages_per_partition_falls_back_to_the_default_cap_when_none_is_given() {
        // Regression test: an offset- or timestamp-filtered fetch with no
        // explicit "max messages per partition" used to pass `None` straight
        // through to `partition_limits`, which treats `None` as "uncapped" —
        // meaning the fetch would try to pull every message from that start
        // point to the end of the partition, however many that is. The
        // unfiltered ("newest-first") fetch path already avoided this by
        // picking a start offset near the high watermark, so it never
        // noticeably hit the uncapped case — an offset filter deliberately
        // picks its own start point instead, so it still needs this same
        // fallback applied downstream, or the identical unbounded-fetch
        // problem resurfaces for it (reported as "the offset filter doesn't
        // seem to work" — in practice, it never finished/returned).
        assert_eq!(effective_max_messages_per_partition(None), DEFAULT_MESSAGE_CAP);
    }

    #[test]
    fn effective_max_messages_per_partition_passes_through_an_explicit_cap() {
        assert_eq!(effective_max_messages_per_partition(Some(50)), 50);
    }

    #[test]
    fn combined_start_offset_uses_the_only_source_given() {
        assert_eq!(combined_start_offset(Some(50), None), Some(50));
        assert_eq!(combined_start_offset(None, Some(80)), Some(80));
    }

    #[test]
    fn combined_start_offset_is_none_when_neither_source_is_given() {
        assert_eq!(combined_start_offset(None, None), None);
    }

    #[test]
    fn combined_start_offset_takes_the_later_of_both_when_both_are_given() {
        // Regression test: an explicit Offset filter used to silently
        // override an accompanying From-date filter (whichever came first in
        // an if/else-if chain won outright, the other was ignored entirely)
        // instead of both applying together. The correct AND semantics is
        // the later (higher) of the two candidate start offsets: any offset
        // at or after that point satisfies "offset >= explicit" AND
        // "timestamp >= from" simultaneously.
        assert_eq!(combined_start_offset(Some(50), Some(80)), Some(80));
        assert_eq!(combined_start_offset(Some(80), Some(50)), Some(80));
    }
}
