import assert from "node:assert/strict";
import test from "node:test";
import {
  addSnapshotChecksum,
  canonicalJson,
  verifySnapshotEnvelope,
  type WorkspaceSnapshot,
} from "../../src/lib/server/workspace-snapshot.ts";

const workspaceId = "11111111-1111-4111-8111-111111111111";

function snapshot(): WorkspaceSnapshot {
  return {
    format: "bdb_workspace_snapshot",
    schemaVersion: 1,
    workspaceId,
    exportedAt: "2026-08-02T12:00:00.000Z",
    workspace: { name: "Test Workspace", legalName: null },
    sections: {
      customers: [{ workspace_id: workspaceId, name: "Customer", id: "c1" }],
      workspace_settings: [{ workspace_id: workspaceId, currency: "EUR" }],
    },
    storageManifest: {
      workspaceAssets: [],
      workspaceDocuments: [],
      supplierDocuments: [],
    },
    exclusions: ["authentication", "workspace memberships"],
  };
}

test("workspace snapshot checksums are stable across object key order", () => {
  const left = { z: 1, a: { y: 2, x: 3 } };
  const right = { a: { x: 3, y: 2 }, z: 1 };
  assert.equal(canonicalJson(left), canonicalJson(right));
});

test("verified workspace snapshots preserve the signed structured payload", () => {
  const source = snapshot();
  const envelope = addSnapshotChecksum(source);
  assert.deepEqual(verifySnapshotEnvelope(envelope, workspaceId), source);
});

test("workspace snapshot verification rejects modified records", () => {
  const envelope = addSnapshotChecksum(snapshot());
  envelope.sections.customers[0] = {
    ...envelope.sections.customers[0],
    name: "Modified",
  };
  assert.throws(
    () => verifySnapshotEnvelope(envelope, workspaceId),
    /checksum is invalid/i,
  );
});

test("workspace snapshot verification rejects cross-workspace restore", () => {
  const envelope = addSnapshotChecksum(snapshot());
  assert.throws(
    () => verifySnapshotEnvelope(
      envelope,
      "22222222-2222-4222-8222-222222222222",
    ),
    /workspace identity is invalid/i,
  );
});
