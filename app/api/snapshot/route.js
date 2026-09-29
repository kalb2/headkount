import { NextResponse } from "next/server";
import {
  ctFetch,
  collectPages,
  loadSmartGroups,
  loadSmartGroupSegments,
  responseRows,
  errorData,
} from "../../../lib/connecteam.js";
export const maxDuration = 300;
export async function POST(req) {
  try {
    const { apiKey } = await req.json();
    const warnings = [];
    const failure = (label, error) => {
      const requestId = error.payload?.requestId;
      const described = {
        message: error.message,
        httpStatus: error.status || 500,
        requestId:
          typeof requestId === "string" && requestId ? requestId : null,
      };
      warnings.push(
        `${label}: ${described.message}${described.requestId ? ` Request ID: ${described.requestId}.` : ""}${error.payload ? ` — ${JSON.stringify(error.payload)}` : ""}`,
      );
      return described;
    };
    const optional = async (label, fn, fallback) => {
      try {
        return await fn();
      } catch (e) {
        failure(label, e);
        return fallback;
      }
    };
    let smartGroupsError = null;
    let smartGroupSegmentsError = null;
    const [
      jobs,
      smartGroups,
      smartGroupSegments,
      schedulers,
      timeClocks,
      users,
      userFields,
      me,
    ] = await Promise.all([
      collectPages(
        apiKey,
        "/jobs/v1/jobs?includeDeleted=false&sort=title&order=asc",
        "jobs",
      ),
      (async () => {
        try {
          return await loadSmartGroups(apiKey);
        } catch (error) {
          smartGroupsError = failure("Smart groups", error);
          return null;
        }
      })(),
      (async () => {
        try {
          return await loadSmartGroupSegments(apiKey);
        } catch (error) {
          smartGroupSegmentsError = failure("Smart group segments", error);
          return null;
        }
      })(),
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
      smartGroupsError,
      smartGroupsBlocked:
        smartGroupsError?.httpStatus === 401 ||
        smartGroupsError?.httpStatus === 403,
      smartGroupSegments: smartGroupSegments || [],
      smartGroupSegmentsLoaded: smartGroupSegments !== null,
      smartGroupSegmentsError,
      smartGroupSegmentsBlocked:
        smartGroupSegmentsError?.httpStatus === 401 ||
        smartGroupSegmentsError?.httpStatus === 403,
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
