import { describe, expect, it } from "vitest";
import {
  cleanHelperText,
  composePrompt,
  parseBulkPrompts,
  slugify,
} from "@/lib/parse";

const SAMPLE = `Thinking
The robot tilts its head thoughtfully, pauses, then returns to its
starting pose.
---
Coffee cheers
The robot raises its existing coffee mug toward the viewer in a
friendly toast, then returns it to its starting position.
---
Hello wave
The robot gently waves its raised hand twice, then returns to the
starting pose.`;

describe("parseBulkPrompts", () => {
  it("splits on --- lines; first line is the name", () => {
    const { blocks, warnings } = parseBulkPrompts(SAMPLE);
    expect(blocks.map((b) => b.name)).toEqual([
      "Thinking",
      "Coffee cheers",
      "Hello wave",
    ]);
    expect(blocks[0].actionPrompt).toBe(
      "The robot tilts its head thoughtfully, pauses, then returns to its starting pose.",
    );
    expect(warnings).toEqual([]);
  });

  it("handles CRLF, blank blocks, and extra whitespace", () => {
    const { blocks } = parseBulkPrompts(
      "A\r\ndo a\r\n  ---  \r\n\r\n---\r\nB\r\ndo b\r\n",
    );
    expect(blocks).toEqual([
      { name: "A", actionPrompt: "do a" },
      { name: "B", actionPrompt: "do b" },
    ]);
  });

  it("does not split on --- inside a line or longer dashes", () => {
    const { blocks } = parseBulkPrompts("A\nwave --- twice\n----\nstill A");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].actionPrompt).toBe("wave --- twice ---- still A");
  });

  it("warns when a block has a name but no prompt", () => {
    const { blocks, warnings } = parseBulkPrompts("Lonely\n---\nB\nprompt");
    expect(blocks).toHaveLength(2);
    expect(warnings[0]).toContain("Lonely");
  });

  it("returns nothing for empty input", () => {
    expect(parseBulkPrompts("  \n---\n").blocks).toEqual([]);
  });
});

describe("composePrompt / slugify", () => {
  it("puts the action first and appends shared instructions", () => {
    expect(composePrompt(" shared ", " act ")).toBe("act\n\nshared");
    expect(composePrompt("", "act")).toBe("act");
  });
  it("makes readable filenames", () => {
    expect(slugify("Coffee cheers!")).toBe("coffee-cheers");
    expect(slugify("  ")).toBe("animation");
    expect(slugify("Ünïcode / path\\..")).toBe("unicode-path");
  });
});

describe("cleanHelperText", () => {
  it("strips wrapper tags and code fences from helper output", () => {
    expect(cleanHelperText("<prompt>\nTilt head.\n</prompt>")).toBe(
      "Tilt head.",
    );
    expect(cleanHelperText("```text\nTilt head.\n```")).toBe("Tilt head.");
    expect(cleanHelperText("<prompt>Tilt head.")).toBe("Tilt head.");
  });
  it("leaves plain text alone", () => {
    expect(cleanHelperText("  Tilt <b>head</b> slowly. ")).toBe(
      "Tilt <b>head</b> slowly.",
    );
  });
});
