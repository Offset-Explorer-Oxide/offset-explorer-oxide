import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { JsonTreeView } from "../src/components/JsonTreeView";
import { ResizableShell } from "../src/features/layout/ResizableShell";
import { ThemeProvider } from "../src/features/theme/ThemeProvider";
import "../src/styles/themes.css";
import "../src/styles/global.css";

const placement = (new URLSearchParams(location.search).get("dock") ?? "bottom") as "right" | "bottom";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
        <ResizableShell
          rightPlacement={placement}
          storageKey={`divider-harness-${placement}`}
          left={<div style={{ padding: 8 }}>sidebar</div>}
          middle={<div className="cluster-detail-panel"><header className="cluster-detail-header"><h2>orders</h2></header><div style={{ padding: 8 }}>middle pane</div></div>}
          right={
            <div className="message-payload-panel">
              <div className="message-payload-scroll message-payload-scroll--tree">
                <JsonTreeView value={{ orderId: "a-1", items: [{ sku: "SKU-1", qty: 2 }] }} lineNumbers showToolbar={false} />
              </div>
            </div>
          }
        />
      </div>
    </ThemeProvider>
  </StrictMode>,
);
