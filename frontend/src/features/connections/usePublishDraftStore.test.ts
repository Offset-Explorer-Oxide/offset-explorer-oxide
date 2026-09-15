import { beforeEach, describe, expect, it } from "vitest";
import { emptyMessage } from "./publishMessages";
import { usePublishDraftStore } from "./usePublishDraftStore";

beforeEach(() => {
  usePublishDraftStore.setState({ messagesByTab: {} });
});

const KEY = "tab-1:conn-1:orders:2";
const OTHER_TOPIC = "tab-1:conn-1:payments:0";
const OTHER_TAB = "tab-2:conn-1:orders:2";
const OTHER_CONNECTION = "tab-1:conn-2:orders:2";

describe("usePublishDraftStore", () => {
  it("holds nothing for a key nobody has typed into", () => {
    expect(usePublishDraftStore.getState().messagesByTab[KEY]).toBeUndefined();
  });

  it("stores a draft under its key", () => {
    const messages = [emptyMessage()];
    usePublishDraftStore.getState().set(KEY, messages);
    expect(usePublishDraftStore.getState().messagesByTab[KEY]).toBe(messages);
  });

  // The key is tab + connection + topic + partition, so composing in one place
  // must not appear in another — a message meant for one partition showing up
  // pre-filled under a different one is exactly the kind of mistake a publish
  // cannot take back.
  it("keeps drafts separate per topic, per tab and per connection", () => {
    const { set } = usePublishDraftStore.getState();
    set(KEY, [{ ...emptyMessage(), value: { encoding: "text", text: "for orders" } }]);

    const state = usePublishDraftStore.getState().messagesByTab;
    expect(state[OTHER_TOPIC]).toBeUndefined();
    expect(state[OTHER_TAB]).toBeUndefined();
    expect(state[OTHER_CONNECTION]).toBeUndefined();
  });

  it("replaces a draft rather than merging into it", () => {
    const { set } = usePublishDraftStore.getState();
    set(KEY, [emptyMessage(), emptyMessage()]);
    set(KEY, [emptyMessage()]);
    expect(usePublishDraftStore.getState().messagesByTab[KEY]).toHaveLength(1);
  });

  describe("reset", () => {
    it("leaves one blank message, so a successful publish cannot be repeated by reflex", () => {
      const { set, reset } = usePublishDraftStore.getState();
      set(KEY, [
        { ...emptyMessage(), value: { encoding: "text", text: "sent" } },
        { ...emptyMessage(), value: { encoding: "text", text: "also sent" } },
      ]);
      reset(KEY);

      const messages = usePublishDraftStore.getState().messagesByTab[KEY];
      expect(messages).toHaveLength(1);
      expect(messages[0].value).toEqual({ encoding: "text", text: "" });
    });

    it("leaves other keys alone", () => {
      const { set, reset } = usePublishDraftStore.getState();
      set(KEY, [emptyMessage()]);
      set(OTHER_TOPIC, [emptyMessage(), emptyMessage()]);
      reset(KEY);
      expect(usePublishDraftStore.getState().messagesByTab[OTHER_TOPIC]).toHaveLength(2);
    });
  });

  describe("clearForConnection", () => {
    it("forgets every draft for that connection, across tabs and topics", () => {
      const { set, clearForConnection } = usePublishDraftStore.getState();
      set(KEY, [emptyMessage()]);
      set(OTHER_TOPIC, [emptyMessage()]);
      set(OTHER_TAB, [emptyMessage()]);
      clearForConnection("conn-1");

      const state = usePublishDraftStore.getState().messagesByTab;
      expect(state[KEY]).toBeUndefined();
      expect(state[OTHER_TOPIC]).toBeUndefined();
      expect(state[OTHER_TAB]).toBeUndefined();
    });

    it("leaves another connection's drafts alone", () => {
      const { set, clearForConnection } = usePublishDraftStore.getState();
      set(KEY, [emptyMessage()]);
      set(OTHER_CONNECTION, [emptyMessage()]);
      clearForConnection("conn-1");

      expect(usePublishDraftStore.getState().messagesByTab[OTHER_CONNECTION]).toHaveLength(1);
    });

    it("is a no-op for a connection with no drafts", () => {
      const { set, clearForConnection } = usePublishDraftStore.getState();
      set(KEY, [emptyMessage()]);
      clearForConnection("conn-never-used");
      expect(usePublishDraftStore.getState().messagesByTab[KEY]).toHaveLength(1);
    });
  });
});
