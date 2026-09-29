"use client";
import { useEffect, useMemo, useRef, useState } from "react";
const newDoor = () => ({
  title: "",
  code: "",
  description: "",
  gps: { address: "", latitude: "", longitude: "" },
  instanceIds: [],
  parentGroupIds: [],
  parentNewGroupKeys: [],
  newGroups: [],
  subJobs: [{ title: "", groupIds: [], newGroupKeys: [] }],
});
const dropdownFields = (fields) =>
  (fields || []).filter(
    (field) => field.type === "dropdown" && !field.isDeleted,
  );
function failureText(error, fallback) {
  if (!error) return fallback;
  return `${error.message}${error.requestId ? ` Request ID: ${error.requestId}.` : ""}`;
}
function groupBlockMessage(snapshot) {
  if (snapshot?.smartGroupsBlocked)
    return failureText(
      snapshot.smartGroupsError,
      "Connecteam refused smart-group access.",
    );
  if (snapshot?.smartGroupSegmentsBlocked)
    return failureText(
      snapshot.smartGroupSegmentsError,
      "Connecteam refused smart-group segment access.",
    );
  return "";
}
function groupStatusLabel(snapshot) {
  if (snapshot.smartGroupsBlocked)
    return snapshot.smartGroupsError?.requestId
      ? `Smart groups blocked · ${snapshot.smartGroupsError.requestId}`
      : "Smart groups blocked";
  if (!snapshot.smartGroupsLoaded) return "Smart groups could not be loaded";
  if (!snapshot.smartGroups.length) return "No smart groups yet";
  const segments = snapshot.smartGroupSegmentsLoaded
    ? ` · ${snapshot.smartGroupSegments.length} segments`
    : "";
  return `${snapshot.smartGroups.length} smart groups${segments}`;
}
function adoptCreatedGroups(pending, selectedKeys, selectedIds, smartGroups) {
  const adoptedIds = [];
  const dropped = new Set();
  const kept = [];
  for (const draft of pending || []) {
    const saved = (smartGroups || []).find(
      (group) => group.name === draft.name,
    );
    if (!saved) {
      kept.push(draft);
      continue;
    }
    dropped.add(draft.key);
    if ((selectedKeys || []).includes(draft.key)) adoptedIds.push(saved.id);
  }
  if (!dropped.size)
    return {
      pending: pending || [],
      selectedKeys: selectedKeys || [],
      selectedIds: selectedIds || [],
      changed: false,
    };
  return {
    pending: kept,
    selectedKeys: (selectedKeys || []).filter((key) => !dropped.has(key)),
    selectedIds: [...new Set([...(selectedIds || []), ...adoptedIds])],
    changed: true,
  };
}
function mergeSavedGroups(snapshot, report) {
  if (!snapshot || !report?.results) return snapshot;
  const groups = [...(snapshot.smartGroups || [])];
  const segments = [...(snapshot.smartGroupSegments || [])];
  for (const result of report.results) {
    if (result.status !== "verified") continue;
    if (
      result.groupId &&
      !groups.some((group) => group.id === result.groupId)
    ) {
      const name = String(result.label || "").replace(/^Smart group /, "");
      groups.push({
        id: result.groupId,
        name: name || `Smart group ${result.groupId}`,
      });
    }
    if (
      result.segmentId &&
      !segments.some((segment) => segment.id === result.segmentId)
    ) {
      const name = String(result.label || "").replace(/^Segment /, "");
      segments.push({
        id: result.segmentId,
        name: name || `Segment ${result.segmentId}`,
        color: "#3968bb",
      });
    }
  }
  const addedGroup = groups.length !== (snapshot.smartGroups || []).length;
  const addedSegment =
    segments.length !== (snapshot.smartGroupSegments || []).length;
  const userFields = (snapshot.userFields || []).map((field) => ({
    ...field,
    dropdownOptions: [...(field.dropdownOptions || [])],
  }));
  for (const result of report.results) {
    if (result.status !== "verified" || !result.optionId || !result.fieldId)
      continue;
    const field = userFields.find((item) => item.id === result.fieldId);
    if (
      !field ||
      field.dropdownOptions.some((option) => option.id === result.optionId)
    )
      continue;
    const value = String(result.label || "")
      .split(": ")
      .slice(1)
      .join(": ");
    field.dropdownOptions.push({
      id: result.optionId,
      value: value || `Option ${result.optionId}`,
      isDisabled: false,
    });
  }
  return {
    ...snapshot,
    userFields,
    smartGroups: groups,
    smartGroupsLoaded: snapshot.smartGroupsLoaded || addedGroup,
    smartGroupsBlocked: addedGroup ? false : snapshot.smartGroupsBlocked,
    smartGroupSegments: segments,
    smartGroupSegmentsLoaded: snapshot.smartGroupSegmentsLoaded || addedSegment,
    smartGroupSegmentsBlocked: addedSegment
      ? false
      : snapshot.smartGroupSegmentsBlocked,
  };
}
const toggle = (values, id) =>
  values.includes(id) ? values.filter((x) => x !== id) : [...values, id];
function Button({ kind = "primary", children, ...props }) {
  return (
    <button className={`btn ${kind}`} {...props}>
      {children}
    </button>
  );
}
function Field({ label, children, hint }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
function Notice({ tone = "info", children }) {
  return (
    <div
      className={`notice ${tone}`}
      role={tone === "danger" ? "alert" : "status"}
    >
      {children}
    </div>
  );
}
function Groups({
  groups,
  value,
  onChange,
  label = "Smart groups",
  segments = [],
  segmentsLoaded = true,
  fields = [],
  createBlocked = false,
  blockMessage = "",
  listFailed = false,
  pending = [],
  selectedKeys = [],
  onSelectedKeys,
  onCreatePending,
  onRemovePending,
}) {
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(!groups.length && !createBlocked);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [segmentId, setSegmentId] = useState(
    segments[0] ? String(segments[0].id) : "new",
  );
  const [segmentName, setSegmentName] = useState("");
  const [color, setColor] = useState("#3968bb");
  const [operator, setOperator] = useState("and");
  const [filters, setFilters] = useState([]);
  const canCreate = typeof onCreatePending === "function";
  const query = search.toLowerCase();
  const filtered = groups.filter((g) =>
    `${g.name} ${g.id}`.toLowerCase().includes(query),
  );
  const filteredPending = pending.filter((g) =>
    `${g.name} ${g.segment?.name || ""}`.toLowerCase().includes(query),
  );
  const selectedCount = value.length + selectedKeys.length;
  const activeFilters = filters.filter(
    (filter) => filter.fieldId && filter.optionIds.length,
  );
  function resetDraft() {
    setName("");
    setDescription("");
    setSegmentName("");
    setColor("#3968bb");
    setOperator("and");
    setFilters([]);
    setSegmentId(segments[0] ? String(segments[0].id) : "new");
  }
  function addGroup() {
    const key = crypto.randomUUID();
    const draft = {
      key,
      name: name.trim(),
      description: description.trim(),
      operator: activeFilters.length > 1 ? operator : "and",
    };
    if (segmentId === "new")
      draft.segment = { name: segmentName.trim(), color };
    else draft.groupSegmentId = Number(segmentId);
    if (activeFilters.length)
      draft.dropdownFilters = activeFilters.map((filter) => ({
        fieldId: Number(filter.fieldId),
        optionIds: filter.optionIds.map(Number),
      }));
    onCreatePending(draft);
    onSelectedKeys?.([...selectedKeys, key]);
    resetDraft();
    setCreating(false);
  }
  const draftReady =
    name.trim() &&
    (segmentId === "new" ? segmentName.trim() && color : segmentId) &&
    filters.every((filter) => !filter.fieldId || filter.optionIds.length > 0);
  return (
    <fieldset className="groupPicker">
      <legend>
        {label} · {selectedCount} selected
      </legend>
      {canCreate && createBlocked && (
        <Notice tone="danger">
          <strong>Smart groups are blocked.</strong>
          <p>{blockMessage}</p>
          <p>Creating a group stays off until this access error is resolved.</p>
        </Notice>
      )}
      {canCreate && !createBlocked && (
        <div className={`groupCreate${groups.length ? "" : " emptyState"}`}>
          {!creating ? (
            <Button type="button" onClick={() => setCreating(true)}>
              Create smart group
            </Button>
          ) : (
            <>
              <div className="createHead">
                <strong>Create smart group</strong>
                {!!groups.length && (
                  <button
                    type="button"
                    className="textButton"
                    onClick={() => setCreating(false)}
                  >
                    Close
                  </button>
                )}
              </div>
              {!groups.length && !listFailed && (
                <p className="muted">
                  No smart groups yet. Add one here, then assign it to a door or
                  brand. An empty list is not an error.
                </p>
              )}
              {!groups.length && listFailed && (
                <p className="muted">
                  The current list could not be read. You can still name a
                  group, choose a segment, and add filters here.
                </p>
              )}
              {!segmentsLoaded && (
                <p className="muted">
                  The segment list could not be loaded. Create a new segment
                  below, or refresh and choose an existing one.
                </p>
              )}
              <p className="muted">
                The group is created when you apply the preview, then it appears
                in this list. Leave filters empty to create a named group with
                no dropdown membership rules.
              </p>
              <Field label="Group name">
                <input
                  maxLength={128}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Grove — MEJ"
                />
              </Field>
              <Field label="Description (optional)">
                <input
                  maxLength={2000}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </Field>
              <Field label="Segment">
                <select
                  aria-label={`${label} segment`}
                  value={segmentId}
                  onChange={(e) => setSegmentId(e.target.value)}
                >
                  {segments.map((segment) => (
                    <option key={segment.id} value={segment.id}>
                      {segment.name}
                    </option>
                  ))}
                  <option value="new">Create a new segment…</option>
                </select>
              </Field>
              {segmentId === "new" && (
                <div className="formGrid two">
                  <Field label="New segment name">
                    <input
                      maxLength={128}
                      value={segmentName}
                      onChange={(e) => setSegmentName(e.target.value)}
                      placeholder="Doors"
                    />
                  </Field>
                  <Field label="Segment color">
                    <input
                      aria-label={`${label} segment color`}
                      type="color"
                      value={color}
                      onChange={(e) => setColor(e.target.value)}
                    />
                  </Field>
                </div>
              )}
              <div className="filterBlock">
                <strong>Dropdown filters</strong>
                {!fields.length && (
                  <p className="muted">
                    This account has no dropdown custom fields, so the group
                    will be created without membership filters.
                  </p>
                )}
                {filters.map((filter, index) => {
                  const field = fields.find(
                    (item) => item.id === Number(filter.fieldId),
                  );
                  const options = (field?.dropdownOptions || []).filter(
                    (option) => !option.isDeleted && !option.isDisabled,
                  );
                  return (
                    <div className="filterRow" key={index}>
                      <Field label={`Filter ${index + 1} field`}>
                        <select
                          aria-label={`Filter ${index + 1} field`}
                          value={filter.fieldId}
                          onChange={(e) =>
                            setFilters((rows) =>
                              rows.map((row, rowIndex) =>
                                rowIndex === index
                                  ? {
                                      fieldId: e.target.value,
                                      optionIds: [],
                                    }
                                  : row,
                              ),
                            )
                          }
                        >
                          <option value="">Choose a dropdown field</option>
                          {fields.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.name}
                            </option>
                          ))}
                        </select>
                      </Field>
                      {!!options.length && (
                        <div className="checkGrid">
                          {options.map((option) => (
                            <label key={option.id}>
                              <input
                                type="checkbox"
                                checked={filter.optionIds.includes(option.id)}
                                onChange={() =>
                                  setFilters((rows) =>
                                    rows.map((row, rowIndex) =>
                                      rowIndex === index
                                        ? {
                                            ...row,
                                            optionIds: toggle(
                                              row.optionIds,
                                              option.id,
                                            ),
                                          }
                                        : row,
                                    ),
                                  )
                                }
                              />
                              <span>{option.value}</span>
                            </label>
                          ))}
                        </div>
                      )}
                      <button
                        type="button"
                        className="textButton"
                        onClick={() =>
                          setFilters((rows) =>
                            rows.filter((_, rowIndex) => rowIndex !== index),
                          )
                        }
                      >
                        Remove filter
                      </button>
                    </div>
                  );
                })}
                {fields.length > 0 && filters.length < 10 && (
                  <button
                    type="button"
                    className="textButton"
                    onClick={() =>
                      setFilters((rows) => [
                        ...rows,
                        { fieldId: "", optionIds: [] },
                      ])
                    }
                  >
                    + Add dropdown filter
                  </button>
                )}
                {activeFilters.length > 1 && (
                  <Field label="Match filters">
                    <select
                      aria-label={`${label} filter operator`}
                      value={operator}
                      onChange={(e) => setOperator(e.target.value)}
                    >
                      <option value="and">All filters (and)</option>
                      <option value="or">Any filter (or)</option>
                    </select>
                  </Field>
                )}
              </div>
              <Button type="button" disabled={!draftReady} onClick={addGroup}>
                Add group to this list
              </Button>
            </>
          )}
        </div>
      )}
      <input
        aria-label={`Search ${label}`}
        placeholder="Search existing or new smart groups…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <div className="miniGroupSelect">
        {filteredPending.map((group) => (
          <div className="pendingGroup" key={group.key}>
            <label>
              <input
                type="checkbox"
                checked={selectedKeys.includes(group.key)}
                onChange={() =>
                  onSelectedKeys?.(toggle(selectedKeys, group.key))
                }
              />
              <span>
                {group.name}
                <small className="badge blue">New</small>
                <small>
                  {group.segment
                    ? `New segment ${group.segment.name}`
                    : `Segment ${segments.find((segment) => segment.id === group.groupSegmentId)?.name || group.groupSegmentId}`}
                  {group.dropdownFilters?.length
                    ? ` · ${group.dropdownFilters.length} filter(s)`
                    : " · no membership filters"}
                </small>
              </span>
            </label>
            {onRemovePending && (
              <button
                type="button"
                className="textButton"
                onClick={() => onRemovePending(group.key)}
              >
                Remove
              </button>
            )}
          </div>
        ))}
        {filtered.map((g) => (
          <label key={g.id}>
            <input
              type="checkbox"
              checked={value.includes(g.id)}
              onChange={() => onChange(toggle(value, g.id))}
            />
            <span>
              {g.name}
              <small> #{g.id}</small>
            </span>
          </label>
        ))}
        {!filtered.length && !filteredPending.length && (
          <p>No matching smart groups.</p>
        )}
      </div>
    </fieldset>
  );
}
async function post(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let json;
  try {
    json = await response.json();
  } catch {
    throw new Error(
      `The server returned HTTP ${response.status} without a readable response. If applying changes, refresh and inspect before retrying.`,
    );
  }
  if (!response.ok)
    throw new Error(
      `${json.error || "Request failed"}${json.requestId ? ` Request ID: ${json.requestId}.` : ""}${json.details ? `\n${JSON.stringify(json.details, null, 2)}` : ""}`,
    );
  return json;
}
function flatten(jobs) {
  const parents = jobs.filter((j) => !j.parentId && !j.isDeleted),
    map = new Map();
  for (const j of jobs.filter((j) => j.parentId && !j.isDeleted))
    map.set(j.jobId, {
      ...j,
      parentTitle: parents.find((p) => p.jobId === j.parentId)?.title,
    });
  for (const p of parents)
    for (const s of p.subJobs || [])
      if (!s.isDeleted)
        map.set(s.jobId, {
          ...map.get(s.jobId),
          ...s,
          parentId: p.jobId,
          parentTitle: p.title,
        });
  return { parents, subJobs: [...map.values()] };
}
export default function Home() {
  const [apiKey, setApiKey] = useState(""),
    [snapshot, setSnapshot] = useState(null),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [report, setReport] = useState(null),
    [plan, setPlan] = useState(null),
    [tab, setTab] = useState("doors"),
    [editor, setEditor] = useState(false),
    [door, setDoor] = useState(newDoor),
    [managed, setManaged] = useState(null);
  const lock = useRef(false);
  useEffect(() => {
    setApiKey(sessionStorage.getItem("connecteam_api_key") || "");
  }, []);
  const { parents, subJobs } = useMemo(
    () => flatten(snapshot?.jobs || []),
    [snapshot],
  );
  async function refresh() {
    const data = await post("/api/snapshot", { apiKey });
    setSnapshot(data);
    return data;
  }
  async function scan() {
    if (lock.current) return;
    lock.current = true;
    setBusy("Loading account…");
    setError("");
    try {
      await refresh();
      sessionStorage.setItem("connecteam_api_key", apiKey);
    } catch (e) {
      setError(e.message);
    } finally {
      lock.current = false;
      setBusy("");
    }
  }
  async function preview(action, payload) {
    if (lock.current) return;
    lock.current = true;
    setBusy("Reading current settings and validating preview…");
    setError("");
    setReport(null);
    try {
      const response = await post("/api/actions", {
        apiKey,
        phase: "preview",
        action,
        payload,
      });
      setPlan(response.plan);
    } catch (e) {
      setError(e.message);
    } finally {
      lock.current = false;
      setBusy("");
    }
  }
  async function apply() {
    if (lock.current) return;
    lock.current = true;
    setBusy("Applying and verifying…");
    setError("");
    const submitted = plan;
    setPlan(null);
    try {
      const result = await post("/api/actions", {
        apiKey,
        phase: "apply",
        plan: submitted,
      });
      setReport(result);
      setSnapshot((current) => mergeSavedGroups(current, result));
      if (result.complete && submitted.action === "createDoor") {
        setEditor(false);
        setDoor(newDoor());
      }
      try {
        const refreshed = await refresh();
        setSnapshot(mergeSavedGroups(refreshed, result));
      } catch (e) {
        setError(
          `Results are shown below, but the account refresh failed: ${e.message}`,
        );
      }
    } catch (e) {
      setError(e.message);
    } finally {
      lock.current = false;
      setBusy("");
    }
  }
  function disconnect() {
    sessionStorage.removeItem("connecteam_api_key");
    setApiKey("");
    setSnapshot(null);
    setTab("doors");
    setError("");
    setPlan(null);
    setReport(null);
    setManaged(null);
    setDoor(newDoor());
    setEditor(false);
  }
  if (!snapshot)
    return (
      <main className="shell connectShell">
        <section className="connectCard">
          <div className="brandMark">C</div>
          <span className="badge blue">Operations Manager · V1.5.0</span>
          <h1>
            Every door.
            <br />
            The right brands and people.
          </h1>
          <p>
            Create a door, connect its brand sub-jobs to existing or new smart
            groups, then preview and verify your changes.
          </p>
          <Field
            label="Connecteam API key"
            hint="Kept in this browser session and sent through this app’s server. Disconnect to clear it."
          >
            <input
              type="password"
              autoComplete="off"
              value={apiKey}
              disabled={!!busy}
              onChange={(e) => setApiKey(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && apiKey.trim() && scan()}
            />
          </Field>
          {error && (
            <Notice tone="danger">
              <pre>{error}</pre>
            </Notice>
          )}
          <Button disabled={!apiKey.trim() || !!busy} onClick={scan}>
            {busy || "Connect & load account"}
          </Button>
        </section>
      </main>
    );
  return (
    <main className="appShell">
      <aside className="sidebar">
        <div className="logo">
          <span>C</span>
          <strong>Ops Manager</strong>
        </div>
        <small className="version">V1.5.0</small>
        <nav>
          {[
            ["doors", "Doors & brands"],
            ["audit", "Audit & Repair"],
            ["assign", "Employee assignments"],
          ].map(([key, label]) => (
            <button
              key={key}
              disabled={!!busy}
              className={tab === key ? "active" : ""}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="sidebarBottom">
          <small>
            Scanned {new Date(snapshot.scannedAt).toLocaleTimeString()}
          </small>
          <Button kind="ghost" disabled={!!busy} onClick={scan}>
            Refresh account
          </Button>
          <Button kind="ghost" disabled={!!busy} onClick={disconnect}>
            Disconnect
          </Button>
        </div>
      </aside>
      <section className="mainPane">
        <header className="topbar">
          <div>
            <small>Connecteam Operations Manager</small>
            <strong>
              {snapshot.me?.company?.name ||
                snapshot.me?.companyName ||
                "Door & brand workspace"}
            </strong>
          </div>
          <span className="status">{groupStatusLabel(snapshot)}</span>
        </header>
        {busy && <Notice>{busy}</Notice>}
        {error && (
          <Notice tone="danger">
            <pre>{error}</pre>
          </Notice>
        )}
        {snapshot.warnings.length > 0 && (
          <Notice tone="warning">
            <details>
              <summary>
                Account loaded with {snapshot.warnings.length} warning(s)
              </summary>
              {snapshot.warnings.map((w, i) => (
                <pre key={i}>{w}</pre>
              ))}
            </details>
          </Notice>
        )}
        {report && <Results report={report} />}
        <fieldset className="workspace" disabled={!!busy}>
          {tab === "doors" && (
            <div className="content">
              {editor ? (
                <DoorBuilder
                  door={door}
                  setDoor={setDoor}
                  snapshot={snapshot}
                  onCancel={() => setEditor(false)}
                  onPreview={() => preview("createDoor", door)}
                />
              ) : managed ? (
                <ManageDoor
                  parent={parents.find((p) => p.jobId === managed)}
                  subJobs={subJobs.filter((s) => s.parentId === managed)}
                  snapshot={snapshot}
                  onBack={() => setManaged(null)}
                  preview={preview}
                />
              ) : (
                <Doors
                  parents={parents}
                  subJobs={subJobs}
                  snapshot={snapshot}
                  onCreate={() => setEditor(true)}
                  onManage={setManaged}
                />
              )}
            </div>
          )}
          {tab === "audit" && (
            <div className="content">
              <div className="headingRow">
                <div>
                  <p className="eyebrow">Account maintenance</p>
                  <h2>Audit & Repair</h2>
                  <p>
                    Select any sub-job. Preview reads its current settings
                    directly from Connecteam.
                  </p>
                </div>
              </div>
              <RepairTable
                snapshot={snapshot}
                subJobs={subJobs}
                preview={preview}
              />
            </div>
          )}
          {tab === "assign" && (
            <div className="content">
              <Assignments snapshot={snapshot} preview={preview} />
            </div>
          )}
        </fieldset>
      </section>
      {plan && (
        <Preview plan={plan} onCancel={() => setPlan(null)} onConfirm={apply} />
      )}
    </main>
  );
}
function Doors({ parents, subJobs, snapshot, onCreate, onManage }) {
  const [search, setSearch] = useState("");
  const rows = parents.filter((j) =>
    `${j.title} ${j.code || ""}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <>
      <div className="headingRow">
        <div>
          <p className="eyebrow">Primary workflow</p>
          <h2>Doors & brands</h2>
          <p>
            One door → brand sub-jobs → existing smart groups → review → save.
          </p>
        </div>
        <Button onClick={onCreate}>+ Create door setup</Button>
      </div>
      <GroupLoadState snapshot={snapshot} onCreate={onCreate} />
      <div className="metricGrid">
        <Metric label="Doors / parent jobs" value={parents.length} />
        <Metric label="Brand sub-jobs" value={subJobs.length} />
      </div>
      <div className="panel">
        <div className="panelToolbar">
          <input
            className="search"
            aria-label="Search doors"
            placeholder="Search doors or job codes…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <span>{rows.length} doors</span>
        </div>
        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>Door / Job</th>
                <th>Brands</th>
                <th>Manage</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 500).map((p) => (
                <tr key={p.jobId}>
                  <td>
                    <strong>{p.title}</strong>
                    <small>{p.gps?.address || p.code || "No address"}</small>
                  </td>
                  <td>
                    {subJobs.filter((s) => s.parentId === p.jobId).length}
                  </td>
                  <td>
                    <Button kind="ghost" onClick={() => onManage(p.jobId)}>
                      Manage brands
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && (
            <p className="emptyBuilder">
              No matching doors. Create your first setup above.
            </p>
          )}
        </div>
        {rows.length > 500 && (
          <p className="tableNote">
            Showing 500 results. Search to find any door.
          </p>
        )}
      </div>
    </>
  );
}
function GroupLoadState({ snapshot, onCreate }) {
  const blocked = groupBlockMessage(snapshot);
  if (blocked)
    return (
      <Notice tone="danger">
        <strong>Smart groups are blocked.</strong>
        <p>{blocked}</p>
        <p>Creating a group stays off until this access error is resolved.</p>
      </Notice>
    );
  if (!snapshot.smartGroupsLoaded && snapshot.smartGroupsError)
    return (
      <div className="emptyState">
        <strong>Smart groups could not be loaded.</strong>
        <p>
          {failureText(
            snapshot.smartGroupsError,
            "The smart-group list failed.",
          )}
        </p>
        <p>
          This was not a permission error, so you can still create a group and
          assign it. Refresh to try the list again.
        </p>
        <Button onClick={onCreate}>Create smart group</Button>
      </div>
    );
  if (snapshot.smartGroupsLoaded && !snapshot.smartGroups.length)
    return (
      <div className="emptyState">
        <strong>No smart groups yet.</strong>
        <p>
          Create one here, then assign it to a door or brand in the same
          preview. An empty list is not an error.
        </p>
        <Button onClick={onCreate}>Create smart group</Button>
      </div>
    );
  return null;
}
function Metric({ label, value }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value.toLocaleString()}</strong>
    </div>
  );
}
function DoorBuilder({ door, setDoor, snapshot, onCancel, onPreview }) {
  const set = (key, value) => setDoor((d) => ({ ...d, [key]: value }));
  const groups = snapshot.smartGroups;
  const instances = [
    ...snapshot.schedulers
      .filter((s) => !s.isArchived)
      .map((s) => ({ id: s.schedulerId, name: s.name, type: "Schedule" })),
    ...snapshot.timeClocks
      .filter((t) => !t.isArchived)
      .map((t) => ({ id: t.id, name: t.name, type: "Time clock" })),
  ];
  const update = (i, patch) =>
    set(
      "subJobs",
      door.subJobs.map((s, index) => (index === i ? { ...s, ...patch } : s)),
    );
  const fields = dropdownFields(snapshot.userFields);
  const parentChosen =
    door.parentGroupIds.length || (door.parentNewGroupKeys || []).length;
  const blocked = !!groupBlockMessage(snapshot);
  const listFailed = !snapshot.smartGroupsLoaded && !!snapshot.smartGroupsError;
  const createFirst = !blocked && !groups.length;
  const multiFields = fields.filter((field) => field.isMultiSelect === true);
  const eligibility = door.eligibility;
  const eligibilityOn = !!eligibility?.doorFieldId;
  const brandField = multiFields.find(
    (field) => field.id === Number(eligibility?.brandFieldId),
  );
  const segmentReady = !eligibilityOn || !!eligibility.segmentId;
  const valid =
    !blocked &&
    door.title.trim() &&
    door.instanceIds.length &&
    door.subJobs.length &&
    door.subJobs.every((sub) => sub.title.trim()) &&
    (eligibilityOn
      ? eligibility.brandFieldId && segmentReady
      : door.subJobs.every(
          (sub) =>
            sub.groupIds.length ||
            (sub.newGroupKeys || []).length ||
            parentChosen,
        ));
  function setEligibility(patch) {
    setDoor((current) => ({
      ...current,
      eligibility: {
        doorFieldId: "",
        doorValue: "",
        doorOptionId: "",
        brandFieldId: "",
        cohortGroupIds: [],
        cohortOptionIds: [],
        segmentId: snapshot.smartGroupSegments?.[0]
          ? String(snapshot.smartGroupSegments[0].id)
          : "new",
        segmentName: "",
        color: "#3968bb",
        ...(current.eligibility || {}),
        ...patch,
      },
    }));
  }
  function addPending(draft) {
    setDoor((current) => ({
      ...current,
      newGroups: [...(current.newGroups || []), draft],
    }));
  }
  function removePending(key) {
    setDoor((current) => ({
      ...current,
      newGroups: (current.newGroups || []).filter((group) => group.key !== key),
      parentNewGroupKeys: (current.parentNewGroupKeys || []).filter(
        (item) => item !== key,
      ),
      subJobs: current.subJobs.map((sub) => ({
        ...sub,
        newGroupKeys: (sub.newGroupKeys || []).filter((item) => item !== key),
      })),
    }));
  }
  useEffect(() => {
    setDoor((current) => {
      const parent = adoptCreatedGroups(
        current.newGroups,
        current.parentNewGroupKeys,
        current.parentGroupIds,
        snapshot.smartGroups,
      );
      let subChanged = false;
      const subJobs = current.subJobs.map((sub) => {
        const next = adoptCreatedGroups(
          current.newGroups,
          sub.newGroupKeys,
          sub.groupIds,
          snapshot.smartGroups,
        );
        if (!next.changed) return sub;
        subChanged = true;
        return {
          ...sub,
          newGroupKeys: next.selectedKeys,
          groupIds: next.selectedIds,
        };
      });
      if (!parent.changed && !subChanged) return current;
      return {
        ...current,
        newGroups: parent.pending,
        parentNewGroupKeys: parent.selectedKeys,
        parentGroupIds: parent.selectedIds,
        subJobs,
      };
    });
  }, [snapshot.smartGroups, setDoor]);
  const parentSection = (
    <>
      <h3>{createFirst ? "Create a smart group" : "2. Parent eligibility"}</h3>
      <p className="muted">
        {createFirst
          ? "Name the group, pick an existing segment or create one, and add dropdown filters only if membership should depend on them. Add the group and leave it checked, then assign it to this door or a brand."
          : "Optional if every brand has its own groups. Brands without custom groups inherit these groups, the description, and the location."}
      </p>
      <Groups
        label="Parent smart groups"
        groups={groups}
        segments={snapshot.smartGroupSegments || []}
        segmentsLoaded={!!snapshot.smartGroupSegmentsLoaded}
        fields={fields}
        createBlocked={blocked}
        blockMessage={groupBlockMessage(snapshot)}
        listFailed={listFailed}
        value={door.parentGroupIds}
        onChange={(v) => set("parentGroupIds", v)}
        pending={door.newGroups || []}
        selectedKeys={door.parentNewGroupKeys || []}
        onSelectedKeys={(keys) => set("parentNewGroupKeys", keys)}
        onCreatePending={addPending}
        onRemovePending={removePending}
      />
    </>
  );
  return (
    <>
      <div className="headingRow">
        <div>
          <p className="eyebrow">New door setup</p>
          <h2>Create a door & its brands</h2>
          <p>
            All brands and assignments are created together after your review.
          </p>
        </div>
        <Button kind="ghost" onClick={onCancel}>
          Back to doors
        </Button>
      </div>
      {blocked ? (
        <Notice tone="danger">
          <strong>Smart groups are blocked.</strong>
          <p>{groupBlockMessage(snapshot)}</p>
        </Notice>
      ) : listFailed ? (
        <Notice tone="warning">
          <strong>Smart groups could not be loaded.</strong>
          <p>
            {failureText(
              snapshot.smartGroupsError,
              "The smart-group list failed.",
            )}
          </p>
          <p>
            This was not a permission error. Create a smart group below and
            assign it. Refresh to try the list again.
          </p>
        </Notice>
      ) : !groups.length ? (
        <Notice>
          No smart groups yet. Name one below, choose a segment, and add filters
          only if you need them. An empty list is not an error.
        </Notice>
      ) : (
        <Notice>
          {groups.length} existing smart groups available. Job and brand
          eligibility below batches one group per brand. A person lands on a
          brand only when they match the job and that brand. Extra groups
          selected by hand are alternatives to that rule.
        </Notice>
      )}
      <div className="panel formPanel">
        <h3>Job and brand eligibility</h3>
        <p className="muted">
          Primary setup for a new job with several brands. Choose the job and
          brand dropdowns, then preview. The app creates the tags, one smart
          group for the job, and one smart group per brand. People who already
          qualify for the job and a brand are tagged automatically. The group
          lists further down remain available for a single group.
        </p>
        {!multiFields.length && (
          <Notice tone="warning">
            This account has no multi-select dropdown fields, so eligibility
            tags cannot be stored yet. Create those fields in Connecteam, or
            assign groups manually below.
          </Notice>
        )}
        <div className="formGrid two">
          <Field label="Job dropdown">
            <select
              aria-label="Job dropdown"
              value={eligibility?.doorFieldId || ""}
              disabled={blocked}
              onChange={(e) =>
                e.target.value
                  ? setEligibility({
                      doorFieldId: e.target.value,
                      doorOptionId: "",
                      cohortOptionIds: [],
                    })
                  : set("eligibility", null)
              }
            >
              <option value="">Skip — assign groups manually</option>
              {multiFields.map((field) => (
                <option key={field.id} value={field.id}>
                  {field.name}
                </option>
              ))}
            </select>
          </Field>
          {eligibilityOn && (
            <Field
              label="Job tag"
              hint="Leave blank to use the job name. Pick an existing tag if this job is already on the field."
            >
              <input
                aria-label="Job tag"
                maxLength={128}
                value={eligibility.doorValue || ""}
                placeholder={door.title || "New job tag"}
                onChange={(e) =>
                  setEligibility({
                    doorValue: e.target.value,
                    doorOptionId: "",
                  })
                }
              />
            </Field>
          )}
        </div>
        {eligibilityOn && (
          <>
            <Field label="Existing job tag">
              <select
                aria-label="Existing job tag"
                value={eligibility.doorOptionId || ""}
                onChange={(e) =>
                  setEligibility({
                    doorOptionId: e.target.value,
                    doorValue: e.target.value ? "" : eligibility.doorValue,
                  })
                }
              >
                <option value="">Create the job tag above</option>
                {(
                  multiFields.find(
                    (field) => field.id === Number(eligibility.doorFieldId),
                  )?.dropdownOptions || []
                )
                  .filter((option) => !option.isDeleted && !option.isDisabled)
                  .map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.value}
                    </option>
                  ))}
              </select>
            </Field>
            <div className="formGrid two">
              <Field label="Brand dropdown">
                <select
                  aria-label="Brand dropdown"
                  value={eligibility.brandFieldId || ""}
                  onChange={(e) =>
                    setEligibility({ brandFieldId: e.target.value })
                  }
                >
                  <option value="">Choose the brand field</option>
                  {multiFields
                    .filter(
                      (field) => field.id !== Number(eligibility.doorFieldId),
                    )
                    .map((field) => (
                      <option key={field.id} value={field.id}>
                        {field.name}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="Segment for these groups">
                <select
                  aria-label="Eligibility segment"
                  value={eligibility.segmentId || ""}
                  onChange={(e) =>
                    setEligibility({ segmentId: e.target.value })
                  }
                >
                  {(snapshot.smartGroupSegments || []).map((segment) => (
                    <option key={segment.id} value={segment.id}>
                      {segment.name}
                    </option>
                  ))}
                  <option value="new">Create a new segment…</option>
                </select>
              </Field>
            </div>
            {String(eligibility.segmentId) === "new" && (
              <div className="formGrid two">
                <Field label="New eligibility segment">
                  <input
                    maxLength={128}
                    value={eligibility.segmentName || ""}
                    placeholder={`${door.title || "Job"} eligibility`}
                    onChange={(e) =>
                      setEligibility({ segmentName: e.target.value })
                    }
                  />
                </Field>
                <Field label="Segment color">
                  <input
                    aria-label="Eligibility segment color"
                    type="color"
                    value={eligibility.color || "#3968bb"}
                    onChange={(e) => setEligibility({ color: e.target.value })}
                  />
                </Field>
              </div>
            )}
            <fieldset className="groupPicker">
              <legend>Who already qualifies for this job</legend>
              <p className="muted">
                A person qualifies for the job when they are in any checked
                group or already have any checked job tag. They are then added
                to a brand only if they also match that brand.
              </p>
              <div className="checkGrid">
                {groups.map((group) => (
                  <label key={group.id}>
                    <input
                      type="checkbox"
                      checked={(eligibility.cohortGroupIds || []).includes(
                        group.id,
                      )}
                      onChange={() =>
                        setEligibility({
                          cohortGroupIds: toggle(
                            eligibility.cohortGroupIds || [],
                            group.id,
                          ),
                        })
                      }
                    />
                    <span>
                      {group.name}
                      <small>Smart group</small>
                    </span>
                  </label>
                ))}
                {(
                  multiFields.find(
                    (field) => field.id === Number(eligibility.doorFieldId),
                  )?.dropdownOptions || []
                )
                  .filter((option) => !option.isDeleted && !option.isDisabled)
                  .map((option) => (
                    <label key={`opt-${option.id}`}>
                      <input
                        type="checkbox"
                        checked={(eligibility.cohortOptionIds || []).includes(
                          option.id,
                        )}
                        onChange={() =>
                          setEligibility({
                            cohortOptionIds: toggle(
                              eligibility.cohortOptionIds || [],
                              option.id,
                            ),
                          })
                        }
                      />
                      <span>
                        {option.value}
                        <small>Existing job tag</small>
                      </span>
                    </label>
                  ))}
              </div>
              {!groups.length && (
                <p className="muted">
                  No smart groups are loaded. Use existing job tags, or create
                  the groups now and tag people later.
                </p>
              )}
            </fieldset>
          </>
        )}
        {createFirst && parentSection}
        <h3>{createFirst ? "Door details" : "1. Door details"}</h3>
        <div className="formGrid two">
          <Field label="Door / job name">
            <input
              maxLength={128}
              value={door.title}
              onChange={(e) => set("title", e.target.value)}
              placeholder="Sephora — The Grove"
            />
          </Field>
          <Field label="Code (optional)">
            <input
              value={door.code}
              onChange={(e) => set("code", e.target.value)}
            />
          </Field>
        </div>
        <Field label="Description (optional)">
          <textarea
            value={door.description}
            onChange={(e) => set("description", e.target.value)}
          />
        </Field>
        <Field label="Address (optional)">
          <input
            value={door.gps.address}
            onChange={(e) =>
              set("gps", { ...door.gps, address: e.target.value })
            }
          />
        </Field>
        <div className="formGrid two">
          {["latitude", "longitude"].map((key) => (
            <Field
              key={key}
              label={`${key[0].toUpperCase() + key.slice(1)} (optional)`}
            >
              <input
                type="number"
                step="any"
                value={door.gps[key]}
                onChange={(e) =>
                  set("gps", { ...door.gps, [key]: e.target.value })
                }
              />
            </Field>
          ))}
        </div>
        <fieldset className="groupPicker">
          <legend>Schedules / time clocks</legend>
          <div className="checkGrid">
            {instances.map((i) => (
              <label key={`${i.type}-${i.id}`}>
                <input
                  type="checkbox"
                  checked={door.instanceIds.includes(i.id)}
                  onChange={() =>
                    set("instanceIds", toggle(door.instanceIds, i.id))
                  }
                />
                <span>
                  {i.name}
                  <small>{i.type}</small>
                </span>
              </label>
            ))}
          </div>
          {!instances.length && (
            <p>
              No schedules or time clocks loaded. Check scan warnings and
              refresh.
            </p>
          )}
        </fieldset>
        {!createFirst && parentSection}
        <h3>{createFirst ? "Brand sub-jobs" : "3. Brand sub-jobs"}</h3>
        <p className="muted">
          Each custom assignment uses the door’s description and location at
          creation. Later parent changes will not flow into those custom
          sub-jobs.
        </p>
        {door.subJobs.map((s, i) => (
          <div className="brandCard" key={i}>
            <div className="formGrid two">
              <Field label={`Brand ${i + 1} name`}>
                <input
                  maxLength={128}
                  placeholder="MEJ"
                  value={s.title}
                  onChange={(e) => update(i, { title: e.target.value })}
                />
              </Field>
              {eligibilityOn && (
                <Field label={`Brand ${i + 1} tag`}>
                  <select
                    aria-label={`Brand ${i + 1} tag`}
                    value={s.brandOptionId || ""}
                    onChange={(e) =>
                      update(i, { brandOptionId: e.target.value })
                    }
                  >
                    <option value="">
                      Create a tag named {s.title || "this brand"}
                    </option>
                    {(brandField?.dropdownOptions || [])
                      .filter(
                        (option) => !option.isDeleted && !option.isDisabled,
                      )
                      .map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.value}
                        </option>
                      ))}
                  </select>
                </Field>
              )}
              <div>
                <Groups
                  label={`Brand ${i + 1} groups`}
                  groups={groups}
                  segments={snapshot.smartGroupSegments || []}
                  segmentsLoaded={!!snapshot.smartGroupSegmentsLoaded}
                  fields={fields}
                  createBlocked={blocked}
                  blockMessage={groupBlockMessage(snapshot)}
                  listFailed={listFailed}
                  value={s.groupIds}
                  onChange={(v) => update(i, { groupIds: v })}
                  pending={door.newGroups || []}
                  selectedKeys={s.newGroupKeys || []}
                  onSelectedKeys={(keys) => update(i, { newGroupKeys: keys })}
                  onCreatePending={addPending}
                  onRemovePending={removePending}
                />
                <small>
                  {s.groupIds.length || (s.newGroupKeys || []).length
                    ? "Custom smart-group assignment"
                    : "Inherits parent groups, description and location"}
                </small>
              </div>
            </div>
            <Button
              kind="ghost"
              disabled={door.subJobs.length === 1}
              onClick={() =>
                set(
                  "subJobs",
                  door.subJobs.filter((_, idx) => idx !== i),
                )
              }
            >
              Remove brand {i + 1}
            </Button>
          </div>
        ))}
        <Button
          kind="ghost"
          onClick={() =>
            set("subJobs", [
              ...door.subJobs,
              { title: "", groupIds: [], newGroupKeys: [] },
            ])
          }
        >
          + Add brand
        </Button>
        <div className="stickyAction">
          <span>{door.subJobs.length} brand sub-job(s)</span>
          <Button disabled={!valid} onClick={onPreview}>
            Preview complete setup
          </Button>
        </div>
      </div>
    </>
  );
}
function ManageDoor({ parent, subJobs, snapshot, onBack, preview }) {
  const [name, setName] = useState(""),
    [groups, setGroups] = useState([]),
    [pending, setPending] = useState([]),
    [selectedKeys, setSelectedKeys] = useState([]),
    [adding, setAdding] = useState(false);
  useEffect(() => {
    const next = adoptCreatedGroups(
      pending,
      selectedKeys,
      groups,
      snapshot.smartGroups,
    );
    if (!next.changed) return;
    setPending(next.pending);
    setSelectedKeys(next.selectedKeys);
    setGroups(next.selectedIds);
  }, [snapshot.smartGroups, pending, selectedKeys, groups]);
  if (!parent)
    return (
      <>
        <Notice tone="warning">
          This door is no longer in the account scan.
        </Notice>
        <Button onClick={onBack}>Back to doors</Button>
      </>
    );
  return (
    <>
      <div className="headingRow">
        <div>
          <p className="eyebrow">Manage door</p>
          <h2>{parent.title}</h2>
          <p>{parent.gps?.address || parent.code}</p>
        </div>
        <Button kind="ghost" onClick={onBack}>
          Back to doors
        </Button>
      </div>
      <Notice>
        Select brands below to change their assignments. Connecteam requires
        individual sub-job updates; a parent containing sub-jobs cannot be
        edited as a whole.
      </Notice>
      {subJobs.length > 0 && (
        <div className="panel formPanel">
          <Button kind="ghost" onClick={() => setAdding(!adding)}>
            {adding ? "Close brand form" : "+ Add brand to this door"}
          </Button>
          {adding && (
            <>
              <Field label="New brand name">
                <input
                  maxLength={128}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </Field>
              <Groups
                label="New brand groups"
                groups={snapshot.smartGroups}
                segments={snapshot.smartGroupSegments || []}
                segmentsLoaded={!!snapshot.smartGroupSegmentsLoaded}
                fields={dropdownFields(snapshot.userFields)}
                createBlocked={!!groupBlockMessage(snapshot)}
                blockMessage={groupBlockMessage(snapshot)}
                listFailed={
                  !snapshot.smartGroupsLoaded && !!snapshot.smartGroupsError
                }
                value={groups}
                onChange={setGroups}
                pending={pending}
                selectedKeys={selectedKeys}
                onSelectedKeys={setSelectedKeys}
                onCreatePending={(draft) =>
                  setPending((current) => [...current, draft])
                }
                onRemovePending={(key) => {
                  setPending((current) =>
                    current.filter((group) => group.key !== key),
                  );
                  setSelectedKeys((current) =>
                    current.filter((item) => item !== key),
                  );
                }}
              />
              <p className="muted">
                With custom groups, the new brand copies the door’s description
                and location. With no groups selected, it inherits all parent
                settings.
              </p>
              <Button
                disabled={!name.trim() || !!groupBlockMessage(snapshot)}
                onClick={() =>
                  preview("addBrand", {
                    parentId: parent.jobId,
                    title: name,
                    groupIds: groups,
                    newGroupKeys: selectedKeys,
                    newGroups: pending,
                  })
                }
              >
                Preview new brand
              </Button>
            </>
          )}
        </div>
      )}
      {subJobs.length ? (
        <RepairTable
          key={parent.jobId}
          snapshot={snapshot}
          subJobs={subJobs}
          preview={preview}
        />
      ) : (
        <Notice tone="warning">
          This job has no sub-jobs. Connecteam does not allow adding sub-jobs to
          a job created without them. Create a new door setup with its brands.
        </Notice>
      )}
    </>
  );
}
function RepairTable({ snapshot, subJobs, preview }) {
  const [search, setSearch] = useState(""),
    [selected, setSelected] = useState([]),
    [mode, setMode] = useState("add"),
    [groupIds, setGroupIds] = useState([]),
    [pending, setPending] = useState([]),
    [selectedKeys, setSelectedKeys] = useState([]);
  useEffect(() => {
    const next = adoptCreatedGroups(
      pending,
      selectedKeys,
      groupIds,
      snapshot.smartGroups,
    );
    if (!next.changed) return;
    setPending(next.pending);
    setSelectedKeys(next.selectedKeys);
    setGroupIds(next.selectedIds);
  }, [snapshot.smartGroups, pending, selectedKeys, groupIds]);
  const rows = subJobs.filter((s) =>
    `${s.title} ${s.parentTitle}`.toLowerCase().includes(search.toLowerCase()),
  );
  const visible = rows.slice(0, 500).filter((s) => s.jobId);
  const active = selected.filter((id) => subJobs.some((s) => s.jobId === id));
  const all =
    visible.length > 0 && visible.every((s) => active.includes(s.jobId));
  return (
    <>
      <Notice>
        Every sub-job is selectable. “Needs review” marks custom assignments
        without users or groups. Review up to 100 records per operation.
      </Notice>
      <div className="panel formPanel">
        <div className="formGrid two">
          <Field label="Assignment change">
            <select value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="add">
                Add groups; keep existing users and groups
              </option>
              <option value="replace">
                Replace groups; keep existing users
              </option>
              <option value="inherit">Inherit parent settings</option>
            </select>
          </Field>
          {mode !== "inherit" && (
            <Groups
              label="Groups to apply"
              groups={snapshot.smartGroups}
              segments={snapshot.smartGroupSegments || []}
              segmentsLoaded={!!snapshot.smartGroupSegmentsLoaded}
              fields={dropdownFields(snapshot.userFields)}
              createBlocked={!!groupBlockMessage(snapshot)}
              blockMessage={groupBlockMessage(snapshot)}
              listFailed={
                !snapshot.smartGroupsLoaded && !!snapshot.smartGroupsError
              }
              value={groupIds}
              onChange={setGroupIds}
              pending={pending}
              selectedKeys={selectedKeys}
              onSelectedKeys={setSelectedKeys}
              onCreatePending={(draft) =>
                setPending((current) => [...current, draft])
              }
              onRemovePending={(key) => {
                setPending((current) =>
                  current.filter((group) => group.key !== key),
                );
                setSelectedKeys((current) =>
                  current.filter((item) => item !== key),
                );
              }}
            />
          )}
        </div>
        {mode === "inherit" && (
          <Notice tone="warning">
            Inheritance replaces custom assignment, description and location
            with the parent’s settings. This is broader than an assignment-only
            change.
          </Notice>
        )}
        <div className="panelToolbar">
          <input
            aria-label="Search sub-jobs"
            className="search"
            placeholder="Search brands or doors…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Button kind="ghost" onClick={() => setSelected([])}>
            Clear selection
          </Button>
        </div>
        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    aria-label="Select visible sub-jobs"
                    checked={all}
                    onChange={() =>
                      setSelected(
                        all
                          ? active.filter(
                              (id) => !visible.some((s) => s.jobId === id),
                            )
                          : [
                              ...new Set([
                                ...active,
                                ...visible.map((s) => s.jobId),
                              ]),
                            ],
                      )
                    }
                  />
                </th>
                <th>Brand / sub-job</th>
                <th>Door</th>
                <th>Current assignment</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((s) => (
                <tr key={s.jobId}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Select ${s.parentTitle} / ${s.title}`}
                      checked={active.includes(s.jobId)}
                      onChange={() => setSelected(toggle(active, s.jobId))}
                    />
                  </td>
                  <td>
                    <strong>{s.title}</strong>
                    {!s.useParentData &&
                      !s.assign?.userIds?.length &&
                      !s.assign?.groupIds?.length && (
                        <small className="badge orange">Needs review</small>
                      )}
                  </td>
                  <td>{s.parentTitle || s.parentId}</td>
                  <td>
                    {s.useParentData ? (
                      "Inherits parent"
                    ) : (
                      <>
                        {(s.assign?.groupIds || [])
                          .map(
                            (id) =>
                              snapshot.smartGroups.find(
                                (g) => g.id === Number(id),
                              )?.name || `Group ${id}`,
                          )
                          .join(", ") || "No groups"}
                        <small>
                          {s.assign?.userIds?.length || 0} directly assigned
                          users
                        </small>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!visible.length && (
            <p className="emptyBuilder">No matching sub-jobs.</p>
          )}
        </div>
        {rows.length > 500 && (
          <p>Showing 500 results. Search to find any sub-job.</p>
        )}
        <div className="stickyAction">
          <span>{active.length} selected</span>
          <Button
            disabled={
              !active.length ||
              active.length > 100 ||
              !!groupBlockMessage(snapshot) ||
              (mode !== "inherit" && !groupIds.length && !selectedKeys.length)
            }
            onClick={() =>
              preview("repairSubJobs", {
                newGroups: pending,
                repairs: active.map((jobId) => ({
                  jobId,
                  mode,
                  groupIds: mode === "inherit" ? [] : groupIds,
                  newGroupKeys: mode === "inherit" ? [] : selectedKeys,
                })),
              })
            }
          >
            Preview assignment changes
          </Button>
        </div>
      </div>
    </>
  );
}
function Assignments({ snapshot, preview }) {
  const [fieldId, setFieldId] = useState(""),
    [optionId, setOptionId] = useState(""),
    [mode, setMode] = useState("add"),
    [search, setSearch] = useState(""),
    [selected, setSelected] = useState([]),
    [newValue, setNewValue] = useState("");
  const fields = snapshot.userFields.filter((f) => f.type === "dropdown"),
    field = fields.find((f) => f.id === Number(fieldId)),
    options = (field?.dropdownOptions || []).filter(
      (o) => !o.isDeleted && !o.isDisabled,
    ),
    users = snapshot.users
      .filter((u) =>
        `${u.firstName} ${u.lastName} ${u.email}`
          .toLowerCase()
          .includes(search.toLowerCase()),
      )
      .slice(0, 300);
  return (
    <>
      <div className="headingRow">
        <div>
          <p className="eyebrow">Employee profiles</p>
          <h2>Employee door assignments</h2>
          <p>
            Update a door dropdown value on employee profiles. This is separate
            from job smart-group eligibility.
          </p>
        </div>
      </div>
      <div className="panel formPanel">
        <div className="formGrid two">
          <Field label="Dropdown field">
            <select
              value={fieldId}
              onChange={(e) => {
                setFieldId(e.target.value);
                setOptionId("");
              }}
            >
              <option value="">Choose a field…</option>
              {fields.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Door value">
            <select
              value={optionId}
              onChange={(e) => setOptionId(e.target.value)}
            >
              <option value="">Choose a value…</option>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.value}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="inlineCreate">
          <input
            aria-label="New dropdown value"
            placeholder="New door dropdown value"
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
          />
          <Button
            kind="ghost"
            disabled={!field || !newValue.trim()}
            onClick={() =>
              preview("createDoorOption", {
                customFieldId: field.id,
                value: newValue,
              })
            }
          >
            Preview new value
          </Button>
        </div>
        <Field label="Operation">
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="add">
              {field && !field.isMultiSelect
                ? "Replace current value"
                : "Add value"}
            </option>
            <option value="remove">Remove value</option>
          </select>
        </Field>
        {field && !field.isMultiSelect && mode === "add" && (
          <Notice tone="warning">
            This field allows one value. Applying a new door will replace the
            employee’s current value.
          </Notice>
        )}
        <div className="selectToolbar">
          <input
            aria-label="Search employees"
            placeholder="Search employees…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Button
            kind="ghost"
            onClick={() => setSelected(users.map((u) => u.userId))}
          >
            Select shown
          </Button>
          <Button kind="ghost" onClick={() => setSelected([])}>
            Clear
          </Button>
        </div>
        <div className="userPicker">
          {users.map((u) => (
            <label className="userRow" key={u.userId}>
              <input
                type="checkbox"
                checked={selected.includes(u.userId)}
                onChange={() => setSelected(toggle(selected, u.userId))}
              />
              <span className="avatar">{u.firstName?.[0]}</span>
              <span>
                {u.firstName} {u.lastName}
                <small>{u.email}</small>
              </span>
            </label>
          ))}
        </div>
        <div className="stickyAction">
          <span>{selected.length} selected · maximum 100 per preview</span>
          <Button
            disabled={
              !field || !optionId || !selected.length || selected.length > 100
            }
            onClick={() =>
              preview("bulkAssignDoor", {
                customFieldId: field.id,
                optionId: Number(optionId),
                mode,
                userIds: selected,
              })
            }
          >
            Preview employee changes
          </Button>
        </div>
      </div>
    </>
  );
}
function AssignmentSummary({ value, groups }) {
  return (
    <span>
      {(value?.groupIds || [])
        .map((id) => {
          const group = groups.find((item) => item.id === Number(id));
          if (!group) return `Group ${id}`;
          return group.pending ? `${group.name} (new)` : group.name;
        })
        .join(", ") || "No groups"}
      <small>{value?.userIds?.length || 0} directly assigned users</small>
    </span>
  );
}
function groupCreatePayload(spec) {
  return {
    name: spec.name,
    ...(spec.description ? { description: spec.description } : {}),
    groupSegmentId: spec.groupSegmentId || `new segment: ${spec.segment.name}`,
    filters: {
      operator: spec.filters.operator,
      dropdownFilters: spec.filters.dropdownFilters.map(
        ({ fieldId, optionIds, fieldName, optionNames }) => ({
          fieldId,
          fieldName,
          optionIds,
          optionNames,
        }),
      ),
    },
  };
}
function Preview({ plan, onCancel, onConfirm }) {
  const dialog = useRef(null);
  useEffect(() => {
    dialog.current.showModal();
    return () => dialog.current?.close();
  }, []);
  const groups = plan.groups || [],
    parent = plan.body?.[0];
  return (
    <dialog
      ref={dialog}
      className="modal previewModal"
      onCancel={onCancel}
      aria-labelledby="preview-title"
    >
      <div className="modalHead">
        <div>
          <p className="eyebrow">Fresh Connecteam preview</p>
          <h3 id="preview-title">
            Review{" "}
            {plan.action === "createDoor"
              ? "door setup"
              : ["repairSubJobs", "addBrand"].includes(plan.action)
                ? "brand assignments"
                : "employee field changes"}
          </h3>
        </div>
        <button className="x" aria-label="Close preview" onClick={onCancel}>
          ×
        </button>
      </div>
      <Notice>
        Nothing has been written. The app checks current data again before
        applying. This preview expires in 10 minutes.
      </Notice>
      {plan.eligibility && (
        <>
          <h3>Job AND brand</h3>
          <p>
            A person is added to a brand only when they qualify for{" "}
            <strong>{plan.eligibility.doorOptionLabel}</strong> and that brand.
            {plan.eligibility.userUpdates.length === 1
              ? " 1 person will gain tags."
              : plan.eligibility.userUpdates.length
                ? ` ${plan.eligibility.userUpdates.length} people will gain tags.`
                : " No new tags are needed."}
            {plan.eligibility.alreadyTagged
              ? ` ${plan.eligibility.alreadyTagged} matching people already have the tags.`
              : ""}
          </p>
          {!!plan.eligibility.options.length && (
            <ul>
              {plan.eligibility.options.map((option) => (
                <li key={option.tempId}>
                  New {option.fieldName} tag: <strong>{option.value}</strong>
                </li>
              ))}
            </ul>
          )}
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>Brand group</th>
                  <th>People who match the job and this brand</th>
                </tr>
              </thead>
              <tbody>
                {plan.eligibility.brands.map((brand) => (
                  <tr key={brand.key}>
                    <td>
                      <strong>{brand.groupName}</strong>
                      <small>{brand.optionLabel}</small>
                    </td>
                    <td>
                      {brand.people.map((person) => person.label).join(", ") ||
                        "No one matches yet. The group still updates when both tags are set later."}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {!!plan.groupCreates?.length && (
        <>
          <h3>Smart groups to create</h3>
          <ul>
            {plan.groupCreates.map((spec) => (
              <li key={spec.key}>
                <strong>{spec.name}</strong>
                {spec.description ? ` — ${spec.description}` : ""}
                <small>
                  {spec.segment
                    ? `New segment ${spec.segment.name} (${spec.segment.color})`
                    : `Existing segment ${spec.groupSegmentId}`}
                  {spec.filters.dropdownFilters.length
                    ? ` · ${spec.filters.operator} · ${spec.filters.dropdownFilters
                        .map(
                          (filter) =>
                            `${filter.fieldName}: ${filter.optionNames.join(", ")}`,
                        )
                        .join("; ")}`
                    : " · no membership filters"}
                </small>
              </li>
            ))}
          </ul>
        </>
      )}
      {plan.action === "createDoor" && (
        <>
          <h3>{parent.title}</h3>
          <p>
            {parent.description || "No description"}
            <br />
            {parent.gps?.address || "No address"}
            {parent.gps?.latitude !== undefined &&
              ` · ${parent.gps.latitude}, ${parent.gps.longitude}`}
          </p>
          <p>
            Code: {parent.code || "None"}
            <br />
            Create in:{" "}
            {parent.instanceIds
              .map(
                (id) =>
                  plan.instances.find((i) => Number(i.id) === id)?.name || id,
              )
              .join(", ")}
          </p>
          <p>
            Parent groups:{" "}
            <AssignmentSummary value={parent.assign} groups={groups} />
          </p>
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>Door → brand</th>
                  <th>Smart groups</th>
                </tr>
              </thead>
              <tbody>
                {parent.subJobs.map((s) => (
                  <tr key={s.title}>
                    <td>
                      {parent.title} → <strong>{s.title}</strong>
                    </td>
                    <td>
                      <AssignmentSummary
                        value={s.useParentData ? parent.assign : s.assign}
                        groups={groups}
                      />
                      <small>
                        {s.useParentData
                          ? "Inherits parent settings"
                          : "Custom groups; copies door description and location"}
                      </small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {plan.action === "addBrand" && (
        <>
          <h3>
            {plan.parentTitle} → {parent.title}
          </h3>
          <AssignmentSummary
            value={
              parent.useParentData ? plan.parentBefore.assign : parent.assign
            }
            groups={groups}
          />
          <p>
            {parent.useParentData
              ? "Inherits parent settings"
              : "Custom groups; copies the door description and location"}
          </p>
        </>
      )}
      {plan.action === "repairSubJobs" && (
        <>
          {plan.input.repairs.some((r) => r.mode === "inherit") && (
            <Notice tone="warning">
              Inheritance also replaces the sub-job’s custom description and
              location with its parent’s settings.
            </Notice>
          )}
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>Door → brand</th>
                  <th>Current</th>
                  <th>After</th>
                </tr>
              </thead>
              <tbody>
                {plan.records.map((r) => (
                  <tr key={r.jobId}>
                    <td>
                      <strong>{r.label}</strong>
                    </td>
                    <td>
                      <AssignmentSummary
                        value={
                          r.before.useParentData
                            ? r.parentBefore.assign
                            : r.before.assign
                        }
                        groups={groups}
                      />
                      <small>
                        {r.before.useParentData ? "Inherited" : "Custom"}
                      </small>
                    </td>
                    <td>
                      <AssignmentSummary
                        value={
                          r.after.useParentData
                            ? r.parentBefore.assign
                            : r.after.assign
                        }
                        groups={groups}
                      />
                      <small>
                        {r.after.useParentData
                          ? "Inherit parent settings"
                          : "Custom assignment; preserve users and other settings"}
                      </small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {plan.action === "bulkAssignDoor" && (
        <>
          <h3>{plan.field.name}</h3>
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Before</th>
                  <th>After</th>
                </tr>
              </thead>
              <tbody>
                {plan.records.map((r) => (
                  <tr key={r.userId}>
                    <td>{r.label}</td>
                    {[r.before, r.after].map((values, i) => (
                      <td key={i}>
                        {values
                          .map(
                            (id) =>
                              plan.field.dropdownOptions.find(
                                (o) => o.id === id,
                              )?.value || id,
                          )
                          .join(", ") || "Empty"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {plan.action === "createDoorOption" && (
        <p>
          Add <strong>{plan.body.value}</strong> to{" "}
          <strong>{plan.field.name}</strong>.
        </p>
      )}
      <details className="technical">
        <summary>Exact request details</summary>
        <pre>
          {JSON.stringify(
            {
              ...(plan.groupCreates?.length
                ? {
                    segments: plan.groupCreates
                      .filter((spec) => spec.segment)
                      .filter(
                        (spec, index, all) =>
                          all.findIndex(
                            (item) =>
                              item.segment.name.toLowerCase() ===
                              spec.segment.name.toLowerCase(),
                          ) === index,
                      )
                      .map((spec) => spec.segment),
                    smartGroups: plan.groupCreates.map(groupCreatePayload),
                  }
                : {}),
              assignment: JSON.parse(
                JSON.stringify(
                  plan.body || plan.records.map((record) => record.after),
                  (key, value) => {
                    if (key !== "groupIds" || !Array.isArray(value))
                      return value;
                    const names = new Map(
                      (plan.groupCreates || []).map((spec) => [
                        spec.tempId,
                        `new:${spec.name}`,
                      ]),
                    );
                    return value.map((id) => names.get(id) || id);
                  },
                ),
              ),
            },
            null,
            2,
          )}
        </pre>
      </details>
      <div className="modalActions">
        <Button kind="ghost" onClick={onCancel}>
          Back to editing
        </Button>
        <Button onClick={onConfirm}>
          {plan.action === "createDoor"
            ? "Create complete setup"
            : "Apply reviewed changes"}
        </Button>
      </div>
    </dialog>
  );
}
function Results({ report }) {
  function download() {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "connecteam-operation-results.json";
    link.click();
    URL.revokeObjectURL(url);
  }
  return (
    <Notice tone={report.complete ? "success" : "warning"}>
      <strong>
        {report.complete
          ? "Operation completed."
          : "Operation needs attention. Inspect the results before retrying."}
      </strong>
      <ul>
        {report.results.map((r, i) => (
          <li key={i}>
            {r.label || r.jobId || "Operation"}: <strong>{r.status}</strong>
            {(r.requestId || r.details?.requestId) && (
              <small>Request ID: {r.requestId || r.details.requestId}</small>
            )}
            {r.note && <small>{r.note}</small>}
            {r.error && <pre>{r.error}</pre>}
            {r.details && (
              <details>
                <summary>Connecteam error details</summary>
                <pre>{JSON.stringify(r.details, null, 2)}</pre>
              </details>
            )}
          </li>
        ))}
      </ul>
      <Button kind="ghost" onClick={download}>
        Download results
      </Button>
    </Notice>
  );
}
