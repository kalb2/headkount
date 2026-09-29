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
assert.equal(response.json.smartGroupsBlocked, false);
assert.equal(response.json.smartGroups.length, 3);
const openApiGroups = await post("/api/snapshot", {
  apiKey: "test-openapi-groups",
});
assert.equal(openApiGroups.status, 200);
assert.equal(openApiGroups.json.smartGroupsLoaded, true);
assert.equal(openApiGroups.json.smartGroupsBlocked, false);
assert.equal(openApiGroups.json.smartGroups[0].name, "Live shape");
const emptyGroups = await post("/api/snapshot", {
  apiKey: "test-empty-groups",
});
assert.equal(emptyGroups.json.smartGroupsLoaded, true);
assert.equal(emptyGroups.json.smartGroupsBlocked, false);
assert.equal(emptyGroups.json.smartGroups.length, 0);
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
assert.equal(response.json.smartGroupsBlocked, true);
assert.equal(response.json.smartGroupsError.requestId, "groups-403");
assert.equal(response.json.smartGroupsError.httpStatus, 403);
assert.match(response.json.warnings[0], /groups-403/);
response = await post("/api/snapshot", { apiKey: "test-groups-shape" });
assert.equal(response.status, 200);
assert.equal(response.json.smartGroupsLoaded, false);
assert.equal(response.json.smartGroupsBlocked, false);
assert.equal(response.json.smartGroupsError.httpStatus, 502);
assert.equal(response.json.smartGroupsError.requestId, "groups-shape");
assert.match(response.json.smartGroupsError.message, /data\.groups/);
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
response = await post("/api/actions", {
  apiKey: "test-create-group",
  phase: "preview",
  action: "addBrand",
  payload: {
    parentId: "door-1",
    title: "Popup",
    groupIds: [1],
    newGroupKeys: ["popup"],
    newGroups: [
      {
        key: "popup",
        name: "Popup cohort",
        groupSegmentId: 7,
        dropdownFilters: [{ fieldId: 30, optionIds: [11] }],
      },
    ],
  },
});
assert.equal(response.status, 200);
assert.equal(response.json.plan.groupCreates[0].filters.operator, "and");
response = await post("/api/actions", {
  apiKey: "test-create-group",
  phase: "apply",
  plan: response.json.plan,
});
assert.equal(response.json.complete, true);
assert.deepEqual(
  response.json.results.map((item) => item.status),
  ["verified", "verified"],
);
assert.equal(response.json.results[0].groupId > 0, true);
const conflict = await post("/api/actions", {
  apiKey: "test-create-group",
  phase: "preview",
  action: "addBrand",
  payload: {
    parentId: "door-1",
    title: "Another",
    groupIds: [],
    newGroupKeys: ["again"],
    newGroups: [{ key: "again", name: "Popup cohort", groupSegmentId: 7 }],
  },
});
assert.equal(conflict.status, 409);
assert.match(conflict.json.error, /already exists/);
const eligibility = await post("/api/actions", {
  apiKey: key,
  phase: "preview",
  action: "createDoor",
  payload: {
    title: "Eligibility Door",
    instanceIds: [20],
    parentGroupIds: [],
    subJobs: [
      { title: "MEJ", groupIds: [], brandOptionId: 20 },
      { title: "Refi", groupIds: [], brandOptionId: 21 },
    ],
    eligibility: {
      doorFieldId: 30,
      brandFieldId: 40,
      doorValue: "Eligibility Door",
      cohortGroupIds: [1],
      groupSegmentId: 7,
    },
  },
});
assert.equal(eligibility.status, 200);
assert.equal(eligibility.json.plan.groupCreates.length, 3);
assert.equal(eligibility.json.plan.groupCreates[1].filters.operator, "and");
assert.deepEqual(
  eligibility.json.plan.eligibility.brands.map((brand) =>
    brand.people.map((person) => person.label),
  ),
  [["Jane Example"], []],
);
assert.deepEqual(
  eligibility.json.plan.eligibility.userUpdates.map((user) => user.userId),
  [101],
);
console.log(
  "PASS: production-route checks for snapshot, group errors, blocked proxy writes, preview requirement, bad GPS, invalid groups, preserved users/geofence, verified repair, stale replay rejection, structured API errors, nested creation, and smart-group create-and-assign.",
);
