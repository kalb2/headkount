import { NextResponse } from "next/server";
import { errorData } from "../../../lib/connecteam.js";
import { previewOperation, applyOperation } from "../../../lib/operations.js";
export const maxDuration = 300;
export async function POST(req) {
  try {
    const { apiKey, phase, action, payload, plan } = await req.json();
    if (phase === "preview")
      return NextResponse.json({
        plan: await previewOperation(apiKey, action, payload),
      });
    if (phase === "apply")
      return NextResponse.json(await applyOperation(apiKey, plan));
    return NextResponse.json(
      { error: "Generate and confirm a preview first." },
      { status: 400 },
    );
  } catch (error) {
    return NextResponse.json(errorData(error), { status: error.status || 500 });
  }
}
