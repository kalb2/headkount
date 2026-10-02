"use client";
import { useEffect, useMemo, useRef, useState } from "react";
const newDoor = () => ({
  title: "",
  code: "",
  description: "",
  gps: { address: "", latitude: "", longitude: "" },
  instanceIds: [],
  doorFieldId: "",
  brandFieldId: "",
  segmentId: "",
  subJobs: [],
  selectedUserIds: [],
});
const toggle = (values, id) =>
  values.includes(id) ? values.filter((x) => x !== id) : [...values, id];

function userFieldOptionIds(user, fieldId) {
  const value = user.customFields?.find(
    (field) => Number(field.customFieldId) === Number(fieldId),
  )?.value;
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => Number(item?.id ?? item))
    .filter((id) => Number.isSafeInteger(id) && id > 0);
}
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
          ...s,
          ...map.get(s.jobId),
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
    [tab, setTab] = useState("create"),
    [door, setDoor] = useState(newDoor),
    [wizardKey, setWizardKey] = useState(0),
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
      if (
        result.complete &&
        ["createDoor", "createQualifiedDoor"].includes(submitted.action)
      ) {
        setDoor(newDoor());
        setWizardKey((value) => value + 1);
        setTab("create");
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
    setTab("create");
    setError("");
    setPlan(null);
    setReport(null);
    setManaged(null);
    setDoor(newDoor());
    setWizardKey((value) => value + 1);
  }
  if (!snapshot)
    return (
      <main className="shell connectShell">
        <section className="connectCard">
          <div className="brandMark">C</div>
          <span className="badge blue">Operations Manager · V1.3</span>
          <h1>Create and manage Connecteam Jobs.</h1>
          <p>Connect your account to get started.</p>
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
            ["create", "Create Job"],
            ["jobs", "Existing Jobs"],
            ["assign", "Employee eligibility"],
            ["audit", "Audit & Repair"],
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
                "Jobs & Sub-jobs workspace"}
            </strong>
          </div>
          <span className="status">Connected</span>
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
          {tab === "create" && (
            <div className="content">
              <DoorBuilder
                key={wizardKey}
                door={door}
                setDoor={setDoor}
                snapshot={snapshot}
                onCancel={() => {
                  setDoor(newDoor());
                  setWizardKey((value) => value + 1);
                }}
                onPreview={() => preview("createQualifiedDoor", door)}
              />
            </div>
          )}
          {tab === "jobs" && (
            <div className="content">
              {managed ? (
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
                  onCreate={() => {
                    setDoor(newDoor());
                    setWizardKey((value) => value + 1);
                    setTab("create");
                  }}
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
              <SmartGroupBindingDiagnostic
                snapshot={snapshot}
                parents={parents}
                subJobs={subJobs}
              />
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
  const rows = parents
    .filter((j) =>
      `${j.title} ${j.code || ""}`
        .toLowerCase()
        .includes(search.toLowerCase()),
    )
    .sort((a, b) =>
      String(a.title || "").localeCompare(String(b.title || ""), undefined, {
        sensitivity: "base",
      }),
    );
  return (
    <>
      <div className="headingRow">
        <div>
          <p className="eyebrow">Existing Jobs</p>
          <h2>Jobs</h2>
          <p>
            View or manage Jobs already in Connecteam.
          </p>
        </div>
        <Button onClick={onCreate}>Create Job</Button>
      </div>
      <div className="metricGrid">
        <Metric label="Jobs" value={parents.length} />
        <Metric label="Sub-jobs" value={subJobs.length} />
      </div>
      <div className="panel">
        <div className="panelToolbar">
          <input
            className="search"
            aria-label="Search Jobs"
            placeholder="Search Jobs or Job codes…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <span>{rows.length} Jobs</span>
        </div>
        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>Job</th>
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
              No matching Jobs. Create your first Job above.
            </p>
          )}
        </div>
        {rows.length > 500 && (
          <p className="tableNote">
            Showing 500 results. Search to find any Job.
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
  const set = (key, value) => setDoor((current) => ({ ...current, [key]: value }));
  const [step, setStep] = useState(1);
  const [subItemSearch, setSubItemSearch] = useState("");
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [employeeGroupId, setEmployeeGroupId] = useState("");
  const [employeeFieldId, setEmployeeFieldId] = useState("");
  const [employeeOptionId, setEmployeeOptionId] = useState("");

  const groups = snapshot.smartGroups || [];
  const dropdownFields = snapshot.userFields.filter(
    (field) => field.type === "dropdown" && field.isMultiSelect === true,
  );
  const doorField = dropdownFields.find(
    (field) => Number(field.id) === Number(door.doorFieldId),
  );
  const brandField = dropdownFields.find(
    (field) => Number(field.id) === Number(door.brandFieldId),
  );
  const brandOptions = (brandField?.dropdownOptions || []).filter(
    (option) => !option.isDeleted && !option.isDisabled,
  );
  const schedules = snapshot.schedulers
    .filter((item) => !item.isArchived)
    .map((item) => ({ id: item.schedulerId, name: item.name }))
    .sort((a, b) =>
      String(a.name || "").localeCompare(String(b.name || ""), undefined, {
        sensitivity: "base",
      }),
    );
  const timeClocks = snapshot.timeClocks
    .filter((item) => !item.isArchived)
    .map((item) => ({ id: item.id, name: item.name }))
    .sort((a, b) =>
      String(a.name || "").localeCompare(String(b.name || ""), undefined, {
        sensitivity: "base",
      }),
    );

  useEffect(() => {
    setDoor((current) => {
      const next = { ...current };
      let changed = false;

      if (!next.doorFieldId) {
        const match =
          dropdownFields.find((field) =>
            /door|job|location|store/i.test(field.name || ""),
          ) || dropdownFields[0];
        if (match) {
          next.doorFieldId = String(match.id);
          changed = true;
        }
      }

      if (!next.brandFieldId) {
        const match = dropdownFields.find((field) =>
          /brand/i.test(field.name || ""),
        );
        if (match && Number(match.id) !== Number(next.doorFieldId)) {
          next.brandFieldId = String(match.id);
          changed = true;
        }
      }

      if (!next.segmentId && snapshot.smartGroupSegments?.length) {
        const match =
          snapshot.smartGroupSegments.find((segment) =>
            /headkount|job|location/i.test(segment.name || ""),
          ) || snapshot.smartGroupSegments[0];
        next.segmentId = String(match.id);
        changed = true;
      }

      return changed ? next : current;
    });
  }, [dropdownFields, snapshot.smartGroupSegments, setDoor]);

  const selectedBrandIds = door.subJobs.map((sub) => Number(sub.brandOptionId));
  const employeeFilterFields = snapshot.userFields.filter(
    (field) => field.type === "dropdown",
  );
  const employeeFilterField = employeeFilterFields.find(
    (field) => Number(field.id) === Number(employeeFieldId),
  );
  const employeeFilterOptions = (
    employeeFilterField?.dropdownOptions || []
  ).filter((option) => !option.isDeleted && !option.isDisabled);
  const supportsSmartGroupMembership = snapshot.users.some(
    (user) => Array.isArray(user.smartGroupIds),
  );
  const visibleEmployees = snapshot.users.filter((user) => {
    const haystack =
      `${user.firstName || ""} ${user.lastName || ""} ${user.email || ""}`.toLowerCase();
    if (!haystack.includes(employeeSearch.toLowerCase())) return false;
    if (
      employeeGroupId &&
      !((user.smartGroupIds || []).map(Number).includes(Number(employeeGroupId)))
    )
      return false;
    if (
      employeeFieldId &&
      employeeOptionId &&
      !userFieldOptionIds(user, employeeFieldId).includes(Number(employeeOptionId))
    )
      return false;
    return true;
  });
  const selectedEmployees = snapshot.users.filter((user) =>
    door.selectedUserIds.includes(user.userId),
  );
  const employeeBrandMatches = (user) => {
    const optionIds = userFieldOptionIds(user, door.brandFieldId);
    return brandOptions.filter(
      (option) =>
        selectedBrandIds.includes(Number(option.id)) &&
        optionIds.includes(Number(option.id)),
    );
  };
  const selectedWithoutBrand = selectedEmployees.filter(
    (user) => employeeBrandMatches(user).length === 0,
  );

  const selectedSegment = (snapshot.smartGroupSegments || []).find(
    (segment) => Number(segment.id) === Number(door.segmentId),
  );
  const existingDoorOption = doorField?.dropdownOptions?.find(
    (option) =>
      !option.isDeleted &&
      !option.isDisabled &&
      String(option.value || "").trim().toLowerCase() ===
        String(door.title || "").trim().toLowerCase(),
  );
  const selectedInstances = [
    ...timeClocks
      .filter((item) => door.instanceIds.includes(item.id))
      .map((item) => ({ ...item, type: "Time Clock" })),
    ...schedules
      .filter((item) => door.instanceIds.includes(item.id))
      .map((item) => ({ ...item, type: "Job Scheduler" })),
  ];
  const plannedGroups = door.title.trim()
    ? [
        {
          key: "door",
          name: `Door: ${door.title.trim()}`,
          description: `Headkount qualification: Door=${door.title.trim()}`,
        },
        ...door.subJobs.map((sub) => ({
          key: `brand:${sub.title}`,
          name: `Door: ${door.title.trim()} · Brand: ${sub.title}`,
          description: `Headkount qualification: Door=${door.title.trim()}; Brand=${sub.title}`,
          subJob: sub.title,
        })),
      ].map((planned) => {
        const sameName = groups.find(
          (group) =>
            String(group.name || "").trim().toLowerCase() ===
            planned.name.toLowerCase(),
        );
        const reusable =
          sameName &&
          sameName.description === planned.description &&
          Number(sameName.groupSegmentId ?? sameName.segmentId) ===
            Number(door.segmentId);
        return {
          ...planned,
          status: reusable ? "Reuse" : sameName ? "Conflict" : "Create",
        };
      })
    : [];
  const totalSubJobAssignments = selectedEmployees.reduce(
    (total, user) => total + employeeBrandMatches(user).length,
    0,
  );

  const stepOneValid =
    door.title.trim() &&
    door.instanceIds.length &&
    door.doorFieldId &&
    door.brandFieldId &&
    door.segmentId &&
    Number(door.doorFieldId) !== Number(door.brandFieldId);
  const stepTwoValid =
    door.subJobs.length > 0 &&
    door.subJobs.every((sub) => sub.title.trim() && sub.brandOptionId);
  const stepThreeValid = door.selectedUserIds.length > 0;
  const canContinue =
    step === 1 ? stepOneValid : step === 2 ? stepTwoValid : stepThreeValid;

  const steps = [
    ["Job", "Enter the Job details"],
    ["Sub-jobs", "Select the Sub-jobs"],
    ["Employees", "Select who can work here"],
    ["Review", "Check and create"],
  ];

  return (
    <>
      <div className="wizardPageTitle">
        <div>
          <p className="eyebrow">Create Job</p>
          <h2>New Job</h2>
        </div>
        <Button kind="ghost" onClick={onCancel}>
          Start over
        </Button>
      </div>

      <div className="wizardShell">
        <div className="wizardProgress" aria-label="Job setup progress">
          {steps.map(([label], index) => {
            const number = index + 1;
            return (
              <div
                key={label}
                className={`wizardProgressStep ${
                  number === step ? "active" : number < step ? "done" : ""
                }`}
              >
                <span>{number < step ? "✓" : number}</span>
                <strong>{label}</strong>
              </div>
            );
          })}
        </div>

        <div className="wizardWorkspace">
          <div className="wizardCard">
          <div className="wizardStepHeader">
            <span>Step {step} of 4</span>
            <h3>{steps[step - 1][0]}</h3>
            <p>{steps[step - 1][1]}</p>
          </div>

          {step === 1 && (
            <div className="wizardStepBody">
              <div className="formGrid two">
                <Field
                  label="Job name"
                  hint="This is the name shown in Connecteam."
                >
                  <input
                    autoFocus
                    maxLength={128}
                    value={door.title}
                    onChange={(e) => set("title", e.target.value)}
                    placeholder="Sephora — The Grove"
                  />
                </Field>
                <Field label="Job code (optional)">
                  <input
                    value={door.code}
                    onChange={(e) => set("code", e.target.value)}
                  />
                </Field>
              </div>

              <Field label="Job description (optional)">
                <textarea
                  value={door.description}
                  onChange={(e) => set("description", e.target.value)}
                />
              </Field>

              <Field label="Job address (optional)">
                <input
                  value={door.gps.address}
                  onChange={(e) =>
                    set("gps", { ...door.gps, address: e.target.value })
                  }
                  placeholder="Street address, city, state, ZIP"
                />
              </Field>

              <details className="coordinateDetails">
                <summary>Precise coordinates</summary>
                <div className="formGrid two">
                  <Field label="Latitude">
                    <input
                      type="number"
                      step="any"
                      value={door.gps.latitude}
                      onChange={(e) =>
                        set("gps", {
                          ...door.gps,
                          latitude: e.target.value,
                        })
                      }
                      placeholder="34.0722"
                    />
                  </Field>
                  <Field label="Longitude">
                    <input
                      type="number"
                      step="any"
                      value={door.gps.longitude}
                      onChange={(e) =>
                        set("gps", {
                          ...door.gps,
                          longitude: e.target.value,
                        })
                      }
                      placeholder="-118.3570"
                    />
                  </Field>
                </div>
                <small>Enter both latitude and longitude.</small>
              </details>

              <div className="wizardSectionLabel">
                <strong>Add this Job to</strong>
              </div>
              <div className="instancePickerGrid">
                <fieldset className="groupPicker instancePicker">
                  <legend>Time Clocks</legend>
                  <div className="checkGrid">
                    {timeClocks.map((clock) => (
                      <label key={`clock-${clock.id}`}>
                        <input
                          type="checkbox"
                          checked={door.instanceIds.includes(clock.id)}
                          onChange={() =>
                            set("instanceIds", toggle(door.instanceIds, clock.id))
                          }
                        />
                        <span>{clock.name}</span>
                      </label>
                    ))}
                    {!timeClocks.length && (
                      <p className="instanceEmpty">No Time Clocks loaded.</p>
                    )}
                  </div>
                </fieldset>

                <fieldset className="groupPicker instancePicker">
                  <legend>Job Schedulers</legend>
                  <div className="checkGrid">
                    {schedules.map((schedule) => (
                      <label key={`schedule-${schedule.id}`}>
                        <input
                          type="checkbox"
                          checked={door.instanceIds.includes(schedule.id)}
                          onChange={() =>
                            set(
                              "instanceIds",
                              toggle(door.instanceIds, schedule.id),
                            )
                          }
                        />
                        <span>{schedule.name}</span>
                      </label>
                    ))}
                    {!schedules.length && (
                      <p className="instanceEmpty">No Job Schedulers loaded.</p>
                    )}
                  </div>
                </fieldset>
              </div>

              <details className="wizardAdvanced">
                <summary>Eligibility settings</summary>
                <div className="formGrid three">
                  <Field
                    label="Job eligibility User Detail"
                    
                  >
                    <select
                      value={door.doorFieldId}
                      onChange={(e) => set("doorFieldId", e.target.value)}
                    >
                      <option value="">Select User Detail</option>
                      {dropdownFields.map((field) => (
                        <option key={field.id} value={field.id}>
                          {field.name}
                        </option>
                      ))}
                    </select>
                  </Field>

                  <Field
                    label="Brand eligibility User Detail"
                    
                  >
                    <select
                      value={door.brandFieldId}
                      onChange={(e) =>
                        setDoor((current) => ({
                          ...current,
                          brandFieldId: e.target.value,
                          subJobs: [],
                        }))
                      }
                    >
                      <option value="">Select User Detail</option>
                      {dropdownFields.map((field) => (
                        <option key={field.id} value={field.id}>
                          {field.name}
                        </option>
                      ))}
                    </select>
                  </Field>

                  <Field
                    label="Smart Group segment"
                    
                  >
                    <select
                      value={door.segmentId}
                      onChange={(e) => set("segmentId", e.target.value)}
                    >
                      <option value="">Select segment</option>
                      {(snapshot.smartGroupSegments || []).map((segment) => (
                        <option key={segment.id} value={segment.id}>
                          {segment.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                {door.doorFieldId &&
                  door.brandFieldId &&
                  Number(door.doorFieldId) === Number(door.brandFieldId) && (
                    <Notice tone="warning">
                      Job eligibility and Brand eligibility must use two
                      different User Details.
                    </Notice>
                  )}
              </details>
            </div>
          )}

          {step === 2 && (
            <div className="wizardStepBody">
              <div className="brandOptionPicker">
                <div className="brandOptionToolbar">
                  <div>
                    <strong>
                      {door.title}
                    </strong>
                    <small>{door.subJobs.length} selected</small>
                  </div>
                  <input
                    aria-label="Search brands"
                    placeholder="Search brands"
                    value={subItemSearch}
                    onChange={(e) => setSubItemSearch(e.target.value)}
                    disabled={!brandField}
                  />
                  {brandField && (
                    <div className="brandOptionActions">
                      <button
                        type="button"
                        onClick={() =>
                          set(
                            "subJobs",
                            brandOptions.map((option) => ({
                              title: option.value,
                              brandOptionId: Number(option.id),
                            })),
                          )
                        }
                      >
                        Select all
                      </button>
                      <button type="button" onClick={() => set("subJobs", [])}>
                        Clear
                      </button>
                    </div>
                  )}
                </div>

                <div className="brandOptionGrid">
                  {brandOptions
                    .filter((option) =>
                      String(option.value || "")
                        .toLowerCase()
                        .includes(subItemSearch.toLowerCase()),
                    )
                    .map((option) => {
                      const selected = door.subJobs.some(
                        (sub) =>
                          Number(sub.brandOptionId) === Number(option.id),
                      );
                      return (
                        <label
                          className={`brandOptionRow ${
                            selected ? "selected" : ""
                          }`}
                          key={option.id}
                        >
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() =>
                              set(
                                "subJobs",
                                selected
                                  ? door.subJobs.filter(
                                      (sub) =>
                                        Number(sub.brandOptionId) !==
                                        Number(option.id),
                                    )
                                  : [
                                      ...door.subJobs,
                                      {
                                        title: option.value,
                                        brandOptionId: Number(option.id),
                                      },
                                    ],
                              )
                            }
                          />
                          <span>
                            <strong>{option.value}</strong>
                          </span>
                        </label>
                      );
                    })}
                  {!brandOptions.length && (
                    <p className="emptyBuilder">
                      No active brand options were found in{" "}
                      {brandField?.name || "the selected User Detail"}.
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="wizardStepBody">
              <div className="wizardContext">
                <strong>{door.title}</strong>
                <span>Choose who can work this Job.</span>
              </div>

              <div className="employeeSetupPanel">
                <div className="employeeSetupFilters">
                  <label className="employeeFilterControl employeeSearchFilter">
                    <span>Search employees</span>
                    <input
                      placeholder="Name or email"
                      value={employeeSearch}
                      onChange={(e) => setEmployeeSearch(e.target.value)}
                    />
                  </label>
                  <label className="employeeFilterControl">
                    <span>User Detail</span>
                    <select
                      value={employeeFieldId}
                      onChange={(e) => {
                        setEmployeeFieldId(e.target.value);
                        setEmployeeOptionId("");
                      }}
                    >
                      <option value="">Any User Detail</option>
                      {employeeFilterFields.map((field) => (
                        <option key={field.id} value={field.id}>
                          {field.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="employeeFilterControl">
                    <span>Value</span>
                    <select
                      value={employeeOptionId}
                      onChange={(e) => setEmployeeOptionId(e.target.value)}
                      disabled={!employeeFilterField}
                    >
                      <option value="">
                        {employeeFilterField ? "Any value" : "Select User Detail first"}
                      </option>
                      {employeeFilterOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.value}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="employeeFilterControl">
                    <span>Smart Group</span>
                    <select
                      value={employeeGroupId}
                      onChange={(e) => setEmployeeGroupId(e.target.value)}
                      disabled={!supportsSmartGroupMembership}
                    >
                      <option value="">
                        {supportsSmartGroupMembership
                          ? "Any Smart Group"
                          : "Membership unavailable"}
                      </option>
                      {supportsSmartGroupMembership &&
                        groups.map((group) => (
                          <option key={group.id} value={group.id}>
                            {group.name}
                          </option>
                        ))}
                    </select>
                  </label>
                </div>

                <div className="employeeSelectToolbar">
                  <strong>
                    {door.selectedUserIds.length} employee
                    {door.selectedUserIds.length === 1 ? "" : "s"} selected
                  </strong>
                  <div>
                    <button
                      type="button"
                      onClick={() =>
                        set(
                          "selectedUserIds",
                          Array.from(
                            new Set([
                              ...door.selectedUserIds,
                              ...visibleEmployees.map((user) => user.userId),
                            ]),
                          ),
                        )
                      }
                    >
                      Select shown
                    </button>
                    <button
                      type="button"
                      onClick={() => set("selectedUserIds", [])}
                    >
                      Clear
                    </button>
                  </div>
                </div>

                <div className="employeeSetupList">
                  {visibleEmployees.slice(0, 500).map((user) => {
                    const matches = employeeBrandMatches(user);
                    const selected = door.selectedUserIds.includes(user.userId);
                    return (
                      <label
                        className={`employeeSetupRow ${
                          selected ? "selected" : ""
                        }`}
                        key={user.userId}
                      >
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() =>
                            set(
                              "selectedUserIds",
                              toggle(door.selectedUserIds, user.userId),
                            )
                          }
                        />
                        <span className="avatar">{user.firstName?.[0]}</span>
                        <span className="employeeSetupIdentity">
                          <strong>
                            {user.firstName} {user.lastName}
                          </strong>
                          <small>{user.email}</small>
                        </span>
                        <span className="employeeBrandStatus">
                          {matches.length ? (
                            <>
                              <small>Sub-jobs</small>
                              <span>
                                {matches
                                  .map((option) => option.value)
                                  .join(", ")}
                              </span>
                            </>
                          ) : (
                            <>
                              <small>No matching Sub-job</small>
                              <span className="warningText">No brand match</span>
                            </>
                          )}
                        </span>
                      </label>
                    );
                  })}
                  {!visibleEmployees.length && (
                    <p className="emptyBuilder">
                      No employees match these filters.
                    </p>
                  )}
                </div>
              </div>

              {selectedWithoutBrand.length > 0 && (
                <Notice tone="warning">
                  {selectedWithoutBrand.length} selected employee
                  {selectedWithoutBrand.length === 1 ? "" : "s"} have no
                  matching Sub-job.
                </Notice>
              )}
            </div>
          )}

          {step === 4 && (
            <div className="wizardStepBody">
              <div className="wizardReviewGrid">
                <div>
                  <span>Job</span>
                  <strong>{door.title}</strong>
                  <small>
                    {door.gps.address || "No address"} ·{" "}
                    {door.instanceIds.length} Schedule/Time Clock assignment(s)
                  </small>
                </div>
                <div>
                  <span>Sub-jobs</span>
                  <strong>{door.subJobs.length}</strong>
                  <small>{door.subJobs.map((sub) => sub.title).join(", ")}</small>
                </div>
                <div>
                  <span>Employees</span>
                  <strong>{door.selectedUserIds.length}</strong>
                  <small>Will receive Job eligibility for {door.title}</small>
                </div>
                <div>
                  <span>Sub-job assignments</span>
                  <strong>
                    {selectedEmployees.reduce(
                      (total, user) => total + employeeBrandMatches(user).length,
                      0,
                    )}
                  </strong>
                  <small>Based on employee Brand eligibility</small>
                </div>
              </div>

              <details className="wizardAdvanced">
                <summary>Technical details</summary>
                <p>
                  Creates the Job, Sub-jobs, required Smart Groups, and employee
                  User Detail assignments.
                </p>
              </details>
            </div>
          )}

          <div className="wizardActions">
            <Button
              kind="ghost"
              onClick={() => (step === 1 ? onCancel() : setStep(step - 1))}
            >
              {step === 1 ? "Cancel" : "Back"}
            </Button>
            <span />
            {step < 4 ? (
              <Button
                disabled={!canContinue}
                onClick={() => setStep(step + 1)}
              >
                Continue
              </Button>
            ) : (
              <Button onClick={onPreview}>Create Job</Button>
            )}
          </div>
        </div>

          <aside className="connecteamLivePreview">
            <div className="livePreviewHeader">
              <div>
                <span>Live preview</span>
                <h3>Connecteam changes</h3>
              </div>
              <span className="livePreviewStep">Step {step}</span>
            </div>

            <section className="previewSection">
              <div className="previewSectionTitle">
                <strong>Job</strong>
                <span className="previewActionBadge create">Create</span>
              </div>
              <div className="previewPrimary">
                {door.title.trim() || "Job name not entered"}
              </div>
              {door.code && <small>Code: {door.code}</small>}
              {door.gps.address && <small>{door.gps.address}</small>}
              {(door.gps.latitude || door.gps.longitude) && (
                <small>
                  Coordinates: {door.gps.latitude || "—"},{" "}
                  {door.gps.longitude || "—"}
                </small>
              )}
              <div className="previewPills">
                {selectedInstances.map((instance) => (
                  <span key={`${instance.type}-${instance.id}`}>
                    {instance.type}: {instance.name}
                  </span>
                ))}
                {!selectedInstances.length && (
                  <span className="previewEmptyPill">
                    No Schedule / Time Clock selected
                  </span>
                )}
              </div>
            </section>

            <section className="previewSection">
              <div className="previewSectionTitle">
                <strong>Sub-jobs</strong>
                <span>{door.subJobs.length}</span>
              </div>
              {door.subJobs.length ? (
                <div className="previewList">
                  {door.subJobs.map((sub) => (
                    <div key={sub.brandOptionId}>
                      <span>{sub.title}</span>
                      <span className="previewActionBadge create">Create</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="previewEmpty">Select Sub-jobs in Step 2.</div>
              )}
            </section>

            <section className="previewSection">
              <div className="previewSectionTitle">
                <strong>Smart Groups</strong>
                <span>{plannedGroups.length}</span>
              </div>
              {plannedGroups.length ? (
                <div className="previewList previewGroupList">
                  {plannedGroups.map((group) => (
                    <div key={group.key}>
                      <span title={group.name}>{group.name}</span>
                      <span
                        className={`previewActionBadge ${group.status.toLowerCase()}`}
                      >
                        {group.status}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="previewEmpty">
                  Enter a Job name to preview Smart Groups.
                </div>
              )}
              {selectedSegment && (
                <small>Segment: {selectedSegment.name}</small>
              )}
            </section>

            <section className="previewSection">
              <div className="previewSectionTitle">
                <strong>User Details</strong>
              </div>
              <div className="previewChangeRow">
                <span>{doorField?.name || "Job eligibility"}</span>
                <strong>
                  {door.title.trim()
                    ? `${existingDoorOption ? "Reuse" : "Add"} “${door.title.trim()}”`
                    : "Waiting for Job name"}
                </strong>
              </div>
              <div className="previewChangeRow">
                <span>Employees updated</span>
                <strong>{door.selectedUserIds.length}</strong>
              </div>
              <div className="previewChangeRow">
                <span>Sub-job qualifications</span>
                <strong>{totalSubJobAssignments}</strong>
              </div>
            </section>

            <section className="previewSection">
              <div className="previewSectionTitle">
                <strong>Qualification assignments</strong>
              </div>
              {plannedGroups.length ? (
                <>
                  <div className="previewQualification">
                    <small>Parent Job</small>
                    <strong>
                      {plannedGroups.map((group) => group.name).join(" + ")}
                    </strong>
                  </div>
                  {door.subJobs.map((sub) => {
                    const group = plannedGroups.find(
                      (candidate) => candidate.subJob === sub.title,
                    );
                    return (
                      <div className="previewQualification" key={sub.brandOptionId}>
                        <small>{sub.title}</small>
                        <strong>{group?.name || "Pending"}</strong>
                      </div>
                    );
                  })}
                </>
              ) : (
                <div className="previewEmpty">
                  Qualification assignments appear as you build the Job.
                </div>
              )}
            </section>

            {door.selectedUserIds.length > 0 && (
              <section className="previewSection">
                <div className="previewSectionTitle">
                  <strong>Selected employees</strong>
                  <span>{door.selectedUserIds.length}</span>
                </div>
                <div className="previewEmployeeNames">
                  {selectedEmployees.slice(0, 6).map((user) => (
                    <span key={user.userId}>
                      {user.firstName} {user.lastName}
                    </span>
                  ))}
                  {selectedEmployees.length > 6 && (
                    <span>+{selectedEmployees.length - 6} more</span>
                  )}
                </div>
              </section>
            )}
          </aside>
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
          This Job is no longer in the account scan.
        </Notice>
        <Button onClick={onBack}>Back to Jobs</Button>
      </>
    );
  return (
    <>
      <div className="headingRow">
        <div>
          <p className="eyebrow">Manage Job</p>
          <h2>{parent.title}</h2>
          <p>{parent.gps?.address || parent.code}</p>
        </div>
        <Button kind="ghost" onClick={onBack}>
          Back to Jobs
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
            {adding ? "Close Sub-job form" : "+ Add Sub-job"}
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
                With custom groups, the new Sub-job copies the Job’s description
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
          a Job created without them. Create a new Job with its Sub-jobs.
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
            placeholder="Search Sub-jobs or Jobs…"
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
                <th>Job</th>
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
function SmartGroupBindingDiagnostic({ snapshot, parents, subJobs }) {
  const [goodGroupName, setGoodGroupName] = useState("Test");
  const [generatedGroupName, setGeneratedGroupName] = useState(
    "Door: Door 1 · Brand: Brand 1",
  );
  const [jobName, setJobName] = useState("Door 1");

  const groups = snapshot.smartGroups || [];
  const segments = snapshot.smartGroupSegments || [];
  const allJobs = [...parents, ...subJobs];
  const findGroup = (name) =>
    groups.find(
      (group) =>
        String(group.name || "").toLowerCase() ===
        String(name || "").trim().toLowerCase(),
    );
  const good = findGroup(goodGroupName);
  const generated = findGroup(generatedGroupName);
  const targetJobs = allJobs.filter(
    (job) =>
      String(job.title || "").toLowerCase() ===
        String(jobName || "").trim().toLowerCase() ||
      String(job.parentTitle || "").toLowerCase() ===
        String(jobName || "").trim().toLowerCase(),
  );
  const refsFor = (group) => {
    if (!group) return [];
    return allJobs.filter((job) =>
      (job.assign?.groupIds || []).some(
        (id) => Number(id) === Number(group.id),
      ),
    );
  };
  const segmentName = (group) =>
    segments.find(
      (segment) =>
        Number(segment.id) === Number(group?.groupSegmentId ?? group?.segmentId),
    )?.name || "Unknown / not returned";
  const groupRows = [
    ["Group ID", good?.id, generated?.id],
    [
      "Segment ID",
      good?.groupSegmentId ?? good?.segmentId,
      generated?.groupSegmentId ?? generated?.segmentId,
    ],
    ["Segment", segmentName(good), segmentName(generated)],
    [
      "Automatically created",
      String(Boolean(good?.isAutomaticallyCreated)),
      String(Boolean(generated?.isAutomaticallyCreated)),
    ],
    ["Users in group", good?.numberOfUsers, generated?.numberOfUsers],
    [
      "Admin user IDs",
      Array.isArray(good?.adminUserIds)
        ? good.adminUserIds.join(", ") || "[]"
        : "Not returned",
      Array.isArray(generated?.adminUserIds)
        ? generated.adminUserIds.join(", ") || "[]"
        : "Not returned",
    ],
  ];

  return (
    <div className="panel diagnosticPanel">
      <div className="panelToolbar">
        <div>
          <strong>Smart Group binding diagnostic</strong>
          <small>
            Compare a known-good Connecteam group with a Headkount-created group
            and see exactly where each group ID is assigned.
          </small>
        </div>
      </div>
      <div className="formGrid three">
        <Field label="Known-good Smart Group">
          <input
            value={goodGroupName}
            onChange={(e) => setGoodGroupName(e.target.value)}
          />
        </Field>
        <Field label="Headkount Smart Group">
          <input
            value={generatedGroupName}
            onChange={(e) => setGeneratedGroupName(e.target.value)}
          />
        </Field>
        <Field label="Door / job">
          <input value={jobName} onChange={(e) => setJobName(e.target.value)} />
        </Field>
      </div>

      {(!good || !generated) && (
        <Notice tone="warning">
          {!good && <>Could not find Smart Group “{goodGroupName}”. </>}
          {!generated && <>Could not find Smart Group “{generatedGroupName}”.</>}
        </Notice>
      )}

      {good && generated && (
        <>
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>Property</th>
                  <th>{good.name}</th>
                  <th>{generated.name}</th>
                </tr>
              </thead>
              <tbody>
                {groupRows.map(([label, left, right]) => (
                  <tr key={label}>
                    <td><strong>{label}</strong></td>
                    <td>{left ?? "Not returned"}</td>
                    <td className={String(left ?? "") !== String(right ?? "") ? "diagnosticDiff" : ""}>
                      {right ?? "Not returned"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="diagnosticOwnerCheck">
            <strong>Current account identity</strong>
            <code>
              {JSON.stringify(
                {
                  id:
                    snapshot.me?.userId ??
                    snapshot.me?.id ??
                    snapshot.me?.ownerId ??
                    null,
                  role:
                    snapshot.me?.role ??
                    snapshot.me?.userType ??
                    snapshot.me?.type ??
                    null,
                },
                null,
                2,
              )}
            </code>
            <small>
              If Admin user IDs are returned above, the owner/current-user ID
              should normally be present on groups that are visible in job
              qualification pickers.
            </small>
          </div>

          <div className="diagnosticRefs">
            <div>
              <strong>{good.name} is referenced by</strong>
              {refsFor(good).length ? (
                refsFor(good).map((job) => (
                  <code key={job.jobId}>
                    {job.parentTitle ? `${job.parentTitle} → ` : ""}
                    {job.title} · {job.jobId}
                  </code>
                ))
              ) : (
                <span>No loaded job/sub-job references this group ID.</span>
              )}
            </div>
            <div>
              <strong>{generated.name} is referenced by</strong>
              {refsFor(generated).length ? (
                refsFor(generated).map((job) => (
                  <code key={job.jobId}>
                    {job.parentTitle ? `${job.parentTitle} → ` : ""}
                    {job.title} · {job.jobId}
                  </code>
                ))
              ) : (
                <span>No loaded job/sub-job references this group ID.</span>
              )}
            </div>
          </div>

          <div className="diagnosticJobs">
            <strong>Loaded records matching “{jobName}”</strong>
            {targetJobs.length ? (
              targetJobs.map((job) => (
                <pre key={job.jobId}>
                  {JSON.stringify(
                    {
                      title: job.title,
                      jobId: job.jobId,
                      parentId: job.parentId || null,
                      parentTitle: job.parentTitle || null,
                      useParentData: job.useParentData,
                      assign: job.assign || null,
                      instanceIds: job.instanceIds || [],
                    },
                    null,
                    2,
                  )}
                </pre>
              ))
            ) : (
              <span>No matching job/sub-job loaded.</span>
            )}
          </div>
        </>
      )}
    </div>
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
          <h2>Employee Job eligibility</h2>
          <p>
            Update a Job eligibility User Detail on employee profiles. This is separate
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
          <Field label="Job eligibility value">
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
            placeholder="New Job eligibility value"
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
            This field allows one value. Applying a new Job eligibility value will replace the
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
            {["createDoor", "createQualifiedDoor"].includes(plan.action)
              ? "Job setup"
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
      {plan.action === "createQualifiedDoor" && (
        <>
          <h3>{plan.doorName}</h3>
          <p>
            <strong>Door eligibility field:</strong> {plan.doorField.name}
            <br />
            <strong>Brand eligibility field:</strong> {plan.brandField.name}
            <br />
            <strong>Door option:</strong>{" "}
            {plan.needsDoorOption
              ? `Create “${plan.doorName}”`
              : `Reuse “${plan.doorName}”`}
          </p>
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>Job / sub-job</th>
                  <th>Qualification</th>
                  <th>Smart group</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <strong>{plan.doorName}</strong>
                  </td>
                  <td>Door only</td>
                  <td>
                    {plan.groupSpecs.find((spec) => spec.key === "door")?.name}
                    <small>
                      {plan.groupSpecs.find((spec) => spec.key === "door")?.existing
                        ? "Reuse existing Headkount group"
                        : "Create dynamic smart group"}
                    </small>
                  </td>
                </tr>
                {plan.brandOptions.map(({ title, option }) => {
                  const spec = plan.groupSpecs.find(
                    (candidate) => candidate.key === `brand:${title}`,
                  );
                  return (
                    <tr key={title}>
                      <td>
                        {plan.doorName} → <strong>{title}</strong>
                      </td>
                      <td>
                        {plan.doorName} AND {option.value}
                      </td>
                      <td>
                        {spec?.name}
                        <small>
                          {spec?.existing
                            ? "Reuse existing Headkount group"
                            : "Create dynamic smart group"}
                        </small>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="creationReview previewEmployeeReview">
            <strong>Employee assignment</strong>
            <span>
              {plan.employeeRecords?.length || 0} employee(s) will receive
              “{plan.doorName}” in {plan.doorField.name}
            </span>
            <span>
              {(plan.employeeRecords || []).reduce(
                (total, record) =>
                  total + (record.matchingBrandOptionIds?.length || 0),
                0,
              )}{" "}
              employee-to-brand qualification(s) will become active
            </span>
            {(plan.employeeRecords || []).some(
              (record) => !record.matchingBrandOptionIds?.length,
            ) && (
              <span className="warningText">
                {
                  plan.employeeRecords.filter(
                    (record) => !record.matchingBrandOptionIds?.length,
                  ).length
                }{" "}
                selected employee(s) currently match none of this Door’s brands
              </span>
            )}
          </div>
          <Notice>
            Headkount will add the Door value to these employees. Users then
            move into or out of the generated Smart Groups automatically as
            their Door and Brand user-detail values change.
          </Notice>
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
            plan.action === "createQualifiedDoor"
              ? {
                  doorOption: plan.needsDoorOption
                    ? { fieldId: plan.doorField.id, value: plan.doorName }
                    : { reuseOptionId: plan.doorOption?.id },
                  smartGroups: plan.groupSpecs.map((spec) => ({
                    name: spec.name,
                    reuseGroupId: spec.existing?.id || null,
                    brandOptionId: spec.brandOptionId,
                  })),
                  instances: plan.requestedInstances,
                }
              : plan.body || plan.records.map((r) => r.after),
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
          {["createDoor", "createQualifiedDoor"].includes(plan.action)
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

  if (report.complete) {
    return (
      <div className="resultBanner success">
        <span className="resultIcon">✓</span>
        <div>
          <strong>Changes saved successfully</strong>
          <small>Connecteam has been updated and verified.</small>
        </div>
        <details>
          <summary>Details</summary>
          <ul>
            {report.results.map((result, index) => (
              <li key={index}>{result.label || result.jobId || "Updated"}</li>
            ))}
          </ul>
          <button type="button" onClick={download}>
            Download results
          </button>
        </details>
      </div>
    );
  }

  return (
    <Notice tone="warning">
      <strong>Some changes need attention.</strong>
      <details open>
        <summary>View details</summary>
        <ul>
          {report.results.map((result, index) => (
            <li key={index}>
              {result.label || result.jobId || "Operation"}
              {result.error && <pre>{result.error}</pre>}
            </li>
          ))}
        </ul>
        <Button kind="ghost" onClick={download}>
          Download results
        </Button>
      </details>
    </Notice>
  );
}
