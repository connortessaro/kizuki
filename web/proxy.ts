import { NextResponse, type NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  try {
    decodeURIComponent(new URL(request.url).pathname);
  } catch {
    return new NextResponse("Not Found", { status: 404 });
  }
  const host = request.headers.get("host") ?? "";
  if (host === "kizuki.dev" || host === "www.kizuki.dev") {
    return NextResponse.rewrite(new URL("/landing", request.url));
  }
  return NextResponse.next();
}

export const config = { matcher: "/((?!_next/|favicon.ico).*)" };
