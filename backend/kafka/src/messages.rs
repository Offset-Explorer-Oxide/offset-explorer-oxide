use std::collections::BTreeMap;

use kafkaoxide_core::TopicMessage;

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

/// The Data tab's Key filter as the bytes to compare against, or `None` for
/// "no key filter".
///
/// Trimmed because the field is typed by hand and a trailing space is
/// invisible in the input yet fatal to an exact match; encoded once here
/// rather than per message, since the whole point of an exact byte filter is
/// that testing it against a message costs a single comparison.
pub fn key_filter_bytes(key: &Option<String>) -> Option<Vec<u8>> {
    let trimmed = key.as_deref()?.trim();
    (!trimmed.is_empty()).then(|| trimmed.as_bytes().to_vec())
}

/// Whether a message's key satisfies the fetch's key filter.
///
/// Exact, byte-for-byte: a Kafka key is an arbitrary byte string, so this
/// neither decodes nor case-folds — a binary or Avro-serialized key simply
/// will not match typed text, which is the same thing the Key column already
/// shows by rendering those bytes lossily.
///
/// A message with *no* key never matches a set filter. That is deliberately
/// not `message_key.unwrap_or(&[])`, which would make a keyless message match
/// an empty filter string — a different question from "no filter at all",
/// which is what `wanted: None` means.
pub fn key_matches(message_key: Option<&[u8]>, wanted: Option<&[u8]>) -> bool {
    match wanted {
        None => true,
        Some(wanted) => message_key == Some(wanted),
    }
}

/// The per-partition window `partition_limits` should apply for this fetch.
///
/// A plain browse keeps the cap it has always had (see
/// `effective_max_messages_per_partition` for why `None` is never passed
/// through). A key search must not: its bound is the resolved From/To offset
/// range, and a 100-message window would search only the newest 100 messages
/// of each partition and then report "not found" for a key sitting one
/// message further back. Uncapped here means "the whole range the date filter
/// resolved to", which is finite.
///
/// Takes the cap and the flag rather than the whole `MessageFilter` so this
/// module stays free of the wire types and trivially testable.
pub fn scan_window_per_partition(max_messages_per_partition: Option<u32>, key_filter_set: bool) -> Option<u32> {
    if key_filter_set {
        return None;
    }
    Some(effective_max_messages_per_partition(max_messages_per_partition))
}

/// How many offsets one partition gives up to the first round of a backwards
/// key walk.
///
/// Small enough that a key near the end of the range is found in one cheap
/// round — the common case, and the whole reason the walk exists — and large
/// enough to be a real read rather than a round-trip for a handful of
/// messages. It only ever bounds the *first* round; `next_slice_size` takes
/// over from there.
pub const INITIAL_SCAN_SLICE: i64 = 50_000;

/// One round's window for a partition, walking backwards from `round_end`
/// towards `range_start`, or `None` once the walk has reached the start.
///
/// Windows abut exactly: each round's end is the previous round's start, so no
/// message is skipped (which would lose a match) and none is read twice (which
/// would return a duplicate row). The start is clamped at `range_start`
/// because that boundary is the user's From date, not a suggestion.
pub fn receding_window(range_start: i64, round_end: i64, slice: i64) -> Option<(i64, i64)> {
    if round_end <= range_start {
        return None;
    }
    Some(((round_end.saturating_sub(slice)).max(range_start), round_end))
}

/// The next round's slice: double the last one.
///
/// A round costs a broker round-trip per shard, so the number of rounds is
/// what the user actually waits on. A fixed slice would take 800 rounds to
/// reach 40 million offsets; doubling reaches it in ten, while keeping the
/// first round — the one that answers the common case — small.
///
/// Saturating, because a slice wide enough to overflow would wrap negative and
/// turn `receding_window` into a window that reads forward.
pub fn next_slice_size(previous: i64) -> i64 {
    previous.saturating_mul(2)
}

/// The `cap` newest matches, newest first.
///
/// Sorted by timestamp because that is the only ordering meaningful *across*
/// partitions: an offset is a position within one partition's log and says
/// nothing about another's. Partition and offset break ties so the order is
/// total and the result deterministic.
///
/// A message with no timestamp sorts oldest. A broker can legitimately produce
/// one, and the alternative — treating "unknown" as "now" — would let it
/// displace a real, newer match from the result.
pub fn newest_matches(mut matches: Vec<TopicMessage>, cap: Option<u32>) -> Vec<TopicMessage> {
    matches.sort_by(|a, b| {
        b.timestamp_ms
            .unwrap_or(i64::MIN)
            .cmp(&a.timestamp_ms.unwrap_or(i64::MIN))
            .then(b.partition.cmp(&a.partition))
            .then(b.offset.cmp(&a.offset))
    });
    if let Some(cap) = cap {
        matches.truncate(cap as usize);
    }
    matches
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

/// Splits an overall `max_total_messages` budget across partitions, giving
/// every partition an even share of it rather than draining them in id
/// order. `windows` is how many messages each partition could contribute at
/// most (its "max messages per partition" window, already clamped to what
/// the partition actually holds); the result is how many to actually read
/// from each, and never exceeds the window.
///
/// Why even rather than in order: the budget is meant to buy the newest
/// messages *in the topic*, and a topic's newest messages are spread over
/// all of its partitions. Filling partition 0 to the brim first — which is
/// what this used to do — spends the whole budget on one partition's
/// history and returns nothing at all from the others, so a 12-partition
/// topic showed a single partition's last 100 messages and called it the
/// topic's latest 100.
///
/// Strictly "the newest N by timestamp" is not obtainable here: which
/// partition holds the newest records is only knowable after reading them,
/// and reading them to find out is the over-fetch this exists to prevent.
/// An even split is the closest approximation that reads only what it
/// returns, and partitions holding fewer messages than their share release
/// the rest to the others (so a small budget is never wasted on an empty
/// partition).
///
/// `None` means no overall budget: every partition contributes its full
/// window.
pub fn distribute_total_budget(
    windows: &BTreeMap<i32, i64>,
    max_total: Option<u32>,
) -> BTreeMap<i32, i64> {
    let Some(max_total) = max_total else {
        return windows.clone();
    };

    let mut allocated: BTreeMap<i32, i64> = windows.keys().map(|&partition| (partition, 0)).collect();
    let mut remaining = i64::from(max_total);

    // Smallest window first, so a partition that cannot use its full share
    // hands the surplus to partitions that can, instead of the share being
    // rounded away.
    let mut by_window: Vec<(i32, i64)> =
        windows.iter().map(|(&partition, &window)| (partition, window.max(0))).collect();
    by_window.sort_by_key(|&(partition, window)| (window, partition));

    let mut sharers = by_window.len() as i64;
    for (partition, window) in &by_window {
        if remaining <= 0 {
            break;
        }
        let share = remaining / sharers;
        let take = (*window).min(share);
        allocated.insert(*partition, take);
        remaining -= take;
        sharers -= 1;
    }

    // Integer division leaves up to `partitions - 1` messages unspent. Hand
    // them out one per partition so the fetch delivers the exact budget
    // asked for rather than a few short of it.
    if remaining > 0 {
        for (partition, window) in &by_window {
            if remaining <= 0 {
                break;
            }
            let taken = allocated.get_mut(partition).expect("every partition was seeded above");
            if *taken < *window {
                *taken += 1;
                remaining -= 1;
            }
        }
    }

    allocated
}

/// Combines an explicit start offset with a from-timestamp-resolved start
/// offset into the single start offset that satisfies both simultaneously —
/// the later (higher) of the two, since a valid start point must be at or
/// after the explicit offset AND at or after the timestamp, and offsets are
/// monotonically non-decreasing with timestamp within a partition. `None`
/// means that source wasn't set at all; the result is `None` only when
/// neither was.
/// A fetch's default ceiling on how many payload bytes to read from the
/// broker before stopping, when the caller doesn't set one.
///
/// Every other cap on a fetch counts messages, which on this app's problem
/// topics says nothing about cost: a "1,000 message" browse of 3 MB records
/// is a 3 GB read, and nothing in the filter form hints at that. Half a
/// gigabyte is far more than an interactive browse needs and still bounds
/// the pathological case to something a desktop app can hold and a user is
/// willing to wait for.
pub const DEFAULT_MAX_TOTAL_PAYLOAD_BYTES: u64 = 512 * 1024 * 1024;

/// How much of a payload to actually carry back to the frontend.
///
/// The Data tab's grid draws one line per row and searches only the first
/// few KB of a value, so the rest of a multi-megabyte payload is fetched,
/// base64-encoded, serialized, shipped across the IPC boundary and retained
/// by the webview purely to be ignored. Cutting it here is what keeps a
/// large fetch inside the renderer's memory ceiling — the full bytes are
/// still one click away, fetched for the single message being opened.
///
/// `None` means "the whole payload", which is what that single-message
/// fetch asks for.
pub fn payload_preview_slice(payload: &[u8], max_bytes: Option<u32>) -> &[u8] {
    match max_bytes {
        Some(max) => &payload[..payload.len().min(max as usize)],
        None => payload,
    }
}

/// Whether a fetch that has read `bytes_read` payload bytes should stop.
///
/// Deliberately `>=` and deliberately checked *after* a message has been
/// taken: a budget checked beforehand would drop any record bigger than the
/// remaining allowance, and a single record bigger than the whole budget
/// would make the fetch return nothing at all — which looks like a broken
/// topic rather than a capped read. Taking the message first means the
/// budget always yields at least one row and is overshot by at most one
/// message.
pub fn byte_budget_reached(bytes_read: u64, budget: Option<u64>) -> bool {
    budget.is_some_and(|budget| bytes_read >= budget)
}

/// What a polled message charges against the byte budget.
///
/// The budget bounds what a fetch *keeps*, not what it reads past. With
/// `include_payload` off nothing of the payload survives the poll loop — the
/// row carries partition/offset/timestamp/key and a size, and the bytes are
/// dropped — so such a browse costs the webview nothing to hold and is
/// charged nothing. Charging it capped a metadata-only browse of a
/// multi-megabyte topic at a few hundred rows, and reported that as a size
/// limit against a result containing no payloads at all.
///
/// When payloads *are* kept this is the full payload length rather than the
/// truncated preview's: the preview bound is a per-message cap, and pairing
/// it with a budget charged only for what survived truncation would let an
/// unbounded number of large messages through.
pub fn budgeted_payload_bytes(payload_len: usize, include_payload: bool) -> u64 {
    if include_payload {
        payload_len as u64
    } else {
        0
    }
}

/// The largest number of consumer instances a fetch will spread its
/// partitions across.
///
/// Eight is where the measured return flattens, and it keeps the worst-case
/// prefetch memory below on a scale a desktop can absorb.
pub const MAX_FETCH_SHARDS: usize = 8;

/// The most prefetch buffering a single fetch may cap itself at, across all
/// its shards. Not an allocation — `queued.max.messages.kbytes` is a ceiling
/// librdkafka fills only with data it actually has in flight.
const SHARD_PREFETCH_CEILING_BYTES: u64 = 128 * 1024 * 1024;

/// How many consumer instances to spread a fetch's partitions across.
///
/// One consumer polling every partition serialises two things that do not
/// have to be: the network fetch, and librdkafka's **decompression**, which
/// happens on the broker thread that received the response, before a message
/// is ever queued for the application. A second consumer instance is a second
/// set of those threads, so splitting the partitions across several is what
/// makes either run in parallel — and because the parallelism is librdkafka's
/// own, the application still polls them from a single loop.
///
/// Measured against a real broker, browsing the newest 100 messages, median
/// of five with the previous fetch's teardown left to drain:
///
/// | topic | 1 shard | 8 shards |
/// |-------|---------|----------|
/// | 25 partitions, 2.75 MB gzip records | 659ms | **157ms** |
/// | 25 partitions, 2.75 MB plain records | 188ms | **68ms** |
/// | 24 partitions, 1.2 KB gzip records | 71ms | **31ms** |
/// | 6 partitions, 135 KB gzip records | 56ms | **26ms** |
/// | 6 partitions, 1.2 KB gzip records | 30ms | **18ms** |
/// | 24 partitions, 1.2 KB plain records | 21ms | 22ms |
/// | 6 partitions, 135 KB plain records | 16ms | 20ms |
/// | 6 partitions, 1.2 KB plain records | 11ms | 11ms |
///
/// The gain tracks how much work librdkafka has to do off the wire, so the
/// compressed rows move and the small plain ones do not. Those last rows are
/// what the count has to stay honest about: a fetch already finishing in
/// ~15 ms has nothing to parallelise, and two things had to be true before
/// they came out flat rather than three times worse — the shards are built
/// concurrently, and the poll loop never blocks long on any one of them (see
/// `fetch_messages`). Both were measured regressions before they were fixed.
///
/// Three things bound it.
///
/// A shard cannot be given less than one partition. Each shard carries its own
/// prefetch queue — which has to stay large enough for one maximum-size record
/// (see `fetch_consumer_config`), so on a large-message topic the shards'
/// queues cap the count rather than [`MAX_FETCH_SHARDS`].
///
/// And a shard is not free to *exist*: every consumer instance brings its own
/// set of librdkafka threads, so asking for more shards than the machine has
/// cores stops buying parallel decompression and starts buying contention for
/// the cores that would have done it. On a two-core machine, six shards took
/// five 100-message browses of a 6-partition topic from **41 ms to 1,595 ms**
/// — individual fetches stalling half a second while the threads fought over
/// the cores. That is why `available_parallelism` is a bound and not merely a
/// hint: the failure mode is far worse than the win it would have bought.
pub fn fetch_shard_count(
    partitions_with_work: usize,
    max_message_size_bytes: u32,
    available_parallelism: usize,
) -> usize {
    if partitions_with_work == 0 {
        return 1;
    }
    // Mirrors the queue each shard will be configured with.
    let per_shard_prefetch = (u64::from(max_message_size_bytes) * 2).max(8 * 1024 * 1024);
    let affordable = (SHARD_PREFETCH_CEILING_BYTES / per_shard_prefetch).max(1) as usize;
    partitions_with_work
        .min(MAX_FETCH_SHARDS)
        .min(affordable)
        .min(available_parallelism.max(1))
}


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

    /// The whole point of sharding is a topic wide enough to spread, and the
    /// measured win grows with the fan-out — see the table on the function.
    #[test]
    fn a_wide_topic_is_spread_across_every_shard_available() {
        assert_eq!(fetch_shard_count(50, 1_048_576, 16), MAX_FETCH_SHARDS);
        assert_eq!(fetch_shard_count(24, 1_048_576, 16), MAX_FETCH_SHARDS);
    }

    /// A shard with no partition to read is a consumer, a connection and a
    /// set of librdkafka threads built to poll nothing.
    #[test]
    fn a_narrow_topic_never_builds_more_shards_than_it_has_partitions() {
        for partitions in 1..=MAX_FETCH_SHARDS {
            assert_eq!(
                fetch_shard_count(partitions, 1_048_576, 16),
                partitions,
                "{partitions} partitions should not be split more ways than that"
            );
        }
    }

    /// A fetch that matched nothing still has to build one consumer, not zero.
    #[test]
    fn a_fetch_with_no_work_still_reports_a_usable_shard_count() {
        assert_eq!(fetch_shard_count(0, 1_048_576, 16), 1);
    }

    /// Each shard keeps a prefetch queue big enough for one maximum-size
    /// record, so on a large-message topic the shard count is what decides
    /// the worst-case buffering. Past a point the queues, not the partition
    /// count, are the binding constraint.
    #[test]
    fn a_large_message_topic_trades_shards_away_to_bound_prefetch_memory() {
        let shards = fetch_shard_count(50, 32 * 1_048_576, 16);

        assert!(
            shards < MAX_FETCH_SHARDS,
            "a 32 MB maximum message size gives each shard a 64 MB prefetch queue; \
             {shards} of those is more buffering than a fetch should reserve"
        );
        assert!(shards >= 1, "there is always at least one consumer");
    }

    /// A shard brings its own librdkafka threads, so more of them than the
    /// machine has cores buys contention rather than parallelism. Measured on
    /// two cores, six shards took five small browses from 41 ms to 1,595 ms —
    /// so this bound is load-bearing, not a tidy-up.
    #[test]
    fn a_small_machine_gets_no_more_shards_than_it_has_cores() {
        assert_eq!(fetch_shard_count(50, 1_048_576, 2), 2);
        assert_eq!(fetch_shard_count(50, 1_048_576, 4), 4);
    }

    /// `available_parallelism` can fail, and the caller passes 1 when it does.
    /// One shard is the unsharded path, which must stay reachable.
    #[test]
    fn an_unknown_core_count_falls_back_to_a_single_consumer() {
        assert_eq!(fetch_shard_count(50, 1_048_576, 1), 1);
        assert_eq!(fetch_shard_count(50, 1_048_576, 0), 1);
    }

    /// The ceiling binds on the queue size, never on the number of shards
    /// alone — a topic of ordinary records must not be throttled by a limit
    /// meant for multi-megabyte ones.
    #[test]
    fn an_enormous_maximum_message_size_falls_back_to_a_single_consumer() {
        assert_eq!(fetch_shard_count(50, 200 * 1_048_576, 16), 1);
    }

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
    fn no_total_budget_leaves_every_partition_at_its_full_window() {
        let windows = map(&[(0, 10), (1, 20)]);
        assert_eq!(distribute_total_budget(&windows, None), windows);
    }

    /// The regression this function exists for: the old behaviour filled
    /// partition 0 to its window and left partition 1 with nothing, so a
    /// "newest 100 in this topic" fetch returned one partition's history.
    #[test]
    fn a_total_budget_is_spread_across_partitions_rather_than_drained_in_order() {
        let windows = map(&[(0, 100), (1, 100)]);
        assert_eq!(distribute_total_budget(&windows, Some(100)), map(&[(0, 50), (1, 50)]));
    }

    #[test]
    fn a_partition_with_less_history_than_its_share_releases_the_rest() {
        // p0 can only give 2, so p1 gets the other 8 rather than the budget
        // being rounded down to 5 each and 3 messages going unread.
        let windows = map(&[(0, 2), (1, 100)]);
        assert_eq!(distribute_total_budget(&windows, Some(10)), map(&[(0, 2), (1, 8)]));
    }

    #[test]
    fn an_uneven_budget_is_handed_out_whole_rather_than_left_short() {
        let windows = map(&[(0, 100), (1, 100), (2, 100)]);
        let allocated = distribute_total_budget(&windows, Some(100));
        assert_eq!(allocated.values().sum::<i64>(), 100);
    }

    #[test]
    fn no_partition_is_ever_asked_for_more_than_its_window() {
        let windows = map(&[(0, 3), (1, 4)]);
        assert_eq!(distribute_total_budget(&windows, Some(1000)), map(&[(0, 3), (1, 4)]));
    }

    #[test]
    fn a_budget_smaller_than_the_partition_count_still_reads_something() {
        let windows = map(&[(0, 10), (1, 10), (2, 10)]);
        let allocated = distribute_total_budget(&windows, Some(2));
        assert_eq!(allocated.values().sum::<i64>(), 2);
    }

    #[test]
    fn an_empty_partition_is_allocated_nothing() {
        let windows = map(&[(0, 0), (1, 10)]);
        assert_eq!(distribute_total_budget(&windows, Some(6)), map(&[(0, 0), (1, 6)]));
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

    #[test]
    fn an_unbounded_preview_keeps_the_whole_payload() {
        let payload = b"hello world";
        assert_eq!(payload_preview_slice(payload, None), payload);
    }

    #[test]
    fn a_payload_shorter_than_the_bound_is_kept_whole() {
        let payload = b"hello";
        assert_eq!(payload_preview_slice(payload, Some(4096)), payload);
    }

    #[test]
    fn a_payload_longer_than_the_bound_is_cut_to_it() {
        let payload = vec![b'x'; 10_000];
        assert_eq!(payload_preview_slice(&payload, Some(4096)).len(), 4096);
    }

    #[test]
    fn a_zero_byte_bound_keeps_nothing() {
        let payload = b"hello";
        assert!(payload_preview_slice(payload, Some(0)).is_empty());
    }

    #[test]
    fn no_budget_never_stops_the_fetch() {
        assert!(!byte_budget_reached(u64::MAX, None));
    }

    #[test]
    fn a_fetch_stops_once_it_has_read_its_budget() {
        assert!(!byte_budget_reached(99, Some(100)));
        assert!(byte_budget_reached(100, Some(100)));
        assert!(byte_budget_reached(101, Some(100)));
    }

    /// Checked after a message is taken rather than before, so a single
    /// record larger than the whole budget still comes back instead of the
    /// fetch returning nothing at all and looking broken.
    #[test]
    fn a_single_message_over_the_whole_budget_is_still_returned_before_stopping() {
        let one_huge_message = 500_000_000u64;
        assert!(byte_budget_reached(one_huge_message, Some(1_024)));
    }

    /// A metadata-only browse keeps none of the payload, so it costs the
    /// webview nothing to hold and must not be charged for it — otherwise
    /// browsing a multi-megabyte topic stopped after a few hundred rows on a
    /// size limit, against a result carrying no payloads at all.
    #[test]
    fn a_metadata_only_fetch_is_charged_nothing_for_the_payloads_it_drops() {
        assert_eq!(budgeted_payload_bytes(4 * 1024 * 1024, false), 0);
        assert_eq!(budgeted_payload_bytes(0, false), 0);
    }

    #[test]
    fn a_fetch_that_keeps_payloads_is_charged_for_them() {
        assert_eq!(budgeted_payload_bytes(4 * 1024 * 1024, true), 4 * 1024 * 1024);
        assert_eq!(budgeted_payload_bytes(0, true), 0);
    }

    /// However many messages a metadata-only browse reads, its running total
    /// stays at zero, so `byte_budget_reached` can never end it.
    #[test]
    fn no_number_of_dropped_payloads_ever_reaches_the_budget() {
        let mut bytes_read = 0u64;
        for _ in 0..10_000 {
            bytes_read += budgeted_payload_bytes(8 * 1024 * 1024, false);
        }
        assert_eq!(bytes_read, 0);
        assert!(!byte_budget_reached(bytes_read, Some(1_024)));
    }

    /// The same browse with payloads kept trips the budget almost at once —
    /// the guard is still there, it is just charged to the mode that retains
    /// the bytes.
    #[test]
    fn the_same_fetch_with_payloads_kept_still_stops_on_the_budget() {
        let bytes_read = budgeted_payload_bytes(8 * 1024 * 1024, true);
        assert!(byte_budget_reached(bytes_read, Some(1_024 * 1_024)));
    }

    #[test]
    fn no_key_filter_matches_every_message() {
        assert!(key_matches(Some(b"anything"), None));
        assert!(key_matches(None, None));
    }

    #[test]
    fn a_key_filter_matches_only_the_exact_same_bytes() {
        assert!(key_matches(Some(b"order-123"), Some(b"order-123")));
        assert!(!key_matches(Some(b"order-1234"), Some(b"order-123")));
        // A prefix is not a match: the filter is exact, not "starts with".
        assert!(!key_matches(Some(b"order-123"), Some(b"order-1")));
    }

    /// A keyless message can never satisfy a key filter — it has nothing to
    /// compare. Worth pinning because the tempting `unwrap_or(&[])` would make
    /// a keyless message match an empty-string filter, which is a different
    /// question from "no filter".
    #[test]
    fn a_message_with_no_key_never_matches_a_key_filter() {
        assert!(!key_matches(None, Some(b"order-123")));
        assert!(!key_matches(None, Some(b"")));
    }

    /// Keys are arbitrary byte strings, not text — a non-UTF-8 key must be
    /// comparable without panicking or being lossily decoded first.
    #[test]
    fn binary_keys_are_compared_as_bytes() {
        let key = [0xff_u8, 0x00, 0xfe];
        assert!(key_matches(Some(&key), Some(&key)));
        assert!(!key_matches(Some(&key), Some(&[0xff_u8, 0x00])));
    }

    #[test]
    fn a_blank_key_filter_is_no_filter_at_all() {
        assert_eq!(key_filter_bytes(&None), None);
        assert_eq!(key_filter_bytes(&Some(String::new())), None);
        assert_eq!(key_filter_bytes(&Some("   ".into())), None);
    }

    /// Trimmed, because the field is typed by hand and a trailing space is
    /// invisible in the input but fatal to an exact match.
    #[test]
    fn a_key_filter_is_trimmed_and_utf8_encoded() {
        assert_eq!(key_filter_bytes(&Some("  order-123 ".into())), Some(b"order-123".to_vec()));
        assert_eq!(key_filter_bytes(&Some("kü".into())), Some(vec![b'k', 0xc3, 0xbc]));
    }

    /// With no key filter the fetch is a bounded browse and keeps the cap it
    /// has always had.
    #[test]
    fn without_a_key_filter_the_window_is_the_usual_per_partition_cap() {
        assert_eq!(scan_window_per_partition(Some(25), false), Some(25));
        assert_eq!(scan_window_per_partition(None, false), Some(DEFAULT_MESSAGE_CAP));
    }

    /// With a key filter the date range is the bound, so the per-partition
    /// window must be uncapped — a 100-message window would search only the
    /// newest 100 messages and report "not found" for a key that is there.
    #[test]
    fn a_key_filter_uncaps_the_per_partition_window() {
        assert_eq!(scan_window_per_partition(Some(25), true), None);
        assert_eq!(scan_window_per_partition(None, true), None);
    }


    fn message_at(partition: i32, offset: i64, timestamp_ms: Option<i64>) -> kafkaoxide_core::TopicMessage {
        kafkaoxide_core::TopicMessage {
            partition,
            offset,
            timestamp_ms,
            key_base64: None,
            payload_base64: None,
            payload_size_bytes: None,
            headers: Vec::new(),
        }
    }

    /// The first round reads the newest slice of the range; each later round
    /// abuts the previous one exactly — no gap (which would skip messages) and
    /// no overlap (which would return duplicates).
    #[test]
    fn rounds_walk_backwards_without_gaps_or_overlap() {
        assert_eq!(receding_window(0, 1_000, 400), Some((600, 1_000)));
        assert_eq!(receding_window(0, 600, 400), Some((200, 600)));
    }

    /// A window never reads past the start of the range the date filter
    /// resolved to — that boundary is the user's From.
    #[test]
    fn the_last_round_is_clamped_to_the_range_start() {
        assert_eq!(receding_window(100, 300, 400), Some((100, 300)));
    }

    /// Once the walk has reached the range start there is nothing left to read,
    /// and the caller must stop rather than assign an empty window forever.
    #[test]
    fn an_exhausted_walk_has_no_window_left() {
        assert_eq!(receding_window(100, 100, 400), None);
        assert_eq!(receding_window(100, 50, 400), None);
    }

    /// Doubling, so a key 40M messages back costs about ten rounds instead of
    /// eight hundred. A round is a broker round-trip per shard, so the count is
    /// what the user waits on.
    #[test]
    fn the_slice_doubles_each_round() {
        assert_eq!(next_slice_size(50_000), 100_000);
        assert_eq!(next_slice_size(100_000), 200_000);
    }

    #[test]
    fn ten_doublings_cover_a_forty_million_offset_range() {
        let mut slice = INITIAL_SCAN_SLICE;
        let mut covered = 0i64;
        let mut rounds = 0;
        while covered < 40_000_000 {
            covered += slice;
            slice = next_slice_size(slice);
            rounds += 1;
        }
        assert!(rounds <= 10, "expected at most 10 rounds, took {rounds}");
    }

    /// A slice big enough to overflow would wrap to a negative window and read
    /// the whole partition backwards. Saturating keeps a very deep walk merely
    /// large.
    #[test]
    fn the_slice_never_overflows_into_a_negative_window() {
        assert_eq!(next_slice_size(i64::MAX), i64::MAX);
        assert_eq!(receding_window(0, 1_000, i64::MAX), Some((0, 1_000)));
    }

    /// Offsets are only comparable within a partition, so the sort that decides
    /// which matches are "newest" across a topic has to be by timestamp.
    #[test]
    fn matches_are_ordered_newest_first_across_partitions() {
        let matches = vec![message_at(0, 10, Some(100)), message_at(3, 1, Some(300)), message_at(1, 7, Some(200))];
        let newest = newest_matches(matches, None);
        assert_eq!(newest.iter().map(|m| m.partition).collect::<Vec<_>>(), vec![3, 1, 0]);
    }

    #[test]
    fn only_the_newest_matches_survive_the_cap() {
        let matches = vec![message_at(0, 10, Some(100)), message_at(1, 7, Some(300)), message_at(2, 5, Some(200))];
        let newest = newest_matches(matches, Some(2));
        assert_eq!(newest.iter().map(|m| m.timestamp_ms).collect::<Vec<_>>(), vec![Some(300), Some(200)]);
    }

    #[test]
    fn no_cap_keeps_every_match() {
        let matches = vec![message_at(0, 10, Some(100)), message_at(1, 7, Some(300))];
        assert_eq!(newest_matches(matches, None).len(), 2);
    }

    /// A broker with `log.message.timestamp.type` unset, or a very old record,
    /// can carry no timestamp at all. Such a message sorts oldest rather than
    /// panicking or jumping to the front.
    #[test]
    fn a_message_without_a_timestamp_sorts_oldest() {
        let matches = vec![message_at(0, 10, None), message_at(1, 7, Some(100))];
        let newest = newest_matches(matches, None);
        assert_eq!(newest[0].partition, 1);
    }

    /// Two messages sharing a timestamp — common on a fast producer — must
    /// still come out in a stable, total order rather than an arbitrary one.
    #[test]
    fn matches_with_equal_timestamps_are_ordered_by_partition_then_offset() {
        let matches = vec![message_at(1, 5, Some(100)), message_at(1, 9, Some(100)), message_at(0, 7, Some(100))];
        let newest = newest_matches(matches, None);
        assert_eq!(
            newest.iter().map(|m| (m.partition, m.offset)).collect::<Vec<_>>(),
            vec![(1, 9), (1, 5), (0, 7)]
        );
    }

}
