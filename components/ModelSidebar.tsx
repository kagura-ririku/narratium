"use client";

import { useEffect, useState } from "react";
import "@/app/styles/fantasy-ui.css";
import { useLanguage } from "@/app/i18n";
import { trackButtonClick } from "@/utils/google-analytics";
import {
  ApiConfig,
  createEmptyApiConfig,
  DEFAULT_OPENAI_BASE_URL,
  getOpenAIModelsEndpoint,
  getActiveApiConfig,
  getStoredApiConfigs,
  normalizeBaseUrl,
  persistApiConfigState,
} from "@/utils/api-config";
import { invokeOpenAIResponses } from "@/utils/openai-responses";

interface ModelSidebarProps {
  isOpen: boolean;
  toggleSidebar: () => void;
}

const createConfigName = (model: string, configs: ApiConfig[], excludeId = "") => {
  const trimmedModel = model.trim() || "OpenAI";
  const baseName = trimmedModel.length > 18 ? trimmedModel.slice(0, 18) : trimmedModel;
  const similarConfigs = configs.filter((config) => config.id !== excludeId && config.name.includes(baseName));
  return similarConfigs.length === 0 ? baseName : `${baseName} ${similarConfigs.length + 1}`;
};

function ActiveSwitch({
  checked,
  onClick,
}: {
  checked: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className={`relative h-6 w-11 rounded-full border transition-all duration-200 ${
        checked
          ? "border-[#d1a35c] bg-[#3b3026] shadow-[0_0_10px_rgba(209,163,92,0.18)]"
          : "border-[#534741] bg-[#1f1f1f]"
      }`}
      aria-pressed={checked}
    >
      <span
        className={`absolute top-[2px] h-[18px] w-[18px] rounded-full transition-all duration-200 ${
          checked
            ? "left-[22px] bg-[#f0c97a] shadow-[0_0_10px_rgba(240,201,122,0.35)]"
            : "left-[2px] bg-[#8a8177]"
        }`}
      />
    </button>
  );
}

export default function ModelSidebar({ isOpen, toggleSidebar }: ModelSidebarProps) {
  const { t, fontClass, serifFontClass, language } = useLanguage();
  const sidebarWidthClass = "w-[calc(100vw-0.75rem)] max-w-[22rem] md:w-72 md:max-w-none";
  const [isMobile, setIsMobile] = useState(false);

  const [configs, setConfigs] = useState<ApiConfig[]>([]);
  const [activeConfigId, setActiveConfigId] = useState("");
  const [selectedConfigId, setSelectedConfigId] = useState("");
  const [draft, setDraft] = useState<ApiConfig>(createEmptyApiConfig());
  const [isCreating, setIsCreating] = useState(false);
  const [openaiModelList, setOpenaiModelList] = useState<string[]>([]);
  const [modelListEmpty, setModelListEmpty] = useState(false);

  const [saveSuccess, setSaveSuccess] = useState(false);
  const [getModelListSuccess, setGetModelListSuccess] = useState(false);
  const [getModelListError, setGetModelListError] = useState(false);
  const [testModelSuccess, setTestModelSuccess] = useState(false);
  const [testModelError, setTestModelError] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [formError, setFormError] = useState("");

  const showForm = isCreating || Boolean(selectedConfigId);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const syncViewport = () => {
      setIsMobile(window.innerWidth < 768);
    };

    syncViewport();
    window.addEventListener("resize", syncViewport);

    return () => window.removeEventListener("resize", syncViewport);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const storedConfigs = getStoredApiConfigs();
    const activeConfig = getActiveApiConfig(storedConfigs);
    const firstConfig = activeConfig || storedConfigs[0] || null;

    setConfigs(storedConfigs);
    setActiveConfigId(activeConfig?.id || "");
    setSelectedConfigId("");

    if (firstConfig) {
      setDraft(firstConfig);
    } else {
      setDraft(createEmptyApiConfig());
      setIsCreating(storedConfigs.length === 0);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) {
      setSelectedConfigId("");
      setIsCreating(false);
      setFormError("");
    }
  }, [isOpen]);

  const flashState = (setter: (value: boolean) => void) => {
    setter(true);
    window.setTimeout(() => setter(false), 2000);
  };

  const syncState = ({
    nextConfigs,
    nextActiveId,
    nextSelectedId,
    nextDraft,
    nextIsCreating = false,
  }: {
    nextConfigs: ApiConfig[];
    nextActiveId: string;
    nextSelectedId: string;
    nextDraft: ApiConfig;
    nextIsCreating?: boolean;
  }) => {
    setConfigs(nextConfigs);
    setActiveConfigId(nextActiveId);
    setSelectedConfigId(nextSelectedId);
    setDraft(nextDraft);
    setIsCreating(nextIsCreating);
    persistApiConfigState(nextConfigs, nextActiveId);
  };

  const loadConfigToForm = (config: ApiConfig) => {
    setDraft({
      ...config,
      baseUrl: normalizeBaseUrl(config.baseUrl),
      apiKey: config.apiKey || "",
    });
    setFormError("");
  };

  const collapseForm = () => {
    setSelectedConfigId("");
    setIsCreating(false);
    setFormError("");
  };

  const validateDraft = () => {
    if (!draft.baseUrl.trim() || !draft.model.trim() || !draft.apiKey.trim()) {
      setFormError(
        language === "zh"
          ? "请填写配置名称、Base URL、模型和 API Key。"
          : "Please fill in the configuration name, base URL, model, and API key.",
      );
      return false;
    }

    setFormError("");
    return true;
  };

  const handleCreateConfig = () => {
    const empty = createEmptyApiConfig();
    setDraft(empty);
    setSelectedConfigId("");
    setOpenaiModelList([]);
    setModelListEmpty(false);
    setFormError("");
    setIsCreating(true);
  };

  const handleCancelCreate = () => {
    const fallback = configs.find((config) => config.id === activeConfigId) || configs[0] || null;
    if (!fallback) {
      setDraft(createEmptyApiConfig());
      setSelectedConfigId("");
      setFormError("");
      setIsCreating(false);
      return;
    }

    setSelectedConfigId(fallback.id);
    loadConfigToForm(fallback);
    setIsCreating(false);
  };

  const handleSelectConfig = (id: string) => {
    const selected = configs.find((config) => config.id === id);
    if (!selected) {
      return;
    }

    if (selectedConfigId === id && !isCreating) {
      collapseForm();
      return;
    }

    setSelectedConfigId(id);
    loadConfigToForm(selected);
    setIsCreating(false);
  };

  const handleActivateConfig = (id: string) => {
    const selected = configs.find((config) => config.id === id);
    if (!selected) {
      return;
    }

    const nextActiveId = activeConfigId === id ? "" : id;
    setActiveConfigId(nextActiveId);
    persistApiConfigState(configs, nextActiveId);
    setSelectedConfigId(id);
    loadConfigToForm(selected);
    setIsCreating(false);
  };

  const handleDeleteConfig = (id: string) => {
    const nextConfigs = configs.filter((config) => config.id !== id);

    if (nextConfigs.length === 0) {
      setConfigs([]);
      setActiveConfigId("");
      setSelectedConfigId("");
      setDraft(createEmptyApiConfig());
      setIsCreating(false);
      persistApiConfigState([], "");
      return;
    }

    const fallback = nextConfigs[0];
    const nextActiveId = id === activeConfigId ? fallback.id : activeConfigId;
    const nextSelectedId = id === selectedConfigId ? fallback.id : selectedConfigId;
    const nextDraft = nextConfigs.find((config) => config.id === nextSelectedId) || fallback;

    syncState({
      nextConfigs,
      nextActiveId,
      nextSelectedId: nextDraft.id,
      nextDraft,
    });
  };

  const handleSave = () => {
    if (!validateDraft()) {
      return;
    }

    const normalizedConfig: ApiConfig = {
      ...draft,
      id: isCreating ? createEmptyApiConfig().id : draft.id,
      name: draft.name.trim() || createConfigName(draft.model, configs, draft.id),
      type: "openai",
      baseUrl: normalizeBaseUrl(draft.baseUrl),
      model: draft.model.trim(),
      apiKey: draft.apiKey.trim(),
    };

    const nextConfigs = isCreating
      ? [...configs, normalizedConfig]
      : configs.map((config) => (config.id === selectedConfigId ? normalizedConfig : config));

    const nextActiveId = isCreating
      ? normalizedConfig.id
      : (activeConfigId === selectedConfigId ? normalizedConfig.id : activeConfigId);

    syncState({
      nextConfigs,
      nextActiveId,
      nextSelectedId: normalizedConfig.id,
      nextDraft: normalizedConfig,
      nextIsCreating: false,
    });

    flashState(setSaveSuccess);
  };

  const handleGetModelList = async () => {
    const trimmedKey = draft.apiKey.trim();
    if (!trimmedKey) {
      setFormError(language === "zh" ? "请先填写 API Key。" : "Please enter an API key first.");
      flashState(setGetModelListError);
      return;
    }

    try {
      const response = await fetch(getOpenAIModelsEndpoint(draft.baseUrl), {
        headers: {
          Authorization: `Bearer ${trimmedKey}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch model list: ${response.status}`);
      }

      const data = await response.json();
      const modelList = Array.isArray(data.data)
        ? data.data
          .map((item: { id?: string }) => item.id?.trim() || "")
          .filter(Boolean)
        : [];

      setOpenaiModelList(modelList);
      setModelListEmpty(modelList.length === 0);
      setFormError("");
      flashState(setGetModelListSuccess);
    } catch (error) {
      console.error("Failed to fetch model list:", error);
      setOpenaiModelList([]);
      setModelListEmpty(true);
      flashState(setGetModelListError);
    }
  };

  const handleTestModel = async () => {
    if (!validateDraft()) {
      return;
    }

    setIsTesting(true);
    setTestModelSuccess(false);
    setTestModelError(false);

    try {
      await invokeOpenAIResponses({
        baseUrl: draft.baseUrl,
        apiKey: draft.apiKey,
        model: draft.model,
        systemMessage: "You are a connectivity test assistant.",
        userMessage: "Reply with a short confirmation that this configuration works.",
        temperature: 0.1,
      });

      setFormError("");
      flashState(setTestModelSuccess);
    } catch (error) {
      console.error("Model test failed:", error);
      setFormError(error instanceof Error ? error.message : "Model test failed.");
      flashState(setTestModelError);
    } finally {
      setIsTesting(false);
    }
  };

  const updateDraft = (patch: Partial<ApiConfig>) => {
    setDraft((current) => ({
      ...current,
      ...patch,
    }));
  };

  const outerClassName = isMobile
    ? `${sidebarWidthClass} fixed right-0 top-0 bottom-0 z-40 transition-transform duration-300 overflow-hidden ${
      isOpen ? "translate-x-0" : "translate-x-full pointer-events-none"
    }`
    : `h-full transition-all duration-300 overflow-hidden ${isOpen ? sidebarWidthClass : "w-0"}`;

  const innerClassName = isMobile
    ? "w-full h-full flex flex-col opacity-100"
    : `${sidebarWidthClass} h-full ${isOpen ? "opacity-100" : "opacity-0"} transition-opacity duration-300 flex flex-col`;

  return (
    <div
      style={
        isMobile
          ? {
            position: "fixed",
            right: 0,
            top: 0,
            bottom: 0,
            zIndex: 40,
          }
          : undefined
      }
      className={`${outerClassName} magic-border border-l border-[#534741] breathing-bg text-[#d0d0d0]`}
    >
      <div className={innerClassName}>
        <div className="flex justify-between items-center p-3 border-b border-[#534741] bg-gradient-to-r from-[#1a1a1a] to-[#2a2a2a]">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 flex items-center justify-center text-[#f4e8c1] bg-[#1c1c1c] rounded-lg border border-[#333333] shadow-inner">
              <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </div>
            <h1 className={`text-base magical-text ${serifFontClass}`}>{t("modelSettings.title")}</h1>
          </div>

          <button
            onClick={() => {
              trackButtonClick("ModelSidebar", "关闭模型设置");
              toggleSidebar();
            }}
            className="w-6 h-6 flex items-center justify-center text-[#f4e8c1] bg-[#1c1c1c] rounded-md border border-[#333333] shadow-inner transition-all duration-300 hover:bg-[#252525] hover:border-[#444444] hover:text-amber-400 hover:shadow-[0_0_8px_rgba(251,146,60,0.4)]"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto fantasy-scrollbar p-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] flex flex-col gap-4" onClick={collapseForm}>
          <div onClick={(event) => event.stopPropagation()}>
            <div className="flex justify-between items-center mb-2">
              <label className={`text-[#f4e8c1] text-xs font-medium ${fontClass}`}>
                {t("modelSettings.configurations") || "API Configurations"}
              </label>
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  trackButtonClick("ModelSidebar", "创建新配置");
                  handleCreateConfig();
                }}
                className="text-xs text-[#d1a35c] hover:text-[#f4e8c1] transition-all duration-200 px-2 py-1 rounded border border-[#534741] hover:border-[#d1a35c] hover:shadow-[0_0_6px_rgba(209,163,92,0.2)] flex items-center gap-1"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                {t("modelSettings.newConfig") || "New Config"}
              </button>
            </div>

            {configs.length > 0 ? (
              <div className="flex flex-col gap-2 max-h-52 overflow-y-auto fantasy-scrollbar pr-1">
                {configs.map((config) => {
                  const isActive = activeConfigId === config.id;
                  const isSelected = selectedConfigId === config.id && !isCreating;

                  return (
                    <div
                      key={config.id}
                      onClick={(event) => {
                        event.stopPropagation();
                        handleSelectConfig(config.id);
                      }}
                      className={`rounded-md border p-2 cursor-pointer transition-all duration-200 ${
                        isSelected
                          ? "bg-[#3f3831] border-[#d1a35c] shadow-[0_0_8px_rgba(209,163,92,0.15)]"
                          : "bg-[#292929] border-[#534741] hover:bg-[#302c28]"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-xs text-[#f4e8c1] truncate">{config.name}</div>
                          <div className="text-[11px] text-[#b8afa5] truncate mt-1">{config.model}</div>
                          <div className="text-[11px] text-[#8a8177] truncate mt-1">{normalizeBaseUrl(config.baseUrl)}</div>
                        </div>

                        <div className="flex items-center gap-2 flex-shrink-0">
                          <ActiveSwitch
                            checked={isActive}
                            onClick={() => handleActivateConfig(config.id)}
                          />
                          <button
                            onClick={(event) => {
                              event.stopPropagation();
                              trackButtonClick("ModelSidebar", "删除配置");
                              handleDeleteConfig(config.id);
                            }}
                            className="text-red-400 hover:text-red-300 text-xs p-1 rounded"
                          >
                            ×
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-xs text-[#8a8a8a] border border-dashed border-[#534741] rounded-md p-3 text-center">
                {t("modelSettings.noConfigs") || "No API configurations yet"}
              </div>
            )}
          </div>

          {showForm && (
            <div
              className="border border-[#534741] rounded-md p-3 bg-[#1c1c1c] bg-opacity-55 space-y-3"
              onClick={(event) => event.stopPropagation()}
            >
              <div>
                <label className={`block text-[#f4e8c1] text-xs font-medium mb-2 ${fontClass}`}>
                  {t("modelSettings.configName") || "Configuration Name"}
                </label>
                <input
                  type="text"
                  value={draft.name}
                  onChange={(event) => updateDraft({ name: event.target.value })}
                  placeholder={t("modelSettings.configNamePlaceholder") || "My API Configuration"}
                  className="w-full bg-[#2d2d2d] border border-[#4d433a] rounded-md py-2 px-3 text-sm text-[#f1ede5] focus:outline-none focus:border-[#d1a35c] transition-colors"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className={`block text-[#f4e8c1] text-xs font-medium ${fontClass}`}>
                    {t("modelSettings.baseUrl")}
                  </label>
                  <span className="text-[11px] text-[#8a8177]">/v1/responses</span>
                </div>
                <input
                  type="text"
                  value={draft.baseUrl}
                  onChange={(event) => updateDraft({ baseUrl: event.target.value })}
                  placeholder={DEFAULT_OPENAI_BASE_URL}
                  className="w-full bg-[#2d2d2d] border border-[#4d433a] rounded-md py-2 px-3 text-sm text-[#f1ede5] focus:outline-none focus:border-[#d1a35c] transition-colors"
                />
              </div>

              <div>
                <label className={`block text-[#f4e8c1] text-xs font-medium mb-2 ${fontClass}`}>
                  {t("modelSettings.apiKey") || "API Key"}
                </label>
                <input
                  type="password"
                  value={draft.apiKey}
                  onChange={(event) => updateDraft({ apiKey: event.target.value })}
                  placeholder="sk-..."
                  className="w-full bg-[#2d2d2d] border border-[#4d433a] rounded-md py-2 px-3 text-sm text-[#f1ede5] focus:outline-none focus:border-[#d1a35c] transition-colors"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <label className={`block text-[#f4e8c1] text-xs font-medium ${fontClass}`}>
                    {t("modelSettings.model")}
                  </label>
                  <button
                    onClick={handleGetModelList}
                    className={`text-xs text-[#d1a35c] hover:text-[#f4e8c1] transition-all duration-200 px-2 py-1 rounded border border-[#534741] hover:border-[#d1a35c] ${fontClass}`}
                  >
                    {t("modelSettings.getModelList") || "Get Model List"}
                  </button>
                </div>

                <input
                  type="text"
                  value={draft.model}
                  onChange={(event) => updateDraft({ model: event.target.value })}
                  placeholder="kimi-k2.5, gpt-4o-mini, gpt-5-mini..."
                  className="w-full bg-[#2d2d2d] border border-[#4d433a] rounded-md py-2 px-3 text-sm text-[#f1ede5] focus:outline-none focus:border-[#d1a35c] transition-colors"
                />

                {openaiModelList.length > 0 && (
                  <div className="rounded-md border border-[#4d433a] overflow-hidden bg-[#26221f]">
                    {openaiModelList.map((option) => (
                      <button
                        key={option}
                        type="button"
                        onClick={() => updateDraft({ model: option })}
                        className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                          draft.model === option
                            ? "bg-[#3f3831] text-[#f4e8c1]"
                            : "text-[#d0d0d0] hover:bg-[#312b26]"
                        }`}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                )}

                {modelListEmpty && (
                  <div className="text-[11px] text-[#8a8a8a]">
                    {t("modelSettings.modelListUnavailable") || "Model list unavailable"}
                  </div>
                )}
              </div>

              {formError && (
                <div className="text-[11px] text-red-300 bg-red-950/20 border border-red-900/30 rounded px-2 py-1.5">
                  {formError}
                </div>
              )}

              <div className="relative">
                <button
                  onClick={() => {
                    trackButtonClick("ModelSidebar", isCreating ? "创建配置" : "保存配置");
                    handleSave();
                  }}
                  className={`bg-[#3e3a3a] hover:bg-[#534741] text-[#f4e8c1] font-normal py-2 px-2 text-sm rounded-md border border-[#d1a35c] w-full transition-all duration-200 hover:shadow-[0_0_8px_rgba(209,163,92,0.2)] ${fontClass}`}
                >
                  {t("common.save") || "Save"}
                </button>

                {saveSuccess && (
                  <div className="absolute top-0 left-0 w-full h-full flex items-center justify-center bg-[#333333] bg-opacity-80 rounded">
                    <div className="flex items-center">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-green-500 mr-1.5" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                      <span className={`text-white text-xs ${fontClass}`}>
                        {t("modelSettings.settingsSaved") || "Settings Saved"}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              <div className="relative">
                <button
                  onClick={() => {
                    trackButtonClick("ModelSidebar", "测试模型");
                    handleTestModel();
                  }}
                  disabled={isTesting}
                  className={`bg-[#3e3a3a] hover:bg-[#534741] text-[#f4e8c1] font-normal py-2 px-2 text-sm rounded-md border border-[#d1a35c] w-full transition-all duration-200 hover:shadow-[0_0_8px_rgba(209,163,92,0.2)] ${fontClass} disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  {isTesting ? (t("modelSettings.testing") || "Testing...") : (t("modelSettings.testModel") || "Test Model")}
                </button>

                {testModelSuccess && (
                  <div className="absolute top-0 left-0 w-full h-full flex items-center justify-center bg-[#333333] bg-opacity-80 rounded">
                    <div className="flex items-center">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-green-500 mr-1.5" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                      <span className={`text-white text-xs ${fontClass}`}>
                        {t("modelSettings.testSuccess") || "Model test successful"}
                      </span>
                    </div>
                  </div>
                )}

                {testModelError && (
                  <div className="absolute top-0 left-0 w-full h-full flex items-center justify-center bg-[#333333] bg-opacity-80 rounded">
                    <div className="flex items-center">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-red-500 mr-1.5" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                      </svg>
                      <span className={`text-white text-xs ${fontClass}`}>
                        {t("modelSettings.testError") || "Model test failed"}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {isCreating && (
                <button
                  onClick={handleCancelCreate}
                  className={`w-full px-2 py-2 bg-[#292929] text-sm text-[#d0d0d0] rounded-md border border-[#534741] hover:bg-[#333333] transition-colors ${fontClass}`}
                >
                  {t("common.cancel") || "Cancel"}
                </button>
              )}
            </div>
          )}

          <div className="flex-1" />
        </div>
      </div>
    </div>
  );
}
