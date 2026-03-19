import { importPresetFromJson } from "@/function/preset/import";
import { PresetOperations } from "@/lib/data/preset-operation";

interface GithubPreset {
  name: string;
  displayName: {
    zh: string;
    en: string;
  };
  description: {
    zh: string;
    en: string;
  };
  filename: string;
}

const GITHUB_API_URL = "https://api.github.com/repos/Narratium/Preset/contents";
const GITHUB_REPO_URL = "https://raw.githubusercontent.com/Narratium/Preset/main";

const AVAILABLE_PRESETS: GithubPreset[] = [
  {
    name: "belle_cat",
    displayName: {
      zh: "贝露喵提示词",
      en: "Belle Cat Prompt",
    },
    description: {
      zh: "表演家——超强人物演绎",
      en: "Performer - Exceptional Character Portrayal",
    },
    filename: "贝露喵预设.json",
  },
];

export function getAvailableGithubPresets(): GithubPreset[] {
  return AVAILABLE_PRESETS;
}

export function getPresetDisplayName(presetName: string, language: "zh" | "en" = "zh"): string {
  const preset = AVAILABLE_PRESETS.find(p => p.name === presetName);
  if (!preset) return presetName;
  return preset.displayName[language] || preset.displayName.zh || preset.name;
}

export function getPresetDescription(presetName: string, language: "zh" | "en" = "zh"): string {
  const preset = AVAILABLE_PRESETS.find(p => p.name === presetName);
  if (!preset) return "";
  return preset.description[language] || preset.description.zh || "";
}

export async function isPresetDownloaded(presetName: string): Promise<boolean> {
  try {
    const downloadedPresets = localStorage.getItem("downloaded_github_presets");
    let isMarkedAsDownloaded = false;
    
    if (downloadedPresets) {
      const presets = JSON.parse(downloadedPresets);
      isMarkedAsDownloaded = presets.includes(presetName);
    }
    
    if (isMarkedAsDownloaded) {
      const exists = await doesPresetExist(presetName);
      return exists;
    }
    
    return false;
  } catch (error) {
    console.error("Error checking if preset is downloaded:", error);
    return false;
  }
}

export async function doesPresetExist(presetName: string): Promise<boolean> {
  try {
    const allPresets = await PresetOperations.getAllPresets();
    
    const presetConfig = AVAILABLE_PRESETS.find(p => p.name === presetName);
    if (!presetConfig) return false;

    return allPresets.some(preset => 
      preset.name === presetConfig.displayName.zh || 
      preset.name === presetConfig.displayName.en ||
      preset.name.includes(presetConfig.displayName.zh) ||
      preset.name.includes(presetConfig.displayName.en),
    );
  } catch (error) {
    console.error("Error checking if preset exists:", error);
    return false;
  }
}

export async function downloadPresetFromGithub(presetName: string, language: "zh" | "en" = "zh"): Promise<{ success: boolean; message?: string; presetId?: string }> {
  try {
    const preset = AVAILABLE_PRESETS.find(p => p.name === presetName);
    if (!preset) {
      return { success: false, message: "Preset not found" };
    }

    try {
      const apiResponse = await fetch(GITHUB_API_URL);
      if (apiResponse.ok) {
        const files = await apiResponse.json();
        if (Array.isArray(files)) {
          const matchingFile = files.find((file: any) =>
            file.name === preset.filename ||
            file.name.toLowerCase() === preset.filename.toLowerCase(),
          );
          
          if (matchingFile && matchingFile.download_url) {
            const response = await fetch(matchingFile.download_url);
            if (!response.ok) {
              return { success: false, message: `Failed to download preset: ${response.statusText}` };
            }
            
            const jsonContent = await response.text();
            const localizedName = getPresetDisplayName(presetName, language);
            const result = await importPresetFromJson(jsonContent, localizedName);
            
            if (result.success && result.presetId) {
              markPresetAsDownloaded(presetName);
              return { success: true, presetId: result.presetId };
            } else {
              return { success: false, message: result.error || "Failed to import preset" };
            }
          }
        }
      }
    } catch (apiError) {
      console.error("Failed to fetch file list from GitHub API:", apiError);
    }

    const encodedFilename = encodeURIComponent(preset.filename);
    const fileUrl = `${GITHUB_REPO_URL}/${encodedFilename}`;
    const response = await fetch(fileUrl);
    
    if (!response.ok) {
      return { success: false, message: `Failed to download preset: ${response.statusText}` };
    }
    
    const jsonContent = await response.text();
    const localizedName = getPresetDisplayName(presetName, language);
    const result = await importPresetFromJson(jsonContent, localizedName);
    
    if (result.success && result.presetId) {
      markPresetAsDownloaded(presetName);
      return { success: true, presetId: result.presetId };
    } else {
      return { success: false, message: result.error || "Failed to import preset" };
    }
  } catch (error) {
    console.error("Error downloading preset from Github:", error);
    return { success: false, message: `Error downloading preset: ${error instanceof Error ? error.message : String(error)}` };
  }
}

function markPresetAsDownloaded(presetName: string): void {
  try {
    const downloadedPresets = localStorage.getItem("downloaded_github_presets");
    let presets: string[] = [];
    
    if (downloadedPresets) {
      presets = JSON.parse(downloadedPresets);
    }
    
    if (!presets.includes(presetName)) {
      presets.push(presetName);
      localStorage.setItem("downloaded_github_presets", JSON.stringify(presets));
    }
  } catch (error) {
    console.error("Error marking preset as downloaded:", error);
  }
}
