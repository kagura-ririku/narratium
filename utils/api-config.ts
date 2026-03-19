export const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com";
export const DEFAULT_RESPONSE_LENGTH = 4096;
export const MIN_RESPONSE_LENGTH = 100;
const RESPONSE_LENGTH_VERSION_KEY = "responseLengthVersion";
const RESPONSE_LENGTH_VERSION = "2";

export interface ApiConfig {
  id: string;
  name: string;
  type: "openai";
  baseUrl: string;
  model: string;
  apiKey: string;
}

const isBrowser = () => typeof window !== "undefined";

export const normalizeBaseUrl = (value?: string): string => {
  const trimmed = (value?.trim() || DEFAULT_OPENAI_BASE_URL).replace(/\/+$/, "");
  return trimmed.replace(/\/v1(?:\/(?:responses|models))?$/i, "");
};

export const getOpenAIApiBaseUrl = (value?: string): string => `${normalizeBaseUrl(value)}/v1`;
export const getOpenAIModelsEndpoint = (value?: string): string => `${getOpenAIApiBaseUrl(value)}/models`;
export const getOpenAIResponsesEndpoint = (value?: string): string => `${getOpenAIApiBaseUrl(value)}/responses`;

const sanitizeConfig = (config: Partial<ApiConfig>, index: number): ApiConfig => ({
  id: config.id?.trim() || `api_${Date.now()}_${index}`,
  name: config.name?.trim() || config.model?.trim() || `API Config ${index + 1}`,
  type: "openai",
  baseUrl: normalizeBaseUrl(config.baseUrl),
  model: config.model?.trim() || "",
  apiKey: config.apiKey?.trim() || "",
});

const migrateLegacyConfig = (storage: Storage): ApiConfig | null => {
  const baseUrl = storage.getItem("openaiBaseUrl") || storage.getItem("modelBaseUrl") || "";
  const model = storage.getItem("openaiModel") || storage.getItem("modelName") || "";
  const apiKey = storage.getItem("openaiApiKey") || storage.getItem("apiKey") || "";

  if (!baseUrl && !model && !apiKey) {
    return null;
  }

  return sanitizeConfig(
    {
      id: "api_legacy",
      name: model || "OpenAI API",
      type: "openai",
      baseUrl,
      model,
      apiKey,
    },
    0,
  );
};

const writeLegacyKeys = (storage: Storage, config: ApiConfig | null) => {
  storage.setItem("llmType", "openai");

  if (!config) {
    storage.removeItem("openaiBaseUrl");
    storage.removeItem("openaiModel");
    storage.removeItem("openaiApiKey");
    storage.removeItem("apiKey");
    storage.removeItem("modelBaseUrl");
    storage.removeItem("modelName");
    return;
  }

  storage.setItem("openaiBaseUrl", normalizeBaseUrl(config.baseUrl));
  storage.setItem("openaiModel", config.model);
  storage.setItem("openaiApiKey", config.apiKey);
  storage.setItem("apiKey", config.apiKey);
  storage.setItem("modelBaseUrl", normalizeBaseUrl(config.baseUrl));
  storage.setItem("modelName", config.model);
};

export const createEmptyApiConfig = (): ApiConfig => ({
  id: `api_${Date.now()}`,
  name: "",
  type: "openai",
  baseUrl: DEFAULT_OPENAI_BASE_URL,
  model: "",
  apiKey: "",
});

export const getStoredApiConfigs = (): ApiConfig[] => {
  if (!isBrowser()) {
    return [];
  }

  const storage = window.localStorage;
  let configs: ApiConfig[] = [];

  const rawConfigs = storage.getItem("apiConfigs");
  if (rawConfigs) {
    try {
      const parsed = JSON.parse(rawConfigs) as Partial<ApiConfig>[];
      if (Array.isArray(parsed)) {
        configs = parsed.map((config, index) => sanitizeConfig(config, index));
      }
    } catch (error) {
      console.error("Failed to parse stored API configs:", error);
    }
  }

  if (configs.length === 0) {
    const migrated = migrateLegacyConfig(storage);
    if (migrated) {
      configs = [migrated];
    }
  }

  const activeConfigId = storage.getItem("activeConfigId");
  const hasStoredActiveConfig = activeConfigId !== null;
  const activeConfig = hasStoredActiveConfig
    ? (activeConfigId ? configs.find((config) => config.id === activeConfigId) || null : null)
    : (configs[0] || null);

  storage.setItem("apiConfigs", JSON.stringify(configs));
  storage.setItem("activeConfigId", activeConfig?.id || "");
  writeLegacyKeys(storage, activeConfig);

  return configs;
};

export const getActiveApiConfig = (configs?: ApiConfig[]): ApiConfig | null => {
  if (!isBrowser()) {
    return null;
  }

  const resolvedConfigs = configs ?? getStoredApiConfigs();
  const activeConfigId = window.localStorage.getItem("activeConfigId");
  if (activeConfigId === "") {
    return null;
  }
  return resolvedConfigs.find((config) => config.id === activeConfigId) || resolvedConfigs[0] || null;
};

export const persistApiConfigState = (configs: ApiConfig[], activeConfigId: string) => {
  if (!isBrowser()) {
    return;
  }

  const sanitizedConfigs = configs.map((config, index) => sanitizeConfig(config, index));
  const activeConfig = activeConfigId
    ? sanitizedConfigs.find((config) => config.id === activeConfigId) || null
    : null;

  window.localStorage.setItem("apiConfigs", JSON.stringify(sanitizedConfigs));
  window.localStorage.setItem("activeConfigId", activeConfig?.id || "");
  writeLegacyKeys(window.localStorage, activeConfig);
};

export const sanitizeResponseLength = (value?: string | number | null): number => {
  const parsed = typeof value === "number" ? value : parseInt(value || "", 10);

  if (Number.isNaN(parsed)) {
    return DEFAULT_RESPONSE_LENGTH;
  }

  return Math.max(MIN_RESPONSE_LENGTH, parsed);
};

export const getStoredResponseLength = (): number => {
  if (!isBrowser()) {
    return DEFAULT_RESPONSE_LENGTH;
  }

  if (window.localStorage.getItem(RESPONSE_LENGTH_VERSION_KEY) !== RESPONSE_LENGTH_VERSION) {
    window.localStorage.setItem("responseLength", DEFAULT_RESPONSE_LENGTH.toString());
    window.localStorage.setItem(RESPONSE_LENGTH_VERSION_KEY, RESPONSE_LENGTH_VERSION);
    return DEFAULT_RESPONSE_LENGTH;
  }

  const normalized = sanitizeResponseLength(window.localStorage.getItem("responseLength"));
  window.localStorage.setItem("responseLength", normalized.toString());
  return normalized;
};

export const persistResponseLength = (value: string | number) => {
  if (!isBrowser()) {
    return DEFAULT_RESPONSE_LENGTH;
  }

  const normalized = sanitizeResponseLength(value);
  window.localStorage.setItem("responseLength", normalized.toString());
  window.localStorage.setItem(RESPONSE_LENGTH_VERSION_KEY, RESPONSE_LENGTH_VERSION);
  return normalized;
};
