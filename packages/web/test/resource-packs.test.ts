import { describe, expect, test } from "bun:test";
import { createManifestSource, resolveFailedExternalTexture, resolveTexture, resourcePackCache, resourcePacks } from "../src/resource-packs.ts";

describe("resource pack texture resolution", () => {
  test("resolves external textures only through accepted manifests", () => {
    const packs = resourcePacks.map((pack) => pack.id === "external-furfsky-adapter" ? { ...pack, enabled: true } : pack);
    const external = packs.find((pack) => pack.id === "external-furfsky-adapter");
    if (!external) throw new Error("missing external adapter fixture");

    const source = createManifestSource(external, "https://packs.example/furfsky", {
      name: "Test manifest",
      license: "Test license",
      homepage: "https://packs.example/furfsky",
      fetchedAt: "2026-07-01T00:00:00.000Z",
      stale: false,
      providerMethod: "user-manifest",
      textures: {
        HYPERION: "https://packs.example/furfsky/items/HYPERION.png",
      },
    }, true);
    const resolved = resolveTexture("HYPERION", packs, [source]);

    expect(resolved.packId).toBe("external-furfsky-adapter");
    expect(resolved.textureUrl).toBe("https://packs.example/furfsky/items/HYPERION.png");
    expect(resolved.fallback).toBe(false);
    expect(resourcePackCache().entries.at(-1)).toMatchObject({
      itemId: "HYPERION",
      cacheStatus: "hit",
      sourceFreshness: "fresh",
      providerMethod: "user-manifest",
    });
  });

  test("falls back when an external manifest does not contain the requested item", () => {
    const packs = resourcePacks.map((pack) => pack.id === "external-furfsky-adapter" ? { ...pack, enabled: true } : pack);
    const external = packs.find((pack) => pack.id === "external-furfsky-adapter");
    if (!external) throw new Error("missing external adapter fixture");

    const source = createManifestSource(external, "https://packs.example/furfsky", {
      name: "Test manifest",
      license: "Test license",
      homepage: "https://packs.example/furfsky",
      fetchedAt: "2026-07-01T00:00:00.000Z",
      stale: false,
      providerMethod: "user-manifest",
      textures: {},
    }, true);

    const resolved = resolveTexture("HYPERION", packs, [source]);

    expect(resolved.packId).toBe("skyagent-generated");
    expect(resolved.texture).toBe("blade");
    expect(resolved.fallbackReason).toBe("external manifest has no texture for item");
  });

  test("falls back when an external manifest license has not been accepted", () => {
    const packs = resourcePacks.map((pack) => pack.id === "external-furfsky-adapter" ? { ...pack, enabled: true } : pack);
    const external = packs.find((pack) => pack.id === "external-furfsky-adapter");
    if (!external) throw new Error("missing external adapter fixture");

    const source = createManifestSource(external, "https://packs.example/furfsky", {
      name: "Test manifest",
      license: "Test license",
      homepage: "https://packs.example/furfsky",
      fetchedAt: "2026-07-01T00:00:00.000Z",
      stale: false,
      providerMethod: "user-manifest",
      textures: {
        HYPERION: "https://packs.example/furfsky/items/HYPERION.png",
      },
    }, false);

    const resolved = resolveTexture("HYPERION", packs, [source]);

    expect(resolved.packId).toBe("skyagent-generated");
    expect(resolved.fallbackReason).toBe("external source missing accepted manifest");
  });

  test("records cache metadata when a browser image load fails", () => {
    const packs = resourcePacks.map((pack) => pack.id === "external-furfsky-adapter" ? { ...pack, enabled: true } : pack);
    const external = packs.find((pack) => pack.id === "external-furfsky-adapter");
    if (!external) throw new Error("missing external adapter fixture");

    const source = createManifestSource(external, "https://packs.example/furfsky", {
      name: "Test manifest",
      license: "Test license",
      homepage: "https://packs.example/furfsky",
      fetchedAt: "2026-07-01T00:00:00.000Z",
      stale: false,
      providerMethod: "user-manifest",
      textures: {
        HYPERION: "https://packs.example/furfsky/items/HYPERION.png",
      },
    }, true);

    const failed = resolveTexture("HYPERION", packs, [source]);
    const fallback = resolveFailedExternalTexture("HYPERION", failed);

    expect(fallback.packId).toBe("skyagent-generated");
    expect(fallback.fallbackReason).toBe("browser failed to load external texture");
    expect(resourcePackCache().entries.at(-2)).toMatchObject({
      packId: "external-furfsky-adapter",
      cacheStatus: "fallback",
      fallbackReason: "browser failed to load external texture",
    });
  });
});
