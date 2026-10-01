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
function dropdownField(fields, id, label) {
  const fieldId = ids([id], `${label} field ID`)[0];
  const field = fields.find((f) => Number(f.id) === fieldId);
  assert(field?.type === "dropdown", `${label} must be an existing dropdown user field.`);
  assert(
    field.isMultiSelect === true,
    `${label} must allow multiple selections so users can qualify for multiple values.`,
  );
  return field;
}
function activeOption(field, id, label) {
  const optionId = ids([id], `${label} option ID`)[0];
  const option = field.dropdownOptions?.find(
    (o) => Number(o.id) === optionId && !o.isDeleted && !o.isDisabled,
  );
  assert(option, `${label} option is unavailable. Refresh the account.`, 409);
  return option;
}
function optionByValue(field, value) {
  const wanted = String(value || "").trim().toLowerCase();
  return field.dropdownOptions?.find(
    (o) =>
      !o.isDeleted &&
      !o.isDisabled &&
      String(o.value || "").trim().toLowerCase() === wanted,
  );
}
function qualificationDescription(doorName, brandName = null) {
  return brandName
    ? `Headkount qualification: Door=${doorName}; Brand=${brandName}`
    : `Headkount qualification: Door=${doorName}`;
}
function findManagedGroup(groups, name, description, segmentId) {
  const sameName = groups.filter(
    (g) => String(g.name || "").trim().toLowerCase() === name.toLowerCase(),
  );
  if (!sameName.length) return null;
  const managed = sameName.find(
    (g) =>
      g.description === description &&
      Number(g.groupSegmentId ?? g.segmentId) === Number(segmentId),
  );
  assert(
    managed,
    `A smart group named “${name}” already exists but was not created for this exact Headkount qualification. Rename it or choose a different door/brand name.`,
    409,
  );
  return managed;
}
function qualifiedGroupName(doorName, brandName = null) {
  return brandName ? `Door: ${doorName} · Brand: ${brandName}` : `Door: ${doorName}`;
}
async function loadQualificationFields(key, input, request) {
  const fields = await collectPages(
    key,
    "/users/v1/custom-fields?customFieldTypes=dropdown",
    "customFields",
    { request },
  );
  const doorField = dropdownField(fields.rows, input.doorFieldId, "Door eligibility");
  const brandField = dropdownField(fields.rows, input.brandFieldId, "Brand eligibility");
  assert(doorField.id !== brandField.id, "Door and Brand eligibility must use different user fields.");
  return { doorField, brandField };
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
  if (action === "createQualifiedDoor") {
    const doorName = title(input.title);
    assert(
      Array.isArray(input.subJobs) && input.subJobs.length > 0 && input.subJobs.length <= 499,
      "Add 1–499 brand sub-jobs.",
    );
    assert(ids(input.instanceIds, "Schedule/time clock IDs").length, "Choose a schedule or time clock.");
    const { doorField, brandField } = await loadQualificationFields(key, input, request);
    const segmentId = ids([input.segmentId], "Smart-group segment ID")[0];
    const segmentJson = await request(key, "/users/v1/smart-group-segments");
    const segments = segmentJson?.data?.segments || segmentJson?.data?.smartGroupSegments || [];
    assert(
      segments.some((segment) => Number(segment.id) === segmentId),
      "The selected smart-group segment is unavailable. Refresh the account.",
      409,
    );
    const brandOptions = input.subJobs.map((sub) => ({
      title: title(sub.title),
      option: activeOption(brandField, sub.brandOptionId, `Brand “${sub.title}”`),
    }));
    assert(
      new Set(brandOptions.map((x) => x.title.toLowerCase())).size === brandOptions.length,
      "Brand sub-job names must be unique within the door.",
    );
    const doorOption = optionByValue(doorField, doorName);
    const groups = await loadSmartGroups(key, request);
    const groupSpecs = [
      {
        key: "door",
        name: qualifiedGroupName(doorName),
        description: qualificationDescription(doorName),
        brandOptionId: null,
      },
      ...brandOptions.map(({ title: brandName, option }) => ({
        key: `brand:${brandName}`,
        name: qualifiedGroupName(doorName, brandName),
        description: qualificationDescription(doorName, brandName),
        brandName,
        brandOptionId: Number(option.id),
      })),
    ].map((spec) => ({
      ...spec,
      existing: findManagedGroup(groups, spec.name, spec.description, segmentId),
    }));
    const [schedulerResult, clockResult] = await Promise.allSettled([
      request(key, "/scheduler/v1/schedulers").then((r) => responseRows(r, "schedulers")),
      request(key, "/time-clock/v1/time-clocks").then((r) => responseRows(r, "timeClocks")),
    ]);
    const instances = [
      ...(schedulerResult.status === "fulfilled" ? schedulerResult.value : [])
        .filter((x) => !x.isArchived)
        .map((x) => Number(x.schedulerId)),
      ...(clockResult.status === "fulfilled" ? clockResult.value : [])
        .filter((x) => !x.isArchived)
        .map((x) => Number(x.id)),
    ];
    const requestedInstances = ids(input.instanceIds, "Schedule/time clock IDs");
    assert(
      requestedInstances.every((id) => instances.includes(id)),
      "A selected schedule/time clock is unavailable. Refresh the account.",
      409,
    );
    const existingJobs = await collectPages(
      key,
      `/jobs/v1/jobs?includeDeleted=false&jobNames=${encodeURIComponent(doorName)}`,
      "jobs",
      { request },
    );
    assert(
      !existingJobs.rows.some(
        (j) => !j.parentId && String(j.title).toLowerCase() === doorName.toLowerCase(),
      ),
      "A door with this name already exists. Manage it instead.",
      409,
    );
    Object.assign(plan, {
      doorName,
      doorField,
      brandField,
      segmentId,
      doorOption: doorOption || null,
      needsDoorOption: !doorOption,
      brandOptions,
      groupSpecs,
      requestedInstances,
    });
  } else if (action === "createDoor") {
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
    if (k === "instanceIds")
      return (
        stable(ids(actual.instanceIds || []).sort((a, b) => a - b)) ===
        stable(ids(v || []).sort((a, b) => a - b))
      );
    if (k === "customFields")
      return stable(customFields(actual.customFields || [])) === stable(v);
    if (k === "code" || k === "description")
      return String(actual[k] ?? "") === String(v ?? "");
    if (k === "color")
      return String(actual[k] ?? "").toLowerCase() === String(v ?? "").toLowerCase();
    if (k === "gps") {
      const actualGps = actual.gps || {};
      return Object.entries(v || {}).every(([field, value]) => {
        if (field === "latitude" || field === "longitude")
          return Number(actualGps[field]) === Number(value);
        return String(actualGps[field] ?? "") === String(value ?? "");
      });
    }
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
    doorField: p.doorField,
    brandField: p.brandField,
    segmentId: p.segmentId,
    doorOption: p.doorOption,
    needsDoorOption: p.needsDoorOption,
    brandOptions: p.brandOptions,
    groupSpecs: p.groupSpecs,
    requestedInstances: p.requestedInstances,
  });
  assert(
    stable(comparable(fresh)) === stable(comparable(plan)),
    "Data changed since preview. Nothing was written; refresh the preview.",
    409,
  );
  const results = [];
  if (plan.action === "createQualifiedDoor") {
    let doorOptionId = fresh.doorOption ? Number(fresh.doorOption.id) : null;
    try {
      if (!doorOptionId) {
        const createdOption = await request(
          key,
          `/users/v1/custom-fields/${fresh.doorField.id}/options`,
          {
            method: "POST",
            body: JSON.stringify({ value: fresh.doorName, isDisabled: false }),
          },
        );
        doorOptionId = Number(createdOption?.data?.id);
        if (!Number.isSafeInteger(doorOptionId) || doorOptionId <= 0) {
          const fields = await collectPages(
            key,
            `/users/v1/custom-fields?customFieldIds=${fresh.doorField.id}`,
            "customFields",
            { request },
          );
          const currentField = fields.rows.find(
            (field) => Number(field.id) === Number(fresh.doorField.id),
          );
          doorOptionId = Number(optionByValue(currentField, fresh.doorName)?.id);
        }
        assert(
          Number.isSafeInteger(doorOptionId) && doorOptionId > 0,
          "The new Door eligibility option could not be verified.",
          502,
        );
        results.push({
          status: "verified",
          label: `${fresh.doorField.name} → ${fresh.doorName}`,
        });
      } else {
        results.push({
          status: "verified",
          label: `${fresh.doorField.name} → ${fresh.doorName} (reused)`,
        });
      }

      const groupIds = new Map();
      for (const spec of fresh.groupSpecs) {
        const dropdownFilters = [
          {
            fieldId: Number(fresh.doorField.id),
            optionIds: [doorOptionId],
          },
        ];
        if (spec.brandOptionId)
          dropdownFilters.push({
            fieldId: Number(fresh.brandField.id),
            optionIds: [Number(spec.brandOptionId)],
          });
        const filters = {
          operator: "and",
          dropdownFilters,
        };

        if (spec.existing) {
          const groupId = Number(spec.existing.id);
          const updatedGroup = await request(
            key,
            `/users/v1/smart-groups/${groupId}`,
            {
              method: "PUT",
              body: JSON.stringify({
                name: spec.name,
                description: spec.description,
                groupSegmentId: fresh.segmentId,
                filters,
              }),
            },
          );
          assert(
            updatedGroup?.data?.id === groupId,
            `Existing Smart Group “${spec.name}” could not be repaired.`,
            502,
          );
          groupIds.set(spec.key, groupId);
          results.push({ status: "verified", label: `${spec.name} (repaired/reused)` });
          continue;
        }

        const createdGroup = await request(key, "/users/v1/smart-groups", {
          method: "POST",
          body: JSON.stringify({
            name: spec.name,
            description: spec.description,
            groupSegmentId: fresh.segmentId,
            filters,
          }),
        });
        const groupId = Number(createdGroup?.data?.id);
        assert(
          Number.isSafeInteger(groupId) && groupId > 0,
          `Smart group “${spec.name}” was created but its ID could not be verified.`,
          502,
        );
        groupIds.set(spec.key, groupId);
        results.push({ status: "verified", label: spec.name });
      }

      const gps = {};
      if (fresh.input.gps?.address?.trim()) gps.address = fresh.input.gps.address.trim();
      for (const [coordinate, max] of [
        ["latitude", 90],
        ["longitude", 180],
      ]) {
        const raw = fresh.input.gps?.[coordinate];
        if (raw !== undefined && raw !== null && String(raw).trim() !== "") {
          assert(
            Number.isFinite(Number(raw)) && Math.abs(Number(raw)) <= max,
            `${coordinate} is out of range.`,
          );
          gps[coordinate] = Number(raw);
        }
      }
      assert(
        ("latitude" in gps) === ("longitude" in gps),
        "Supply both coordinates or leave both blank.",
      );

      // Connecteam currently persists parent assignments reliably during nested
      // creation, but can drop custom assignments on nested sub-jobs. Create a
      // temporary inherited sub-job so the parent is eligible for future
      // sub-job additions, then create every real brand sub-job explicitly.
      const bootstrapTitle = "__Headkount setup__";
      const parent = {
        title: fresh.doorName,
        code: fresh.input.code?.trim() || "",
        description: fresh.input.description?.trim() || "",
        color: "#3968BB",
        instanceIds: fresh.requestedInstances,
        assign: {
          type: "both",
          userIds: [],
          // Connecteam only exposes a Smart Group to a sub-job when that
          // group is also qualified on the parent job. The parent therefore
          // carries the Door-only group plus every Door+Brand group; each
          // sub-job narrows that set to its matching Door+Brand group.
          groupIds: [
            groupIds.get("door"),
            ...fresh.brandOptions.map(({ title: brandName }) =>
              groupIds.get(`brand:${brandName}`),
            ),
          ],
        },
        subJobs: [{ title: bootstrapTitle }],
        ...(Object.keys(gps).length ? { gps } : {}),
      };
      const response = await request(key, "/jobs/v1/jobs", {
        method: "POST",
        body: JSON.stringify([parent]),
      });
      const created = responseRows(response, "jobs");
      assert(
        created.length === 1,
        "Create response did not identify exactly one created job.",
        502,
      );

      let actual = await getJob(key, created[0].jobId, request);
      const { subJobs: _bootstrap, ...parentExpected } = parent;
      assert(
        matchesUpdate(actual, parentExpected),
        "Created parent job settings could not be verified.",
        502,
      );
      const bootstrap = actual.subJobs?.find(
        (candidate) => candidate.title === bootstrapTitle,
      );
      assert(
        bootstrap?.jobId,
        "Temporary setup sub-job could not be identified.",
        502,
      );

      const expectedSubJobs = fresh.brandOptions.map(({ title: brandName }) => ({
        parentId: actual.jobId,
        title: brandName,
        useParentData: false,
        assign: {
          type: "both",
          userIds: [],
          groupIds: [groupIds.get(`brand:${brandName}`)],
        },
        description: fresh.input.description?.trim() || "",
        ...(Object.keys(gps).length ? { gps: copy(gps) } : {}),
      }));

      const subResponse = await request(key, "/jobs/v1/jobs", {
        method: "POST",
        body: JSON.stringify(expectedSubJobs),
      });
      const createdSubs = responseRows(subResponse, "jobs");
      assert(
        createdSubs.length === expectedSubJobs.length,
        "Create response did not identify every brand sub-job.",
        502,
      );

      for (let index = 0; index < expectedSubJobs.length; index++) {
        const expectedSub = expectedSubJobs[index];
        const createdSub =
          createdSubs.find(
            (candidate) =>
              candidate.title &&
              String(candidate.title).toLowerCase() ===
                expectedSub.title.toLowerCase(),
          ) || createdSubs[index];
        assert(
          createdSub?.jobId,
          `Created sub-job “${expectedSub.title}” was not identified.`,
          502,
        );
        const fullSubJob = await getJob(key, createdSub.jobId, request);
        assert(
          matchesUpdate(fullSubJob, expectedSub),
          `Created sub-job “${expectedSub.title}” could not be verified.`,
          502,
        );
      }

      await request(key, jobPath(bootstrap.jobId), { method: "DELETE" });
      actual = await getJob(key, actual.jobId, request);
      results.push({
        status: "verified",
        label: fresh.doorName,
        jobId: actual.jobId,
      });
      return { results, complete: true };
    } catch (error) {
      results.push({
        status: error.status >= 500 ? "unknown" : "failed",
        ...errorData(error),
      });
      return { results, complete: false };
    }
  }
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
      for (const expectedSub of subJobs) {
        const summary = actual.subJobs.find(
          (candidate) =>
            String(candidate.title || "").toLowerCase() ===
            expectedSub.title.toLowerCase(),
        );
        assert(
          summary?.jobId,
          `Created sub-job “${expectedSub.title}” is missing from the parent response.`,
          502,
        );
        const fullSubJob = await getJob(key, summary.jobId, request);
        assert(
          matchesUpdate(fullSubJob, expectedSub),
          `Created sub-job “${expectedSub.title}” could not be verified.`,
          502,
        );
      }
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
