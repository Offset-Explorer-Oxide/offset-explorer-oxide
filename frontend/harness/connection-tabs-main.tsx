import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConnectionModal } from "../src/features/connections/modal/ConnectionModal";
import { ThemeProvider } from "../src/features/theme/ThemeProvider";
import "../src/styles/themes.css";
import "../src/styles/global.css";

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={client}>
        <ConnectionModal onAdd={async () => {}} onCancel={() => {}} />
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
);
