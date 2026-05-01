import { NextRequest, NextResponse } from "next/server";

const ENGINE_URL = process.env.ENGINE_URL ?? "http://localhost:8000";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const enginePath = path.join("/");
  const search = req.nextUrl.search;
  const url = `${ENGINE_URL}/${enginePath}${search}`;

  // For SSE endpoints, use a TransformStream to pipe chunks immediately
  const isSSE = req.headers.get("accept")?.includes("text/event-stream");

  if (isSSE) {
    let upstreamResponse: Response;
    try {
      upstreamResponse = await fetch(url, {
        headers: {
          Accept: "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
        // @ts-ignore – Node fetch supports this to prevent buffering
        duplex: "half",
      });
    } catch (err) {
      return NextResponse.json({ error: "Engine unreachable" }, { status: 503 });
    }

    if (!upstreamResponse.ok || !upstreamResponse.body) {
      return NextResponse.json({ error: "Engine SSE failed" }, { status: 502 });
    }

    // Pipe the upstream body directly to the browser — no buffering
    const { readable, writable } = new TransformStream();
    upstreamResponse.body.pipeTo(writable).catch(() => {});

    return new Response(readable, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
        "Transfer-Encoding": "chunked",
      },
    });
  }

  try {
    const upstream = await fetch(url, {
      headers: { "Content-Type": "application/json" },
    });

    const contentType = upstream.headers.get("Content-Type") || "application/json";
    const headers = new Headers();
    headers.set("Content-Type", contentType);

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

export async function PUT(
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
      method: "PUT",
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

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const enginePath = path.join("/");
  const search = req.nextUrl.search;
  const url = `${ENGINE_URL}/${enginePath}${search}`;

  try {
    const upstream = await fetch(url, { method: "DELETE" });
    const contentType = upstream.headers.get("Content-Type") || "application/json";
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { "Content-Type": contentType },
    });
  } catch {
    return NextResponse.json({ error: "Engine unreachable" }, { status: 503 });
  }
}
