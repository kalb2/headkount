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
        customFields: [{ customFieldId: 30, value: [{ id: 10 }] }],
      },
      {
        userId: 102,
        firstName: "Sam",
        lastName: "Example",
        email: "sam@example.test",
        customFields: [],
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
  if (path === "/users/v1/smart-groups") {
    if (key === "test-groups-error")
      return new Response(
        JSON.stringify({
          requestId: "groups-403",
          detail: "Smart Groups permission denied",
        }),
        { status: 403 },
      );
    return response({
      smartGroups:
        key === "test-empty-groups"
          ? []
          : [
              { id: 1, name: "MEJ Qualified", usersCount: 12 },
              { id: 2, name: "Refi Qualified", usersCount: 8 },
              { id: 3, name: "House Labs Qualified", usersCount: 14 },
            ],
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
  if (path.endsWith("/custom-fields/30/options") && method === "POST") {
    state.fields[0].dropdownOptions.push({ id: 12, ...body });
    return response({ id: 12, ...body });
  }
  if (path === "/users/v1/users") {
    if (method === "PUT")
      for (const update of body) {
        const user = state.users.find((u) => u.userId === update.userId);
        user.customFields = update.customFields;
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
