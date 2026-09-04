#!/usr/bin/env bash
#
# Fills a local broker with everything `backend/kafka/tests/*` reads.
#
# The existing PowerShell fixture scripts cover the compression and
# large-message topics on Windows; this is the portable equivalent, and it
# also creates the topics `cluster_reads.rs` needs — which the PowerShell
# ones predate.
#
#   docker run -d --name kafka -p 9092:9092 apache/kafka:3.9.0
#   ./scripts/e2e-fixtures.sh
#   KAFKAOXIDE_E2E_BOOTSTRAP=localhost:9092 cargo test -p kafkaoxide-kafka
#
# Every step is idempotent, so re-running it against a broker that already
# has the fixtures is harmless.
set -euo pipefail

CONTAINER="${KAFKA_CONTAINER:-kafka}"
BOOTSTRAP="${KAFKA_BOOTSTRAP:-localhost:9092}"
K="/opt/kafka/bin"

kexec() { docker exec "$CONTAINER" "$@"; }
kexec_i() { docker exec -i "$CONTAINER" "$@"; }

topic() {
  kexec "$K/kafka-topics.sh" --bootstrap-server "$BOOTSTRAP" \
    --create --if-not-exists --topic "$1" --partitions "$2" --replication-factor 1 >/dev/null
}

echo "==> waiting for the broker"
for _ in $(seq 1 60); do
  if kexec "$K/kafka-topics.sh" --bootstrap-server "$BOOTSTRAP" --list >/dev/null 2>&1; then break; fi
  sleep 1
done

# --- compression_codecs.rs -------------------------------------------------
# Produced by Kafka's own Java console producer, so what lands on disk does
# not depend on which codecs the librdkafka build under test supports — that
# independence is the whole point of the test.
echo "==> compression fixtures (c-gzip, c-snappy, c-lz4, c-zstd)"
for codec in gzip snappy lz4 zstd; do
  topic "c-$codec" 1
  seq 1 20 | sed 's/^/msg-/' \
    | kexec_i "$K/kafka-console-producer.sh" --bootstrap-server "$BOOTSTRAP" \
        --topic "c-$codec" --compression-codec "$codec" >/dev/null 2>&1
done

# --- payload_budget.rs / fetch_budget.rs -----------------------------------
# One 512 KB record per line: the console producer splits on newlines, so a
# file of concatenated records with no separator is sent as one oversized
# message and rejected wholesale.
echo "==> large-message fixtures (big-msgs, big-2mb)"
kexec sh -c 'head -c 524288 /dev/zero | tr "\0" x > /tmp/big.txt; echo >> /tmp/big.txt'
topic big-msgs 1
topic big-2mb 3
kexec sh -c "for i in \$(seq 1 20); do cat /tmp/big.txt; done > /tmp/big20.txt"
kexec sh -c "for i in \$(seq 1 30); do cat /tmp/big.txt; done > /tmp/big30.txt"
kexec sh -c "$K/kafka-console-producer.sh --bootstrap-server $BOOTSTRAP --topic big-msgs < /tmp/big20.txt" >/dev/null 2>&1
kexec sh -c "$K/kafka-console-producer.sh --bootstrap-server $BOOTSTRAP --topic big-2mb  < /tmp/big30.txt" >/dev/null 2>&1

# --- fetch_stall.rs --------------------------------------------------------
# Enough messages, over enough partitions, that a fetch of the whole topic
# crosses librdkafka's prefetch-queue threshold many times over — which is
# the only way the one-second-per-crossing stall that test guards against
# becomes visible. A few hundred small messages never reach the threshold at
# all and the test would pass against the bug.
echo "==> stall fixture (perf-probe: 30,000 x 1 KB over 6 partitions)"
topic perf-probe 6
if [ "$(kexec "$K/kafka-get-offsets.sh" --bootstrap-server "$BOOTSTRAP" --topic perf-probe \
        | awk -F: '{ total += $3 } END { print total + 0 }')" -lt 30000 ]; then
  kexec sh -c 'head -c 1000 /dev/zero | tr "\0" x > /tmp/kb.txt; echo >> /tmp/kb.txt'
  kexec sh -c 'rm -f /tmp/perf.txt; for i in $(seq 1 30000); do cat /tmp/kb.txt; done > /tmp/perf.txt'
  kexec sh -c "$K/kafka-console-producer.sh --bootstrap-server $BOOTSTRAP --topic perf-probe \
    --batch-size 65536 < /tmp/perf.txt" >/dev/null 2>&1
fi

# --- fetch_completion.rs ---------------------------------------------------
# A topic whose offsets are NOT all readable messages. Every transaction
# writes a commit marker, which occupies an offset that the broker never
# delivers to a consumer — so `high - low` over-counts what a fetch can
# actually collect, and the newest offset in a partition is typically a
# marker rather than a record.
#
# That gap is the whole point of the fixture: a fetch that decides it is
# finished by counting messages up to `high - low` can never reach that
# number here, and falls back on its idle timeout instead.
echo "==> completion fixture (perf-txn: 10,000 transactional records + commit markers)"
topic perf-txn 6
if [ "$(kexec "$K/kafka-get-offsets.sh" --bootstrap-server "$BOOTSTRAP" --topic perf-txn \
        | awk -F: '{ total += $3 } END { print total + 0 }')" -lt 10000 ]; then
  kexec sh -c 'head -c 1000 /dev/zero | tr "\0" y > /tmp/txn-kb.txt; echo >> /tmp/txn-kb.txt'
  kexec "$K/kafka-producer-perf-test.sh" --topic perf-txn --num-records 10000 \
    --payload-file /tmp/txn-kb.txt --throughput -1 \
    --transactional-id e2e-fixture-txn --transaction-duration-ms 50 \
    --producer-props "bootstrap.servers=$BOOTSTRAP" batch.size=65536 >/dev/null 2>&1
fi

# --- cluster_reads.rs ------------------------------------------------------
echo "==> cluster fixtures (e2e-basic, e2e-headers)"
topic e2e-basic 3
for i in $(seq 1 60); do echo "k$i:value-$i"; done \
  | kexec_i "$K/kafka-console-producer.sh" --bootstrap-server "$BOOTSTRAP" --topic e2e-basic \
      --property parse.key=true --property key.separator=: >/dev/null 2>&1

topic e2e-headers 1
printf 'trace-id:abc123,content-type:application/json\tkey-1:body-1\ntrace-id:def456,content-type:text/plain\tkey-2:body-2\n' \
  | kexec_i "$K/kafka-console-producer.sh" --bootstrap-server "$BOOTSTRAP" --topic e2e-headers \
      --property parse.headers=true --property parse.key=true --property key.separator=: >/dev/null 2>&1

# --- cluster_reads.rs key filter -------------------------------------------
# One key deliberately repeated, because a key filter's contract is "every
# message with this key in the range", not "the first one". Single-partition
# so the expected offsets are stable, and the `dup` records are interleaved
# with others so a filter that ignored the key would return the wrong set.
echo "==> key-filter fixture (e2e-keys)"
topic e2e-keys 1
printf 'dup:v1\nother:x1\ndup:v2\nother:x2\ndup:v3\n' \
  | kexec_i "$K/kafka-console-producer.sh" --bootstrap-server "$BOOTSTRAP" --topic e2e-keys \
      --property parse.key=true --property key.separator=: >/dev/null 2>&1

# --- key_filter_perf.rs ----------------------------------------------------
# 200,000 records, deliberately more than one `INITIAL_SCAN_SLICE` (50,000), so
# a capped key search that stops after its first backwards slice is
# distinguishable from one that read the whole topic. The ten `needle` records
# sit at the very end, which is the case the cap exists to make fast.
#
# Skipped when the topic already holds its records: producing 200,000 of them
# takes a while, and re-running would double the count and break the tests'
# exact `scanned` assertions.
echo "==> key-search perf fixture (perf-keys, 200k records)"
topic perf-keys 1
PERF_COUNT=$(kexec "$K/kafka-get-offsets.sh" --bootstrap-server "$BOOTSTRAP" --topic perf-keys 2>/dev/null \
  | awk -F: '{print $3}' | head -1)
if [ "${PERF_COUNT:-0}" -ne 200000 ]; then
  kexec sh -c 'seq 1 199990 | sed "s/^/filler-:value-/" > /tmp/perfkeys.txt;
    for i in $(seq 1 10); do echo "needle:hit-$i" >> /tmp/perfkeys.txt; done'
  kexec sh -c "$K/kafka-console-producer.sh --bootstrap-server $BOOTSTRAP --topic perf-keys \
    --property parse.key=true --property key.separator=: < /tmp/perfkeys.txt" >/dev/null 2>&1
else
  echo "    perf-keys already holds 200,000 records, skipping"
fi

# Two consumer groups, because the lag path behaves differently for each:
# `e2e-group` is left idle (Kafka reports it `Empty`, members array NULL) and
# `e2e-live` keeps a consumer running so its members carry the partition
# assignments that lag rows are derived from.
echo "==> consumer groups (e2e-group idle, e2e-live with a live member)"
kexec "$K/kafka-console-consumer.sh" --bootstrap-server "$BOOTSTRAP" --topic e2e-basic \
  --group e2e-group --from-beginning --max-messages 30 --timeout-ms 15000 >/dev/null 2>&1 || true

if ! kexec "$K/kafka-consumer-groups.sh" --bootstrap-server "$BOOTSTRAP" --describe --group e2e-live 2>/dev/null \
     | grep -q console-consumer; then
  docker exec -d "$CONTAINER" "$K/kafka-console-consumer.sh" --bootstrap-server "$BOOTSTRAP" \
    --topic e2e-basic --group e2e-live --from-beginning
  # The group only becomes Stable once the member has joined and been assigned.
  sleep 12
fi

echo
echo "==> topics"
kexec "$K/kafka-topics.sh" --bootstrap-server "$BOOTSTRAP" --list
