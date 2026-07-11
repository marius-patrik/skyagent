import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

const APP_ID = "skyagent";
const CONFIG_KEYS = new Set(["username", "uuid", "selectedProfileId"]);

export type SkyAgentConfig = {
  username?: string;
  uuid?: string;
  selectedProfileId?: string;
};

export function agentsHome() {
  return path.resolve(process.env.AGENTS_HOME?.trim() || path.join(os.homedir(), ".agents"));
}

export function dataDir() {
  return path.join(agentsHome(), "runtime", "apps", APP_ID);
}

export function ensureDataDir() {
  const dir = dataDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") fs.chmodSync(dir, 0o700);
  return dir;
}

export function configPath() {
  return path.join(dataDir(), "config.json");
}

export function hypixelApiKeyPath() {
  return path.join(agentsHome(), "secrets", "HYPIXEL_API_KEY.secret");
}

export function readJson<T>(file: string, fallback: T): T {
  try {
    const info = fs.lstatSync(file);
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new Error(`SkyAgent state must be a physical file: ${file}`);
    }
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw error;
  }
}

export function writeJson(file: string, value: unknown) {
  ensureDataDir();
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporary, file);
  if (process.platform !== "win32") fs.chmodSync(file, 0o600);
}

function validateConfig(value: unknown): SkyAgentConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid SkyAgent config: ${configPath()}`);
  }
  const config = value as Record<string, unknown>;
  for (const key of Object.keys(config)) {
    if (!CONFIG_KEYS.has(key)) throw new Error(`Unsupported SkyAgent config key: ${key}`);
    if (typeof config[key] !== "string" || !(config[key] as string).trim() || (config[key] as string).includes("\0")) {
      throw new Error(`Invalid SkyAgent config value: ${key}`);
    }
  }
  return config as SkyAgentConfig;
}

export function readConfig(): SkyAgentConfig {
  return validateConfig(readJson(configPath(), {}));
}

export function writeConfig(config: SkyAgentConfig) {
  writeJson(configPath(), validateConfig(config));
}

export function getApiKey() {
  const file = hypixelApiKeyPath();
  try {
    const info = fs.lstatSync(file);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Agent OS secret must be a physical file: ${file}`);
    return fs.readFileSync(file, "utf8").trim();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}

export function publicConfig(config = readConfig()) {
  return {
    username: config.username ?? null,
    uuid: config.uuid ?? null,
    selectedProfileId: config.selectedProfileId ?? null,
    apiKeyConfigured: Boolean(getApiKey()),
    apiKeySource: getApiKey() ? "agent-os-secret" : null,
    dataDir: dataDir(),
    secretPath: hypixelApiKeyPath(),
  };
}

export function setConfigValue(key: keyof SkyAgentConfig, value: unknown) {
  if (!CONFIG_KEYS.has(key)) throw new Error(`Unsupported SkyAgent config key: ${key}`);
  const config = readConfig();
  if (value === null || value === undefined || value === "") {
    delete config[key];
  } else if (typeof value === "string" && value.trim() && !value.includes("\0")) {
    config[key] = value;
  } else {
    throw new Error(`Invalid SkyAgent config value: ${key}`);
  }
  writeConfig(config);
  return publicConfig(config);
}
