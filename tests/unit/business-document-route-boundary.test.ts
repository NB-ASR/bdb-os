import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("business document URL validation remains inside the structured command boundary", async () => {
  const route = await readFile("src/app/api/business-documents/render/route.ts", "utf8");
  const boundary = route.indexOf("const result = await runCommand(async () =>");
  const workspaceParse = route.indexOf('const workspaceId = uuid(url.searchParams.get("workspaceId")', boundary);
  const documentParse = route.indexOf('const id = uuid(url.searchParams.get("id")', boundary);
  const membershipCheck = route.indexOf("await requireWorkspaceCommand(request, workspaceId)", boundary);

  assert.ok(boundary >= 0);
  assert.ok(workspaceParse > boundary);
  assert.ok(documentParse > boundary);
  assert.ok(membershipCheck > documentParse);
  assert.match(route, /\.eq\("workspace_id", workspaceId\)\.eq\("id", id\)/);
});
