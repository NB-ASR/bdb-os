import assert from "node:assert/strict";

const baseUrl = process.env.BDB_SMOKE_BASE_URL?.replace(/\/$/, "");
if (!baseUrl) {
  throw new Error("Set BDB_SMOKE_BASE_URL to the deployment being verified.");
}

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    redirect: "manual",
    ...options,
  });
  return response;
}

const health = await request("/api/health");
assert.equal(health.status, 200, `Health endpoint returned ${health.status}`);
const healthBody = await health.json();
assert.equal(healthBody.status, "ok");
assert.equal(healthBody.checks?.configuration, true);
assert.equal(healthBody.checks?.database, true);

const login = await request("/login");
assert.equal(login.status, 200, `Login returned ${login.status}`);
const loginHtml = await login.text();
assert.match(loginHtml, /Welcome back\./i);
assert.equal(login.headers.get("x-content-type-options"), "nosniff");
assert.equal(login.headers.get("x-frame-options"), "DENY");
assert.match(login.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);

const workspace = await request("/workspace");
assert.ok([302, 303, 307, 308].includes(workspace.status), `Anonymous workspace returned ${workspace.status}`);
assert.match(workspace.headers.get("location") ?? "", /\/login/);

const callback = await request("/auth/callback?next=/activate");
assert.equal(callback.status, 200, `Auth callback page returned ${callback.status}`);

console.log(`BDB OS smoke checks passed for ${baseUrl}`);
