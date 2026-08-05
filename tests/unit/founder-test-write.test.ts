import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const supportRoute = await readFile("src/app/api/admin/support-session/route.ts", "utf8");
const commandHelper = await readFile("src/lib/server/command.ts", "utf8");
const cloudStore = await readFile("src/lib/cloud-store.ts", "utf8");
const workspaceContext = await readFile("src/app/api/workspace/context/route.ts", "utf8");
const proxy = await readFile("src/proxy.ts", "utf8");
const switcher = await readFile("src/components/dev-role-switcher.tsx", "utf8");

test("Founder test-write sessions are server-selected and shorter lived", () => {
  assert.match(supportRoute, /const accessMode = supportAccessMode\(\)/);
  assert.match(supportRoute, /TEST_WRITE_SESSION_MINUTES = 20/);
  assert.match(supportRoute, /testing_mode: accessMode === "test_write"/);
  assert.doesNotMatch(supportRoute, /body\?\.accessMode/);
});

test("workspace commands distinguish writable testing from read-only support", () => {
  assert.match(commandHelper, /supportSession\?\.access_mode === "test_write"/);
  assert.match(commandHelper, /request\.method !== "GET" && !supportWriteEnabled/);
  assert.match(commandHelper, /support_test_write/);
  assert.match(commandHelper, /SUPPORT_READ_ONLY/);
});

test("Founder testing receives complete owner-equivalent UI and feature access", () => {
  assert.match(cloudStore, /access_mode === "test_write" \? "owner" : "platform-support"/);
  assert.match(workspaceContext, /supportMode === "test_write"/);
  assert.match(workspaceContext, /from\("features"\)/);
  assert.match(proxy, /founderTestWrite = supportSession\?\.access_mode === "test_write"/);
  assert.match(proxy, /if \(founderTestWrite\)/);
  assert.match(proxy, /access_profile: supportSession\.access_mode === "test_write" \? "owner" : "platform-support"/);
});

test("the interface makes writable integration access explicit", () => {
  assert.match(switcher, /Founder testing · Full access/);
  assert.match(switcher, /Changes affect integration data/);
  assert.match(switcher, /Founder support · Read only/);
});
