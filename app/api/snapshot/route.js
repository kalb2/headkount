import { NextResponse } from "next/server";
import {
  ctFetch,
  collectPages,
  loadSmartGroups,
  responseRows,
  errorData,
} from "../../../lib/connecteam.js";
export const maxDuration = 300;
export async function POST(req) {
  try {
    const { apiKey } = await req.json();
    const warnings = [];
    const optional = async (label, fn, fallback) => {
      try {
        return await fn();
      } catch (e) {
        warnings.push(
          `${label}: ${e.message}${e.payload ? ` — ${JSON.stringify(e.payload)}` : ""}`,
        );
        return fallback;
      }
    };
    const [jobs, smartGroups, schedulers, timeClocks, users, userFields, me] =
      await Promise.all([
        collectPages(
          apiKey,
          "/jobs/v1/jobs?includeDeleted=false&sort=title&order=asc",
          "jobs",
        ),
        optional("Smart groups", () => loadSmartGroups(apiKey), null),
        optional(
          "Schedules",
          async () =>
            responseRows(
              await ctFetch(apiKey, "/scheduler/v1/schedulers"),
              "schedulers",
            ),
          [],
        ),
        optional(
          "Time clocks",
          async () =>
            responseRows(
              await ctFetch(apiKey, "/time-clock/v1/time-clocks"),
              "timeClocks",
            ),
          [],
        ),
        optional(
          "Users",
          () =>
            collectPages(apiKey, "/users/v1/users?userStatus=active", "users"),
          { rows: [] },
        ),
        optional(
          "User fields",
          () => collectPages(apiKey, "/users/v1/custom-fields", "customFields"),
          { rows: [] },
        ),
        optional("Account", () => ctFetch(apiKey, "/me"), {}),
      ]);
    return NextResponse.json({
      jobs: jobs.rows,
      smartGroups: smartGroups || [],
      smartGroupsLoaded: smartGroups !== null,
      schedulers,
      timeClocks,
      users: users.rows,
      userFields: userFields.rows,
      me: me.data || me,
      warnings,
      scannedAt: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(errorData(error), { status: error.status || 500 });
  }
}
