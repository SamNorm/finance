import { describe, expect, it } from "vitest";
import { AREAS, registeredTools, toolGuide } from "./guide";

describe("the tool guide", () => {
  it("covers every tool once, and only tools the server has", () => {
    const guided = AREAS.flatMap((area) => Object.keys(area.tools));
    expect(guided.toSorted()).toEqual([...registeredTools().keys()].toSorted());
  });

  // Two lines an analyst scans, not the model's description.
  it("keeps each tool to two short lines", () => {
    const long = toolGuide()
      .flatMap((area) => area.tools)
      .filter((t) => t.does.length > 130 || t.returns.length > 160)
      .map((t) => t.name);
    expect(long).toEqual([]);
  });

  it("takes titles and effects from the tools as registered", () => {
    const tools = toolGuide().flatMap((area) => area.tools);
    expect(tools.find((t) => t.name === "get_borrower")).toMatchObject({
      title: "Get a borrower",
      effect: "reads",
    });
    expect(tools.find((t) => t.name === "create_borrower")?.effect).toBe(
      "adds",
    );
    expect(tools.find((t) => t.name === "remove_period")?.effect).toBe(
      "changes",
    );
  });
});
