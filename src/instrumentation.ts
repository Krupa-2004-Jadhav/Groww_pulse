// Next.js instrumentation hook — runs once when the server process starts
// (https://nextjs.org/docs/app/guides/instrumentation). This is what makes
// the pipeline actually run continuously, rather than only existing as
// tested-in-isolation functions: the ingest poller and evaluation tick
// start here and keep going for the life of the process.
export async function register() {
  // Also invoked for the edge runtime and, briefly, during build - only the
  // long-lived Node.js server process should start background timers.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NODE_ENV === "test") return;

  const { startBackgroundJobs } = await import("@/lib/pipeline/scheduler");
  await startBackgroundJobs();
}
