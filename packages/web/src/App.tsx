import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, BarChart3, Boxes, CalendarClock, CheckCircle2, ChevronDown, CircleDollarSign, ClipboardList, Gem, KeyRound, Layers3, Loader2, Pickaxe, RefreshCw, Search, Settings, ShieldAlert, Sparkles, UserRound } from "lucide-react";
import { RARITY_ORDER, SKILL_NAMES } from "@skyagent/core/progression";
import { cn } from "./lib/utils.ts";
import { Button } from "./components/ui/button.tsx";
import { Card } from "./components/ui/card.tsx";
import { Input } from "./components/ui/input.tsx";

type ViewId = "overview" | "inventory" | "networth" | "accessories" | "progression" | "planner" | "settings";
type LoadState = "ready" | "loading" | "error" | "disabled" | "missing" | "outage";

const views: Array<{ id: ViewId; label: string; icon: typeof BarChart3 }> = [
  { id: "overview", label: "Overview", icon: BarChart3 },
  { id: "inventory", label: "Inventory", icon: Boxes },
  { id: "networth", label: "Networth", icon: CircleDollarSign },
  { id: "accessories", label: "Accessories", icon: Gem },
  { id: "progression", label: "Progression", icon: Layers3 },
  { id: "planner", label: "Planner", icon: ClipboardList },
  { id: "settings", label: "Settings", icon: Settings },
];

const statusCopy: Record<LoadState, { label: string; detail: string; icon: typeof CheckCircle2 }> = {
  ready: { label: "Ready", detail: "Local shell is ready to connect to SkyAgent services.", icon: CheckCircle2 },
  loading: { label: "Loading", detail: "Fetching the latest profile data.", icon: Loader2 },
  error: { label: "Error", detail: "The last request failed. Check configuration and provider status.", icon: ShieldAlert },
  disabled: { label: "API disabled", detail: "Add an API key or use environment configuration before fetching private profile data.", icon: KeyRound },
  missing: { label: "Missing profile", detail: "Select a profile or confirm the configured username.", icon: UserRound },
  outage: { label: "Provider outage", detail: "A price or metadata provider is unavailable; stale or partial results may be shown.", icon: AlertTriangle },
};
const stateOrder: LoadState[] = ["ready", "loading", "error", "disabled", "missing", "outage"];

const sectionRows = [
  ["Inventory", "Armor, equipment, wardrobe, backpacks, vault, pets", "Decoded sections"],
  ["Networth", "Purse, bank, priced items, unknown prices", "Estimate"],
  ["Accessories", "Magical Power, duplicates, missing upgrades", "Budget aware"],
  ["Progression", "Skills, Dungeons, Slayer, Mining, Garden, Rift", "Sections"],
  ["Planner", "Goal route, blockers, next upgrades, what to skip", "Auditable"],
];

const readinessRows = [
  ["Dungeons", "Catacombs 24, class 20, floor progress"],
  ["Slayer", "Broad Slayer XP and boss unlock signals"],
  ["Kuudra", "Combat, Crimson Isle, Kuudra completions"],
  ["Garden", "Garden level, Farming level, crop milestones"],
  ["Mining", "HotM, powder foundation, major unlocks"],
];

function storageValue(key: string, fallback: string) {
  if (typeof window === "undefined") {
    return fallback;
  }
  return window.localStorage.getItem(key) ?? fallback;
}

function saveStorage(key: string, value: string) {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(key, value);
  }
}

function Field({ label, value, onChange, type = "text", placeholder = "" }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <Input value={value} onChange={(event) => onChange(event.currentTarget.value)} type={type} placeholder={placeholder} />
    </label>
  );
}

function StateBanner({ state }: { state: LoadState }) {
  const copy = statusCopy[state];
  const Icon = copy.icon;
  return (
    <section className={cn("state-banner", state)}>
      <Icon className={cn("state-icon", state === "loading" && "spin")} size={18} />
      <div>
        <strong>{copy.label}</strong>
        <span>{copy.detail}</span>
      </div>
    </section>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function Overview({ username, profile, setProfile }: { username: string; profile: string; setProfile: (value: string) => void }) {
  return (
    <div className="view-grid">
      <Card className="panel wide">
        <div className="panel-heading">
          <div>
            <h2>Profile Overview</h2>
            <p>{username || "No username"} / {profile || "No profile selected"}</p>
          </div>
          <Button className="icon-button" aria-label="Refresh profile"><RefreshCw size={18} /></Button>
        </div>
        <div className="metrics-grid">
          <Metric label="Networth" value="Pending" detail="Connect API to calculate" />
          <Metric label="Magical Power" value="Pending" detail="Accessory bag required" />
          <Metric label="Readiness" value="5 areas" detail="Dungeons to Mining" />
          <Metric label="Planner" value="Ready" detail="Goal route shell" />
        </div>
      </Card>
      <Card className="panel">
        <h3>Profile Selector</h3>
        <div className="selector-list">
          {["Apple", "Banana", "Coconut"].map((name) => (
            <Button className={cn("selector-row", profile === name && "selected")} key={name} onClick={() => setProfile(name)}>
              <span>{name}</span>
              <small>{profile === name ? "Selected" : "Available"}</small>
            </Button>
          ))}
        </div>
      </Card>
      <Card className="panel">
        <h3>Provider Signals</h3>
        <ul className="status-list">
          <li><CheckCircle2 size={16} /> Hypixel API configured by env or local settings</li>
          <li><AlertTriangle size={16} /> Price providers can return partial candidates</li>
          <li><ShieldAlert size={16} /> Secrets never render in full</li>
        </ul>
      </Card>
    </div>
  );
}

function Inventory() {
  return (
    <Card className="panel wide">
      <div className="panel-heading">
        <h2>Inventory And Item Sections</h2>
        <Button className="text-button"><Search size={16} /> Inspect</Button>
      </div>
      <div className="table">
        {["Armor", "Equipment", "Wardrobe", "Inventory", "Ender Chest", "Backpacks", "Accessory Bag", "Personal Vault", "Pets"].map((section) => (
          <div className="table-row" key={section}>
            <span>{section}</span>
            <small>Uses shared inventory extraction and item normalization</small>
            <strong>Waiting</strong>
          </div>
        ))}
      </div>
    </Card>
  );
}

function Networth() {
  return (
    <Card className="panel wide">
      <div className="panel-heading">
        <h2>Networth Breakdown</h2>
        <Button className="text-button"><CircleDollarSign size={16} /> Reprice</Button>
      </div>
      <div className="split">
        <div className="stack">
          {["Purse", "Bank", "Armor", "Equipment", "Accessories", "Pets"].map((name, index) => (
            <div className="bar-row" key={name}>
              <span>{name}</span>
              <div><i style={{ width: `${28 + index * 9}%` }} /></div>
              <strong>--</strong>
            </div>
          ))}
        </div>
        <div className="callout">
          <AlertTriangle size={18} />
          <p>Unknown prices and partial auction candidates stay visible instead of being folded into totals.</p>
        </div>
      </div>
    </Card>
  );
}

function Accessories() {
  return (
    <Card className="panel wide">
      <div className="panel-heading">
        <h2>Missing Accessories</h2>
        <Button className="text-button"><Gem size={16} /> Rank MP</Button>
      </div>
      <div className="upgrade-list">
        {RARITY_ORDER.slice(0, 6).map((rarity, index) => (
          <article className="upgrade" key={rarity}>
            <span>{rarity}</span>
            <strong>{index + 3} MP candidate</strong>
            <small>Requires price and accessory metadata provider</small>
          </article>
        ))}
      </div>
    </Card>
  );
}

function Progression() {
  return (
    <Card className="panel wide">
      <div className="panel-heading">
        <h2>Progression Sections</h2>
        <Button className="text-button"><Layers3 size={16} /> Load Sections</Button>
      </div>
      <div className="section-grid">
        {sectionRows.map(([name, detail, state]) => (
          <article className="section-tile" key={name}>
            <strong>{name}</strong>
            <span>{detail}</span>
            <small>{state}</small>
          </article>
        ))}
      </div>
      <div className="skill-strip">
        {SKILL_NAMES.slice(0, 8).map((skill) => <span key={skill}>{skill}</span>)}
      </div>
    </Card>
  );
}

function Planner() {
  return (
    <Card className="panel wide">
      <div className="panel-heading">
        <div>
          <h2>Goal Planner</h2>
          <p>Routes combine readiness, networth, accessories, profile sections, memories, and warnings.</p>
        </div>
        <Button className="text-button"><Sparkles size={16} /> Plan</Button>
      </div>
      <div className="planner-layout">
        <label className="field">
          <span>Goal</span>
          <Input defaultValue="F7 completion" />
        </label>
        <label className="field">
          <span>Budget</span>
          <Input defaultValue="10000000" inputMode="numeric" />
        </label>
        <div className="route-list">
          {readinessRows.map(([area, detail]) => (
            <article className="route-step" key={area}>
              <Pickaxe size={16} />
              <div>
                <strong>{area}</strong>
                <small>{detail}</small>
              </div>
              <span>Estimate</span>
            </article>
          ))}
        </div>
      </div>
    </Card>
  );
}

function SettingsView({ username, setUsername, profile, setProfile, apiKey, setApiKey }: {
  username: string;
  setUsername: (value: string) => void;
  profile: string;
  setProfile: (value: string) => void;
  apiKey: string;
  setApiKey: (value: string) => void;
}) {
  const [priceProvider, setPriceProvider] = useState(() => storageValue("skyagent.priceProvider", "CoflNet + Hypixel fallback"));
  const [metadataProvider, setMetadataProvider] = useState(() => storageValue("skyagent.metadataProvider", "NotEnoughUpdates + Hypixel resources"));
  const [cacheMode, setCacheMode] = useState(() => storageValue("skyagent.cacheMode", "Local browser shell only"));

  function saveSettings() {
    saveStorage("skyagent.username", username);
    saveStorage("skyagent.profile", profile);
    saveStorage("skyagent.priceProvider", priceProvider);
    saveStorage("skyagent.metadataProvider", metadataProvider);
    saveStorage("skyagent.cacheMode", cacheMode);
  }

  return (
    <Card className="panel wide">
      <div className="panel-heading">
        <h2>Settings</h2>
        <Button className="text-button" onClick={saveSettings}><KeyRound size={16} /> Save Local</Button>
      </div>
      <div className="settings-grid">
        <Field label="Username" value={username} onChange={setUsername} placeholder="Minecraft name" />
        <Field label="Profile" value={profile} onChange={setProfile} placeholder="Cute name or profile ID" />
        <Field label="API key" value={apiKey} onChange={setApiKey} type="password" placeholder="Use HYPIXEL_API_KEY when possible" />
        <Field label="Price provider" value={priceProvider} onChange={setPriceProvider} />
        <Field label="Metadata provider" value={metadataProvider} onChange={setMetadataProvider} />
        <Field label="Cache mode" value={cacheMode} onChange={setCacheMode} />
      </div>
      <div className="callout">
        <ShieldAlert size={18} />
        <p>Secrets stay in explicit local storage or environment configuration. The UI masks API keys and does not print them back.</p>
      </div>
    </Card>
  );
}

function ActiveView(props: {
  view: ViewId;
  username: string;
  setUsername: (value: string) => void;
  profile: string;
  setProfile: (value: string) => void;
  apiKey: string;
  setApiKey: (value: string) => void;
}) {
  if (props.view === "inventory") return <Inventory />;
  if (props.view === "networth") return <Networth />;
  if (props.view === "accessories") return <Accessories />;
  if (props.view === "progression") return <Progression />;
  if (props.view === "planner") return <Planner />;
  if (props.view === "settings") return <SettingsView {...props} />;
  return <Overview username={props.username} profile={props.profile} setProfile={props.setProfile} />;
}

export function App() {
  const [view, setView] = useState<ViewId>("overview");
  const [state, setState] = useState<LoadState>("ready");
  const [username, setUsernameState] = useState(() => storageValue("skyagent.username", ""));
  const [profile, setProfileState] = useState(() => storageValue("skyagent.profile", ""));
  const [apiKey, setApiKeyState] = useState("");
  const active = useMemo(() => views.find((entry) => entry.id === view) ?? views[0], [view]);

  useEffect(() => {
    window.localStorage.removeItem("skyagent.apiKey");
    window.sessionStorage.removeItem("skyagent.apiKey");
  }, []);

  function setUsername(value: string) {
    setUsernameState(value);
    saveStorage("skyagent.username", value);
  }

  function setProfile(value: string) {
    setProfileState(value);
    saveStorage("skyagent.profile", value);
  }

  function setApiKey(value: string) {
    setApiKeyState(value);
  }

  function cycleState() {
    const index = stateOrder.indexOf(state);
    setState(stateOrder[(index + 1) % stateOrder.length]);
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">SA</div>
          <div>
            <strong>SkyAgent</strong>
            <span>Hypixel SkyBlock</span>
          </div>
        </div>
        <nav>
          {views.map((entry) => {
            const Icon = entry.icon;
            return (
              <Button className={cn("nav-item", view === entry.id && "active")} key={entry.id} onClick={() => setView(entry.id)}>
                <Icon size={18} />
                <span>{entry.label}</span>
              </Button>
            );
          })}
        </nav>
      </aside>
      <main className="workspace">
        <header className="topbar">
          <div>
            <span className="eyebrow">{active.label}</span>
            <h1>{active.label}</h1>
          </div>
          <div className="top-actions">
            <Button className="state-select" onClick={cycleState}>
              <CalendarClock size={16} />
              <span>{statusCopy[state].label}</span>
              <ChevronDown size={16} />
            </Button>
            <Button className="icon-button" aria-label="Settings" onClick={() => setView("settings")}><Settings size={18} /></Button>
          </div>
        </header>
        <StateBanner state={state} />
        <ActiveView view={view} username={username} setUsername={setUsername} profile={profile} setProfile={setProfile} apiKey={apiKey} setApiKey={setApiKey} />
      </main>
    </div>
  );
}
