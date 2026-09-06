import { describe, it, expect } from "vitest";
import { groupIntoStories } from "../group-into-stories";
import { ChangeEvent } from "@/lib/watermark/changes";

function event(overrides: Partial<ChangeEvent>): ChangeEvent {
  return {
    seq: 1,
    symbol: "AAPL",
    eventType: "price_move",
    tier: "medium",
    score: 50,
    reason: "AAPL moved.",
    occurredAt: new Date(),
    ...overrides,
  };
}

describe("groupIntoStories", () => {
  it("groups multiple events for the same symbol into one story with a combined score", () => {
    const events = [
      event({ seq: 1, eventType: "price_move", score: 80, reason: "AAPL moved sharply." }),
      event({ seq: 2, eventType: "volume_surge", score: 70, reason: "AAPL volume unusual." }),
    ];
    const stories = groupIntoStories(events);
    expect(stories).toHaveLength(1);
    expect(stories[0].symbol).toBe("AAPL");
    expect(stories[0].events).toHaveLength(2);
    expect(stories[0].reason).toContain("AAPL moved sharply.");
  });

  it("keeps different symbols as separate stories, ranked by combined score descending", () => {
    const events = [
      event({ seq: 1, symbol: "LOW", eventType: "price_move", score: 20 }),
      event({ seq: 2, symbol: "HIGH", eventType: "price_move", score: 90 }),
    ];
    const stories = groupIntoStories(events);
    expect(stories.map((s) => s.symbol)).toEqual(["HIGH", "LOW"]);
  });

  it("an empty event list produces an empty story list", () => {
    expect(groupIntoStories([])).toEqual([]);
  });
});
