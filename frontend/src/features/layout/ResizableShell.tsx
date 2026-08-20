import { ReactNode } from "react";
import { useResizablePanes } from "./useResizablePanes";

export interface ResizableShellProps {
  left?: ReactNode;
  /** Keeps `left` mounted (preserving its internal state, e.g. an expanded tree) but visually hidden, instead of unmounting it. */
  leftHidden?: boolean;
  middle: ReactNode;
  right?: ReactNode;
  /** Overridable for tests; defaults to a single shared app-wide layout. */
  storageKey?: string;
}

export function ResizableShell({
  left,
  leftHidden = false,
  middle,
  right,
  storageKey = "kafkaoxide.pane-widths",
}: ResizableShellProps) {
  const { leftWidth, rightWidth, startResizingLeft, startResizingRight } = useResizablePanes({ storageKey });

  return (
    <div className="resizable-shell">
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
      <div className="resizable-pane resizable-pane--middle" data-testid="resizable-pane-middle">
        {middle}
      </div>
      {right && (
        <>
          <div
            className="resizable-divider resizable-divider--persistent"
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
