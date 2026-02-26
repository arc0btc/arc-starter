import { describe, expect, test } from "bun:test";
import { discoverSkills } from "../src/skills.ts";

describe("discoverSkills", () => {
  test("discovers skills from skills/ directory", () => {
    const skills = discoverSkills();
    expect(skills.length).toBeGreaterThan(0);
  });

  test("each skill has required fields", () => {
    const skills = discoverSkills();
    for (const skill of skills) {
      expect(typeof skill.name).toBe("string");
      expect(skill.name.length).toBeGreaterThan(0);
      expect(typeof skill.description).toBe("string");
      expect(typeof skill.path).toBe("string");
      expect(typeof skill.hasSensor).toBe("boolean");
      expect(typeof skill.hasCli).toBe("boolean");
      expect(typeof skill.hasAgent).toBe("boolean");
      expect(Array.isArray(skill.tags)).toBe(true);
    }
  });

  test("skills are sorted alphabetically", () => {
    const skills = discoverSkills();
    const names = skills.map((s) => s.name);
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    expect(names).toEqual(sorted);
  });

  test("ceo skill is discovered with correct metadata", () => {
    const skills = discoverSkills();
    const ceo = skills.find((s) => s.name === "ceo");
    expect(ceo).toBeDefined();
    expect(ceo!.hasSensor).toBe(false);
    expect(ceo!.hasCli).toBe(false);
    expect(ceo!.hasAgent).toBe(true);
    expect(ceo!.tags).toContain("strategy");
  });

  test("heartbeat skill has sensor but no cli", () => {
    const skills = discoverSkills();
    const heartbeat = skills.find((s) => s.name === "heartbeat");
    expect(heartbeat).toBeDefined();
    expect(heartbeat!.hasSensor).toBe(true);
    expect(heartbeat!.hasCli).toBe(false);
  });

  test("manage-skills skill has cli but no sensor", () => {
    const skills = discoverSkills();
    const ms = skills.find((s) => s.name === "manage-skills");
    expect(ms).toBeDefined();
    expect(ms!.hasCli).toBe(true);
    expect(ms!.hasSensor).toBe(false);
  });
});
