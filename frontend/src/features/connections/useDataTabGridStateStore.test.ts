import { beforeEach, describe, expect, it } from "vitest";
import { EMPTY_DATA_TAB_GRID_STATE, useDataTabGridStateStore } from "./useDataTabGridStateStore";

beforeEach(() => {
  useDataTabGridStateStore.setState({ stateByTab: {} });
});

describe("useDataTabGridStateStore", () => {
  it("starts a key it has never seen from the empty arrangement", () => {
    expect(useDataTabGridStateStore.getState().stateByTab["tab-1:1:orders:all"]).toBeUndefined();
    expect(EMPTY_DATA_TAB_GRID_STATE).toEqual({ sortModel: [], filterModel: {}, searchText: "" });
  });

  // The three parts of the arrangement are set by three separate places in
  // DataTab (a sort event, a filter event, the search box), so a patch has to
  // leave the parts it doesn't mention alone — otherwise sorting a column
  // silently wiped the search you'd typed.
  it("merges a patch into a key's existing arrangement instead of replacing it", () => {
    const { patchState } = useDataTabGridStateStore.getState();

    patchState("tab-1:1:orders:all", { searchText: "order-42" });
    patchState("tab-1:1:orders:all", { sortModel: [{ colId: "offset", sort: "desc" }] });
    patchState("tab-1:1:orders:all", { filterModel: { partition: { filterType: "number" } } });

    expect(useDataTabGridStateStore.getState().stateByTab["tab-1:1:orders:all"]).toEqual({
      searchText: "order-42",
      sortModel: [{ colId: "offset", sort: "desc" }],
      filterModel: { partition: { filterType: "number" } },
    });
  });

  it("keeps each tab/topic's arrangement separate", () => {
    const { patchState } = useDataTabGridStateStore.getState();

    patchState("tab-1:1:orders:all", { searchText: "order-42" });
    patchState("tab-2:1:orders:all", { searchText: "order-99" });

    expect(useDataTabGridStateStore.getState().stateByTab["tab-1:1:orders:all"]?.searchText).toBe("order-42");
    expect(useDataTabGridStateStore.getState().stateByTab["tab-2:1:orders:all"]?.searchText).toBe("order-99");
  });

  it("hands back the same empty-arrangement object every time, so a selector falling back to it doesn't look like a state change", () => {
    expect(EMPTY_DATA_TAB_GRID_STATE).toBe(EMPTY_DATA_TAB_GRID_STATE);
  });
});
