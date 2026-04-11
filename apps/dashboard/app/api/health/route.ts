import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ status: "ok", app: "agenthive-dashboard", version: "0.5.0" });
}
