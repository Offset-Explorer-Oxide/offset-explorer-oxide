import { ReactNode } from "react";
import { useResizablePanes } from "./useResizablePanes";

/** Where the payload pane sits: beside the middle pane, or docked under it. */
export type RightPanePlacement = "right" | "bottom";

export interface ResizableShellProps {
  left?: ReactNode;
  /** Keeps `left` mounted (preserving its internal state, e.g. an expanded tree) but visually hidden, instead of unmounting it. */
  leftHidden?: boolean;
  middle: ReactNode;
  right?: ReactNode;
  /**
   * `"right"` (the default) puts `right` in a column beside `middle`;
   * `"bottom"` docks it full-width underneath, handing `middle` the width the
   * column was taking. Each placement keeps its own persisted size — see
   * `StoredWidths.bottom`.
   */
  rightPlacement?: RightPanePlacement;
  /** Overridable for tests; defaults to a single shared app-wide layout. */
  storageKey?: string;
}

export function ResizableShell({
  left,
  leftHidden = false,
  middle,
  right,
  rightPlacement = "right",
  storageKey = "kafkaoxide.pane-widths",
}: ResizableShellProps) {
  const dockedBelow = rightPlacement === "bottom";
  // Which panes are really beside the middle one, so each divider's range can
  // use the width the other pane isn't taking — a hidden sidebar or a
  // bottom-docked payload panel hands its share back.
  const { leftWidth, rightWidth, bottomHeight, startResizingLeft, startResizingRight, startResizingBottom } =
    useResizablePanes({
      storageKey,
      leftPaneVisible: Boolean(left) && !leftHidden,
      rightPaneVisible: Boolean(right) && !dockedBelow,
    });

  return (
    <div className={`resizable-shell resizable-shell--${rightPlacement}`}>
      {left && (
        <>
          <div
            className="resizable-pane resizable-pane--left"
            data-testid="resizable-pane-left"
            style={leftHidden ? { display: "none" } : { width: leftWidth }}
          >
            {left}
          </div>
          <div
            className="resizable-divider resizable-divider--persistent"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize left panel"
            onPointerDown={startResizingLeft}
            style={leftHidden ? { display: "none" } : undefined}
          />
        </>
      )}
      {/* The middle pane and a bottom-docked payload panel share a column, so
          the dock sits under the *middle pane* rather than under the whole
          window — the sidebar keeps its full height either way. With the
          payload panel on the right this column holds one child and lays out
          exactly as the bare middle pane used to. */}
      <div className="resizable-column">
        <div className="resizable-pane resizable-pane--middle" data-testid="resizable-pane-middle">
          {middle}
        </div>
        {right && dockedBelow && (
          <>
            <div
              className="resizable-divider resizable-divider--persistent resizable-divider--horizontal"
              role="separator"
              aria-orientation="horizontal"
              aria-label="Resize bottom panel"
              onPointerDown={startResizingBottom}
            />
            {/* Same `data-testid` as the side placement on purpose: it is the
                same pane showing the same thing, and anything looking for
                "the payload pane" should find it wherever the user has put
                it. */}
            <div
              className="resizable-pane resizable-pane--bottom"
              data-testid="resizable-pane-right"
              style={{ height: bottomHeight }}
            >
              {right}
            </div>
          </>
        )}
      </div>
      {right && !dockedBelow && (
        <>
          <div
            className="resizable-divider resizable-divider--persistent resizable-divider--right"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize right panel"
            onPointerDown={startResizingRight}
          />
          <div
            className="resizable-pane resizable-pane--right"
            data-testid="resizable-pane-right"
            style={{ width: rightWidth }}
          >
            {right}
          </div>
        </>
      )}
    </div>
  );
}
