"use client";

import { RefreshCw, Trash2, TriangleAlert } from "lucide-react";
import { Badge, Button } from "@/components/ui";
import type { CatalogueQueuedCommand } from "@/lib/modules/catalogue-offline-queue";

export function CataloguePendingChanges<Action extends string>({
  label,
  commands,
  syncing,
  onRetry,
  onDiscard,
  describe,
}: {
  label: string;
  commands: readonly CatalogueQueuedCommand<Action>[];
  syncing: boolean;
  onRetry: () => void;
  onDiscard: (commandId: string) => void;
  describe: (command: CatalogueQueuedCommand<Action>) => string;
}) {
  if (!commands.length) return null;
  const blocked = commands[0]?.lastError ? commands[0] : null;
  const ambiguousBlocked = blocked?.lastFailureKind === "ambiguous"
    || Boolean(blocked && blocked.attempts > 0 && blocked.lastFailureKind !== "rejected");

  return (
    <div className="settings-note" style={{ marginBottom: 18 }}>
      <strong>{commands.length} {label} change{commands.length === 1 ? "" : "s"} waiting to sync</strong>
      <p>
        Changes stay in order with stable retry keys. A failed change stops later changes until its outcome is safely resolved.
      </p>
      {blocked ? (
        <div className="review-callout" style={{ marginTop: 12, marginBottom: 12 }}>
          <TriangleAlert size={18} />
          <div>
            <strong>Sync stopped on {describe(blocked)}</strong>
            <p>{blocked.lastError}{blocked.lastErrorCode ? ` · ${blocked.lastErrorCode}` : ""}</p>
            {ambiguousBlocked ? (
              <p>The server may already have applied this change. BDB OS must retry the same stable key before it can be discarded safely.</p>
            ) : null}
          </div>
        </div>
      ) : null}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
        <Button variant="secondary" disabled={syncing} onClick={onRetry}>
          <RefreshCw size={16} className={syncing ? "spin" : ""} /> {blocked ? "Retry this change" : "Sync pending"}
        </Button>
      </div>
      <details style={{ marginTop: 12 }}>
        <summary style={{ cursor: "pointer", fontWeight: 700 }}>Review pending changes</summary>
        <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
          {commands.map((command, index) => {
            const ambiguous = command.lastFailureKind === "ambiguous"
              || (command.attempts > 0 && command.lastFailureKind !== "rejected");
            return (
              <div
                key={command.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 12,
                  padding: "10px 12px",
                  border: "1px solid var(--border)",
                  borderRadius: 10,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 7, alignItems: "center" }}>
                    <strong>{describe(command)}</strong>
                    <Badge tone={command.lastError ? "gold" : "neutral"}>{command.action}</Badge>
                    {ambiguous ? <Badge tone="gold">Outcome unknown</Badge> : null}
                    {command.lastFailureKind === "rejected" ? <Badge tone="neutral">Rejected</Badge> : null}
                    {index > 0 && blocked ? <Badge tone="neutral">Waiting</Badge> : null}
                  </div>
                  <p className="muted" style={{ margin: "4px 0 0" }}>
                    Queued {new Date(command.createdAt).toLocaleString()} · {command.attempts} failed attempt{command.attempts === 1 ? "" : "s"}
                  </p>
                  {command.lastError ? <p style={{ margin: "4px 0 0" }}>{command.lastError}</p> : null}
                </div>
                <Button
                  type="button"
                  variant="quiet"
                  disabled={syncing || ambiguous}
                  onClick={() => onDiscard(command.id)}
                  title={ambiguous
                    ? "Retry first because the server may already have applied this change"
                    : "Discard only this pending local change"}
                >
                  <Trash2 size={15} /> Discard
                </Button>
              </div>
            );
          })}
        </div>
      </details>
    </div>
  );
}
