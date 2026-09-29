// Test-only preload. Never imported by the application or used by `npm start`.
const originalFetch = globalThis.fetch;
const data = {};
function fixture() {
  const sub = {
    jobId: "brand-1",
    parentId: "door-1",
    title: "MEJ",
    code: "MEJ",
    description: "Brand details",
    gps: { address: "Entrance B" },
    fenceSize: 50,
    useParentData: false,
    assign: { type: "both", userIds: [101], groupIds: [1] },
    customFields: [{ customFieldId: 90, value: "Preserve this" }],
  };
  return {
    jobs: [
      {
        jobId: "door-1",
        parentId: null,
        title: "Sephora — The Grove",
        code: "GROVE",
        description: "Store description",
        gps: { address: "189 The Grove Dr, Los Angeles" },
        assign: { type: "both", userIds: [102], groupIds: [2] },
        instanceIds: [20],
        subJobs: [
          sub,
          {
            ...structuredClone(sub),
            jobId: "brand-2",
            title: "Refi",
            assign: { type: "both", userIds: [], groupIds: [] },
          },
        ],
      },
    ],
    users: [
      {
        userId: 101,
        firstName: "Jane",
        lastName: "Example",
        email: "jane@example.test",
        customFields: [
          { customFieldId: 30, value: [{ id: 10 }] },
          { customFieldId: 40, value: [{ id: 20 }] },
        ],
        smartGroupsIds: [1],
      },
      {
        userId: 102,
        firstName: "Sam",
        lastName: "Example",
        email: "sam@example.test",
        customFields: [{ customFieldId: 40, value: [{ id: 21 }] }],
        smartGroupsIds: [2],
      },
    ],
    fields: [
      {
        id: 30,
        name: "Doors",
        type: "dropdown",
        isMultiSelect: true,
        isRequired: false,
        dropdownOptions: [
          { id: 10, value: "The Grove" },
          { id: 11, value: "Santa Monica" },
        ],
      },
      {
        id: 40,
        name: "Brands",
        type: "dropdown",
        isMultiSelect: true,
        isRequired: false,
        dropdownOptions: [
          { id: 20, value: "MEJ" },
          { id: 21, value: "Refi" },
        ],
      },
    ],
  };
}
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(typeof input === "string" ? input : input.url);
  if (url.hostname !== "api.connecteam.com")
    return originalFetch(input, options);
  const key = options.headers?.["X-API-KEY"];
  if (!String(key).startsWith("test-"))
    throw new Error(
      "Mock server accepts test keys only; no live traffic is allowed.",
    );
  const state = (data[key] ??= fixture()),
    method = options.method || "GET",
    path = url.pathname;
  const body = options.body ? JSON.parse(options.body) : null;
  const response = (payload, status = 200) =>
    new Response(JSON.stringify({ requestId: "test-request", data: payload }), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  if (path === "/me")
    return response({ companyName: "Example Operations (test data)" });
  if (!state.smartGroups)
    state.smartGroups =
      key === "test-empty-groups"
        ? []
        : [
            { id: 1, name: "MEJ Qualified", usersCount: 12, groupSegmentId: 7 },
            { id: 2, name: "Refi Qualified", usersCount: 8, groupSegmentId: 7 },
            {
              id: 3,
              name: "House Labs Qualified",
              usersCount: 14,
              groupSegmentId: 7,
            },
          ];
  if (!state.segments)
    state.segments = [
      { id: 7, name: "Departments", color: "#3968bb", sortOrder: 1 },
    ];
  state.nextGroup ??= 50;
  state.nextSegment ??= 80;
  if (path === "/users/v1/smart-group-segments") {
    if (method === "POST") {
      const created = {
        id: state.nextSegment++,
        name: body.name,
        color: body.color,
        sortOrder: state.segments.length + 1,
      };
      state.segments.push(created);
      return response(created);
    }
    return response({ segments: state.segments });
  }
  if (path === "/users/v1/smart-groups") {
    if (key === "test-groups-error")
      return new Response(
        JSON.stringify({
          requestId: "groups-403",
          detail: "Smart Groups permission denied",
        }),
        { status: 403 },
      );
    if (key === "test-groups-shape" && method !== "POST")
      return new Response(
        JSON.stringify({ requestId: "groups-shape", data: { users: [] } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    if (key === "test-openapi-groups" && method !== "POST")
      return response({
        groups: [
          {
            id: 9,
            name: "Live shape",
            groupSegmentId: 7,
            numberOfUsers: 1,
          },
        ],
      });
    if (method === "POST") {
      const duplicate = state.smartGroups.some(
        (group) => group.name.toLowerCase() === body.name.toLowerCase(),
      );
      if (duplicate)
        return new Response(
          JSON.stringify({
            requestId: "group-409",
            detail: "Group name already exists",
          }),
          { status: 409 },
        );
      const created = {
        id: state.nextGroup++,
        name: body.name,
        description: body.description,
        groupSegmentId: body.groupSegmentId,
        numberOfUsers: 0,
      };
      state.smartGroups.push(created);
      return response(created);
    }
    const id = Number(url.searchParams.get("id"));
    return response({
      smartGroups: id
        ? state.smartGroups.filter((group) => group.id === id)
        : state.smartGroups,
    });
  }
  if (path === "/scheduler/v1/schedulers")
    return response({
      schedulers: [{ schedulerId: 20, name: "West Coast Retail" }],
    });
  if (path === "/time-clock/v1/time-clocks")
    return response({ timeClocks: [] });
  if (path === "/users/v1/custom-fields")
    return response({ customFields: state.fields });
  if (/\/custom-fields\/\d+\/options$/.test(path) && method === "POST") {
    const fieldId = Number(path.split("/")[4]);
    const field = state.fields.find((item) => item.id === fieldId);
    const created = { id: fieldId === 30 ? 12 : 50, ...body };
    field.dropdownOptions.push(created);
    return response(created);
  }
  if (path === "/users/v1/users") {
    if (method === "PUT")
      for (const update of body) {
        const user = state.users.find((item) => item.userId === update.userId);
        const next = [...(user.customFields || [])];
        for (const field of update.customFields || []) {
          const index = next.findIndex(
            (item) => item.customFieldId === field.customFieldId,
          );
          const stored = {
            customFieldId: field.customFieldId,
            value: field.value,
          };
          if (index >= 0) next[index] = stored;
          else next.push(stored);
        }
        user.customFields = next;
      }
    const filter = url.searchParams.getAll("userIds").map(Number);
    return response({
      users: filter.length
        ? state.users.filter((u) => filter.includes(u.userId))
        : state.users,
    });
  }
  if (path === "/jobs/v1/jobs" && method === "POST") {
    const created = body.map((job, i) => {
      const value = {
        code: "",
        description: "",
        ...job,
        jobId: `new-${state.jobs.length}-${i}`,
      };
      if (job.parentId) {
        const parent = state.jobs.find((p) => p.jobId === job.parentId);
        parent.subJobs.push(value);
      } else {
        value.subJobs = job.subJobs.map((s, index) => ({
          ...s,
          jobId: `${value.jobId}-sub-${index}`,
          parentId: value.jobId,
        }));
        state.jobs.push(value);
      }
      return value;
    });
    return response({ jobs: created }, 201);
  }
  if (path === "/jobs/v1/jobs") {
    const filter = url.searchParams.get("jobNames");
    return response({
      jobs: filter
        ? state.jobs.filter(
            (j) => j.title.toLowerCase() === filter.toLowerCase(),
          )
        : state.jobs,
    });
  }
  if (path.startsWith("/jobs/v1/jobs/")) {
    const id = decodeURIComponent(path.split("/").at(-1)),
      job = state.jobs
        .flatMap((p) => [p, ...p.subJobs])
        .find((j) => j.jobId === id);
    if (!job)
      return new Response(JSON.stringify({ detail: "Job missing" }), {
        status: 404,
      });
    if (method === "PUT") {
      if (key === "test-write-error")
        return new Response(
          JSON.stringify({
            requestId: "write-422",
            detail: [
              { loc: ["body", "assign"], msg: "Example validation failure" },
            ],
          }),
          { status: 422 },
        );
      Object.assign(job, body);
    }
    return response({ job });
  }
  throw new Error(`Unmocked request ${method} ${path}`);
};
