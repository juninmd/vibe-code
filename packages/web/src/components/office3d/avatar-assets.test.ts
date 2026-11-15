import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createCharacter } from "./character";
import { createEnvironment, ENVIRONMENTS, isEnvironment } from "./environments";
import { AVATAR_SKINS, applyAvatarSkin, isAvatarSkin } from "./skins";

describe("avatar skins", () => {
  it.each(AVATAR_SKINS.map((s) => s.id))("applies %s without errors", (id) => {
    const c = createCharacter({ label: "X", accent: "#38bdf8", hair: "#000" });
    const before = c.head.children.length + c.group.children.length;
    applyAvatarSkin(c, id, "#38bdf8");
    const after = c.head.children.length + c.group.children.length;
    if (id === "dev") expect(after).toBe(before);
    else expect(after).toBeGreaterThan(before);
  });

  it("guards ids", () => {
    expect(isAvatarSkin("robot")).toBe(true);
    expect(isAvatarSkin("nope")).toBe(false);
  });
});

describe("environments", () => {
  it.each(ENVIRONMENTS.map((e) => e.id))("%s builds, animates and disposes cleanly", (id) => {
    const scene = new THREE.Scene();
    const env = createEnvironment(id, scene);
    expect(scene.children.length).toBeGreaterThan(0);
    env.room.fit(14, 10, 2);
    env.room.update(1.5);
    env.dispose();
    expect(scene.children.length).toBe(0);
  });

  it("guards ids", () => {
    expect(isEnvironment("space")).toBe(true);
    expect(isEnvironment("moon")).toBe(false);
  });
});
