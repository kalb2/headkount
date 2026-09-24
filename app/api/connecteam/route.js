import { NextResponse } from "next/server";
import { ctFetch, ConnecteamError } from "../../../lib/connecteam";

const ALLOWED = [
  /^\/me$/,
  /^\/users\/v1\/users(?:\?.*)?$/,
  /^\/users\/v1\/custom-fields(?:\?.*)?$/,
  /^\/users\/v1\/smart-groups(?:\?.*)?$/,
  /^\/users\/v1\/smart-group-segments(?:\?.*)?$/,
  /^\/jobs\/v1\/jobs(?:\/[^/?]+)?(?:\?.*)?$/,
  /^\/jobs\/v1\/custom-fields(?:\?.*)?$/,
  /^\/scheduler\/v1\/schedulers(?:\?.*)?$/,
  /^\/time-clock\/v1\/time-clocks(?:\?.*)?$/,
];

export async function POST(req) {
  try {
    const { apiKey, path, method = "GET" } = await req.json();
    if (method !== "GET")
      return NextResponse.json(
        {
          error:
            "Writes require a validated preview through the actions route.",
        },
        { status: 405 },
      );
    if (!ALLOWED.some((r) => r.test(path || ""))) {
      return NextResponse.json(
        { error: "This API path is not allowed by this app." },
        { status: 400 },
      );
    }
    const payload = await ctFetch(apiKey, path, {
      method,
      cache: "no-store",
    });
    return NextResponse.json(payload ?? { ok: true });
  } catch (err) {
    const status = err instanceof ConnecteamError ? err.status : 500;
    return NextResponse.json(
      { error: err.message, details: err.payload || null },
      { status },
    );
  }
}
