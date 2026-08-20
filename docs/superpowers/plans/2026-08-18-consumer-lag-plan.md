# Consumer Group Lag Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the "Consumer group X — coming soon" placeholder with a real `ConsumerGroupDetailPanel` showing per-partition lag, per `docs/superpowers/specs/2026-08-18-consumer-lag-design.md`.

**Architecture:** New pure byte-decoder for `ConsumerProtocolAssignment` (unit-testable, no rdkafka I/O) → `KafkaClient::fetch_consumer_group_lag` (decode assignment, `committed_offsets`, `fetch_watermarks`) → thin Tauri command → frontend panel matching the existing detail-panel family.

**Tech Stack:** Rust (`kafkaoxide-core`, `kafkaoxide-kafka`, `src-tauri`), React/TypeScript, existing `useConnections`/`useClusterResources` hook patterns.

---

### Task 1: `PartitionLag`/`ConsumerGroupLag` core types

**Files:**
- Modify: `backend/core/src/cluster.rs`
- Modify: `backend/core/src/lib.rs`

- [ ] **Step 1: Add the types with tests**

Add to `backend/core/src/cluster.rs`:

```rust
/// One row in the consumer group lag panel's table.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PartitionLag {
    pub topic: String,
    pub partition: i32,
    /// `None` if the group has never committed an offset for this partition.
    pub current_offset: Option<i64>,
    pub log_end_offset: i64,
    /// `None` when `current_offset` is `None` — nothing to subtract from.
    pub lag: Option<i64>,
    /// `None` when assignment decoding failed or produced no owner for this partition.
    pub client_id: Option<String>,
    pub client_host: Option<String>,
}

/// Full lag snapshot for one consumer group, returned by the "Refresh" button.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConsumerGroupLag {
    pub state: String,
    pub partitions: Vec<PartitionLag>,
}
```

Add tests to the `#[cfg(test)] mod tests` block in the same file:

```rust
#[test]
fn partition_lag_serializes_fields_as_camel_case() {
    let lag = PartitionLag {
        topic: "orders".into(),
        partition: 1,
        current_offset: Some(9_800),
        log_end_offset: 15_200,
        lag: Some(5_400),
        client_id: Some("c1".into()),
        client_host: Some("10.0.0.5".into()),
    };
    let json = serde_json::to_string(&lag).unwrap();
    assert_eq!(
        json,
        r#"{"topic":"orders","partition":1,"currentOffset":9800,"logEndOffset":15200,"lag":5400,"clientId":"c1","clientHost":"10.0.0.5"}"#
    );
}

#[test]
fn partition_lag_serializes_missing_values_as_null() {
    let lag = PartitionLag {
        topic: "orders".into(),
        partition: 1,
        current_offset: None,
        log_end_offset: 100,
        lag: None,
        client_id: None,
        client_host: None,
    };
    let json = serde_json::to_string(&lag).unwrap();
    assert!(json.contains(r#""currentOffset":null"#));
    assert!(json.contains(r#""lag":null"#));
    assert!(json.contains(r#""clientId":null"#));
}

#[test]
fn consumer_group_lag_serializes_fields_as_camel_case() {
    let group_lag = ConsumerGroupLag { state: "Stable".into(), partitions: vec![] };
    let json = serde_json::to_string(&group_lag).unwrap();
    assert_eq!(json, r#"{"state":"Stable","partitions":[]}"#);
}
```

- [ ] **Step 2: Export from `lib.rs`**

In `backend/core/src/lib.rs`, change:
```rust
pub use cluster::{BrokerSummary, ConfigEntry, ConsumerGroupSummary, PartitionSummary, TopicSummary};
```
to:
```rust
pub use cluster::{
    BrokerSummary, ConfigEntry, ConsumerGroupLag, ConsumerGroupSummary, PartitionLag,
    PartitionSummary, TopicSummary,
};
```

- [ ] **Step 3: Run tests**

Run: `cargo test -p kafkaoxide-core`
Expected: 21 passed (18 existing + 3 new), 0 failed.

- [ ] **Step 4: Commit**

```bash
git add backend/core/src/cluster.rs backend/core/src/lib.rs
git commit -m "feat(core): add PartitionLag/ConsumerGroupLag types"
```

---

### Task 2: Pure `ConsumerProtocolAssignment` byte decoder

**Files:**
- Create: `backend/kafka/src/assignment.rs`
- Modify: `backend/kafka/src/lib.rs`

The Kafka embedded consumer protocol's assignment wire format (used by all standard partition assignors — range, round-robin, sticky):
```
Assignment => Version AssignedPartitions UserData
  Version => int16
  AssignedPartitions => Array<Topic>
    Topic => TopicName Array<Partition>
      TopicName => string (int16 length-prefixed UTF-8, non-negative)
      Partition => int32
  UserData => bytes (int32 length-prefixed, nullable — ignored, we stop parsing before it)
```

- [ ] **Step 1: Write the decoder with tests**

Create `backend/kafka/src/assignment.rs`:

```rust
use error_stack::{Result, ResultExt};
use kafkaoxide_core::AppError;

/// Decodes a `GroupMemberInfo::assignment()` byte slice (Kafka's
/// `ConsumerProtocolAssignment` wire format) into the flat list of
/// (topic, partition) pairs this member owns. Only the version + assigned
/// partitions are read; `UserData` is never parsed since nothing here uses
/// it.
pub fn decode_consumer_protocol_assignment(bytes: &[u8]) -> Result<Vec<(String, i32)>, AppError> {
    let mut cursor = Cursor { bytes, pos: 0 };
    let _version = cursor.read_i16()?;
    let topic_count = cursor.read_i32()?;
    if topic_count < 0 {
        return Ok(Vec::new());
    }

    let mut result = Vec::new();
    for _ in 0..topic_count {
        let topic = cursor.read_string()?;
        let partition_count = cursor.read_i32()?;
        if partition_count < 0 {
            continue;
        }
        for _ in 0..partition_count {
            result.push((topic.clone(), cursor.read_i32()?));
        }
    }
    Ok(result)
}

struct Cursor<'a> {
    bytes: &'a [u8],
    pos: usize,
}

impl<'a> Cursor<'a> {
    fn read_i16(&mut self) -> Result<i16, AppError> {
        let slice = self
            .bytes
            .get(self.pos..self.pos + 2)
            .ok_or_else(|| error_stack::Report::new(AppError::Kafka))
            .attach_printable("truncated assignment: expected i16")?;
        self.pos += 2;
        Ok(i16::from_be_bytes([slice[0], slice[1]]))
    }

    fn read_i32(&mut self) -> Result<i32, AppError> {
        let slice = self
            .bytes
            .get(self.pos..self.pos + 4)
            .ok_or_else(|| error_stack::Report::new(AppError::Kafka))
            .attach_printable("truncated assignment: expected i32")?;
        self.pos += 4;
        Ok(i32::from_be_bytes([slice[0], slice[1], slice[2], slice[3]]))
    }

    fn read_string(&mut self) -> Result<String, AppError> {
        let len = self.read_i16()?;
        if len < 0 {
            return Err(error_stack::Report::new(AppError::Kafka))
                .attach_printable("truncated assignment: null topic name");
        }
        let len = len as usize;
        let slice = self
            .bytes
            .get(self.pos..self.pos + len)
            .ok_or_else(|| error_stack::Report::new(AppError::Kafka))
            .attach_printable("truncated assignment: expected topic name bytes")?;
        self.pos += len;
        String::from_utf8(slice.to_vec())
            .change_context(AppError::Kafka)
            .attach_printable("assignment topic name is not valid UTF-8")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn encode_i16(v: i16) -> Vec<u8> {
        v.to_be_bytes().to_vec()
    }
    fn encode_i32(v: i32) -> Vec<u8> {
        v.to_be_bytes().to_vec()
    }
    fn encode_string(s: &str) -> Vec<u8> {
        let mut out = encode_i16(s.len() as i16);
        out.extend_from_slice(s.as_bytes());
        out
    }

    #[test]
    fn decodes_a_single_topic_single_partition_assignment() {
        let mut bytes = encode_i16(0); // version
        bytes.extend(encode_i32(1)); // 1 topic
        bytes.extend(encode_string("orders"));
        bytes.extend(encode_i32(1)); // 1 partition
        bytes.extend(encode_i32(0)); // partition 0

        let result = decode_consumer_protocol_assignment(&bytes).unwrap();
        assert_eq!(result, vec![("orders".to_string(), 0)]);
    }

    #[test]
    fn decodes_a_single_topic_with_multiple_partitions() {
        let mut bytes = encode_i16(0);
        bytes.extend(encode_i32(1));
        bytes.extend(encode_string("orders"));
        bytes.extend(encode_i32(3));
        bytes.extend(encode_i32(0));
        bytes.extend(encode_i32(1));
        bytes.extend(encode_i32(2));

        let result = decode_consumer_protocol_assignment(&bytes).unwrap();
        assert_eq!(
            result,
            vec![
                ("orders".to_string(), 0),
                ("orders".to_string(), 1),
                ("orders".to_string(), 2),
            ]
        );
    }

    #[test]
    fn decodes_multiple_topics() {
        let mut bytes = encode_i16(0);
        bytes.extend(encode_i32(2));
        bytes.extend(encode_string("orders"));
        bytes.extend(encode_i32(1));
        bytes.extend(encode_i32(0));
        bytes.extend(encode_string("payments"));
        bytes.extend(encode_i32(1));
        bytes.extend(encode_i32(5));

        let result = decode_consumer_protocol_assignment(&bytes).unwrap();
        assert_eq!(
            result,
            vec![("orders".to_string(), 0), ("payments".to_string(), 5)]
        );
    }

    #[test]
    fn decodes_zero_topics_to_an_empty_list() {
        let mut bytes = encode_i16(0);
        bytes.extend(encode_i32(0));

        let result = decode_consumer_protocol_assignment(&bytes).unwrap();
        assert_eq!(result, Vec::new());
    }

    #[test]
    fn errors_on_truncated_input() {
        let bytes = encode_i16(0); // version only, missing topic count
        let result = decode_consumer_protocol_assignment(&bytes);
        assert!(result.is_err());
    }

    #[test]
    fn errors_on_a_topic_name_length_that_overruns_the_buffer() {
        let mut bytes = encode_i16(0);
        bytes.extend(encode_i32(1));
        bytes.extend(encode_i16(50)); // claims a 50-byte name
        bytes.extend(b"short"); // but only 5 bytes follow

        let result = decode_consumer_protocol_assignment(&bytes);
        assert!(result.is_err());
    }

    #[test]
    fn ignores_trailing_user_data_bytes() {
        let mut bytes = encode_i16(0);
        bytes.extend(encode_i32(1));
        bytes.extend(encode_string("orders"));
        bytes.extend(encode_i32(1));
        bytes.extend(encode_i32(0));
        bytes.extend(encode_i32(4)); // user_data length prefix
        bytes.extend(b"xyz!"); // user_data bytes (never read)

        let result = decode_consumer_protocol_assignment(&bytes).unwrap();
        assert_eq!(result, vec![("orders".to_string(), 0)]);
    }
}
```

- [ ] **Step 2: Wire into `lib.rs`**

In `backend/kafka/src/lib.rs`, add:
```rust
pub mod assignment;
```
(alongside the existing `pub mod client; pub mod config; pub mod messages; pub mod zookeeper;`)

- [ ] **Step 3: Run tests**

Run: `cargo test -p kafkaoxide-kafka assignment::`
Expected: 7 passed, 0 failed.

- [ ] **Step 4: Commit**

```bash
git add backend/kafka/src/assignment.rs backend/kafka/src/lib.rs
git commit -m "feat(kafka): add ConsumerProtocolAssignment byte decoder"
```

---

### Task 3: `KafkaClient::fetch_consumer_group_lag`

**Files:**
- Modify: `backend/kafka/src/client.rs`

- [ ] **Step 1: Add the trait method + closed-port error test**

Add to the `KafkaClient` trait in `backend/kafka/src/client.rs` (after `describe_topic_config`):

```rust
    /// Backs the consumer group detail panel's "Refresh" button. Decodes
    /// each member's partition assignment (see `crate::assignment`), then
    /// fetches committed offsets (via a throwaway consumer scoped to this
    /// group id — never subscribed/polled, so it cannot join the group or
    /// disturb the real consumers' rebalance) and log-end offsets for
    /// exactly those partitions.
    async fn fetch_consumer_group_lag(
        &self,
        connection: &Connection,
        group_id: &str,
        password: Option<&str>,
    ) -> Result<ConsumerGroupLag, AppError>;
```

Add the import at the top of the file:
```rust
use kafkaoxide_core::{
    AppError, BrokerSummary, ConfigEntry, Connection, ConnectionStatus, ConsumerGroupLag,
    ConsumerGroupSummary, MessageFilter, PartitionLag, PartitionSummary, SaslMechanism,
    SecurityProtocol, TopicMessage, TopicSummary,
};
use crate::assignment::decode_consumer_protocol_assignment;
```
(merge into the existing `use kafkaoxide_core::{...}` and `use crate::{...}` lines rather than duplicating them.)

Add the test (in the `#[cfg(test)] mod tests` block, near the other `_errors_for_a_closed_port` tests):

```rust
    #[tokio::test]
    async fn fetch_consumer_group_lag_errors_for_a_closed_port() {
        let client = RdKafkaClient;
        let result = client
            .fetch_consumer_group_lag(&sample_connection(), "billing-service", None)
            .await;
        assert!(result.is_err());
    }
```

- [ ] **Step 2: Verify it fails to compile (RED)**

Run: `cargo test -p kafkaoxide-kafka fetch_consumer_group_lag`
Expected: compile error — `not all trait items implemented: fetch_consumer_group_lag`.

- [ ] **Step 3: Implement**

Add to the `impl KafkaClient for RdKafkaClient` block, after `describe_topic_config`:

```rust
    async fn fetch_consumer_group_lag(
        &self,
        connection: &Connection,
        group_id: &str,
        password: Option<&str>,
    ) -> Result<ConsumerGroupLag, AppError> {
        let config = client_config(connection, password);
        let group_id = group_id.to_string();
        tokio::task::spawn_blocking(move || {
            let consumer: BaseConsumer = config
                .create()
                .change_context(AppError::Kafka)
                .attach_printable("failed to create kafka consumer")?;
            let groups = consumer
                .fetch_group_list(Some(&group_id), METADATA_TIMEOUT)
                .change_context(AppError::Kafka)
                .attach_printable_lazy(|| format!("failed to fetch group list for {group_id}"))?;
            let group = groups
                .groups()
                .iter()
                .find(|g| g.name() == group_id)
                .ok_or_else(|| error_stack::Report::new(AppError::NotFound))
                .attach_printable_lazy(|| format!("group {group_id} not found"))?;

            let mut owners: std::collections::HashMap<(String, i32), (String, String)> =
                std::collections::HashMap::new();
            let mut decode_failures = 0usize;
            let mut decode_attempts = 0usize;
            for member in group.members() {
                if group.protocol_type() != "consumer" {
                    continue;
                }
                let Some(assignment_bytes) = member.assignment() else { continue };
                decode_attempts += 1;
                match decode_consumer_protocol_assignment(assignment_bytes) {
                    Ok(partitions) => {
                        for (topic, partition) in partitions {
                            owners.insert(
                                (topic, partition),
                                (member.client_id().to_string(), member.client_host().to_string()),
                            );
                        }
                    }
                    Err(_) => decode_failures += 1,
                }
            }

            if decode_attempts > 0 && decode_failures == decode_attempts {
                return Err(error_stack::Report::new(AppError::Kafka))
                    .attach_printable_lazy(|| {
                        format!("could not determine partition assignment for group {group_id}")
                    });
            }

            if owners.is_empty() {
                return Ok(ConsumerGroupLag {
                    state: group.state().to_string(),
                    partitions: Vec::new(),
                });
            }

            let mut tpl = TopicPartitionList::new();
            for (topic, partition) in owners.keys() {
                tpl.add_partition(topic, *partition);
            }

            let group_config = {
                let mut c = client_config(connection, password);
                c.set("group.id", &group_id);
                c
            };
            let group_consumer: BaseConsumer = group_config
                .create()
                .change_context(AppError::Kafka)
                .attach_printable("failed to create group-scoped kafka consumer")?;
            let committed = group_consumer
                .committed_offsets(tpl, METADATA_TIMEOUT)
                .change_context(AppError::Kafka)
                .attach_printable_lazy(|| format!("failed to fetch committed offsets for {group_id}"))?;

            let mut partitions = Vec::new();
            for element in committed.elements() {
                let topic = element.topic().to_string();
                let partition = element.partition();
                let current_offset = element.offset().to_raw().filter(|&o| o >= 0);

                let (_low, high) = consumer
                    .fetch_watermarks(&topic, partition, METADATA_TIMEOUT)
                    .change_context(AppError::Kafka)
                    .attach_printable_lazy(|| {
                        format!("failed to fetch watermarks for {topic}:{partition}")
                    })?;

                let lag = current_offset.map(|current| (high - current).max(0));
                let (client_id, client_host) = owners
                    .get(&(topic.clone(), partition))
                    .cloned()
                    .map(|(id, host)| (Some(id), Some(host)))
                    .unwrap_or((None, None));

                partitions.push(PartitionLag {
                    topic,
                    partition,
                    current_offset,
                    log_end_offset: high,
                    lag,
                    client_id,
                    client_host,
                });
            }

            Ok(ConsumerGroupLag { state: group.state().to_string(), partitions })
        })
        .await
        .change_context(AppError::Kafka)
        .attach_printable("fetch_consumer_group_lag task panicked")?
    }
```

- [ ] **Step 4: Run tests**

Run: `cargo test -p kafkaoxide-kafka`
Expected: 33 passed (25 existing + 7 assignment + 1 new closed-port test — assignment tests already counted separately in Task 2, so this run should show 26 in `client::tests` + the rest), 0 failed. If the exact count differs, confirm 0 failed and that `fetch_consumer_group_lag_errors_for_a_closed_port` is in the list.

- [ ] **Step 5: Commit**

```bash
git add backend/kafka/src/client.rs
git commit -m "feat(kafka): implement fetch_consumer_group_lag"
```

---

### Task 4: Tauri command

**Files:**
- Modify: `src-tauri/src/commands/connections.rs`
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: Add the command**

Add to `src-tauri/src/commands/connections.rs`, after `connection_describe_topic_config`:

```rust
/// Backs the consumer group detail panel's "Refresh" button.
#[tauri::command]
pub async fn connection_fetch_consumer_group_lag(
    state: State<'_, AppState>,
    id: String,
    group_id: String,
) -> Result<kafkaoxide_core::ConsumerGroupLag, CommandError> {
    let connection = kafkaoxide_db::connections::get(&state.pool, &id).await?;
    Ok(state
        .kafka
        .fetch_consumer_group_lag(&connection, &group_id, None)
        .await?)
}
```

- [ ] **Step 2: Register in `main.rs`**

In `src-tauri/src/main.rs`, add after `commands::connections::connection_describe_topic_config,`:
```rust
            commands::connections::connection_fetch_consumer_group_lag,
```

- [ ] **Step 3: Sanity-check the backend workspace still compiles where it can**

Run: `cargo test --workspace --exclude kafkaoxide-app`
Expected: same pass counts as Task 3, 0 failed (this command isn't itself testable in this sandbox — `kafkaoxide-app` can't build here — but the library crates it depends on must still be green).

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands/connections.rs src-tauri/src/main.rs
git commit -m "feat(tauri): wire connection_fetch_consumer_group_lag command"
```

---

### Task 5: Frontend types, API, hook

**Files:**
- Modify: `frontend/src/lib/tauri.ts`
- Modify: `frontend/src/features/connections/useClusterResources.ts`

- [ ] **Step 1: Add types and API call**

In `frontend/src/lib/tauri.ts`, add after `ConfigEntry`:

```typescript
export interface PartitionLag {
  topic: string;
  partition: number;
  currentOffset: number | null;
  logEndOffset: number;
  lag: number | null;
  clientId: string | null;
  clientHost: string | null;
}

export interface ConsumerGroupLag {
  state: string;
  partitions: PartitionLag[];
}
```

Add to the `api` object, after `describeTopicConfig`:
```typescript
  fetchConsumerGroupLag: (id: string, groupId: string) =>
    invoke<ConsumerGroupLag>("connection_fetch_consumer_group_lag", { id, groupId }),
```

- [ ] **Step 2: Add the hook**

In `frontend/src/features/connections/useClusterResources.ts`, add after `useTopicConfig`:

```typescript
/** Backs the consumer group detail panel's "Refresh" button. */
export function useFetchConsumerGroupLag() {
  return useMutation<ConsumerGroupLag, Error, { connectionId: string; groupId: string }>({
    mutationFn: ({ connectionId, groupId }) => api.fetchConsumerGroupLag(connectionId, groupId),
  });
}
```
(add `ConsumerGroupLag` to the existing `import { api, MessageFilter, TopicMessage } from "../../lib/tauri";` line.)

- [ ] **Step 3: Verify the frontend still builds**

Run: `npm run build` (from `frontend/`)
Expected: `tsc` clean (the new exports are unused so far but must still type-check), `vite build` succeeds.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/tauri.ts frontend/src/features/connections/useClusterResources.ts
git commit -m "feat(frontend): add consumer group lag types, API, and hook"
```

---

### Task 6: `ConsumerGroupDetailPanel` component

**Files:**
- Create: `frontend/src/features/connections/ConsumerGroupDetailPanel.tsx`
- Create: `frontend/src/features/connections/ConsumerGroupDetailPanel.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/features/connections/ConsumerGroupDetailPanel.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setInvokeHandlers } from "../../lib/testInvoke";
import { ConsumerGroupDetailPanel } from "./ConsumerGroupDetailPanel";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ConsumerGroupDetailPanel", () => {
  it("shows the group id and does not fetch on mount", () => {
    const fetchLag = vi.fn();
    setInvokeHandlers({ connection_fetch_consumer_group_lag: fetchLag });
    renderWithClient(<ConsumerGroupDetailPanel connectionId="1" groupId="billing-service" />);

    expect(screen.getByText("billing-service")).toBeInTheDocument();
    expect(fetchLag).not.toHaveBeenCalled();
  });

  it("fetches and renders lag rows when Refresh is clicked", async () => {
    setInvokeHandlers({
      connection_fetch_consumer_group_lag: () => ({
        state: "Stable",
        partitions: [
          {
            topic: "orders",
            partition: 1,
            currentOffset: 9800,
            logEndOffset: 15200,
            lag: 5400,
            clientId: "c1",
            clientHost: "10.0.0.5",
          },
        ],
      }),
    });
    const user = userEvent.setup();
    renderWithClient(<ConsumerGroupDetailPanel connectionId="1" groupId="billing-service" />);

    await user.click(screen.getByRole("button", { name: "Refresh" }));

    const rows = await screen.findAllByRole("row");
    const cells = within(rows[1]).getAllByRole("cell").map((c) => c.textContent);
    expect(cells).toEqual(["orders", "1", "9,800", "15,200", "5,400", "c1@10.0.0.5"]);
    expect(screen.getByText("Stable")).toBeInTheDocument();
  });

  it("shows the summed total lag", async () => {
    setInvokeHandlers({
      connection_fetch_consumer_group_lag: () => ({
        state: "Stable",
        partitions: [
          { topic: "orders", partition: 0, currentOffset: 100, logEndOffset: 100, lag: 0, clientId: null, clientHost: null },
          { topic: "orders", partition: 1, currentOffset: 100, logEndOffset: 5500, lag: 5400, clientId: null, clientHost: null },
        ],
      }),
    });
    const user = userEvent.setup();
    renderWithClient(<ConsumerGroupDetailPanel connectionId="1" groupId="billing-service" />);

    await user.click(screen.getByRole("button", { name: "Refresh" }));

    expect(await screen.findByText("Total lag: 5,400 messages")).toBeInTheDocument();
  });

  it("shows an empty-assignment message when the group has no partitions", async () => {
    setInvokeHandlers({
      connection_fetch_consumer_group_lag: () => ({ state: "Empty", partitions: [] }),
    });
    const user = userEvent.setup();
    renderWithClient(<ConsumerGroupDetailPanel connectionId="1" groupId="billing-service" />);

    await user.click(screen.getByRole("button", { name: "Refresh" }));

    expect(await screen.findByText(/no active partition assignment/i)).toBeInTheDocument();
  });

  it("shows an error banner when the fetch fails", async () => {
    setInvokeHandlers({
      connection_fetch_consumer_group_lag: () => {
        throw new Error("Couldn't determine partition assignment for this group");
      },
    });
    const user = userEvent.setup();
    renderWithClient(<ConsumerGroupDetailPanel connectionId="1" groupId="billing-service" />);

    await user.click(screen.getByRole("button", { name: "Refresh" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't determine partition assignment for this group",
    );
  });

  it("shows a dash for unknown current offset and lag", async () => {
    setInvokeHandlers({
      connection_fetch_consumer_group_lag: () => ({
        state: "Stable",
        partitions: [
          { topic: "orders", partition: 2, currentOffset: null, logEndOffset: 100, lag: null, clientId: null, clientHost: null },
        ],
      }),
    });
    const user = userEvent.setup();
    renderWithClient(<ConsumerGroupDetailPanel connectionId="1" groupId="billing-service" />);

    await user.click(screen.getByRole("button", { name: "Refresh" }));

    const rows = await screen.findAllByRole("row");
    const cells = within(rows[1]).getAllByRole("cell").map((c) => c.textContent);
    expect(cells).toEqual(["orders", "2", "—", "100", "—", "—"]);
  });

  it("filters rows by topic name via the search box", async () => {
    setInvokeHandlers({
      connection_fetch_consumer_group_lag: () => ({
        state: "Stable",
        partitions: [
          { topic: "orders", partition: 0, currentOffset: 0, logEndOffset: 0, lag: 0, clientId: null, clientHost: null },
          { topic: "payments", partition: 0, currentOffset: 0, logEndOffset: 0, lag: 0, clientId: null, clientHost: null },
        ],
      }),
    });
    const user = userEvent.setup();
    renderWithClient(<ConsumerGroupDetailPanel connectionId="1" groupId="billing-service" />);
    await user.click(screen.getByRole("button", { name: "Refresh" }));
    await screen.findByText("payments");

    await user.type(screen.getByLabelText("Search topics"), "pay");

    expect(screen.queryByText("orders")).not.toBeInTheDocument();
    expect(screen.getByText("payments")).toBeInTheDocument();
  });

  it("applies a warning class at 1,000+ lag and a critical class at 10,000+ lag", async () => {
    setInvokeHandlers({
      connection_fetch_consumer_group_lag: () => ({
        state: "Stable",
        partitions: [
          { topic: "a", partition: 0, currentOffset: 0, logEndOffset: 1000, lag: 1000, clientId: null, clientHost: null },
          { topic: "b", partition: 0, currentOffset: 0, logEndOffset: 10000, lag: 10000, clientId: null, clientHost: null },
          { topic: "c", partition: 0, currentOffset: 0, logEndOffset: 5, lag: 5, clientId: null, clientHost: null },
        ],
      }),
    });
    const user = userEvent.setup();
    renderWithClient(<ConsumerGroupDetailPanel connectionId="1" groupId="billing-service" />);

    await user.click(screen.getByRole("button", { name: "Refresh" }));

    const rows = await screen.findAllByRole("row");
    expect(rows[1]).toHaveClass("lag-row--warning");
    expect(rows[2]).toHaveClass("lag-row--critical");
    expect(rows[3]).not.toHaveClass("lag-row--warning");
    expect(rows[3]).not.toHaveClass("lag-row--critical");
  });
});
```

- [ ] **Step 2: Verify it fails (RED)**

Run: `npx vitest run src/features/connections/ConsumerGroupDetailPanel.test.tsx` (from `frontend/`)
Expected: fails — module `./ConsumerGroupDetailPanel` does not exist.

- [ ] **Step 3: Implement**

Create `frontend/src/features/connections/ConsumerGroupDetailPanel.tsx`:

```tsx
import { useState } from "react";
import { PartitionLag } from "../../lib/tauri";
import { useFetchConsumerGroupLag } from "./useClusterResources";

export interface ConsumerGroupDetailPanelProps {
  connectionId: string;
  groupId: string;
}

const WARNING_THRESHOLD = 1_000;
const CRITICAL_THRESHOLD = 10_000;

function lagRowClass(lag: number | null): string {
  if (lag === null) return "";
  if (lag >= CRITICAL_THRESHOLD) return "lag-row--critical";
  if (lag >= WARNING_THRESHOLD) return "lag-row--warning";
  return "";
}

function formatNumber(value: number | null): string {
  return value === null ? "—" : value.toLocaleString();
}

function formatOwner(row: PartitionLag): string {
  return row.clientId && row.clientHost ? `${row.clientId}@${row.clientHost}` : "—";
}

export function ConsumerGroupDetailPanel({ connectionId, groupId }: ConsumerGroupDetailPanelProps) {
  const [searchText, setSearchText] = useState("");
  const fetchLag = useFetchConsumerGroupLag();
  const data = fetchLag.data;

  const totalLag = data?.partitions.reduce((sum, p) => sum + (p.lag ?? 0), 0) ?? null;
  const filteredPartitions = data?.partitions.filter((p) =>
    p.topic.toLowerCase().includes(searchText.toLowerCase()),
  );

  return (
    <div className="cluster-detail-panel">
      <header className="cluster-detail-header">
        <h2>
          {groupId}
          {data && <> ({data.state})</>}
        </h2>
      </header>

      <div className="lag-panel-summary">
        <span>{totalLag !== null ? `Total lag: ${totalLag.toLocaleString()} messages` : ""}</span>
        <button
          type="button"
          onClick={() => fetchLag.mutate({ connectionId, groupId })}
          disabled={fetchLag.isPending}
        >
          Refresh
        </button>
      </div>

      {fetchLag.isError && (
        <p role="alert" className="connection-modal-error">
          {fetchLag.error instanceof Error ? fetchLag.error.message : "Failed to fetch lag"}
        </p>
      )}

      {data && data.partitions.length === 0 && (
        <p>This group has no active partition assignment.</p>
      )}

      {data && data.partitions.length > 0 && (
        <>
          <label className="data-tab-search">
            Search topics
            <input value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="Search…" />
          </label>

          <table className="topic-detail-table">
            <thead>
              <tr>
                <th>Topic</th>
                <th>Partition</th>
                <th>Current</th>
                <th>Log End</th>
                <th>Lag</th>
                <th>Consumer</th>
              </tr>
            </thead>
            <tbody>
              {filteredPartitions?.map((row) => (
                <tr key={`${row.topic}-${row.partition}`} className={lagRowClass(row.lag)}>
                  <td>{row.topic}</td>
                  <td>{row.partition}</td>
                  <td>{formatNumber(row.currentOffset)}</td>
                  <td>{formatNumber(row.logEndOffset)}</td>
                  <td>{formatNumber(row.lag)}</td>
                  <td>{formatOwner(row)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/features/connections/ConsumerGroupDetailPanel.test.tsx` (from `frontend/`)
Expected: 8 passed, 0 failed.

- [ ] **Step 5: Add CSS**

Add to `frontend/src/styles/global.css`, near `.data-tab-search`:

```css
.lag-panel-summary {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  font-size: 12px;
}
.lag-panel-summary button {
  padding: 6px 14px;
  border-radius: 4px;
  border: 1px solid var(--color-border);
  background: var(--color-bg-elevated);
  color: var(--color-fg);
  cursor: pointer;
}
.lag-row--warning td {
  background: color-mix(in srgb, var(--color-status-gray) 15%, transparent);
}
.lag-row--critical td {
  background: color-mix(in srgb, var(--color-status-red) 15%, transparent);
  color: var(--color-status-red);
}
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/connections/ConsumerGroupDetailPanel.tsx frontend/src/features/connections/ConsumerGroupDetailPanel.test.tsx frontend/src/styles/global.css
git commit -m "feat(frontend): add ConsumerGroupDetailPanel"
```

---

### Task 7: Wire into `App.tsx`

**Files:**
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Replace the placeholder**

In `frontend/src/App.tsx`, replace:
```tsx
              {selection?.type === "consumerGroup" && (
                <p className="app-main-placeholder">Consumer group "{selection.groupId}" — coming soon.</p>
              )}
```
with:
```tsx
              {selection?.type === "consumerGroup" && (
                <ConsumerGroupDetailPanel connectionId={selection.connectionId} groupId={selection.groupId} />
              )}
```
and add the import near the other detail-panel imports:
```tsx
import { ConsumerGroupDetailPanel } from "./features/connections/ConsumerGroupDetailPanel";
```

- [ ] **Step 2: Run the full frontend suite and build**

Run (from `frontend/`): `npm test`
Expected: all test files pass, including `App.test.tsx` unaffected.

Run (from `frontend/`): `npm run build`
Expected: `tsc` clean, `vite build` succeeds.

- [ ] **Step 3: Run the full backend suite**

Run: `cargo test --workspace --exclude kafkaoxide-app`
Expected: 0 failed.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/App.tsx
git commit -m "feat(frontend): wire ConsumerGroupDetailPanel into the consumer group selection"
```

- [ ] **Step 5: Push**

```bash
git push origin feature/initial-mvp
```

---

## Self-Review

**Spec coverage:** Backend approach (assignment decode → committed_offsets → watermarks) → Task 2+3. Core types → Task 1. Tauri command → Task 4. UI (header+state, total lag, Refresh, search, table, color coding, Consumer column) → Task 6. Error handling (no assignment, decode failure, missing committed offset, fetch error) → Task 6 tests. Wiring into the existing placeholder → Task 7. All spec sections covered.

**Placeholder scan:** No TBD/TODO; every step has literal code or commands.

**Type consistency:** `PartitionLag`/`ConsumerGroupLag` field names match between Rust (`snake_case` source, `camelCase` over the wire) and TypeScript (`camelCase`) throughout Tasks 1, 5, 6. `fetchConsumerGroupLag`/`useFetchConsumerGroupLag` naming consistent between Task 5's hook and Task 6/7's usage.
