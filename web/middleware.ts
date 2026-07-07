import { NextResponse } from "next/server";

export function middleware(request: Request) {
  try {
    decodeURIComponent(new URL(request.url).pathname);
  } catch {
    return new NextResponse("Not Found", { status: 404 });
  }
  return NextResponse.next();
}
