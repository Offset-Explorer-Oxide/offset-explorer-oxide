import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";

/** App name + version, shown at the top of the window — reads the version straight from `tauri.conf.json` at runtime rather than duplicating it in the frontend. */
export function AppTitle() {
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch(() => setVersion(null));
  }, []);

  return (
    <div className="app-title">
      <span className="app-title-name">Offset Explorer Oxide</span>
      {version && <span className="app-title-version">v{version}</span>}
    </div>
  );
}
