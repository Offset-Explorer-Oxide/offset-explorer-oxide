import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ICellRendererParams } from "ag-grid-community";
import { TopicMessage } from "../../lib/tauri";
import { ValueCell, ValueCellContext } from "./ValueCell";

function sampleRow(overrides: Partial<TopicMessage> = {}): TopicMessage {
  return { partition: 0, offset: 5, timestampMs: null, keyBase64: null, payloadBase64: null, headers: [], ...overrides };
}

function renderCell(data: TopicMessage | undefined, fetchPayload: ValueCellContext["fetchPayload"]) {
  const params = { data, context: { fetchPayload } } as unknown as ICellRendererParams<TopicMessage> & {
    context: ValueCellContext;
  };
  return render(<ValueCell {...params} />);
}

describe("ValueCell", () => {
  it("shows the decoded payload text when payloadBase64 is present", () => {
    renderCell(sampleRow({ payloadBase64: btoa('{"a":1}') }), vi.fn());
    expect(screen.getByText('{"a":1}')).toBeInTheDocument();
  });

  it("shows a Fetch payload button when payloadBase64 is null", () => {
    renderCell(sampleRow(), vi.fn());
    expect(screen.getByRole("button", { name: "Fetch payload" })).toBeInTheDocument();
  });

  it("calls context.fetchPayload with the row when the button is clicked", async () => {
    const fetchPayload = vi.fn().mockResolvedValue(undefined);
    const row = sampleRow({ partition: 2, offset: 9 });
    const user = userEvent.setup();
    renderCell(row, fetchPayload);

    await user.click(screen.getByRole("button", { name: "Fetch payload" }));

    expect(fetchPayload).toHaveBeenCalledWith(row);
  });

  it("shows a disabled 'Fetching…' state while the fetch is pending", async () => {
    let resolveFetch: () => void = () => {};
    const fetchPayload = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    const user = userEvent.setup();
    renderCell(sampleRow(), fetchPayload);

    await user.click(screen.getByRole("button", { name: "Fetch payload" }));

    expect(screen.getByRole("button", { name: "Fetching…" })).toBeDisabled();
    resolveFetch();
  });

  it("renders nothing when the row has no data", () => {
    const { container } = renderCell(undefined, vi.fn());
    expect(container).toBeEmptyDOMElement();
  });
});
