import { beforeEach, describe, expect, it } from "vitest";
import { emptyFilterForm } from "./dataFilters";
import { useDataTabFiltersStore } from "./useDataTabFiltersStore";

beforeEach(() => {
  useDataTabFiltersStore.setState({ formByTab: {} });
});

describe("useDataTabFiltersStore", () => {
  it("starts with no stored form for any key", () => {
    expect(useDataTabFiltersStore.getState().formByTab["tab-1:1:orders:all"]).toBeUndefined();
  });

  it("stores a form under the given key", () => {
    const form = { ...emptyFilterForm(), maxMessagesPerPartition: "10" };
    useDataTabFiltersStore.getState().setForm("tab-1:1:orders:all", form);

    expect(useDataTabFiltersStore.getState().formByTab["tab-1:1:orders:all"]).toEqual(form);
  });

  it("keeps different keys' forms independent", () => {
    const ordersForm = { ...emptyFilterForm(), maxMessagesPerPartition: "10" };
    const paymentsForm = { ...emptyFilterForm(), offset: "500" };
    useDataTabFiltersStore.getState().setForm("tab-1:1:orders:all", ordersForm);
    useDataTabFiltersStore.getState().setForm("tab-1:1:payments:all", paymentsForm);

    expect(useDataTabFiltersStore.getState().formByTab["tab-1:1:orders:all"]).toEqual(ordersForm);
    expect(useDataTabFiltersStore.getState().formByTab["tab-1:1:payments:all"]).toEqual(paymentsForm);
  });

  it("overwrites a key's previous form", () => {
    useDataTabFiltersStore.getState().setForm("tab-1:1:orders:all", { ...emptyFilterForm(), offset: "1" });
    useDataTabFiltersStore.getState().setForm("tab-1:1:orders:all", { ...emptyFilterForm(), offset: "2" });

    expect(useDataTabFiltersStore.getState().formByTab["tab-1:1:orders:all"].offset).toBe("2");
  });
});
