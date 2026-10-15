"use client";

import { useEffect, useMemo, useState } from "react";

const STORAGE_KEY = "headkount_ui_labels_v1";

const DEFAULTS = {
  jobSingular: "Job",
  jobPlural: "Jobs",
  subJobSingular: "Sub-job",
  subJobPlural: "Sub-jobs",
  brandSingular: "Brand",
  brandPlural: "Brands",
  employeeSingular: "Employee",
  employeePlural: "Employees",
};

function clean(value, fallback) {
  return String(value || "").trim().slice(0, 40) || fallback;
}

function normalizedLabels(value = {}) {
  return {
    jobSingular: clean(value.jobSingular, DEFAULTS.jobSingular),
    jobPlural: clean(value.jobPlural, DEFAULTS.jobPlural),
    subJobSingular: clean(value.subJobSingular, DEFAULTS.subJobSingular),
    subJobPlural: clean(value.subJobPlural, DEFAULTS.subJobPlural),
    brandSingular: clean(value.brandSingular, DEFAULTS.brandSingular),
    brandPlural: clean(value.brandPlural, DEFAULTS.brandPlural),
    employeeSingular: clean(value.employeeSingular, DEFAULTS.employeeSingular),
    employeePlural: clean(value.employeePlural, DEFAULTS.employeePlural),
  };
}

function lowerFirst(value) {
  return value ? value[0].toLowerCase() + value.slice(1) : value;
}

function replacements(labels) {
  const job = labels.jobSingular;
  const jobs = labels.jobPlural;
  const subJob = labels.subJobSingular;
  const subJobs = labels.subJobPlural;
  const brand = labels.brandSingular;
  const brands = labels.brandPlural;
  const employee = labels.employeeSingular;
  const employees = labels.employeePlural;

  return new Map([
    ["Job", job],
    ["Jobs", jobs],
    ["job", lowerFirst(job)],
    ["jobs", lowerFirst(jobs)],
    ["Sub-job", subJob],
    ["Sub-jobs", subJobs],
    ["sub-job", lowerFirst(subJob)],
    ["sub-jobs", lowerFirst(subJobs)],
    ["Brand", brand],
    ["Brands", brands],
    ["brand", lowerFirst(brand)],
    ["brands", lowerFirst(brands)],
    ["Employee", employee],
    ["Employees", employees],
    ["employee", lowerFirst(employee)],
    ["employees", lowerFirst(employees)],
    ["Create Job", `Create ${job}`],
    ["Existing Jobs", `Existing ${jobs}`],
    ["Employee eligibility", `${employee} eligibility`],
    ["Jobs & Sub-jobs workspace", `${jobs} & ${subJobs} workspace`],
    ["Create and manage Connecteam Jobs.", `Create and manage Connecteam ${jobs}.`],
    ["View or manage Jobs already in Connecteam.", `View or manage ${jobs} already in Connecteam.`],
    ["Job name", `${job} name`],
    ["Job code (optional)", `${job} code (optional)`],
    ["Job description (optional)", `${job} description (optional)`],
    ["Job address (optional)", `${job} address (optional)`],
    ["Job eligibility User Detail", `${job} eligibility User Detail`],
    ["Brand eligibility User Detail", `${brand} eligibility User Detail`],
    ["Search brands", `Search ${lowerFirst(brands)}`],
    ["Search employees", `Search ${lowerFirst(employees)}`],
    ["No matching Sub-job", `No matching ${subJob}`],
    ["No brand match", `No ${lowerFirst(brand)} match`],
    ["Selected employees", `Selected ${lowerFirst(employees)}`],
    ["Employees updated", `${employees} updated`],
    ["Manage brands", `Manage ${lowerFirst(brands)}`],
    ["Brands", brands],
    ["Employee Job eligibility", `${employee} ${job} eligibility`],
    ["Job eligibility value", `${job} eligibility value`],
    ["New Job eligibility value", `New ${job} eligibility value`],
  ]);
}

function applyLabels(labels) {
  const map = replacements(labels);
  const skip = new Set(["SCRIPT", "STYLE", "PRE", "CODE"]);

  const rewriteNode = (node) => {
    if (node.nodeType !== Node.TEXT_NODE || !node.parentElement) return;
    if (skip.has(node.parentElement.tagName)) return;
    const original = node.nodeValue || "";
    const trimmed = original.trim();
    const next = map.get(trimmed);
    if (!next || next === trimmed) return;
    node.nodeValue = original.replace(trimmed, next);
  };

  const walk = (root) => {
    if (!root) return;
    if (root.nodeType === Node.TEXT_NODE) {
      rewriteNode(root);
      return;
    }
    if (root.nodeType !== Node.ELEMENT_NODE && root !== document.body) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) rewriteNode(node);

    if (root.querySelectorAll) {
      root.querySelectorAll("input, select, textarea").forEach((element) => {
        if (element.placeholder && map.has(element.placeholder)) {
          element.placeholder = map.get(element.placeholder);
        }
        const aria = element.getAttribute("aria-label");
        if (aria && map.has(aria)) element.setAttribute("aria-label", map.get(aria));
      });
    }
  };

  walk(document.body);
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      mutation.addedNodes.forEach(walk);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  return () => observer.disconnect();
}

export default function LabelCustomizer() {
  const [open, setOpen] = useState(false);
  const [labels, setLabels] = useState(DEFAULTS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let saved = {};
    try {
      saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    } catch {}
    setLabels(normalizedLabels(saved));
    setLoaded(true);
  }, []);

  const active = useMemo(() => normalizedLabels(labels), [labels]);

  useEffect(() => {
    if (!loaded) return;
    return applyLabels(active);
  }, [active, loaded]);

  const save = () => {
    const next = normalizedLabels(labels);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    window.location.reload();
  };

  const reset = () => {
    localStorage.removeItem(STORAGE_KEY);
    window.location.reload();
  };

  if (!loaded) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Customize labels"
        style={styles.launcher}
      >
        Labels
      </button>
      {open && (
        <div style={styles.backdrop} onMouseDown={() => setOpen(false)}>
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="label-settings-title"
            style={styles.modal}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div style={styles.header}>
              <div>
                <small style={styles.eyebrow}>Client settings</small>
                <h2 id="label-settings-title" style={styles.title}>Labels</h2>
              </div>
              <button type="button" onClick={() => setOpen(false)} style={styles.close}>×</button>
            </div>
            <p style={styles.copy}>
              Change what the app calls common items. This only changes the interface; Connecteam data and Smart Group rules are unchanged.
            </p>
            <div style={styles.grid}>
              <LabelInput label="Job — singular" value={labels.jobSingular} onChange={(value) => setLabels((current) => ({ ...current, jobSingular: value }))} />
              <LabelInput label="Job — plural" value={labels.jobPlural} onChange={(value) => setLabels((current) => ({ ...current, jobPlural: value }))} />
              <LabelInput label="Sub-job — singular" value={labels.subJobSingular} onChange={(value) => setLabels((current) => ({ ...current, subJobSingular: value }))} />
              <LabelInput label="Sub-job — plural" value={labels.subJobPlural} onChange={(value) => setLabels((current) => ({ ...current, subJobPlural: value }))} />
              <LabelInput label="Brand — singular" value={labels.brandSingular} onChange={(value) => setLabels((current) => ({ ...current, brandSingular: value }))} />
              <LabelInput label="Brand — plural" value={labels.brandPlural} onChange={(value) => setLabels((current) => ({ ...current, brandPlural: value }))} />
              <LabelInput label="Employee — singular" value={labels.employeeSingular} onChange={(value) => setLabels((current) => ({ ...current, employeeSingular: value }))} />
              <LabelInput label="Employee — plural" value={labels.employeePlural} onChange={(value) => setLabels((current) => ({ ...current, employeePlural: value }))} />
            </div>
            <div style={styles.actions}>
              <button type="button" onClick={reset} style={styles.secondary}>Reset defaults</button>
              <button type="button" onClick={save} style={styles.primary}>Save labels</button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

function LabelInput({ label, value, onChange }) {
  return (
    <label style={styles.field}>
      <span style={styles.fieldLabel}>{label}</span>
      <input
        value={value}
        maxLength={40}
        onChange={(event) => onChange(event.target.value)}
        style={styles.input}
      />
    </label>
  );
}

const styles = {
  launcher: {
    position: "fixed",
    right: 20,
    bottom: 20,
    zIndex: 90,
    border: "1px solid #d7dde6",
    borderRadius: 9,
    background: "#fff",
    padding: "9px 13px",
    fontWeight: 750,
    cursor: "pointer",
    boxShadow: "0 3px 14px rgba(20,35,55,.12)",
  },
  backdrop: {
    position: "fixed",
    inset: 0,
    zIndex: 100,
    display: "grid",
    placeItems: "center",
    padding: 20,
    background: "rgba(16,24,40,.42)",
  },
  modal: {
    width: "min(720px, 100%)",
    maxHeight: "90vh",
    overflow: "auto",
    borderRadius: 14,
    background: "#fff",
    boxShadow: "0 24px 70px rgba(16,24,40,.24)",
    padding: 22,
  },
  header: { display: "flex", justifyContent: "space-between", alignItems: "start", gap: 16 },
  eyebrow: { color: "#667085", fontWeight: 800, textTransform: "uppercase", letterSpacing: ".05em" },
  title: { margin: "3px 0 0", fontSize: 26 },
  close: { border: 0, background: "transparent", fontSize: 28, lineHeight: 1, cursor: "pointer" },
  copy: { color: "#667085", lineHeight: 1.5, margin: "14px 0 18px" },
  grid: { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 },
  field: { display: "grid", gap: 6 },
  fieldLabel: { fontSize: 12, color: "#667085", fontWeight: 750 },
  input: { width: "100%", boxSizing: "border-box", border: "1px solid #d7dde6", borderRadius: 8, padding: "10px 11px", font: "inherit" },
  actions: { display: "flex", justifyContent: "flex-end", gap: 9, marginTop: 20 },
  secondary: { border: "1px solid #d7dde6", borderRadius: 8, background: "#fff", padding: "9px 12px", fontWeight: 750, cursor: "pointer" },
  primary: { border: 0, borderRadius: 8, background: "#1769e0", color: "#fff", padding: "9px 13px", fontWeight: 800, cursor: "pointer" },
};
