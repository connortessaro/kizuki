import { NextResponse, type NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  try {
    decodeURIComponent(new URL(request.url).pathname);
  } catch {
    return new NextResponse("Not Found", { status: 404 });
  }
  const host = request.headers.get("host") ?? "";
  if (host === "kizuki.dev" || host === "www.kizuki.dev") {
    const { pathname } = new URL(request.url);
    if (/\.[a-z0-9]+$/i.test(pathname)) return NextResponse.next();
    return NextResponse.rewrite(new URL("/landing", request.url));
  }
  return NextResponse.next();
}

export const config = { matcher: "/((?!_next/|favicon.ico).*)" };
