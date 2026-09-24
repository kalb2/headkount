"use client";
import { useEffect, useMemo, useRef, useState } from "react";
const newDoor = () => ({
  title: "",
  code: "",
  description: "",
  gps: { address: "", latitude: "", longitude: "" },
  instanceIds: [],
  parentGroupIds: [],
  subJobs: [{ title: "", groupIds: [] }],
});
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
function Groups({ groups, value, onChange, label = "Smart groups" }) {
  const [search, setSearch] = useState("");
  const filtered = groups.filter((g) =>
    `${g.name} ${g.id}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <fieldset className="groupPicker">
      <legend>
        {label} · {value.length} selected
      </legend>
      <input
        aria-label={`Search ${label}`}
        placeholder="Search existing smart groups…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <div className="miniGroupSelect">
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
        {!filtered.length && <p>No matching smart groups.</p>}
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
      `${json.error || "Request failed"}${json.details ? `\n${JSON.stringify(json.details, null, 2)}` : ""}`,
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
      if (result.complete && submitted.action === "createDoor") {
        setEditor(false);
        setDoor(newDoor());
      }
      try {
        await refresh();
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
          <span className="badge blue">Operations Manager · V1.3</span>
          <h1>
            Every door.
            <br />
            The right brands and people.
          </h1>
          <p>
            Create a door, connect its brand sub-jobs to existing smart groups,
            then preview and verify your changes.
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
        <small className="version">V1.3</small>
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
          <span className="status">
            {snapshot.smartGroupsLoaded
              ? `${snapshot.smartGroups.length} smart groups loaded`
              : "Smart groups unavailable"}
          </span>
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
function Doors({ parents, subJobs, onCreate, onManage }) {
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
  const valid =
    snapshot.smartGroupsLoaded &&
    groups.length > 0 &&
    door.title.trim() &&
    door.instanceIds.length &&
    door.subJobs.length &&
    door.subJobs.every(
      (s) =>
        s.title.trim() && (s.groupIds.length || door.parentGroupIds.length),
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
      {!snapshot.smartGroupsLoaded || !groups.length ? (
        <Notice tone="warning">
          {snapshot.smartGroupsLoaded
            ? "The account returned no smart groups."
            : "Smart groups could not be loaded."}{" "}
          Refresh the account before creating a setup.
        </Notice>
      ) : (
        <Notice>
          {groups.length} existing smart groups available. Selecting several
          groups adds those groups; it does not calculate a Door AND Brand
          intersection.
        </Notice>
      )}
      <div className="panel formPanel">
        <h3>1. Door details</h3>
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
        <h3>2. Parent eligibility</h3>
        <p className="muted">
          Optional if every brand has its own groups. Brands without custom
          groups inherit these groups, the description, and the location.
        </p>
        <Groups
          label="Parent smart groups"
          groups={groups}
          value={door.parentGroupIds}
          onChange={(v) => set("parentGroupIds", v)}
        />
        <h3>3. Brand sub-jobs</h3>
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
              <div>
                <Groups
                  label={`Brand ${i + 1} groups`}
                  groups={groups}
                  value={s.groupIds}
                  onChange={(v) => update(i, { groupIds: v })}
                />
                <small>
                  {s.groupIds.length
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
            set("subJobs", [...door.subJobs, { title: "", groupIds: [] }])
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
    [adding, setAdding] = useState(false);
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
                value={groups}
                onChange={setGroups}
              />
              <p className="muted">
                With custom groups, the new brand copies the door’s description
                and location. With no groups selected, it inherits all parent
                settings.
              </p>
              <Button
                disabled={!name.trim() || !snapshot.smartGroupsLoaded}
                onClick={() =>
                  preview("addBrand", {
                    parentId: parent.jobId,
                    title: name,
                    groupIds: groups,
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
    [groupIds, setGroupIds] = useState([]);
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
              value={groupIds}
              onChange={setGroupIds}
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
              !snapshot.smartGroupsLoaded ||
              (mode !== "inherit" && !groupIds.length)
            }
            onClick={() =>
              preview("repairSubJobs", {
                repairs: active.map((jobId) => ({
                  jobId,
                  mode,
                  groupIds: mode === "inherit" ? [] : groupIds,
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
        .map(
          (id) =>
            groups.find((g) => g.id === Number(id))?.name || `Group ${id}`,
        )
        .join(", ") || "No groups"}
      <small>{value?.userIds?.length || 0} directly assigned users</small>
    </span>
  );
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
            plan.body || plan.records.map((r) => r.after),
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
