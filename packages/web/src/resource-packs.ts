export type ResourcePack = {
  id: string;
  name: string;
  author: string;
  license: string;
  homepage: string;
  enabled: boolean;
  priority: number;
  coverage: Array<"items" | "armor" | "pets" | "accessories">;
};

export type TextureResolution = {
  itemId: string;
  packId: string;
  texture: string;
  textureUrl: string | null;
  fallback: boolean;
  fallbackReason: string | null;
  attribution: string;
  license: string;
};

export type PackManifest = {
  name: string;
  license: string;
  homepage: string;
  fetchedAt: string;
  stale: boolean;
  providerMethod: "bundled-manifest" | "user-manifest" | "generated";
  textures: Record<string, string>;
};

export type PackSource = {
  packId: string;
  url: string;
  enabled: boolean;
  addedAt: string;
  licenseAccepted: boolean;
  manifest: PackManifest | null;
};

export type PackCacheEntry = {
  packId: string;
  itemId: string;
  sourceUrl: string;
  textureUrl: string | null;
  resolvedAt: string;
  cacheStatus: "hit" | "miss" | "fallback" | "stale";
  sourceFreshness: "fresh" | "stale" | "missing-manifest" | "missing-texture" | "generated";
  providerMethod: PackManifest["providerMethod"];
  license: string;
  fallbackReason: string | null;
};

export const resourcePacks: ResourcePack[] = [
  {
    id: "skyagent-generated",
    name: "SkyAgent Generated Pixels",
    author: "SkyAgent",
    license: "MIT generated CSS shapes, no copied game textures",
    homepage: "https://github.com/marius-patrik/skyagent",
    enabled: true,
    priority: 10,
    coverage: ["items", "armor", "pets", "accessories"],
  },
  {
    id: "external-furfsky-adapter",
    name: "FurfSky Reborn adapter",
    author: "FurfSky Reborn contributors",
    license: "User-provided pack required; assets are not bundled",
    homepage: "https://furfsky.net/",
    enabled: false,
    priority: 30,
    coverage: ["items", "armor", "accessories"],
  },
  {
    id: "external-hypixel-plus-adapter",
    name: "Hypixel Plus adapter",
    author: "Hypixel Plus contributors",
    license: "User-provided pack required; assets are not bundled",
    homepage: "https://hypixel.net/threads/4174260/",
    enabled: false,
    priority: 20,
    coverage: ["items", "armor"],
  },
];

const generatedTextures: Record<string, string> = {
  HYPERION: "blade",
  TERMINATOR: "bow",
  WITHER_GOGGLES: "helm",
  STORM_CHESTPLATE: "chest",
  IMPLOSION_BELT: "belt",
  WITHER_RELIC: "relic",
  ENCHANTED_DIAMOND_BLOCK: "gem",
  GOLDEN_DRAGON: "pet",
};

export const defaultPackSources: PackSource[] = [
  {
    packId: "skyagent-generated",
    url: "generated://skyagent/css-pixels",
    enabled: true,
    addedAt: "2026-07-01T00:00:00.000Z",
    licenseAccepted: true,
    manifest: {
      name: "SkyAgent Generated Pixels",
      license: "MIT generated CSS shapes, no copied game textures",
      homepage: "https://github.com/marius-patrik/skyagent",
      fetchedAt: "2026-07-01T00:00:00.000Z",
      stale: false,
      providerMethod: "generated",
      textures: Object.fromEntries(Object.entries(generatedTextures).map(([itemId, texture]) => [itemId, `${texture}.css`])),
    },
  },
];

const textureCache = new Map<string, PackCacheEntry>();

export function resourcePackCache() {
  return {
    entries: [...textureCache.values()],
    entryCount: textureCache.size,
    fallbackCount: [...textureCache.values()].filter((entry) => entry.cacheStatus === "fallback").length,
  };
}

export function createManifestSource(pack: ResourcePack, url: string, manifest: PackManifest, licenseAccepted: boolean): PackSource {
  return {
    packId: pack.id,
    url,
    enabled: true,
    addedAt: new Date().toISOString(),
    licenseAccepted,
    manifest,
  };
}

function cache(entry: PackCacheEntry) {
  textureCache.set(`${entry.packId}:${entry.itemId}`, entry);
}

function generatedFallback(itemId: string, reason: string | null): TextureResolution {
  const generated = resourcePacks[0];
  const fallback = !generatedTextures[itemId];
  cache({
    packId: generated.id,
    itemId,
    sourceUrl: defaultPackSources[0].url,
    textureUrl: null,
    resolvedAt: new Date().toISOString(),
    cacheStatus: fallback ? "fallback" : "hit",
    sourceFreshness: "generated",
    providerMethod: "generated",
    license: generated.license,
    fallbackReason: reason ?? (fallback ? "unknown generated texture" : null),
  });
  return {
    itemId,
    packId: generated.id,
    texture: generatedTextures[itemId] ?? "cube",
    textureUrl: null,
    fallback,
    fallbackReason: reason ?? (fallback ? "unknown generated texture" : null),
    attribution: `${generated.name} by ${generated.author}`,
    license: generated.license,
  };
}

export function resolveFailedExternalTexture(itemId: string, failed: TextureResolution): TextureResolution {
  cache({
    packId: failed.packId,
    itemId,
    sourceUrl: failed.textureUrl ?? "external://unknown",
    textureUrl: failed.textureUrl,
    resolvedAt: new Date().toISOString(),
    cacheStatus: "fallback",
    sourceFreshness: "missing-texture",
    providerMethod: "user-manifest",
    license: failed.license,
    fallbackReason: "browser failed to load external texture",
  });
  return generatedFallback(itemId, "browser failed to load external texture");
}

export function resolveTexture(itemId: string, packs: ResourcePack[] = resourcePacks, sources: PackSource[] = defaultPackSources): TextureResolution {
  const enabled = [...packs].filter((pack) => pack.enabled).sort((a, b) => b.priority - a.priority);
  const enabledSources = sources.filter((source) => source.enabled);
  const externalSource = enabledSources
    .map((source) => ({ source, pack: enabled.find((pack) => pack.id === source.packId && pack.id !== "skyagent-generated") }))
    .find((entry) => entry.pack);
  if (externalSource?.pack) {
    const manifest = externalSource.source.manifest;
    if (!externalSource.source.licenseAccepted || !manifest) {
      cache({
        packId: externalSource.pack.id,
        itemId,
        sourceUrl: externalSource.source.url,
        textureUrl: null,
        resolvedAt: new Date().toISOString(),
        cacheStatus: "miss",
        sourceFreshness: "missing-manifest",
        providerMethod: "user-manifest",
        license: externalSource.pack.license,
        fallbackReason: "external source missing accepted manifest",
      });
      return generatedFallback(itemId, "external source missing accepted manifest");
    }
    const textureUrl = manifest.textures[itemId];
    if (!textureUrl) {
      cache({
        packId: externalSource.pack.id,
        itemId,
        sourceUrl: externalSource.source.url,
        textureUrl: null,
        resolvedAt: new Date().toISOString(),
        cacheStatus: "fallback",
        sourceFreshness: "missing-texture",
        providerMethod: manifest.providerMethod,
        license: manifest.license,
        fallbackReason: "external manifest has no texture for item",
      });
      return generatedFallback(itemId, "external manifest has no texture for item");
    }
    cache({
      packId: externalSource.pack.id,
      itemId,
      sourceUrl: externalSource.source.url,
      textureUrl,
      resolvedAt: new Date().toISOString(),
      cacheStatus: manifest.stale ? "stale" : "hit",
      sourceFreshness: manifest.stale ? "stale" : "fresh",
      providerMethod: manifest.providerMethod,
      license: manifest.license,
      fallbackReason: manifest.stale ? "external manifest is stale" : null,
    });
    return {
      itemId,
      packId: externalSource.pack.id,
      texture: "external",
      textureUrl,
      fallback: false,
      fallbackReason: manifest.stale ? "external manifest is stale" : null,
      attribution: `${externalSource.pack.name} by ${externalSource.pack.author}`,
      license: manifest.license,
    };
  }

  return generatedFallback(itemId, null);
}
