// Quick unit tests for parseFlags boolean-flag fix
import { describe, it, expect } from "bun:test";

const BOOLEAN_FLAGS = new Set(["force"]);

function parseFlags(args: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (!args[i].startsWith("--")) continue;
    const key = args[i].slice(2);
    if (BOOLEAN_FLAGS.has(key)) {
      flags[key] = "true";
    } else if (i + 1 < args.length && !args[i + 1].startsWith("--")) {
      flags[key] = args[i + 1];
      i++;
    }
  }
  return flags;
}

describe("parseFlags", () => {
  it("parses trailing --force with no following arg", () => {
    const f = parseFlags(["--to", "a@b.com", "--subject", "hi", "--force"]);
    expect(f.force).toBe("true");
    expect(f.to).toBe("a@b.com");
    expect(f.subject).toBe("hi");
  });

  it("parses --force before another flag without eating it", () => {
    const f = parseFlags(["--force", "--to", "a@b.com"]);
    expect(f.force).toBe("true");
    expect(f.to).toBe("a@b.com");
  });

  it("parses value flags normally", () => {
    const f = parseFlags(["--to", "x@y.com", "--subject", "test", "--body", "hello"]);
    expect(f.to).toBe("x@y.com");
    expect(f.subject).toBe("test");
    expect(f.body).toBe("hello");
  });

  it("does not set missing boolean flag", () => {
    const f = parseFlags(["--to", "x@y.com"]);
    expect(f.force).toBeUndefined();
  });
});
