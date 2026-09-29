import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDoor,
  buildRepair,
  previewOperation,
  applyOperation,
} from "../lib/operations.js";
import {
  collectPages,
  loadSmartGroups,
  ctFetch,
  ConnecteamError,
  extractSelectedIds,
} from "../lib/connecteam.js";
const parent = {
  jobId: "parent",
  title: "The Grove",
  code: "GROVE",
  parentId: null,
  description: "Door description",
  gps: { address: "Los Angeles", latitude: 34, longitude: -118 },
  fenceSize: 100,
  assign: { type: "both", userIds: [7], groupIds: [1] },
  subJobs: [{ jobId: "brand", title: "MEJ" }],
  instanceIds: [20],
};
const child = {
  jobId: "brand",
  title: "MEJ",
  code: "MEJ",
  parentId: "parent",
  useParentData: false,
  description: "Brand description",
  gps: { address: "Entrance B" },
  fenceSize: 50,
  assign: { type: "both", userIds: [8], groupIds: [1] },
  customFields: [
    { customFieldId: 10, value: [{ id: 2 }], type: "dropdown", name: "Field" },
  ],
};
const door = {
  title: "New Door",
  code: "NEW",
  description: "Shared",
  instanceIds: [20],
  parentGroupIds: [1],
  gps: { address: "NY", latitude: "", longitude: "" },
  subJobs: [
    { title: "MEJ", groupIds: [2] },
    { title: "Refi", groupIds: [] },
  ],
};
function mockApi(options = {}) {
  const state = {
    parent: structuredClone(parent),
    brand: structuredClone(child),
    groups: options.groups || [
      { id: 1, name: "Old", groupSegmentId: 7 },
      { id: 2, name: "New", groupSegmentId: 7 },
    ],
    segments: options.segments || [
      { id: 7, name: "Departments", color: "#3968bb", sortOrder: 1 },
    ],
    fields: options.fields || [
      {
        id: 30,
        name: "Doors",
        type: "dropdown",
        dropdownOptions: [
          { id: 10, value: "Grove" },
          { id: 11, value: "Santa Monica" },
        ],
      },
    ],
    nextGroup: 100,
    nextSegment: 200,
  };
  const calls = [];
  const request = async (key, path, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : undefined;
    calls.push({ path, method: opts.method || "GET", body });
    if (options.hook) await options.hook({ state, calls, path, opts });
    if (path.startsWith("/users/v1/smart-group-segments")) {
      if (opts.method === "POST") {
        const created = {
          id: state.nextSegment++,
          name: body.name,
          color: body.color,
          sortOrder: state.segments.length + 1,
        };
        state.segments.push(created);
        return { requestId: "segment-req", data: created };
      }
      return { data: { segments: state.segments } };
    }
    if (path.startsWith("/users/v1/smart-groups")) {
      if (opts.method === "POST") {
        if (options.failGroupCreate)
          throw new ConnecteamError("Group name already exists", 409, {
            requestId: "group-409",
          });
        const created = {
          id: state.nextGroup++,
          name: body.name,
          description: body.description,
          groupSegmentId: body.groupSegmentId,
          numberOfUsers: 0,
        };
        state.groups.push(created);
        return { requestId: "group-req", data: created };
      }
      const id = Number(
        new URLSearchParams(path.split("?")[1] || "").get("id"),
      );
      return {
        data: {
          smartGroups:
            options.hideCreated && id >= 100
              ? []
              : state.groups.filter((group) => !id || group.id === id),
        },
      };
    }
    if (path.startsWith("/users/v1/custom-fields"))
      return { data: { customFields: state.fields } };
    if (path === "/scheduler/v1/schedulers")
      return { data: { schedulers: [{ schedulerId: 20, name: "Schedule" }] } };
    if (path === "/time-clock/v1/time-clocks")
      return { data: { timeClocks: [] } };
    if (path.startsWith("/jobs/v1/jobs?")) return { data: { jobs: [] } };
    if (path === "/jobs/v1/jobs" && opts.method === "POST") {
      if (options.failJobCreate)
        throw new ConnecteamError("Permission denied", 403, {
          requestId: "job-403",
        });
      const body = JSON.parse(opts.body)[0];
      state.created = {
        ...body,
        jobId: "created",
        subJobs: body.subJobs?.map((s, i) => ({ ...s, jobId: `new${i}` })),
      };
      return { data: { jobs: [state.created] } };
    }
    const id = decodeURIComponent(path.split("/").at(-1));
    if (opts.method === "PUT") {
      if (options.failWrite)
        throw new ConnecteamError("Permission denied", 403, {
          requestId: "req-1",
          detail: "Missing jobs.write",
        });
      state[id] = { ...state[id], ...JSON.parse(opts.body) };
    }
    if (!state[id]) throw new ConnecteamError("Missing job", 404);
    return { data: { job: structuredClone(state[id]) } };
  };
  return { state, calls, request };
}
test("nested creation validates and omits blank coordinates, copies door location for custom brands", () => {
  const [p] = buildDoor(door);
  assert.deepEqual(p.gps, { address: "NY" });
  assert.deepEqual(p.subJobs[0].gps, p.gps);
  assert.equal(p.subJobs[0].description, "Shared");
  assert.equal(p.subJobs[1].useParentData, true);
  assert.equal(p.subJobs[1].assign, undefined);
});
test("creation rejects empty setup, duplicate brands, bad IDs and invalid coordinates", () => {
  for (const patch of [
    { subJobs: [] },
    {
      subJobs: [
        { title: "MEJ", groupIds: [2] },
        { title: "mej", groupIds: [2] },
      ],
    },
    { instanceIds: ["oops"] },
    { gps: { latitude: 100, longitude: 0 } },
    { gps: { latitude: 20, longitude: "" } },
    { title: "x".repeat(129) },
    { parentGroupIds: [], subJobs: [{ title: "Empty", groupIds: [] }] },
  ])
    assert.throws(() => buildDoor({ ...door, ...patch }));
});
test("repair preserves users and all writable fields while adding or replacing groups", () => {
  const next = buildRepair(child, parent, { mode: "add", groupIds: [2] });
  assert.deepEqual(next.assign, {
    type: "both",
    userIds: [8],
    groupIds: [1, 2],
  });
  assert.deepEqual(next.gps, child.gps);
  assert.equal(next.fenceSize, 50);
  assert.equal(next.description, child.description);
  assert.deepEqual(next.customFields, [
    { customFieldId: 10, value: [{ id: 2 }] },
  ]);
  assert.equal(next.parentId, "parent");
  assert.equal(next.code, "MEJ");
  assert.deepEqual(
    buildRepair(child, parent, { mode: "replace", groupIds: [2] }).assign,
    { type: "both", userIds: [8], groupIds: [2] },
  );
});
test("leaving inheritance copies fresh parent settings, including users and groups", () => {
  const next = buildRepair({ ...child, useParentData: true }, parent, {
    mode: "add",
    groupIds: [2],
  });
  assert.deepEqual(next.assign, {
    type: "both",
    userIds: [7],
    groupIds: [1, 2],
  });
  assert.deepEqual(next.gps, parent.gps);
  assert.equal(next.fenceSize, parent.fenceSize);
  assert.equal(next.description, parent.description);
});
test("inherit payload excludes prohibited fields but preserves code and custom fields", () => {
  const next = buildRepair(child, parent, { mode: "inherit" });
  for (const k of ["assign", "gps", "description"])
    assert.equal(k in next, false);
  assert.equal(next.code, "MEJ");
  assert.equal(next.customFields.length, 1);
  assert.equal(next.useParentData, true);
});
test("preview is read-only and invalid groups block writes", async () => {
  const m = mockApi();
  await previewOperation(
    "key",
    "repairSubJobs",
    { repairs: [{ jobId: "brand", mode: "add", groupIds: [2] }] },
    m.request,
  );
  assert.ok(m.calls.every((c) => c.method === "GET"));
  await assert.rejects(
    () =>
      previewOperation(
        "key",
        "repairSubJobs",
        { repairs: [{ jobId: "brand", mode: "add", groupIds: [99] }] },
        m.request,
      ),
    /no longer available/,
  );
});
test("apply re-fetches immediately before repair and verifies afterward", async () => {
  const m = mockApi();
  const p = await previewOperation(
    "key",
    "repairSubJobs",
    { repairs: [{ jobId: "brand", mode: "replace", groupIds: [2] }] },
    m.request,
  );
  const r = await applyOperation("key", p, m.request);
  assert.equal(r.complete, true);
  const index = m.calls.findIndex((c) => c.method === "PUT");
  assert.ok(
    m.calls.slice(0, index).filter((c) => c.path.endsWith("/brand")).length >=
      3,
  );
  assert.equal(m.calls[index + 1].method, "GET");
  assert.deepEqual(m.state.brand.assign.userIds, [8]);
});
test("stale preview blocks all writes instead of overwriting a concurrent edit", async () => {
  const m = mockApi();
  const p = await previewOperation(
    "key",
    "repairSubJobs",
    { repairs: [{ jobId: "brand", mode: "add", groupIds: [2] }] },
    m.request,
  );
  m.state.brand.description = "Changed elsewhere";
  await assert.rejects(
    () => applyOperation("key", p, m.request),
    /changed since preview/,
  );
  assert.ok(m.calls.every((c) => c.method === "GET"));
});
test("a change after preflight is detected before writing", async () => {
  let childReads = 0;
  const m = mockApi({
    hook: ({ state, path, opts }) => {
      if (path.endsWith("/brand") && !opts.method && ++childReads === 3)
        state.brand.code = "External edit";
    },
  });
  const p = await previewOperation(
    "key",
    "repairSubJobs",
    { repairs: [{ jobId: "brand", mode: "add", groupIds: [2] }] },
    m.request,
  );
  const result = await applyOperation("key", p, m.request);
  assert.equal(result.complete, false);
  assert.match(result.results[0].error, /changed after preview/);
  assert.ok(m.calls.every((c) => c.method === "GET"));
});
test("partial failure reports completed, failed and not-attempted records accurately", async () => {
  const m = mockApi({
    hook: ({ path, opts }) => {
      if (path.endsWith("/b2") && opts.method === "PUT")
        throw new ConnecteamError("Denied", 403, { requestId: "req-2" });
    },
  });
  m.state.b2 = { ...structuredClone(child), jobId: "b2", title: "Refi" };
  m.state.b3 = { ...structuredClone(child), jobId: "b3", title: "House Labs" };
  const p = await previewOperation(
    "key",
    "repairSubJobs",
    {
      repairs: ["brand", "b2", "b3"].map((jobId) => ({
        jobId,
        mode: "add",
        groupIds: [2],
      })),
    },
    m.request,
  );
  const r = await applyOperation("key", p, m.request);
  assert.deepEqual(
    r.results.map((r) => r.status),
    ["verified", "failed", "not-attempted"],
  );
  assert.equal(r.results[1].details.requestId, "req-2");
});
test("successful write with mismatched readback is not claimed verified", async () => {
  const m = mockApi({
    hook: ({ state, path, opts, calls }) => {
      if (
        path.endsWith("/brand") &&
        !opts.method &&
        calls.some((c) => c.method === "PUT")
      )
        state.brand.assign.groupIds = [1];
    },
  });
  const p = await previewOperation(
    "key",
    "repairSubJobs",
    { repairs: [{ jobId: "brand", mode: "add", groupIds: [2] }] },
    m.request,
  );
  const r = await applyOperation("key", p, m.request);
  assert.equal(r.results[0].status, "saved-unverified");
  assert.equal(r.complete, false);
});
test("create uses one nested write and verifies the resulting structure", async () => {
  const m = mockApi();
  const p = await previewOperation("key", "createDoor", door, m.request);
  const r = await applyOperation("key", p, m.request);
  assert.equal(r.complete, true);
  assert.equal(m.calls.filter((c) => c.method === "POST").length, 1);
  assert.equal(
    m.calls.find((c) => c.method === "POST").body[0].subJobs.length,
    2,
  );
});
test("add brand rechecks parent and sends a sub-job with the correct parent ID", async () => {
  const m = mockApi();
  const p = await previewOperation(
    "key",
    "addBrand",
    { parentId: "parent", title: "New brand", groupIds: [2] },
    m.request,
  );
  assert.equal(p.body[0].parentId, "parent");
  assert.deepEqual(p.body[0].gps, parent.gps);
  const r = await applyOperation("key", p, m.request);
  assert.equal(r.complete, true);
});
test("standalone parent cannot gain brands", async () => {
  const m = mockApi();
  m.state.parent.subJobs = [];
  await assert.rejects(
    () =>
      previewOperation(
        "key",
        "addBrand",
        { parentId: "parent", title: "No", groupIds: [2] },
        m.request,
      ),
    /already containing/,
  );
});
test("expired previews cannot write", async () => {
  const m = mockApi();
  await assert.rejects(
    () => applyOperation("key", { createdAt: 0 }, m.request),
    /expired/,
  );
  assert.equal(m.calls.length, 0);
});
test("smart-group loading accepts documented response and rejects malformed success", async () => {
  assert.deepEqual(
    await loadSmartGroups("k", async () => ({
      data: { smartGroups: [{ id: "2", name: "MEJ" }] },
    })),
    [{ id: 2, name: "MEJ" }],
  );
  await assert.rejects(
    () => loadSmartGroups("k", async () => ({ data: { groups: [] } })),
    /smartGroups is missing/,
  );
});
test("pagination detects repeated pages and tolerates echoed current offsets", async () => {
  await assert.rejects(
    () =>
      collectPages("k", "/jobs", "jobs", {
        limit: 1,
        request: async () => ({ data: { jobs: [{ jobId: "a" }] } }),
      }),
    /repeated a page/,
  );

  const echoedPaths = [];
  const echoed = await collectPages("k", "/jobs", "jobs", {
    limit: 1,
    request: async (k, p) => {
      echoedPaths.push(p);
      return echoedPaths.length === 1
        ? { data: { jobs: [{ jobId: "a" }] }, paging: { offset: 0 } }
        : { data: { jobs: [] }, paging: { offset: 1 } };
    },
  });
  assert.deepEqual(echoed.rows, [{ jobId: "a" }]);
  assert.match(echoedPaths[1], /offset=1/);

  const paths = [];
  const r = await collectPages("k", "/jobs", "jobs", {
    limit: 1,
    request: async (k, p) => {
      paths.push(p);
      return paths.length === 1
        ? { data: { jobs: [{ jobId: "a" }] }, paging: { offset: 12 } }
        : { data: { jobs: [] } };
    },
  });
  assert.equal(r.rows.length, 1);
  assert.match(paths[1], /offset=12/);
});
test("dropdown null never becomes option zero", () => {
  assert.deepEqual(extractSelectedIds(null), []);
  assert.deepEqual(extractSelectedIds(""), []);
  assert.throws(() => extractSelectedIds("unrecognized"));
});
test("real upstream error status, validation body and request ID are retained", async () => {
  const original = global.fetch;
  global.fetch = async () =>
    new Response(
      JSON.stringify({
        requestId: "request-422",
        detail: [{ msg: "Invalid assign" }],
      }),
      { status: 422 },
    );
  try {
    await assert.rejects(
      () => ctFetch("key", "/jobs/v1/jobs", { method: "PUT" }),
      (e) =>
        e.status === 422 &&
        e.payload.requestId === "request-422" &&
        e.message.includes("Invalid assign"),
    );
  } finally {
    global.fetch = original;
  }
});
function userApi({ multi = true } = {}) {
  const state = {
    users: [
      {
        userId: 1,
        firstName: "Jane",
        lastName: "Example",
        customFields: [{ customFieldId: 30, value: [{ id: 10 }] }],
      },
    ],
    field: {
      id: 30,
      name: "Doors",
      type: "dropdown",
      isMultiSelect: multi,
      isRequired: false,
      dropdownOptions: [
        { id: 10, value: "Grove" },
        { id: 11, value: "Santa Monica" },
      ],
    },
  };
  const calls = [];
  const request = async (k, path, opts = {}) => {
    calls.push({ path, ...opts });
    if (path.startsWith("/users/v1/custom-fields"))
      return { data: { customFields: [structuredClone(state.field)] } };
    if (opts.method === "PUT") {
      const update = JSON.parse(opts.body)[0];
      state.users[0].customFields = update.customFields;
    }
    return { data: { users: structuredClone(state.users) } };
  };
  return { state, calls, request };
}
test("employee updates refetch values, preserve unrelated selections and send only the intended field", async () => {
  const m = userApi();
  const p = await previewOperation(
    "key",
    "bulkAssignDoor",
    { customFieldId: 30, optionId: 11, mode: "add", userIds: [1] },
    m.request,
  );
  assert.deepEqual(p.records[0].after, [10, 11]);
  const r = await applyOperation("key", p, m.request);
  assert.equal(r.complete, true);
  const body = JSON.parse(m.calls.find((c) => c.method === "PUT").body);
  assert.deepEqual(body, [
    {
      userId: 1,
      customFields: [{ customFieldId: 30, value: [{ id: 10 }, { id: 11 }] }],
    },
  ]);
});
test("single select preview exposes replacement and stale employee data blocks writes", async () => {
  const m = userApi({ multi: false });
  const p = await previewOperation(
    "key",
    "bulkAssignDoor",
    { customFieldId: 30, optionId: 11, mode: "add", userIds: [1] },
    m.request,
  );
  assert.deepEqual(p.records[0].before, [10]);
  assert.deepEqual(p.records[0].after, [11]);
  m.state.users[0].customFields = [];
  await assert.rejects(
    () => applyOperation("key", p, m.request),
    /changed since preview/,
  );
  assert.ok(m.calls.every((c) => !c.method));
});
test("required employee dropdown cannot be cleared", async () => {
  const m = userApi();
  m.state.field.isRequired = true;
  await assert.rejects(
    () =>
      previewOperation(
        "key",
        "bulkAssignDoor",
        { customFieldId: 30, optionId: 10, mode: "remove", userIds: [1] },
        m.request,
      ),
    /cannot be cleared/,
  );
});

test("schedule-only access does not require unrelated time clock permissions", async () => {
  const m = mockApi();
  const request = async (k, path, opts) => {
    if (path === "/time-clock/v1/time-clocks")
      throw new ConnecteamError("Time clock scope unavailable", 403);
    return m.request(k, path, opts);
  };
  const plan = await previewOperation("key", "createDoor", door, request);
  assert.equal(plan.body[0].instanceIds[0], 20);
  await assert.rejects(
    () =>
      previewOperation(
        "key",
        "createDoor",
        { ...door, instanceIds: [999] },
        request,
      ),
    /Time clock scope unavailable/,
  );
});
test("read failure immediately before a repair is not reported as an attempted write", async () => {
  let reads = 0;
  const m = mockApi({
    hook: ({ path, opts }) => {
      if (path.endsWith("/brand") && !opts.method && ++reads === 3)
        throw new ConnecteamError("Read timed out", 502);
    },
  });
  const plan = await previewOperation(
    "key",
    "repairSubJobs",
    { repairs: [{ jobId: "brand", mode: "add", groupIds: [2] }] },
    m.request,
  );
  const result = await applyOperation("key", plan, m.request);
  assert.equal(result.results[0].status, "failed");
  assert.ok(m.calls.every((c) => c.method === "GET"));
});
test("an empty user readback cannot falsely verify a removal", async () => {
  const m = userApi();
  let written = false;
  const request = async (k, path, opts = {}) => {
    if (opts.method === "PUT") written = true;
    else if (written && path.startsWith("/users/v1/users"))
      return { data: { users: [] } };
    return m.request(k, path, opts);
  };
  const plan = await previewOperation(
    "key",
    "bulkAssignDoor",
    { customFieldId: 30, optionId: 10, mode: "remove", userIds: [1] },
    request,
  );
  const result = await applyOperation("key", plan, request);
  assert.equal(result.results[0].status, "saved-unverified");
});
test("missing dropdown settings block employee writes", async () => {
  const m = userApi();
  delete m.state.field.isMultiSelect;
  await assert.rejects(
    () =>
      previewOperation(
        "key",
        "bulkAssignDoor",
        { customFieldId: 30, optionId: 11, mode: "add", userIds: [1] },
        m.request,
      ),
    /selection settings are missing/,
  );
});
test("dropdown option creation rejects duplicates and verifies new options", async () => {
  const m = userApi();
  const request = async (k, path, opts = {}) => {
    if (opts.method === "POST") {
      m.state.field.dropdownOptions.push({ id: 12, ...JSON.parse(opts.body) });
      return { data: { id: 12 } };
    }
    return m.request(k, path, opts);
  };
  await assert.rejects(
    () =>
      previewOperation(
        "key",
        "createDoorOption",
        { customFieldId: 30, value: "Grove" },
        request,
      ),
    /already exists/,
  );
  const plan = await previewOperation(
    "key",
    "createDoorOption",
    { customFieldId: 30, value: "New Door" },
    request,
  );
  const result = await applyOperation("key", plan, request);
  assert.equal(result.results[0].status, "verified");
});

const newGroup = {
  key: "grove-mej",
  name: "Grove MEJ",
  description: "Brand cohort",
  segment: { name: "Locations", color: "#3968BB" },
};
test("creating a named group and assigning it happens in one preview and apply", async () => {
  const m = mockApi();
  const payload = {
    ...door,
    parentGroupIds: [],
    parentNewGroupKeys: ["grove-mej"],
    newGroups: [newGroup],
    subJobs: [
      { title: "MEJ", groupIds: [2], newGroupKeys: ["grove-mej"] },
      { title: "Refi", groupIds: [], newGroupKeys: [] },
    ],
  };
  const plan = await previewOperation("key", "createDoor", payload, m.request);
  assert.ok(m.calls.every((call) => call.method === "GET"));
  assert.equal(plan.groupCreates[0].filters.dropdownFilters.length, 0);
  assert.match(plan.groups.find((group) => group.pending).name, /Grove MEJ/);
  const result = await applyOperation("key", plan, m.request);
  assert.equal(result.complete, true);
  assert.deepEqual(
    result.results.map((item) => item.status),
    ["verified", "verified", "verified"],
  );
  const posts = m.calls.filter((call) => call.method === "POST");
  assert.deepEqual(
    posts.map((call) => call.path),
    [
      "/users/v1/smart-group-segments",
      "/users/v1/smart-groups",
      "/jobs/v1/jobs",
    ],
  );
  assert.deepEqual(posts[0].body, { name: "Locations", color: "#3968bb" });
  assert.deepEqual(posts[1].body, {
    name: "Grove MEJ",
    description: "Brand cohort",
    groupSegmentId: 200,
    filters: { operator: "and", dropdownFilters: [] },
  });
  assert.deepEqual(posts[2].body[0].assign.groupIds, [100]);
  assert.deepEqual(posts[2].body[0].subJobs[0].assign.groupIds, [2, 100]);
  assert.equal(posts[2].body[0].subJobs[1].useParentData, true);
  assert.equal(result.results[1].groupId, 100);
  assert.equal(result.results[1].requestId, "group-req");
  assert.ok(m.calls.every((call) => call.method !== "DELETE"));
});
test("dropdown filters use fieldId and can target an existing segment", async () => {
  const m = mockApi();
  const plan = await previewOperation(
    "key",
    "addBrand",
    {
      parentId: "parent",
      title: "Popup",
      groupIds: [1],
      newGroupKeys: ["filtered"],
      newGroups: [
        {
          key: "filtered",
          name: "Grove cohort",
          groupSegmentId: 7,
          operator: "or",
          dropdownFilters: [{ fieldId: 30, optionIds: [11, 10] }],
        },
      ],
    },
    m.request,
  );
  const result = await applyOperation("key", plan, m.request);
  assert.equal(result.complete, true);
  const groupPost = m.calls.find(
    (call) => call.method === "POST" && call.path === "/users/v1/smart-groups",
  );
  assert.deepEqual(groupPost.body.filters, {
    operator: "or",
    dropdownFilters: [{ fieldId: 30, optionIds: [11, 10] }],
  });
  assert.equal(groupPost.body.customFieldId, undefined);
  const jobPost = m.calls.find(
    (call) => call.method === "POST" && call.path === "/jobs/v1/jobs",
  );
  assert.deepEqual(jobPost.body[0].assign.groupIds, [1, 100]);
  assert.equal(
    m.calls.filter(
      (call) =>
        call.path.startsWith("/users/v1/smart-group-segments") &&
        call.method === "POST",
    ).length,
    0,
  );
});
test("smart group creation rejects conflicts before any write", async () => {
  const m = mockApi();
  const base = {
    parentId: "parent",
    title: "Popup",
    groupIds: [],
    newGroupKeys: ["g1"],
  };
  await assert.rejects(
    () =>
      previewOperation(
        "key",
        "addBrand",
        {
          ...base,
          newGroups: [{ key: "g1", name: "Old", groupSegmentId: 7 }],
        },
        m.request,
      ),
    /already exists/,
  );
  await assert.rejects(
    () =>
      previewOperation(
        "key",
        "addBrand",
        {
          ...base,
          newGroups: [{ key: "g1", name: "Fresh", groupSegmentId: 99 }],
        },
        m.request,
      ),
    /not a valid segment/,
  );
  await assert.rejects(
    () =>
      previewOperation(
        "key",
        "addBrand",
        {
          ...base,
          newGroups: [
            {
              key: "g1",
              name: "Fresh",
              groupSegmentId: 7,
              dropdownFilters: [{ fieldId: 30, optionIds: [99] }],
            },
          ],
        },
        m.request,
      ),
    /not a valid choice/,
  );
  await assert.rejects(
    () =>
      previewOperation(
        "key",
        "addBrand",
        {
          ...base,
          newGroups: [
            {
              key: "g1",
              name: "Fresh",
              segment: { name: "Departments", color: "#abcdef" },
            },
          ],
        },
        m.request,
      ),
    /Select it instead of creating a new one/,
  );
  await assert.rejects(
    () =>
      previewOperation(
        "key",
        "addBrand",
        {
          ...base,
          newGroups: [
            {
              key: "g1",
              name: "Fresh",
              groupSegmentId: 7,
              dropdownFilters: [{ customFieldId: 30, optionIds: [10] }],
            },
          ],
        },
        m.request,
      ),
    /fieldId/,
  );
  assert.ok(m.calls.every((call) => call.method === "GET"));
});
test("a group-name conflict from Connecteam keeps the assignment unattempted", async () => {
  const m = mockApi({ failGroupCreate: true });
  const plan = await previewOperation(
    "key",
    "repairSubJobs",
    {
      newGroups: [{ key: "g1", name: "Extra", groupSegmentId: 7 }],
      repairs: [
        {
          jobId: "brand",
          mode: "add",
          groupIds: [],
          newGroupKeys: ["g1"],
        },
      ],
    },
    m.request,
  );
  const result = await applyOperation("key", plan, m.request);
  assert.deepEqual(
    result.results.map((item) => item.status),
    ["failed", "not-attempted"],
  );
  assert.equal(result.results[0].requestId, "group-409");
  assert.match(result.results[0].error, /Request ID: group-409/);
  assert.ok(m.calls.every((call) => call.method !== "PUT"));
});
test("a created group is kept when the later assignment write fails", async () => {
  const m = mockApi({ failJobCreate: true });
  const plan = await previewOperation(
    "key",
    "addBrand",
    {
      parentId: "parent",
      title: "Popup",
      groupIds: [],
      newGroupKeys: ["g1"],
      newGroups: [{ key: "g1", name: "Popup group", groupSegmentId: 7 }],
    },
    m.request,
  );
  const result = await applyOperation("key", plan, m.request);
  assert.deepEqual(
    result.results.map((item) => item.status),
    ["verified", "failed"],
  );
  assert.equal(result.results[1].requestId, "job-403");
  assert.match(result.results[1].note, /kept/);
  assert.equal(m.state.groups.at(-1).name, "Popup group");
});
test("unverified group readback does not assign the new id", async () => {
  const m = mockApi({ hideCreated: true });
  const plan = await previewOperation(
    "key",
    "createDoor",
    {
      ...door,
      parentNewGroupKeys: ["g1"],
      newGroups: [{ key: "g1", name: "Hidden", groupSegmentId: 7 }],
    },
    m.request,
  );
  const result = await applyOperation("key", plan, m.request);
  assert.equal(result.results[0].status, "saved-unverified");
  assert.equal(result.results.at(-1).status, "not-attempted");
  assert.equal(
    m.calls.filter(
      (call) => call.path === "/jobs/v1/jobs" && call.method === "POST",
    ).length,
    0,
  );
});
test("repair can add one shared new group without dropping direct users", async () => {
  const m = mockApi();
  const plan = await previewOperation(
    "key",
    "repairSubJobs",
    {
      newGroups: [
        {
          key: "g1",
          name: "Shared",
          groupSegmentId: 7,
        },
      ],
      repairs: [
        {
          jobId: "brand",
          mode: "replace",
          groupIds: [],
          newGroupKeys: ["g1"],
        },
      ],
    },
    m.request,
  );
  const result = await applyOperation("key", plan, m.request);
  assert.equal(result.complete, true);
  assert.deepEqual(m.state.brand.assign, {
    type: "both",
    userIds: [8],
    groupIds: [100],
  });
  assert.equal(m.state.brand.code, "MEJ");
  assert.equal(m.state.brand.customFields[0].customFieldId, 10);
});
test("several new groups can share one new segment", async () => {
  const m = mockApi({ groups: [] });
  const plan = await previewOperation(
    "key",
    "createDoor",
    {
      ...door,
      parentGroupIds: [],
      parentNewGroupKeys: ["a", "b"],
      newGroups: [
        {
          key: "a",
          name: "Alpha",
          segment: { name: "Locations", color: "#112233" },
        },
        {
          key: "b",
          name: "Beta",
          segment: { name: "Locations", color: "#112233" },
        },
      ],
      subJobs: [{ title: "MEJ", groupIds: [], newGroupKeys: ["a"] }],
    },
    m.request,
  );
  const result = await applyOperation("key", plan, m.request);
  assert.equal(result.complete, true);
  assert.equal(
    m.calls.filter(
      (call) =>
        call.method === "POST" &&
        call.path === "/users/v1/smart-group-segments",
    ).length,
    1,
  );
  assert.equal(
    m.calls.filter(
      (call) =>
        call.method === "POST" && call.path === "/users/v1/smart-groups",
    ).length,
    2,
  );
});
