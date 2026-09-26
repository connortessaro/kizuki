/**
 * True if a request's Host header names this computer (127.0.0.1, localhost, or ::1).
 * Kizuki has no login because it only listens on this computer; checking the host name
 * stops a website that points its own domain at this computer from reaching it.
 */
export function isLocalHost(host: string | null): boolean {
  if (!host) return false;
  const name = host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.split(":")[0]!;
  return name === "127.0.0.1" || name === "localhost" || name === "[::1]";
}
