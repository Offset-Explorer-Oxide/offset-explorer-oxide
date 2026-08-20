# Consumer Group Lag — Design

**Goal:** Show Kafka consumer group lag (per partition: log-end offset minus committed offset) to the user, fitting into the existing cluster workspace's information architecture rather than introducing a new navigation concept.

**Context:** The tree's "Consumers" category (`ClusterResourceTree` → `ResourceCategory<ConsumerGroupSummary>`) already lists every consumer group via `list_consumer_groups` (`rdkafka::Consumer::fetch_group_list`). Clicking a group currently selects it into `useWorkspaceSelectionStore` (`{ type: "consumerGroup", connectionId, groupId }`) and the middle pane shows a "coming soon" placeholder (`App.tsx`). This spec replaces that placeholder with a real panel.

---

## Backend approach

Lag requires two numbers per partition the group consumes: the **log-end offset** (already computed elsewhere via `fetch_watermarks`) and the group's **committed offset** for that partition. The hard part is knowing *which* partitions a group consumes and who owns each — that comes from decoding the group's member assignment data.

### Steps

1. `fetch_group_list(Some(group_id), timeout)` — already used by `list_consumer_groups`. Returns `GroupInfo` with `state()`, `protocol_type()`, and `members(): &[GroupMemberInfo]`.
2. Filter to `protocol_type() == "consumer"` (excludes Kafka Connect and other non-standard group types this feature doesn't support).
3. For each member, decode `member.assignment()` (raw bytes) using Kafka's `ConsumerProtocolAssignment` wire format:
   ```
   version: i16
   topics: array of {
     name: string (i16-length-prefixed)
     partitions: array of i32
   }
   user_data: bytes (nullable, ignored)
   ```
   This is a small, fixed, well-documented binary layout — implemented by hand (no new crate), consistent with this codebase's existing byte-level rdkafka work (e.g. base64 payload encoding). Produces a `Vec<(topic, partition, client_id, client_host)>` — the partition ownership map, which also directly answers "which consumer owns this partition" for the UI's Consumer column.
4. Build a `TopicPartitionList` from the decoded partitions. Create a throwaway `BaseConsumer` configured with `group.id = <target group>` (**never** `subscribe()`/`poll()` it — that would make it join the group and disturb the real consumers' rebalance; only `committed_offsets()` is called, which sends a plain `OffsetFetch` request to the group coordinator and does not affect group membership).
5. `committed_offsets(tpl, timeout)` → committed offset per partition (or "unset" if the group never committed one).
6. `fetch_watermarks(topic, partition, timeout)` per partition (same call `count_topic_messages`/`list_partitions` already use) → log-end offset.
7. `lag = max(0, log_end_offset - committed_offset)`; `None` if no committed offset exists yet.

This mirrors the technique real Kafka lag tools (Burrow, kafka-lag-exporter) use, and every primitive involved (`fetch_group_list`, `fetch_watermarks`, `committed_offsets`, `BaseConsumer` + `spawn_blocking`) already has precedent elsewhere in `kafkaoxide-kafka`.

### Data types (`kafkaoxide-core`)

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PartitionLag {
    pub topic: String,
    pub partition: i32,
    /// None if the group has never committed an offset for this partition.
    pub current_offset: Option<i64>,
    pub log_end_offset: i64,
    /// None when current_offset is None (nothing to subtract from).
    pub lag: Option<i64>,
    pub client_id: Option<String>,
    pub client_host: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConsumerGroupLag {
    pub state: String,
    pub partitions: Vec<PartitionLag>,
}
```

`client_id`/`client_host` are `None` when assignment decoding fails or the group has no members yet (see Error handling) — the row still shows lag, just without owner attribution.

### KafkaClient trait addition

```rust
async fn fetch_consumer_group_lag(
    &self,
    connection: &Connection,
    group_id: &str,
    password: Option<&str>,
) -> Result<ConsumerGroupLag, AppError>;
```

Testable in this sandbox the same way every other Kafka-reaching method here is: a closed-port error-path test. The assignment-decode byte-parsing logic itself (step 3) should be pulled into a pure function (e.g. `decode_consumer_protocol_assignment(bytes: &[u8]) -> Result<Vec<(String, i32)>, AppError>`) in its own module so it's unit-testable with hand-built byte fixtures, independent of any rdkafka I/O — following the same pattern `messages.rs`'s `partition_limits`/`apply_total_cap` already established for keeping the actually-interesting logic testable without a live broker.

### Tauri command

```rust
#[tauri::command]
pub async fn connection_fetch_consumer_group_lag(
    state: State<'_, AppState>,
    id: String,
    group_id: String,
) -> Result<ConsumerGroupLag, CommandError>
```

Thin wiring, reviewed by hand like every other command in this session (`kafkaoxide-app` still can't build in this sandbox).

---

## UI design

`ConsumerGroupDetailPanel` — same visual family as `ClusterDetailPanel`/`BrokerDetailPanel`/`TopicDetailPanel` (reuses `.cluster-detail-header`, `.topic-detail-table` CSS classes).

```
┌─ billing-service (Stable) ──────────────────────────────────────┐
│                                                                  │
│  Total lag: 4,382 messages                        [ Refresh ]  │
│                                                                  │
│  [ Search topics… ]                                             │
│                                                                  │
│  Topic      Partition  Current   Log End  Lag    Consumer        │
│  orders     0          10,201    10,201   0      c1@10.0.0.5     │
│  orders     1          9,800     15,200   5,400  c1@10.0.0.5     │  ← red
│  payments   0          500       1,300    800    c2@10.0.0.9     │  ← yellow
│  payments   1          200       200      0      c2@10.0.0.9     │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

- **Header:** group id + state (already available from `ConsumerGroupSummary`, but re-fetched fresh as part of `ConsumerGroupLag.state` so it's current at Refresh time, not stale from the tree list).
- **Total lag:** `partitions.iter().filter_map(|p| p.lag).sum()`, computed client-side. Shows "—" if every partition has unknown lag.
- **Refresh button:** nothing fetched on tab open — matches the Topic Properties → Messages pattern. Click calls `connection_fetch_consumer_group_lag`.
- **Search box:** client-side-only filter by topic name, matching the Data tab's grid search bar convention (no backend round-trip).
- **Table:** plain HTML table (`.topic-detail-table`, like Partitions/Config), not AG Grid — small, non-sortable-at-scale dataset per group, consistent with how Partitions/Config already chose a plain table over AG Grid.
- **Color coding:** the Lag cell (and its row) tinted using fixed thresholds — yellow ≥ 1,000, red ≥ 10,000, using new CSS classes alongside the existing `status-dot--green/red` convention rather than introducing a different visual language. No user-facing threshold inputs (fixed defaults per the approved design).
- **Consumer column:** `${client_id}@${client_host}`, or "—" if unknown (decode failed / no member data).

**Inputs:** none required to fetch beyond the implicit group selection (already done via the tree) and the Refresh click. The search box is a local filter, not a fetch parameter.

**Output:** the table above, one row per `(topic, partition)` the group is assigned, plus the total-lag summary line.

---

## Error handling & edge cases

- **Group has no members / not `Stable`** (e.g. `Empty`, `PreparingRebalance`, `Dead`): `partitions` comes back empty. UI shows "This group has no active partition assignment" instead of an empty table.
- **A member's `protocol_type()` isn't `"consumer"`:** that member is skipped entirely (its partitions don't appear) — this feature only supports standard consumer groups, not Kafka Connect groups etc.
- **Assignment decode fails for a member** (malformed/non-standard bytes): that member's partitions are skipped rather than shown with garbage data. If *every* member fails to decode, the command returns an error and the UI shows "Couldn't determine partition assignment for this group" instead of a misleading empty/partial table.
- **A partition has no committed offset yet:** `current_offset`/`lag` are `None`; the row renders "—" in both cells rather than a misleading `0` or a crash.
- **Backend/network failure during Refresh:** same `role="alert"` error-banner pattern already used by `ClusterDetailPanel`/`TopicPropertiesTab`/`DataTab`.

---

## Testing

- **Backend:** `decode_consumer_protocol_assignment` gets real unit tests against hand-built byte fixtures (valid single-topic, multi-topic, multi-partition, and malformed-input cases) — this is the one piece of new logic that doesn't require a live broker to verify correctly, so it should get the most thorough coverage. `fetch_consumer_group_lag` gets the standard closed-port error-path test matching every other `KafkaClient` method.
- **Frontend:** `ConsumerGroupDetailPanel` tested the same way as `ClusterDetailPanel`/`TopicDetailPanel` — mocked `invoke` via `setInvokeHandlers`, asserting: nothing fetched on mount, Refresh triggers the fetch and renders rows, total lag sums correctly, search box filters rows client-side, color-coding classes apply at the right thresholds, and each edge case above (empty assignment, decode failure, missing committed offset) renders its documented fallback text rather than a raw crash or `NaN`.
