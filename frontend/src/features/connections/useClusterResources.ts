import { useMutation, useQuery } from "@tanstack/react-query";
import { api, ConsumerGroupLag, MessageFilter, SchemaFormat, TopicMessage } from "../../lib/tauri";

/** Backs the tree's "Brokers" sub-list — fetched lazily, only once the category is expanded. */
export function useBrokers(connectionId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["brokers", connectionId],
    queryFn: () => api.listBrokers(connectionId),
    enabled,
  });
}

/** Backs the tree's "Topics" sub-list — fetched lazily, only once the category is expanded. */
export function useTopics(connectionId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["topics", connectionId],
    queryFn: () => api.listTopics(connectionId),
    enabled,
  });
}

/** Backs the tree's "Consumers" sub-list — fetched lazily, only once the category is expanded. */
export function useConsumerGroups(connectionId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["consumer-groups", connectionId],
    queryFn: () => api.listConsumerGroups(connectionId),
    enabled,
  });
}

/** Backs the topic detail panel's Properties > Messages "Refresh" button. */
export function useCountTopicMessages() {
  return useMutation<number, Error, { connectionId: string; topic: string }>({
    mutationFn: ({ connectionId, topic }) => api.countTopicMessages(connectionId, topic),
  });
}

/** Backs the topic Data tab's Fetch button. `requestId` tags the backend's streamed `"messages-batch"` events so a listener can tell this fetch's rows apart from a superseded one. */
export function useFetchMessages() {
  return useMutation<
    TopicMessage[],
    Error,
    { connectionId: string; topic: string; filter: MessageFilter; requestId: string }
  >({
    mutationFn: ({ connectionId, topic, filter, requestId }) =>
      api.fetchMessages(connectionId, topic, filter, requestId),
  });
}

/** Backs the topic detail panel's Partitions tab, and the sidebar tree's per-topic partition expand. */
export function usePartitions(connectionId: string, topic: string, enabled: boolean = true) {
  return useQuery({
    queryKey: ["partitions", connectionId, topic],
    queryFn: () => api.listPartitions(connectionId, topic),
    enabled,
  });
}

/** Backs the topic detail panel's Config tab. */
export function useTopicConfig(connectionId: string, topic: string) {
  return useQuery({
    queryKey: ["topic-config", connectionId, topic],
    queryFn: () => api.describeTopicConfig(connectionId, topic),
  });
}

/** Backs the consumer group detail panel's "Refresh" button. */
export function useFetchConsumerGroupLag() {
  return useMutation<ConsumerGroupLag, Error, { connectionId: string; groupId: string }>({
    mutationFn: ({ connectionId, groupId }) => api.fetchConsumerGroupLag(connectionId, groupId),
  });
}

/** Backs the topic detail panel's Schema tab. */
export function useTopicSchema(connectionId: string, topic: string, format: SchemaFormat) {
  return useQuery({
    queryKey: ["topic-schema", connectionId, topic, format],
    queryFn: () => api.getTopicSchema(connectionId, topic, format),
  });
}

/** Backs the Schema tab's Save button. */
export function useSetTopicSchema() {
  return useMutation<void, Error, { connectionId: string; topic: string; format: SchemaFormat; schemaText: string }>({
    mutationFn: ({ connectionId, topic, format, schemaText }) =>
      api.setTopicSchema(connectionId, topic, format, schemaText),
  });
}

/** Backs the Schema tab's Clear button. */
export function useDeleteTopicSchema() {
  return useMutation<void, Error, { connectionId: string; topic: string; format: SchemaFormat }>({
    mutationFn: ({ connectionId, topic, format }) => api.deleteTopicSchema(connectionId, topic, format),
  });
}

/** Backs the payload viewer's "Avro" mode button. */
export function useDecodeAvro() {
  return useMutation<unknown, Error, { connectionId: string; topic: string; payloadBase64: string }>({
    mutationFn: ({ connectionId, topic, payloadBase64 }) => api.decodeAvro(connectionId, topic, payloadBase64),
  });
}
