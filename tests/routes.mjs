import assert from "node:assert/strict";
const base = "http://127.0.0.1:3100";
async function post(path, body) {
  const r = await fetch(base + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: await r.json() };
}
const key = "test-routes";
let response = await post("/api/snapshot", { apiKey: key });
assert.equal(response.status, 200);
assert.equal(response.json.smartGroupsLoaded, true);
assert.equal(response.json.smartGroups.length, 3);
response = await post("/api/connecteam", {
  apiKey: key,
  path: "/jobs/v1/jobs/door-1",
  method: "DELETE",
});
assert.equal(response.status, 405);
response = await post("/api/actions", {
  apiKey: key,
  action: "repairSubJobs",
  payload: {},
});
assert.equal(response.status, 400);
response = await post("/api/actions", {
  apiKey: key,
  phase: "preview",
  action: "createDoor",
  payload: {
    title: "Invalid GPS",
    instanceIds: [20],
    parentGroupIds: [1],
    gps: { latitude: 91, longitude: 0 },
    subJobs: [{ title: "MEJ", groupIds: [1] }],
  },
});
assert.equal(response.status, 400);
response = await post("/api/actions", {
  apiKey: key,
  phase: "preview",
  action: "repairSubJobs",
  payload: { repairs: [{ jobId: "brand-1", mode: "add", groupIds: [999] }] },
});
assert.equal(response.status, 409);
response = await post("/api/actions", {
  apiKey: key,
  phase: "preview",
  action: "repairSubJobs",
  payload: { repairs: [{ jobId: "brand-1", mode: "replace", groupIds: [3] }] },
});
assert.equal(response.status, 200);
const plan = response.json.plan;
assert.deepEqual(plan.records[0].after.assign, {
  type: "both",
  userIds: [101],
  groupIds: [3],
});
assert.equal(plan.records[0].after.fenceSize, 50);
response = await post("/api/actions", { apiKey: key, phase: "apply", plan });
assert.equal(response.json.complete, true);
response = await post("/api/actions", { apiKey: key, phase: "apply", plan });
assert.equal(response.status, 409);
response = await post("/api/snapshot", { apiKey: "test-groups-error" });
assert.equal(response.json.smartGroupsLoaded, false);
assert.match(response.json.warnings[0], /groups-403/);
const errorPreview = await post("/api/actions", {
  apiKey: "test-write-error",
  phase: "preview",
  action: "repairSubJobs",
  payload: { repairs: [{ jobId: "brand-1", mode: "replace", groupIds: [3] }] },
});
response = await post("/api/actions", {
  apiKey: "test-write-error",
  phase: "apply",
  plan: errorPreview.json.plan,
});
assert.equal(response.json.complete, false);
assert.equal(response.json.results[0].status, "failed");
assert.equal(response.json.results[0].httpStatus, 422);
assert.equal(response.json.results[0].details.requestId, "write-422");
response = await post("/api/actions", {
  apiKey: key,
  phase: "preview",
  action: "createDoor",
  payload: {
    title: "Verified route door",
    instanceIds: [20],
    parentGroupIds: [],
    gps: { address: "Example", latitude: "", longitude: "" },
    subJobs: [{ title: "MEJ", groupIds: [1] }],
  },
});
assert.equal(response.status, 200);
assert.deepEqual(response.json.plan.body[0].gps, { address: "Example" });
response = await post("/api/actions", {
  apiKey: key,
  phase: "apply",
  plan: response.json.plan,
});
assert.equal(response.json.complete, true);
console.log(
  "PASS: production-route checks for snapshot, group errors, blocked proxy writes, preview requirement, bad GPS, invalid groups, preserved users/geofence, verified repair, stale replay rejection, structured API errors, and nested creation.",
);
