import { describe, it, expect } from "vitest";
import { GET } from "../route";

describe("GET /api/health (Phase 1, Test Gate 1)", () => {
  it("returns 200 with provider status", async () => {
    const res = await GET();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.db).toBe("connected");
    expect(body.provider).toHaveProperty("provider");
    expect(body).toHaveProperty("ingest");
    expect(body).toHaveProperty("timestamp");
  });
});
