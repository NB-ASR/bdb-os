import { createHash } from "node:crypto";

export type WorkspaceSnapshot = {
  format: "bdb_workspace_snapshot";
  schemaVersion: 1;
  workspaceId: string;
  exportedAt: string;
  workspace: { name: string; legalName: string | null };
  sections: Record<string, unknown[]>;
  storageManifest: {
    workspaceAssets: Array<{ bucket: string; path: string }>;
    workspaceDocuments: Array<{ bucket: string; path: string }>;
    supplierDocuments: Array<{ bucket: string; path: string }>;
  };
  exclusions: string[];
};

export type WorkspaceSnapshotEnvelope = WorkspaceSnapshot & {
  checksum: { algorithm: "sha256"; value: string };
};

function normalise(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalise);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, normalise(item)]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown) {
  return JSON.stringify(normalise(value));
}

export function sha256Text(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function sha256Bytes(value: ArrayBuffer) {
  return createHash("sha256").update(Buffer.from(value)).digest("hex");
}

export function hashJson(value: unknown) {
  return sha256Text(canonicalJson(value));
}

export function addSnapshotChecksum(snapshot: WorkspaceSnapshot): WorkspaceSnapshotEnvelope {
  return {
    ...snapshot,
    checksum: {
      algorithm: "sha256",
      value: hashJson(snapshot),
    },
  };
}

export function verifySnapshotEnvelope(
  value: unknown,
  workspaceId: string,
): WorkspaceSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The selected file is not a BDB OS workspace snapshot.");
  }

  const envelope = value as Partial<WorkspaceSnapshotEnvelope>;
  const { checksum, ...snapshotValue } = envelope;
  const snapshot = snapshotValue as WorkspaceSnapshot;

  if (
    snapshot.format !== "bdb_workspace_snapshot"
    || snapshot.schemaVersion !== 1
    || snapshot.workspaceId !== workspaceId
    || !snapshot.sections
    || typeof snapshot.sections !== "object"
    || Array.isArray(snapshot.sections)
  ) {
    throw new Error("The snapshot format, version or workspace identity is invalid.");
  }

  if (
    checksum?.algorithm !== "sha256"
    || typeof checksum.value !== "string"
    || !/^[0-9a-f]{64}$/i.test(checksum.value)
    || hashJson(snapshot).toLowerCase() !== checksum.value.toLowerCase()
  ) {
    throw new Error("The snapshot checksum is invalid. The file may be incomplete or modified.");
  }

  return snapshot;
}
