import { create } from "zustand";

export const DEFAULT_ZOOKEEPER_TIMEOUT_MS = 10_000;
export const DEFAULT_BROKER_READ_TIMEOUT_MS = 10_000;
export const DEFAULT_MAX_MESSAGE_SIZE_BYTES = 1_048_576;

interface GeneralSettingsState {
  zookeeperTimeoutMs: number;
  brokerReadTimeoutMs: number;
  maxMessageSizeBytes: number;
  setZookeeperTimeoutMs: (ms: number) => void;
  setBrokerReadTimeoutMs: (ms: number) => void;
  setMaxMessageSizeBytes: (bytes: number) => void;
}

const STORAGE_KEY = "kafkaoxide.generalSettings";

interface StoredGeneralSettings {
  zookeeperTimeoutMs: number;
  brokerReadTimeoutMs: number;
  maxMessageSizeBytes: number;
}

const DEFAULTS: StoredGeneralSettings = {
  zookeeperTimeoutMs: DEFAULT_ZOOKEEPER_TIMEOUT_MS,
  brokerReadTimeoutMs: DEFAULT_BROKER_READ_TIMEOUT_MS,
  maxMessageSizeBytes: DEFAULT_MAX_MESSAGE_SIZE_BYTES,
};

export function loadStoredGeneralSettings(): StoredGeneralSettings {
  if (typeof localStorage === "undefined") return DEFAULTS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<StoredGeneralSettings>;
    return {
      zookeeperTimeoutMs: parsed.zookeeperTimeoutMs ?? DEFAULT_ZOOKEEPER_TIMEOUT_MS,
      brokerReadTimeoutMs: parsed.brokerReadTimeoutMs ?? DEFAULT_BROKER_READ_TIMEOUT_MS,
      maxMessageSizeBytes: parsed.maxMessageSizeBytes ?? DEFAULT_MAX_MESSAGE_SIZE_BYTES,
    };
  } catch {
    return DEFAULTS;
  }
}

function persist(patch: Partial<StoredGeneralSettings>) {
  if (typeof localStorage === "undefined") return;
  const current = loadStoredGeneralSettings();
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, ...patch }));
}

/** Positive-integer guard — a timeout or max size of 0/negative would either hang every request or reject it outright. */
function clampPositiveInt(value: number): number {
  const truncated = Math.trunc(value);
  return truncated > 0 ? truncated : 1;
}

const initial = loadStoredGeneralSettings();

export const useGeneralSettingsStore = create<GeneralSettingsState>((set) => ({
  zookeeperTimeoutMs: initial.zookeeperTimeoutMs,
  brokerReadTimeoutMs: initial.brokerReadTimeoutMs,
  maxMessageSizeBytes: initial.maxMessageSizeBytes,
  setZookeeperTimeoutMs: (ms) => {
    const clamped = clampPositiveInt(ms);
    persist({ zookeeperTimeoutMs: clamped });
    set({ zookeeperTimeoutMs: clamped });
  },
  setBrokerReadTimeoutMs: (ms) => {
    const clamped = clampPositiveInt(ms);
    persist({ brokerReadTimeoutMs: clamped });
    set({ brokerReadTimeoutMs: clamped });
  },
  setMaxMessageSizeBytes: (bytes) => {
    const clamped = clampPositiveInt(bytes);
    persist({ maxMessageSizeBytes: clamped });
    set({ maxMessageSizeBytes: clamped });
  },
}));
