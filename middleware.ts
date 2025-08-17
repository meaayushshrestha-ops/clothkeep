// middleware.ts (runs at the edge, before any route)
import { NextRequest, NextResponse } from "next/server";

const USER = process.env.BASIC_USER || "";
const PASS = process.env.BASIC_PASS || "";

// Optional: comma-separated IPs you want to allow without a password
// e.g. "203.0.113.10,198.51.100.4"
const IP_ALLOWLIST = (process.env.IP_ALLOWLIST || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

function unauthorized(): NextResponse {
  return new NextResponse("Authentication required.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="JOHNY GEAR STORE", charset="UTF-8"' },
  });
}

export function middleware(req: NextRequest) {
  // Allowlist check (optional)
  if (IP_ALLOWLIST.length) {
    const ip =
      req.ip ||
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      "";
    if (!IP_ALLOWLIST.includes(ip)) {
      // not in allowlist → keep going to Basic Auth check
    }
  }

  // Skip static assets and Next internals (handled by config.matcher below)
  const auth = req.headers.get("authorization") || "";
  const [scheme, encoded] = auth.split(" ");
  if (scheme === "Basic" && encoded) {
    try {
      // atob is available in the Edge runtime
      const [u, p] = atob(encoded).split(":");
      if (u === USER && p === PASS) {
        return NextResponse.next();
      }
    } catch {
      /* fall through to 401 */
    }
  }

  return unauthorized();
}

// Protect everything except _next/static, _next/image, and favicon
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

