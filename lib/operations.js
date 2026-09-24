import {
  ctFetch,
  assert,
  ids,
  loadSmartGroups,
  responseRows,
  collectPages,
  chunks,
  extractSelectedIds,
  errorData,
} from "./connecteam.js";

export function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .filter((k) => value[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${stable(value[k])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
const copy = (v) => structuredClone(v);
const title = (v) => {
  assert(
    typeof v === "string" && v.trim() && v.trim().length <= 128,
    "Names must contain 1–128 characters.",
  );
  return v.trim();
};
const jobPath = (id) => {
  assert(
    typeof id === "string" && id.length > 0 && id.length < 200,
    "Invalid job ID.",
  );
  return `/jobs/v1/jobs/${encodeURIComponent(id)}`;
};
function customFields(fields) {
  return fields?.map((f) => ({
    customFieldId: ids([f.customFieldId])[0],
    value: copy(f.value),
  }));
}
function assignment(a) {
  assert(
    a && ["both", "users", "groups"].includes(a.type || "both"),
    "Current assignment is missing or unsupported.",
    502,
  );
  return {
    type: "both",
    userIds: ids(a.userIds || []),
    groupIds: ids(a.groupIds || []),
  };
}
function pick(object, keys) {
  return Object.fromEntries(
    keys
      .filter((k) => Object.hasOwn(object, k))
      .map((k) => [k, copy(object[k])]),
  );
}
export function jobState(job) {
  return pick(job, [
    "jobId",
    "parentId",
    "title",
    "code",
    "description",
    "gps",
    "fenceSize",
    "customFields",
    "assign",
    "useParentData",
    "isDeleted",
    "instanceIds",
  ]);
}
export function buildRepair(current, parent, intent) {
  assert(
    current.parentId && !current.isDeleted,
    "Only active sub-jobs can be repaired.",
  );
  assert(
    parent?.jobId === current.parentId && !parent.isDeleted,
    "The parent job is missing or deleted.",
    409,
  );
  assert(
    ["add", "replace", "inherit"].includes(intent.mode),
    "Invalid assignment operation.",
  );
  assert(
    typeof current.useParentData === "boolean",
    "Sub-job inheritance setting is missing.",
    502,
  );
  const next = {
    parentId: current.parentId,
    title: title(current.title),
    ...pick(current, ["code"]),
    useParentData: intent.mode === "inherit",
  };
  if (current.customFields != null)
    next.customFields = customFields(current.customFields);
  if (intent.mode === "inherit") return next;
  // When leaving inheritance, materialize the CURRENT parent settings first.
  const source = current.useParentData ? parent : current;
  Object.assign(next, pick(source, ["description", "gps", "fenceSize"]));
  next.assign = assignment(source.assign);
  const chosen = ids(intent.groupIds, "Selected smart groups");
  assert(chosen.length, "Choose at least one smart group.");
  next.assign.groupIds =
    intent.mode === "replace"
      ? chosen
      : [...new Set([...next.assign.groupIds, ...chosen])];
  return next;
}
export function buildDoor(input) {
  const gps = {};
  if (input.gps?.address?.trim()) gps.address = input.gps.address.trim();
  for (const [key, max] of [
    ["latitude", 90],
    ["longitude", 180],
  ]) {
    const v = input.gps?.[key];
    if (v !== undefined && v !== null && String(v).trim() !== "") {
      assert(
        Number.isFinite(Number(v)) && Math.abs(Number(v)) <= max,
        `${key} is out of range.`,
      );
      gps[key] = Number(v);
    }
  }
  assert(
    "latitude" in gps === "longitude" in gps,
    "Supply both coordinates or leave both blank.",
  );
  const parent = {
    title: title(input.title),
    code: input.code?.trim() || "",
    description: input.description?.trim() || "",
    color: "#3968BB",
    instanceIds: ids(input.instanceIds, "Schedule/time clock IDs"),
    assign: {
      type: "both",
      userIds: [],
      groupIds: ids(input.parentGroupIds || []),
    },
  };
  assert(parent.instanceIds.length, "Choose a schedule or time clock.");
  if (Object.keys(gps).length) parent.gps = gps;
  assert(
    Array.isArray(input.subJobs) &&
      input.subJobs.length > 0 &&
      input.subJobs.length <= 499,
    "Add 1–499 brand sub-jobs. A standalone job cannot gain sub-jobs later.",
  );
  parent.subJobs = input.subJobs.map((s) => {
    const groupIds = ids(s.groupIds || []);
    const sub = { title: title(s.title), useParentData: !groupIds.length };
    if (groupIds.length)
      Object.assign(
        sub,
        {
          assign: { type: "both", userIds: [], groupIds },
          description: parent.description,
        },
        parent.gps ? { gps: copy(parent.gps) } : {},
      );
    else
      assert(
        parent.assign.groupIds.length,
        `“${sub.title}” must have smart groups or inherit a parent with smart groups.`,
      );
    return sub;
  });
  assert(
    new Set(parent.subJobs.map((s) => s.title.toLowerCase())).size ===
      parent.subJobs.length,
    "Brand sub-job names must be unique within the door.",
  );
  return [parent];
}
async function getJob(key, id, request) {
  const json = await request(key, jobPath(id));
  assert(
    json?.data?.job?.jobId === id,
    "Connecteam returned a missing or mismatched job.",
    502,
  );
  return json.data.job;
}
function validateGroups(groups, requested) {
  const available = new Set(groups.map((g) => g.id));
  for (const id of ids(requested))
    assert(
      available.has(id),
      `Smart group ${id} is no longer available. Refresh and preview again.`,
      409,
    );
}
async function repairRecord(key, intent, request) {
  const current = await getJob(key, intent.jobId, request);
  assert(current.parentId, "Select a sub-job, not a parent job.");
  const parent = await getJob(key, current.parentId, request);
  return {
    jobId: current.jobId,
    label: `${parent.title} → ${current.title}`,
    before: jobState(current),
    parentBefore: jobState(parent),
    after: buildRepair(current, parent, intent),
  };
}
export async function previewOperation(key, action, input, request = ctFetch) {
  assert(
    input && typeof input === "object" && !Array.isArray(input),
    "Missing operation details.",
  );
  let plan = { action, input: copy(input), createdAt: Date.now(), records: [] };
  if (action === "createDoor") {
    const groups = await loadSmartGroups(key, request);
    assert(
      groups.length,
      "No smart groups are available. Load smart groups before creating a setup.",
    );
    const body = buildDoor(input);
    validateGroups(groups, [
      ...body[0].assign.groupIds,
      ...body[0].subJobs.flatMap((s) => s.assign?.groupIds || []),
    ]);
    const [s, t] = await Promise.allSettled([
      request(key, "/scheduler/v1/schedulers").then((r) =>
        responseRows(r, "schedulers"),
      ),
      request(key, "/time-clock/v1/time-clocks").then((r) =>
        responseRows(r, "timeClocks"),
      ),
    ]);
    const instances = [
      ...(s.status === "fulfilled" ? s.value : [])
        .filter((x) => !x.isArchived)
        .map((x) => ({ id: x.schedulerId, name: x.name })),
      ...(t.status === "fulfilled" ? t.value : [])
        .filter((x) => !x.isArchived)
        .map((x) => ({ id: x.id, name: x.name })),
    ];
    assert(
      body[0].instanceIds.every((id) =>
        instances.some((x) => Number(x.id) === id),
      ),
      `A selected schedule/time clock is unavailable. ${[s, t]
        .filter((r) => r.status === "rejected")
        .map((r) => r.reason.message)
        .join(" ")}`,
    );
    const existing = await collectPages(
      key,
      `/jobs/v1/jobs?includeDeleted=false&jobNames=${encodeURIComponent(body[0].title)}`,
      "jobs",
      { request },
    );
    assert(
      !existing.rows.some(
        (j) =>
          !j.parentId && j.title.toLowerCase() === body[0].title.toLowerCase(),
      ),
      "A door with this name already exists. Manage it instead.",
      409,
    );
    Object.assign(plan, { body, groups, instances });
  } else if (action === "addBrand") {
    const parent = await getJob(key, input.parentId, request);
    assert(
      !parent.parentId && !parent.isDeleted && parent.subJobs?.length,
      "This must be an active parent already containing sub-jobs.",
    );
    const groups = await loadSmartGroups(key, request);
    const groupIds = ids(input.groupIds || []);
    validateGroups(groups, groupIds);
    const sub = {
      parentId: parent.jobId,
      title: title(input.title),
      useParentData: groupIds.length === 0,
    };
    assert(
      !parent.subJobs.some(
        (s) =>
          !s.isDeleted && s.title.toLowerCase() === sub.title.toLowerCase(),
      ),
      "This brand already exists under the door.",
      409,
    );
    if (groupIds.length)
      Object.assign(sub, pick(parent, ["description", "gps", "fenceSize"]), {
        assign: { type: "both", userIds: [], groupIds },
      });
    else
      assert(
        assignment(parent.assign).groupIds.length ||
          assignment(parent.assign).userIds.length,
        "Select smart groups; the parent has no assignments to inherit.",
      );
    Object.assign(plan, {
      body: [sub],
      groups,
      parentBefore: jobState(parent),
      parentTitle: parent.title,
    });
  } else if (action === "repairSubJobs") {
    assert(
      Array.isArray(input.repairs) &&
        input.repairs.length > 0 &&
        input.repairs.length <= 100,
      "Select 1–100 sub-jobs per preview.",
    );
    assert(
      new Set(input.repairs.map((r) => r.jobId)).size === input.repairs.length,
      "Duplicate sub-job selections.",
    );
    const groups = await loadSmartGroups(key, request);
    for (const intent of input.repairs) {
      if (intent.mode !== "inherit") validateGroups(groups, intent.groupIds);
      plan.records.push(await repairRecord(key, intent, request));
    }
    plan.groups = groups;
  } else if (action === "bulkAssignDoor" || action === "createDoorOption") {
    const fieldId = ids([input.customFieldId])[0];
    const fields = await collectPages(
      key,
      `/users/v1/custom-fields?customFieldIds=${fieldId}`,
      "customFields",
      { request },
    );
    const field = fields.rows.find((f) => f.id === fieldId);
    assert(field?.type === "dropdown", "Choose an existing dropdown field.");
    plan.field = field;
    if (action === "createDoorOption") {
      assert(
        typeof input.value === "string" && input.value.trim(),
        "Enter a dropdown value.",
      );
      plan.body = { value: input.value.trim(), isDisabled: false };
      assert(
        !field.dropdownOptions?.some(
          (o) =>
            !o.isDeleted &&
            o.value.toLowerCase() === plan.body.value.toLowerCase(),
        ),
        "This dropdown value already exists.",
        409,
      );
    } else {
      assert(
        ["add", "remove"].includes(input.mode),
        "Invalid assignment operation.",
      );
      assert(
        typeof field.isMultiSelect === "boolean",
        "Dropdown selection settings are missing; refusing to overwrite values.",
        502,
      );
      const optionId = ids([input.optionId])[0];
      assert(
        field.dropdownOptions?.some(
          (o) => o.id === optionId && !o.isDeleted && !o.isDisabled,
        ),
        "The dropdown value is unavailable.",
      );
      const userIds = ids(input.userIds);
      assert(
        userIds.length > 0 && userIds.length <= 100,
        "Select 1–100 users per preview.",
      );
      for (const batch of chunks(userIds, 25)) {
        const users = responseRows(
          await request(
            key,
            `/users/v1/users?limit=500&${batch.map((id) => `userIds=${id}`).join("&")}`,
          ),
          "users",
        );
        for (const id of batch) {
          const user = users.find((u) => u.userId === id);
          assert(user, `User ${id} is missing or inactive.`, 409);
          const before = extractSelectedIds(
            user.customFields?.find((f) => f.customFieldId === fieldId)?.value,
          );
          const after =
            input.mode === "remove"
              ? before.filter((x) => x !== optionId)
              : field.isMultiSelect
                ? [...new Set([...before, optionId])]
                : [optionId];
          assert(
            !field.isRequired || after.length,
            "This required field cannot be cleared.",
          );
          plan.records.push({
            userId: id,
            label: `${user.firstName} ${user.lastName}`,
            before,
            after,
          });
        }
      }
    }
  } else assert(false, "Unknown action.");
  return plan;
}

function matchesUpdate(actual, expected) {
  return Object.entries(expected).every(([k, v]) => {
    if (k === "assign")
      return ["userIds", "groupIds"].every(
        (field) =>
          stable(ids(actual.assign?.[field] || []).sort((a, b) => a - b)) ===
          stable(ids(v[field] || []).sort((a, b) => a - b)),
      );
    if (k === "customFields")
      return stable(customFields(actual.customFields || [])) === stable(v);
    return stable(actual[k]) === stable(v);
  });
}
export async function applyOperation(key, plan, request = ctFetch) {
  assert(
    plan &&
      Date.now() - plan.createdAt < 10 * 60 * 1000 &&
      plan.createdAt <= Date.now(),
    "Preview expired. Generate a fresh preview.",
    409,
  );
  const fresh = await previewOperation(key, plan.action, plan.input, request);
  // Revalidate the entire preview before the first write. Check again directly before each repair.
  const comparable = (p) => ({
    body: p.body,
    records: p.records,
    field: p.field,
    parentBefore: p.parentBefore,
  });
  assert(
    stable(comparable(fresh)) === stable(comparable(plan)),
    "Data changed since preview. Nothing was written; refresh the preview.",
    409,
  );
  const results = [];
  if (["createDoor", "addBrand", "createDoorOption"].includes(plan.action)) {
    let response;
    try {
      response = await request(
        key,
        plan.action !== "createDoorOption"
          ? "/jobs/v1/jobs"
          : `/users/v1/custom-fields/${plan.field.id}/options`,
        { method: "POST", body: JSON.stringify(fresh.body) },
      );
    } catch (error) {
      return {
        results: [
          {
            status: error.status >= 500 ? "unknown" : "failed",
            ...errorData(error),
          },
        ],
        complete: false,
      };
    }
    try {
      if (plan.action === "createDoorOption") {
        const fields = await collectPages(
          key,
          `/users/v1/custom-fields?customFieldIds=${plan.field.id}`,
          "customFields",
          { request },
        );
        assert(
          fields.rows
            .find((f) => f.id === plan.field.id)
            ?.dropdownOptions?.some(
              (o) =>
                o.value === plan.body.value && !o.isDeleted && !o.isDisabled,
            ),
          "The new dropdown value could not be verified.",
          502,
        );
        return {
          results: [
            {
              status: "verified",
              label: `${plan.field.name} → ${plan.body.value}`,
            },
          ],
          complete: true,
        };
      }
      const created = responseRows(response, "jobs");
      assert(
        created.length === 1,
        "Create response did not identify exactly one created job.",
        502,
      );
      const actual = await getJob(key, created[0].jobId, request);
      const expected = fresh.body[0];
      if (plan.action === "addBrand") {
        assert(
          matchesUpdate(actual, expected),
          "Created brand settings could not be verified.",
          502,
        );
        return {
          results: [
            {
              status: "verified",
              label: `${plan.parentTitle} → ${actual.title}`,
              jobId: actual.jobId,
            },
          ],
          complete: true,
        };
      }
      const { subJobs, ...parentExpected } = expected;
      assert(
        matchesUpdate(actual, parentExpected),
        "Created parent settings could not be verified.",
        502,
      );
      assert(
        actual.subJobs?.length === subJobs.length,
        "Created sub-job count does not match.",
        502,
      );
      for (const s of subJobs)
        assert(
          actual.subJobs.some((a) => matchesUpdate(a, s)),
          `Created sub-job “${s.title}” could not be verified.`,
          502,
        );
      return {
        results: [
          { status: "verified", label: actual.title, jobId: actual.jobId },
        ],
        complete: true,
      };
    } catch (error) {
      return {
        results: [
          { status: "saved-unverified", ...errorData(error), response },
        ],
        complete: false,
      };
    }
  }
  for (let i = 0; i < plan.records.length; i++) {
    const expected = plan.records[i];
    let written = false,
      attempted = false;
    try {
      if (plan.action === "repairSubJobs") {
        const intent = plan.input.repairs[i];
        if (intent.mode !== "inherit")
          validateGroups(await loadSmartGroups(key, request), intent.groupIds);
        const current = await repairRecord(key, intent, request);
        assert(
          stable(current) === stable(expected),
          `“${expected.label}” changed after preview.`,
          409,
        );
        attempted = true;
        await request(key, jobPath(expected.jobId), {
          method: "PUT",
          body: JSON.stringify(current.after),
        });
        written = true;
        const saved = await getJob(key, expected.jobId, request);
        assert(
          matchesUpdate(saved, current.after),
          "Write returned success but verification differed. Inspect this sub-job before retrying.",
          502,
        );
      } else {
        // Re-read each user just before writing; other custom fields are omitted intentionally.
        const user = responseRows(
          await request(key, `/users/v1/users?userIds=${expected.userId}`),
          "users",
        ).find((u) => u.userId === expected.userId);
        assert(user, "User is missing or inactive.", 409);
        const before = extractSelectedIds(
          user.customFields?.find((f) => f.customFieldId === plan.field.id)
            ?.value,
        );
        assert(
          stable(before) === stable(expected.before),
          "User value changed since preview.",
          409,
        );
        attempted = true;
        await request(key, "/users/v1/users?includeSmartGroupIds=false", {
          method: "PUT",
          body: JSON.stringify([
            {
              userId: expected.userId,
              customFields: [
                {
                  customFieldId: plan.field.id,
                  value: expected.after.map((id) => ({ id })),
                },
              ],
            },
          ]),
        });
        written = true;
        const saved = responseRows(
          await request(key, `/users/v1/users?userIds=${expected.userId}`),
          "users",
        ).find((u) => u.userId === expected.userId);
        assert(
          saved,
          "Updated user was missing from verification response.",
          502,
        );
        assert(
          stable(
            extractSelectedIds(
              saved?.customFields?.find(
                (f) => f.customFieldId === plan.field.id,
              )?.value,
            ),
          ) === stable(expected.after),
          "User write could not be verified.",
          502,
        );
      }
      results.push({
        label: expected.label,
        jobId: expected.jobId,
        userId: expected.userId,
        status: "verified",
      });
    } catch (error) {
      results.push({
        label: expected.label,
        jobId: expected.jobId,
        userId: expected.userId,
        status: written
          ? "saved-unverified"
          : attempted && error.status >= 500
            ? "unknown"
            : "failed",
        ...errorData(error),
      });
      for (const rest of plan.records.slice(i + 1))
        results.push({
          label: rest.label,
          jobId: rest.jobId,
          userId: rest.userId,
          status: "not-attempted",
        });
      break;
    }
  }
  return { results, complete: results.every((r) => r.status === "verified") };
}
