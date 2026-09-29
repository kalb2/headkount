import {
  ctFetch,
  assert,
  ids,
  loadSmartGroups,
  loadSmartGroupById,
  loadSmartGroupSegments,
  responseRows,
  collectPages,
  chunks,
  extractSelectedIds,
  errorData,
  ConnecteamError,
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
function validateGroups(groups, requested, reserved = new Set()) {
  const available = new Set(groups.map((g) => g.id));
  for (const id of ids(requested))
    assert(
      reserved.has(id) || available.has(id),
      `Smart group ${id} is no longer available. Refresh and preview again.`,
      409,
    );
}
const TEMP_BASE = 9_007_199_254_000_000;
function groupKeys(values) {
  if (values == null) return [];
  assert(Array.isArray(values), "New smart group selections must be an array.");
  assert(
    values.every(
      (key) => typeof key === "string" && /^[\w.-]{1,40}$/.test(key),
    ),
    "Invalid new smart group selection.",
  );
  return [...new Set(values)];
}
function referencedGroupKeys(action, input) {
  if (action === "createDoor")
    return [
      ...groupKeys(input.parentNewGroupKeys),
      ...(Array.isArray(input.subJobs) ? input.subJobs : []).flatMap((sub) =>
        groupKeys(sub?.newGroupKeys),
      ),
    ];
  if (action === "addBrand") return groupKeys(input.newGroupKeys);
  if (action === "repairSubJobs")
    return (Array.isArray(input.repairs) ? input.repairs : []).flatMap(
      (repair) =>
        repair?.mode === "inherit" ? [] : groupKeys(repair?.newGroupKeys),
    );
  return [];
}
function optionalDescription(value) {
  if (value == null || value === "") return "";
  assert(
    typeof value === "string" && value.trim().length <= 2000,
    "Descriptions must be 2000 characters or fewer.",
  );
  return value.trim();
}
function segmentColor(value) {
  assert(
    typeof value === "string" && /^#[0-9A-Fa-f]{6}$/.test(value.trim()),
    "Segment color must be a #RRGGBB hex code.",
  );
  return value.trim().toLowerCase();
}
function dropdownFilters(raw, fields) {
  const source = raw?.dropdownFilters || [];
  assert(Array.isArray(source), "Dropdown filters must be an array.");
  assert(source.length <= 10, "Use at most 10 dropdown filters.");
  if (raw?.customFieldId != null && raw?.fieldId == null)
    assert(
      false,
      "Dropdown filters use fieldId (the custom field id). customFieldId is not the smart-group filter contract.",
    );
  const operator = raw?.operator || "and";
  assert(
    operator === "and" || operator === "or",
    "Filter operator must be and or or.",
  );
  const seen = new Set();
  const filters = source.map((filter) => {
    if (filter?.customFieldId != null && filter?.fieldId == null)
      assert(
        false,
        "Dropdown filters use fieldId (the custom field id). customFieldId is not the smart-group filter contract.",
      );
    const fieldId = ids([filter?.fieldId], "Custom field IDs")[0];
    assert(
      !seen.has(fieldId),
      "Each dropdown field can be used once in a smart group.",
    );
    seen.add(fieldId);
    const field = fields.find(
      (item) =>
        item.id === fieldId && item.type === "dropdown" && !item.isDeleted,
    );
    assert(
      field,
      `Custom field ${fieldId} is missing or is not a dropdown.`,
      400,
    );
    const optionIds = ids(filter.optionIds || [], "Dropdown option IDs");
    assert(optionIds.length, "Choose at least one dropdown option.");
    const optionNames = optionIds.map((optionId) => {
      const option = field.dropdownOptions?.find(
        (item) => item.id === optionId && !item.isDeleted && !item.isDisabled,
      );
      assert(
        option,
        `Option ${optionId} is not a valid choice for dropdown field ${fieldId}.`,
        400,
      );
      return option.value;
    });
    return { fieldId, optionIds, fieldName: field.name, optionNames };
  });
  return { operator, dropdownFilters: filters };
}
function assignTempIds(specs, liveIds) {
  const used = new Set(liveIds);
  for (let index = 0; index < specs.length; index++) {
    let id = TEMP_BASE + index;
    while (used.has(id)) id += specs.length || 1;
    assert(
      Number.isSafeInteger(id),
      "Could not reserve an id for a new smart group.",
    );
    used.add(id);
    specs[index].tempId = id;
  }
}
async function planGroupCreates(key, action, input, groups, request) {
  const wanted = new Set(referencedGroupKeys(action, input));
  if (!wanted.size) return [];
  assert(
    Array.isArray(input.newGroups) && input.newGroups.length <= 20,
    "Create 1–20 smart groups per operation.",
  );
  const seen = new Set();
  for (const raw of input.newGroups) {
    assert(
      raw && typeof raw.key === "string" && /^[\w.-]{1,40}$/.test(raw.key),
      "Each new smart group needs a key.",
    );
    assert(!seen.has(raw.key), "Duplicate new smart group key.");
    seen.add(raw.key);
  }
  for (const keyName of wanted)
    assert(
      seen.has(keyName),
      `Selected new smart group “${keyName}” is missing its details.`,
    );
  const chosen = input.newGroups.filter((group) => wanted.has(group.key));
  const [segments, fieldPages] = await Promise.all([
    loadSmartGroupSegments(key, request),
    collectPages(key, "/users/v1/custom-fields", "customFields", { request }),
  ]);
  const liveNames = new Set(
    groups.map((group) =>
      String(group.name || "")
        .trim()
        .toLowerCase(),
    ),
  );
  const segmentNames = new Map(
    segments.map((segment) => [
      String(segment.name || "")
        .trim()
        .toLowerCase(),
      segment,
    ]),
  );
  const creating = new Map();
  const usedNames = new Set();
  const specs = chosen.map((raw) => {
    const name = title(raw.name);
    const lower = name.toLowerCase();
    assert(
      !liveNames.has(lower),
      `Smart group “${name}” already exists. Select it instead of creating it.`,
      409,
    );
    assert(
      !usedNames.has(lower),
      `Duplicate new smart group name “${name}”.`,
      409,
    );
    usedNames.add(lower);
    let groupSegmentId = null;
    let segment = null;
    if (raw.groupSegmentId != null && raw.groupSegmentId !== "") {
      assert(
        !raw.segment,
        "Choose an existing segment or a new segment, not both.",
      );
      groupSegmentId = ids([raw.groupSegmentId], "Segment IDs")[0];
      assert(
        segments.some((item) => item.id === groupSegmentId),
        `Segment ${groupSegmentId} is not a valid segment.`,
        400,
      );
    } else {
      assert(
        raw.segment && typeof raw.segment === "object",
        "Choose a segment or enter a new segment name.",
      );
      const segmentName = title(raw.segment.name);
      const color = segmentColor(raw.segment.color);
      const segmentKey = segmentName.toLowerCase();
      const existing = segmentNames.get(segmentKey);
      assert(
        !existing,
        `Segment “${segmentName}” already exists. Select it instead of creating a new one.`,
        409,
      );
      if (creating.has(segmentKey))
        assert(
          creating.get(segmentKey) === color,
          `New segment “${segmentName}” was given two different colors.`,
        );
      creating.set(segmentKey, color);
      segment = { name: segmentName, color };
    }
    return {
      key: raw.key,
      name,
      description: optionalDescription(raw.description),
      groupSegmentId,
      segment,
      filters: dropdownFilters(raw, fieldPages.rows),
    };
  });
  assignTempIds(
    specs,
    groups.map((group) => group.id),
  );
  return specs;
}
function withPlannedGroups(action, input, specs) {
  const tempByKey = new Map(specs.map((spec) => [spec.key, spec.tempId]));
  const expand = (groupIds, keys) =>
    ids([
      ...(groupIds || []),
      ...groupKeys(keys).map((keyName) => {
        assert(tempByKey.has(keyName), `Unknown new smart group “${keyName}”.`);
        return tempByKey.get(keyName);
      }),
    ]);
  if (action === "createDoor")
    return {
      ...input,
      parentGroupIds: expand(input.parentGroupIds, input.parentNewGroupKeys),
      subJobs: (input.subJobs || []).map((sub) => ({
        ...sub,
        groupIds: expand(sub.groupIds, sub.newGroupKeys),
      })),
    };
  if (action === "addBrand")
    return {
      ...input,
      groupIds: expand(input.groupIds, input.newGroupKeys),
    };
  if (action === "repairSubJobs")
    return {
      ...input,
      repairs: (input.repairs || []).map((repair) => ({
        ...repair,
        groupIds:
          repair.mode === "inherit"
            ? []
            : expand(repair.groupIds, repair.newGroupKeys),
      })),
    };
  return input;
}
function displayGroups(groups, specs) {
  return [
    ...groups,
    ...specs.map((spec) => ({
      id: spec.tempId,
      name: spec.name,
      pending: true,
      groupSegmentId: spec.groupSegmentId,
    })),
  ];
}
function groupRequestBody(spec, segmentId) {
  const body = {
    name: spec.name,
    groupSegmentId: segmentId,
    filters: {
      operator: spec.filters.operator,
      dropdownFilters: spec.filters.dropdownFilters.map(
        ({ fieldId, optionIds }) => ({ fieldId, optionIds }),
      ),
    },
  };
  if (spec.description) body.description = spec.description;
  return body;
}
function groupWriteError(error, label) {
  const requestId = error.payload?.requestId;
  const suffix = requestId ? ` Request ID: ${requestId}.` : "";
  const reason =
    error.status === 409
      ? `${label} was rejected because the name already exists.`
      : error.status === 400 || error.status === 422
        ? `${label} was rejected. ${error.message}`
        : `${label} failed. ${error.message}`;
  return new ConnecteamError(
    `${reason}${suffix}`,
    error.status || 502,
    error.payload,
  );
}
function outcomeStatus(error, written, attempted) {
  if (written) return "saved-unverified";
  if (attempted && error.status >= 500) return "unknown";
  return "failed";
}
async function materializeGroups(key, specs, request) {
  const results = [];
  const idMap = new Map();
  const segmentIds = new Map();
  const stop = (index, extra = []) => {
    for (const spec of specs.slice(index))
      results.push({
        label: `Smart group ${spec.name}`,
        status: "not-attempted",
      });
    results.push(...extra);
    return { ok: false, results, idMap };
  };
  for (let index = 0; index < specs.length; index++) {
    const spec = specs[index];
    let segmentId = spec.groupSegmentId;
    if (spec.segment) {
      const cacheKey = spec.segment.name.toLowerCase();
      if (segmentIds.has(cacheKey)) segmentId = segmentIds.get(cacheKey);
      else {
        const segmentLabel = `Segment ${spec.segment.name}`;
        let response,
          attempted = false,
          written = false;
        try {
          attempted = true;
          response = await request(key, "/users/v1/smart-group-segments", {
            method: "POST",
            body: JSON.stringify({
              name: spec.segment.name,
              color: spec.segment.color,
            }),
          });
          written = true;
          segmentId = ids([response?.data?.id], "Segment IDs")[0];
          assert(
            response.data.name === spec.segment.name,
            "Created segment name could not be verified.",
            502,
          );
          const listed = await loadSmartGroupSegments(key, request);
          const saved = listed.find((segment) => segment.id === segmentId);
          assert(
            saved &&
              saved.name === spec.segment.name &&
              String(saved.color || "").toLowerCase() === spec.segment.color,
            "Created segment could not be verified. Refresh and inspect before retrying.",
            502,
          );
          segmentIds.set(cacheKey, segmentId);
          results.push({
            status: "verified",
            label: segmentLabel,
            segmentId,
            requestId: response.requestId,
          });
        } catch (error) {
          const reported =
            written && error instanceof ConnecteamError
              ? error
              : groupWriteError(
                  error instanceof ConnecteamError
                    ? error
                    : new ConnecteamError(error.message, 502),
                  segmentLabel,
                );
          results.push({
            label: segmentLabel,
            status: outcomeStatus(reported, written, attempted),
            ...errorData(reported),
          });
          results.push({
            label: `Smart group ${spec.name}`,
            status: "not-attempted",
          });
          return stop(index + 1);
        }
      }
    }
    const groupLabel = `Smart group ${spec.name}`;
    let response,
      attempted = false,
      written = false;
    try {
      attempted = true;
      response = await request(key, "/users/v1/smart-groups", {
        method: "POST",
        body: JSON.stringify(groupRequestBody(spec, segmentId)),
      });
      written = true;
      const createdId = ids([response?.data?.id], "Smart-group IDs")[0];
      assert(
        response.data.name === spec.name &&
          Number(response.data.groupSegmentId) === segmentId,
        "Created smart group response did not match the request.",
        502,
      );
      const saved = await loadSmartGroupById(key, createdId, request);
      const savedSegment = Number(saved.groupSegmentId ?? saved.segmentId);
      assert(
        saved.name === spec.name && savedSegment === segmentId,
        "Created smart group could not be verified. Refresh and inspect before retrying.",
        502,
      );
      idMap.set(spec.tempId, saved.id);
      results.push({
        status: "verified",
        label: groupLabel,
        groupId: saved.id,
        requestId: response.requestId,
      });
    } catch (error) {
      const reported =
        written && error instanceof ConnecteamError
          ? error
          : groupWriteError(
              error instanceof ConnecteamError
                ? error
                : new ConnecteamError(error.message, 502),
              groupLabel,
            );
      results.push({
        label: groupLabel,
        status: outcomeStatus(reported, written, attempted),
        ...errorData(reported),
      });
      return stop(index + 1);
    }
  }
  return { ok: true, results, idMap };
}
function swapGroupIds(value, idMap) {
  if (Array.isArray(value))
    return value.map((item) => swapGroupIds(item, idMap));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        key === "groupIds" && Array.isArray(item)
          ? item.map((id) => {
              if (!idMap.has(id)) {
                assert(
                  id < TEMP_BASE,
                  "A new smart group was not created, so nothing else was assigned.",
                  502,
                );
                return id;
              }
              return idMap.get(id);
            })
          : swapGroupIds(item, idMap),
      ]),
    );
  return value;
}
function keptGroupNote(prefix) {
  return prefix.some((result) => result.groupId || result.segmentId)
    ? "Smart groups or segments created earlier in this operation were kept. Retry by selecting the existing group."
    : undefined;
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
  let plan = {
    action,
    input: copy(input),
    createdAt: Date.now(),
    records: [],
    groupCreates: [],
  };
  const plansGroups = ["createDoor", "addBrand", "repairSubJobs"].includes(
    action,
  );
  const liveGroups = plansGroups ? await loadSmartGroups(key, request) : [];
  const groupCreates = plansGroups
    ? await planGroupCreates(key, action, input, liveGroups, request)
    : [];
  const planned = plansGroups
    ? withPlannedGroups(action, input, groupCreates)
    : input;
  const reserved = new Set(groupCreates.map((spec) => spec.tempId));
  plan.groupCreates = groupCreates;
  if (action === "createDoor") {
    const groups = liveGroups;
    assert(
      groups.length || groupCreates.length,
      "No smart groups are available. Create a smart group in this setup, or refresh and select an existing one.",
    );
    const body = buildDoor(planned);
    validateGroups(
      groups,
      [
        ...body[0].assign.groupIds,
        ...body[0].subJobs.flatMap((s) => s.assign?.groupIds || []),
      ],
      reserved,
    );
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
    Object.assign(plan, {
      body,
      groups: displayGroups(groups, groupCreates),
      instances,
    });
  } else if (action === "addBrand") {
    const parent = await getJob(key, planned.parentId, request);
    assert(
      !parent.parentId && !parent.isDeleted && parent.subJobs?.length,
      "This must be an active parent already containing sub-jobs.",
    );
    const groups = liveGroups;
    const groupIds = ids(planned.groupIds || []);
    validateGroups(groups, groupIds, reserved);
    const sub = {
      parentId: parent.jobId,
      title: title(planned.title),
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
      groups: displayGroups(groups, groupCreates),
      parentBefore: jobState(parent),
      parentTitle: parent.title,
    });
  } else if (action === "repairSubJobs") {
    assert(
      Array.isArray(planned.repairs) &&
        planned.repairs.length > 0 &&
        planned.repairs.length <= 100,
      "Select 1–100 sub-jobs per preview.",
    );
    assert(
      new Set(planned.repairs.map((r) => r.jobId)).size ===
        planned.repairs.length,
      "Duplicate sub-job selections.",
    );
    const groups = liveGroups;
    for (const intent of planned.repairs) {
      if (intent.mode !== "inherit")
        validateGroups(groups, intent.groupIds, reserved);
      plan.records.push(await repairRecord(key, intent, request));
    }
    plan.groups = displayGroups(groups, groupCreates);
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
    groupCreates: p.groupCreates || [],
  });
  assert(
    stable(comparable(fresh)) === stable(comparable(plan)),
    "Data changed since preview. Nothing was written; refresh the preview.",
    409,
  );
  let createdResults = [];
  let idMap = new Map();
  if (fresh.groupCreates.length) {
    const materialized = await materializeGroups(
      key,
      fresh.groupCreates,
      request,
    );
    createdResults = materialized.results;
    idMap = materialized.idMap;
    if (!materialized.ok) {
      const skipped =
        plan.action === "repairSubJobs"
          ? plan.records.map((record) => ({
              label: record.label,
              jobId: record.jobId,
              status: "not-attempted",
            }))
          : [
              {
                label:
                  plan.action === "addBrand"
                    ? `${plan.parentTitle} → ${plan.input.title}`
                    : plan.input.title,
                status: "not-attempted",
              },
            ];
      return {
        results: [...createdResults, ...skipped],
        complete: false,
      };
    }
  }
  const realize = (value) => swapGroupIds(value, idMap);
  const results = [];
  if (["createDoor", "addBrand", "createDoorOption"].includes(plan.action)) {
    let response;
    try {
      response = await request(
        key,
        plan.action !== "createDoorOption"
          ? "/jobs/v1/jobs"
          : `/users/v1/custom-fields/${plan.field.id}/options`,
        {
          method: "POST",
          body: JSON.stringify(
            plan.action === "createDoorOption"
              ? fresh.body
              : realize(fresh.body),
          ),
        },
      );
    } catch (error) {
      return {
        results: [
          ...createdResults,
          {
            label:
              plan.action === "addBrand"
                ? `${plan.parentTitle} → ${plan.input.title}`
                : plan.input.title || "Operation",
            status: error.status >= 500 ? "unknown" : "failed",
            ...errorData(error),
            note: keptGroupNote(createdResults),
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
      const expected = realize(fresh.body)[0];
      if (plan.action === "addBrand") {
        assert(
          matchesUpdate(actual, expected),
          "Created brand settings could not be verified.",
          502,
        );
        return {
          results: [
            ...createdResults,
            {
              status: "verified",
              label: `${plan.parentTitle} → ${actual.title}`,
              jobId: actual.jobId,
              requestId: response.requestId,
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
          ...createdResults,
          {
            status: "verified",
            label: actual.title,
            jobId: actual.jobId,
            requestId: response.requestId,
          },
        ],
        complete: true,
      };
    } catch (error) {
      return {
        results: [
          ...createdResults,
          {
            status: "saved-unverified",
            ...errorData(error),
            response,
            note: keptGroupNote(createdResults),
          },
        ],
        complete: false,
      };
    }
  }
  const plannedRepairs =
    plan.action === "repairSubJobs"
      ? withPlannedGroups(plan.action, plan.input, fresh.groupCreates).repairs
      : [];
  for (let i = 0; i < plan.records.length; i++) {
    const expected = plan.records[i];
    let written = false,
      attempted = false;
    try {
      if (plan.action === "repairSubJobs") {
        const intent = plannedRepairs[i];
        if (intent.mode !== "inherit")
          validateGroups(
            await loadSmartGroups(key, request),
            intent.groupIds,
            new Set(fresh.groupCreates.map((spec) => spec.tempId)),
          );
        const current = await repairRecord(key, intent, request);
        assert(
          stable(current) === stable(expected),
          `“${expected.label}” changed after preview.`,
          409,
        );
        attempted = true;
        const after = realize(current.after);
        await request(key, jobPath(expected.jobId), {
          method: "PUT",
          body: JSON.stringify(after),
        });
        written = true;
        const saved = await getJob(key, expected.jobId, request);
        assert(
          matchesUpdate(saved, after),
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
        note: keptGroupNote(createdResults),
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
  return {
    results: [...createdResults, ...results],
    complete: [...createdResults, ...results].every(
      (result) => result.status === "verified",
    ),
  };
}
