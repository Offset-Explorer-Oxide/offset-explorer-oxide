import type { UseMutationResult } from "@tanstack/react-query";
import type { ConnectionStatus } from "../../../lib/tauri";

export interface PingResultProps<TVariables> {
  mutation: Pick<UseMutationResult<ConnectionStatus, Error, TVariables>, "isSuccess" | "isError" | "data" | "error">;
  failureMessage: string;
  successMessage?: string;
}

/** Renders the success/failure line shown beneath a ping button, once a ping has run. */
export function PingResult<TVariables>({
  mutation,
  failureMessage,
  successMessage = "Success",
}: PingResultProps<TVariables>) {
  if (mutation.isSuccess) {
    const reachable = mutation.data === "REACHABLE";
    return (
      <p role="status" className={`ping-result ${reachable ? "ping-result--success" : "ping-result--error"}`}>
        {reachable ? successMessage : failureMessage}
      </p>
    );
  }

  if (mutation.isError) {
    return (
      <p role="alert" className="ping-result ping-result--error">
        {mutation.error instanceof Error ? mutation.error.message : failureMessage}
      </p>
    );
  }

  return null;
}
