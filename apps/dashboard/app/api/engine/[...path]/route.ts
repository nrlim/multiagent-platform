import { NextRequest, NextResponse } from "next/server";

const ENGINE_URL = process.env.ENGINE_URL ?? "http://localhost:8000";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const enginePath = path.join("/");
  const search = req.nextUrl.search;
  const url = `${ENGINE_URL}/${enginePath}${search}`;

  // For SSE endpoints, stream directly
  const isSSE = req.headers.get("accept")?.includes("text/event-stream");

  if (isSSE) {
    const upstream = await fetch(url, {
      headers: { Accept: "text/event-stream", "Cache-Control": "no-cache" },
    });

    return new Response(upstream.body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  }

  try {
    const upstream = await fetch(url, {
      headers: { "Content-Type": "application/json" },
    });
    
    // Support non-JSON responses (e.g. file contents or downloads)
    const contentType = upstream.headers.get("Content-Type") || "application/json";
    const headers = new Headers();
    headers.set("Content-Type", contentType);

    // If it's returning a file download header, pass it along
    const contentDisposition = upstream.headers.get("Content-Disposition");
    if (contentDisposition) {
      headers.set("Content-Disposition", contentDisposition);
    }

    return new Response(upstream.body, {
      status: upstream.status,
      headers,
    });
  } catch {
    return NextResponse.json({ error: "Engine unreachable" }, { status: 503 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const enginePath = path.join("/");
  const search = req.nextUrl.search;
  const url = `${ENGINE_URL}/${enginePath}${search}`;
  const body = await req.text();

  try {
    const upstream = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    
    const contentType = upstream.headers.get("Content-Type") || "application/json";
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { "Content-Type": contentType },
    });
  } catch {
    return NextResponse.json({ error: "Engine unreachable" }, { status: 503 });
  }
}
