import { describe, expect, test } from "bun:test";
import { parseFlags, pad, truncate } from "../src/utils.ts";

describe("parseFlags", () => {
  test("parses named flags with values", () => {
    const result = parseFlags(["--subject", "hello world", "--priority", "3"]);
    expect(result.flags).toEqual({ subject: "hello world", priority: "3" });
    expect(result.positional).toEqual([]);
  });

  test("parses boolean flags (no value)", () => {
    const result = parseFlags(["--verbose"]);
    expect(result.flags).toEqual({ verbose: "true" });
    expect(result.positional).toEqual([]);
  });

  test("collects positional args", () => {
    const result = parseFlags(["list", "--limit", "10"]);
    expect(result.flags).toEqual({ limit: "10" });
    expect(result.positional).toEqual(["list"]);
  });

  test("handles empty args", () => {
    const result = parseFlags([]);
    expect(result.flags).toEqual({});
    expect(result.positional).toEqual([]);
  });

  test("treats flag followed by another flag as boolean", () => {
    const result = parseFlags(["--verbose", "--name", "test"]);
    expect(result.flags).toEqual({ verbose: "true", name: "test" });
  });

  test("handles mixed positional and flags", () => {
    const result = parseFlags(["add", "--subject", "my task", "--priority", "1"]);
    expect(result.flags).toEqual({ subject: "my task", priority: "1" });
    expect(result.positional).toEqual(["add"]);
  });
});

describe("pad", () => {
  test("pads short string to width", () => {
    expect(pad("abc", 6)).toBe("abc   ");
  });

  test("adds single space when string equals width", () => {
    expect(pad("abcdef", 6)).toBe("abcdef ");
  });

  test("adds single space when string exceeds width", () => {
    expect(pad("abcdefgh", 6)).toBe("abcdefgh ");
  });
});

describe("truncate", () => {
  test("returns short string unchanged", () => {
    expect(truncate("abc", 10)).toBe("abc");
  });

  test("truncates long string with tilde", () => {
    expect(truncate("hello world", 8)).toBe("hello w~");
  });

  test("returns string unchanged when exactly at max", () => {
    expect(truncate("abcde", 5)).toBe("abcde");
  });
});
