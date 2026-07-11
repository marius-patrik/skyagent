import { useEffect, useMemo, useState } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import * as Switch from "@radix-ui/react-switch";
import dagre from "dagre";
import { motion } from "motion/react";
import {
  AlertTriangle,
  Box,
  Boxes,
  CircleDollarSign,
  Gem,
  GitBranch,
  Hammer,
  Layers3,
  PackageCheck,
  Pickaxe,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Swords,
  Settings,
} from "lucide-react";
import { accessories, equipment, inventorySections, networthBreakdown, plannerSteps, profile as mockProfile, progression, providerStatus } from "./mock-data.ts";
import { createManifestSource, defaultPackSources, resolveFailedExternalTexture, resolveTexture, resourcePackCache, resourcePacks, type PackManifest, type PackSource, type ResourcePack, type TextureResolution } from "./resource-packs.ts";
import { Button } from "./components/ui/button.tsx";
import { cn } from "./lib/utils.ts";

type ViewId = "overview" | "inventory" | "networth" | "accessories" | "progression" | "planner" | "packs" | "settings";

const views: Array<{ id: ViewId; label: string; icon: typeof Boxes }> = [
  { id: "overview", label: "Overview", icon: Sparkles },
  { id: "inventory", label: "Inventory", icon: Boxes },
  { id: "networth", label: "Networth", icon: CircleDollarSign },
  { id: "accessories", label: "Accessories", icon: Gem },
  { id: "progression", label: "Progression", icon: Layers3 },
  { id: "planner", label: "Planner", icon: GitBranch },
  { id: "packs", label: "Resource Packs", icon: PackageCheck },
  { id: "settings", label: "Settings", icon: Settings },
];

type ProfileSettings = {
  player: string;
  profile: string;
};

type PackState = {
  packs: ResourcePack[];
  sources: PackSource[];
};

function exampleManifest(url: string): PackManifest {
  const baseUrl = url.replace(/[\\/]$/, "");
  return {
    name: "User provided SkyBlock pack manifest",
    license: "User-confirmed license for local private use",
    homepage: baseUrl,
    fetchedAt: new Date().toISOString(),
    stale: false,
    providerMethod: "user-manifest",
    textures: {
      HYPERION: `${baseUrl}/items/HYPERION.png`,
      TERMINATOR: `${baseUrl}/items/TERMINATOR.png`,
      WITHER_GOGGLES: `${baseUrl}/items/WITHER_GOGGLES.png`,
      STORM_CHESTPLATE: `${baseUrl}/items/STORM_CHESTPLATE.png`,
      IMPLOSION_BELT: `${baseUrl}/items/IMPLOSION_BELT.png`,
      WITHER_RELIC: `${baseUrl}/items/WITHER_RELIC.png`,
    },
  };
}

function storageValue(key: string, fallback: string) {
  return typeof window === "undefined" ? fallback : window.localStorage.getItem(key) ?? fallback;
}

async function appRequest(route: string) {
  const response = await fetch(route);
  if (!response.ok) throw new Error(`${route} failed: HTTP ${response.status}`);
  return response.json();
}

function coins(value: string) {
  return value.replace("B", "b").replace("M", "m");
}

function ItemIcon({ itemId, rarity, packState }: { itemId: string; rarity: string; packState: PackState }) {
  const [runtimeFallback, setRuntimeFallback] = useState<TextureResolution | null>(null);
  useEffect(() => setRuntimeFallback(null), [itemId, packState]);
  const texture = runtimeFallback ?? resolveTexture(itemId, packState.packs, packState.sources);
  return (
    <span
      className={cn("item-icon", `rarity-${rarity}`, `texture-${texture.texture}`)}
      title={`${itemId} via ${texture.attribution}`}
    >
      <span className="texture-shape">
        {texture.textureUrl ? (
          <img
            alt=""
            src={texture.textureUrl}
            onError={(event) => {
              event.currentTarget.hidden = true;
              setRuntimeFallback(resolveFailedExternalTexture(itemId, texture));
            }}
          />
        ) : null}
      </span>
    </span>
  );
}

function Metric({ label, value, detail, tone = "plain" }: { label: string; value: string; detail: string; tone?: string }) {
  return (
    <motion.article className={cn("metric", tone)} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </motion.article>
  );
}

function ProviderStrip() {
  return (
    <section className="provider-strip" aria-label="Provider status">
      {providerStatus.map((provider) => (
        <article className={cn("provider-pill", provider.severity)} key={provider.source}>
          {provider.severity === "ok" ? <ShieldCheck size={16} /> : <AlertTriangle size={16} />}
          <div>
            <strong>{provider.source}</strong>
            <span>{provider.status} · {provider.freshness}</span>
          </div>
        </article>
      ))}
    </section>
  );
}

function Overview({ live, onRefresh, packState }: { live: any; onRefresh: () => void; packState: PackState }) {
  const profile = live.profile;
  return (
    <div className="view-grid overview-grid">
      <section className="profile-band">
        <div className="profile-head">
          <div className="skin-frame" aria-hidden="true">
            <span className="skin-head" />
            <span className="skin-body" />
          </div>
          <div>
            <span className="eyebrow">Selected SkyBlock Profile</span>
            <h1>{profile.username}</h1>
            <p>{profile.profile} · Level {profile.level} · {profile.selectedGoal}</p>
          </div>
        </div>
        <Button className="action-button" onClick={onRefresh}><RefreshCw size={16} /> Refresh</Button>
      </section>

      <Metric label="Networth" value={profile.networth} detail={`${profile.purse} purse · ${profile.bank} bank`} tone="gold" />
      <Metric label="Magical Power" value={String(profile.magicalPower)} detail="Accessory enrichment ready" tone="purple" />
      <Metric label="Goal" value="M5" detail="Planner has 5 auditable steps" tone="blue" />

      <section className="panel wide">
        <div className="section-heading">
          <div>
            <h2>Current Gear</h2>
            <p>Resolved through the resource-pack adapter with generated fallback textures.</p>
          </div>
          <Swords size={20} />
        </div>
        <div className="equipment-grid">
          {equipment.map((item) => (
            <article className="equipment-tile" key={item.slot}>
              <ItemIcon itemId={item.itemId} rarity={item.rarity} packState={packState} />
              <div>
                <span>{item.slot}</span>
                <strong>{item.name}</strong>
                <small>{item.detail}</small>
              </div>
              <b>{coins(item.value)}</b>
            </article>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="section-heading compact">
          <h2>Freshness</h2>
          <AlertTriangle size={18} />
        </div>
        <ProviderStrip />
      </section>
    </div>
  );
}

function Inventory() {
  return (
    <section className="panel wide">
      <div className="section-heading">
        <div>
          <h2>Inventory Sections</h2>
          <p>Section cards keep decoded counts, warnings, and priced value separate.</p>
        </div>
        <Boxes size={20} />
      </div>
      <div className="inventory-board">
        {inventorySections.map((section) => (
          <article className="inventory-section" key={section.name}>
            <Box size={18} />
            <strong>{section.name}</strong>
            <span>{section.decoded} decoded</span>
            <small className={section.warnings ? "warn-text" : ""}>{section.warnings} warnings</small>
            <b>{section.value}</b>
          </article>
        ))}
      </div>
    </section>
  );
}

function Networth({ live }: { live: any }) {
  const profile = live.profile;
  const total = live.networth?.networth?.total ?? live.networth?.total ?? profile.networth;
  return (
    <section className="panel wide">
      <div className="section-heading">
        <div>
          <h2>Networth Breakdown</h2>
          <p>Totals separate known value, low-confidence sections, and provider provenance instead of hiding estimates.</p>
        </div>
        <CircleDollarSign size={20} />
      </div>
      <div className="networth-layout">
        <div className="networth-total">
          <span>Total estimate</span>
          <strong>{typeof total === "number" ? total.toLocaleString() : total}</strong>
          <small>{profile.purse} purse · {profile.bank} bank · unknown prices excluded</small>
        </div>
        <div className="networth-list">
          {networthBreakdown.map((row) => (
            <article className="networth-row" key={row.name}>
              <div>
                <strong>{row.name}</strong>
                <span>{row.provider} · {row.confidence} confidence</span>
              </div>
              <div className="progress-track"><i style={{ width: `${row.share}%` }} /></div>
              <b>{row.value}</b>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function Accessories({ packState }: { packState: PackState }) {
  return (
    <section className="panel wide">
      <div className="section-heading">
        <div>
          <h2>Accessory Upgrades</h2>
          <p>Ranked by coin per Magical Power with explicit metadata fallback behavior.</p>
        </div>
        <Gem size={20} />
      </div>
      <div className="upgrade-list">
        {accessories.map((item) => (
          <article className="upgrade-row" key={item.name}>
            <ItemIcon itemId={item.itemId} rarity={item.rarity} packState={packState} />
            <div>
              <strong>{item.name}</strong>
              <span>{item.mp} MP · {item.efficiency}</span>
            </div>
            <b>{item.cost}</b>
          </article>
        ))}
      </div>
    </section>
  );
}

function Progression() {
  return (
    <section className="panel wide">
      <div className="section-heading">
        <div>
          <h2>Progression Readiness</h2>
          <p>Compact sections for repeated comparison across combat, economy, and skill goals.</p>
        </div>
        <Pickaxe size={20} />
      </div>
      <div className="progression-grid">
        {progression.map((area) => (
          <article className="progress-card" key={area.area}>
            <div>
              <strong>{area.area}</strong>
              <span>Level {area.level}</span>
            </div>
            <div className="progress-track"><i style={{ width: `${area.score}%` }} /></div>
            <small>{area.next}</small>
          </article>
        ))}
      </div>
    </section>
  );
}

function plannerLayout() {
  const graph = new dagre.graphlib.Graph();
  graph.setGraph({ rankdir: "LR", nodesep: 34, ranksep: 54 });
  graph.setDefaultEdgeLabel(() => ({}));
  for (const step of plannerSteps) graph.setNode(step.id, { width: 156, height: 64 });
  for (let index = 0; index < plannerSteps.length - 1; index += 1) graph.setEdge(plannerSteps[index].id, plannerSteps[index + 1].id);
  dagre.layout(graph);
  return plannerSteps.map((step) => ({ ...step, ...(graph.node(step.id) as { x: number; y: number }) }));
}

function Planner() {
  const nodes = useMemo(plannerLayout, []);
  return (
    <section className="panel wide">
      <div className="section-heading">
        <div>
          <h2>Goal Plan Graph</h2>
          <p>Dagre lays out the route so blockers, upgrades, and provider warnings stay auditable.</p>
        </div>
        <Hammer size={20} />
      </div>
      <div className="plan-canvas">
        {nodes.map((node, index) => (
          <motion.article
            className="plan-node"
            key={node.id}
            style={{ left: node.x - 78, top: node.y - 32 }}
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: index * 0.04 }}
          >
            <span>{index + 1}</span>
            <strong>{node.label}</strong>
            <small>{node.detail}</small>
          </motion.article>
        ))}
      </div>
    </section>
  );
}

function Packs({ packState, setPackState }: { packState: PackState; setPackState: (state: PackState) => void }) {
  const [sourceUrl, setSourceUrl] = useState("file:///packs/FurfSky-Reborn.zip");
  const [licenseAccepted, setLicenseAccepted] = useState(false);
  const [manifestText, setManifestText] = useState(() => JSON.stringify(exampleManifest("file:///packs/FurfSky-Reborn.zip"), null, 2));
  const [manifestStatus, setManifestStatus] = useState("manifest ready");
  const cache = resourcePackCache();
  function addSource() {
    const external = packState.packs.find((pack) => pack.id !== "skyagent-generated" && pack.enabled) ?? packState.packs[1];
    if (!licenseAccepted) {
      setManifestStatus("accept the pack license before adding this source");
      return;
    }
    let manifest: PackManifest;
    try {
      manifest = JSON.parse(manifestText) as PackManifest;
      if (!manifest.license || !manifest.homepage || !manifest.textures) throw new Error("manifest requires license, homepage, and textures");
    } catch (error) {
      setManifestStatus(error instanceof Error ? error.message : "invalid manifest JSON");
      return;
    }
    const source = createManifestSource(external, sourceUrl, manifest, licenseAccepted);
    setPackState({
      ...packState,
      sources: [...packState.sources, source],
    });
    setManifestStatus(`added ${manifest.name}`);
  }
  return (
    <section className="panel wide">
      <div className="section-heading">
        <div>
          <h2>Resource Pack Pipeline</h2>
          <p>External packs are configurable adapters. No third-party textures are bundled in this repo.</p>
        </div>
        <PackageCheck size={20} />
      </div>
      <div className="pack-list">
        {packState.packs.map((pack) => (
          <article className="pack-row" key={pack.id}>
            <Switch.Root
              className="switch"
              checked={pack.enabled}
              onCheckedChange={(enabled) => setPackState({
                ...packState,
                packs: packState.packs.map((entry) => entry.id === pack.id ? { ...entry, enabled } : entry),
              })}
            >
              <Switch.Thumb className="switch-thumb" />
            </Switch.Root>
            <div>
              <strong>{pack.name}</strong>
              <span>{pack.author} · {pack.license}</span>
              <small>{pack.coverage.join(", ")} · {pack.homepage}</small>
            </div>
          </article>
        ))}
      </div>
      <div className="pack-source-row">
        <label>
          <span>Pack source</span>
          <input
            value={sourceUrl}
            onChange={(event) => {
              const nextUrl = event.currentTarget.value;
              setSourceUrl(nextUrl);
              setManifestText(JSON.stringify(exampleManifest(nextUrl), null, 2));
            }}
          />
        </label>
        <Button className="action-button" onClick={addSource}>Add Source</Button>
      </div>
      <label className="license-row">
        <Switch.Root className="switch" checked={licenseAccepted} onCheckedChange={setLicenseAccepted}>
          <Switch.Thumb className="switch-thumb" />
        </Switch.Root>
        <span>I have the right to use this pack locally and the manifest license is accurate.</span>
      </label>
      <label className="manifest-field">
        <span>Texture manifest</span>
        <textarea value={manifestText} onChange={(event) => setManifestText(event.currentTarget.value)} />
      </label>
      <div className="cache-summary">
        <strong>Manifest status</strong>
        <span>{manifestStatus}</span>
      </div>
      <div className="cache-summary">
        <strong>Texture cache</strong>
        <span>{cache.entryCount} entries · {cache.fallbackCount} fallbacks · sources: {packState.sources.length}</span>
      </div>
      <div className="pack-list">
        {packState.sources.map((source) => (
          <article className="pack-row" key={`${source.packId}:${source.url}`}>
            <PackageCheck size={18} />
            <div>
              <strong>{source.packId}</strong>
              <span>{source.url}</span>
              <small>
                {source.enabled ? "enabled" : "disabled"} · {source.manifest?.providerMethod ?? "missing manifest"} · {source.manifest?.stale ? "stale" : "fresh"} · added {source.addedAt}
              </small>
            </div>
          </article>
        ))}
      </div>
      <div className="cache-summary">
        <strong>Latest resolutions</strong>
        <span>
          {cache.entries.slice(-3).map((entry) => `${entry.itemId}: ${entry.cacheStatus}/${entry.sourceFreshness}`).join(" · ") || "No texture resolutions yet"}
        </span>
      </div>
    </section>
  );
}

function SettingsView({
  settings,
  setSettings,
  status,
  onLoad,
}: {
  settings: ProfileSettings;
  setSettings: (settings: ProfileSettings) => void;
  status: string;
  onLoad: () => void;
}) {
  function update(key: keyof ProfileSettings, value: string) {
    const next = { ...settings, [key]: value };
    setSettings(next);
    for (const [entryKey, entryValue] of Object.entries(next)) window.localStorage.setItem(`skyagent.web.${entryKey}`, entryValue);
  }
  return (
    <section className="panel wide">
      <div className="section-heading">
        <div>
          <h2>Profile Settings</h2>
          <p>Select the player and profile read by the local SkyAgent application service.</p>
        </div>
        <Settings size={20} />
      </div>
      <div className="settings-grid">
        {([
          ["player", "Player", "Minecraft username or UUID"],
          ["profile", "Profile", "Cute name or profile ID"],
        ] as Array<[keyof ProfileSettings, string, string]>).map(([key, label, placeholder]) => (
          <label className="settings-field" key={key}>
            <span>{label}</span>
            <input
              value={settings[key]}
              type="text"
              placeholder={placeholder}
              onChange={(event) => update(key, event.currentTarget.value)}
            />
          </label>
        ))}
      </div>
      <div className="cache-summary">
        <strong>Application service</strong>
        <span>/api/overview, /api/inventory, /api/networth, /api/accessories, /api/progression, /api/provider-status · {status}</span>
      </div>
      <Button className="action-button" onClick={onLoad}><RefreshCw size={16} /> Load Profile Data</Button>
    </section>
  );
}

function ActiveView({ view, live, settings, setSettings, status, onLoad, packState, setPackState }: {
  view: ViewId;
  live: any;
  settings: ProfileSettings;
  setSettings: (settings: ProfileSettings) => void;
  status: string;
  onLoad: () => void;
  packState: PackState;
  setPackState: (state: PackState) => void;
}) {
  if (view === "inventory") return <Inventory />;
  if (view === "networth") return <Networth live={live} />;
  if (view === "accessories") return <Accessories packState={packState} />;
  if (view === "progression") return <Progression />;
  if (view === "planner") return <Planner />;
  if (view === "packs") return <Packs packState={packState} setPackState={setPackState} />;
  if (view === "settings") return <SettingsView settings={settings} setSettings={setSettings} status={status} onLoad={onLoad} />;
  return <Overview live={live} onRefresh={onLoad} packState={packState} />;
}

export function App() {
  const [settings, setSettings] = useState<ProfileSettings>(() => ({
    player: storageValue("skyagent.web.player", mockProfile.username),
    profile: storageValue("skyagent.web.profile", mockProfile.profile),
  }));
  const [packState, setPackState] = useState<PackState>({
    packs: resourcePacks,
    sources: defaultPackSources,
  });
  const [status, setStatus] = useState("profile data not loaded");
  const [live, setLive] = useState<any>({ profile: mockProfile });
  async function loadProfileData() {
    try {
      setStatus("loading profile data");
      const query = `player=${encodeURIComponent(settings.player)}&profile=${encodeURIComponent(settings.profile)}`;
      const [overview, inventory, networth, accessoryData, progressionData, providers] = await Promise.all([
        appRequest(`/api/overview?${query}`),
        appRequest(`/api/inventory?${query}`),
        appRequest(`/api/networth?${query}`),
        appRequest(`/api/accessories?${query}`),
        appRequest(`/api/progression?${query}`),
        appRequest("/api/provider-status"),
      ]);
      setLive({
        profile: {
          ...mockProfile,
          username: settings.player || mockProfile.username,
          profile: settings.profile || mockProfile.profile,
          networth: networth?.networth?.total ?? mockProfile.networth,
          magicalPower: accessoryData?.accessories?.magicalPower ?? mockProfile.magicalPower,
        },
        overview,
        inventory,
        networth,
        accessories: accessoryData,
        progression: progressionData,
        providers,
      });
      setStatus("profile data loaded");
    } catch (error) {
      setStatus(`profile data unavailable: ${error instanceof Error ? error.message : String(error)}`);
      setLive({ profile: { ...mockProfile, username: settings.player || mockProfile.username, profile: settings.profile || mockProfile.profile } });
    }
  }
  return (
    <Tabs.Root defaultValue="overview" className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-cube" aria-hidden="true"><span /></div>
          <div>
            <strong>SkyAgent</strong>
            <span>SkyBlock command center</span>
          </div>
        </div>
        <Tabs.List className="nav-list" aria-label="SkyAgent web views">
          {views.map((view) => {
            const Icon = view.icon;
            return (
              <Tabs.Trigger className="nav-trigger" value={view.id} key={view.id} aria-label={view.label}>
                <Icon size={18} />
                <span>{view.label}</span>
              </Tabs.Trigger>
            );
          })}
        </Tabs.List>
      </aside>
      <main className="workspace">
        <header className="topbar">
          <div>
            <span className="eyebrow">Agent OS local application</span>
            <h1>SkyBlock Profile Analysis</h1>
          </div>
          <Button className="action-button" onClick={loadProfileData}><CircleDollarSign size={16} /> Load Profile</Button>
        </header>
        <ProviderStrip />
        {views.map((view) => (
          <Tabs.Content value={view.id} key={view.id} className="tab-content">
            <ActiveView
              view={view.id}
              live={live}
              settings={settings}
              setSettings={setSettings}
              status={status}
              onLoad={loadProfileData}
              packState={packState}
              setPackState={setPackState}
            />
          </Tabs.Content>
        ))}
      </main>
    </Tabs.Root>
  );
}
