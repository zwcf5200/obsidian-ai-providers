import { AIProviderType } from '../../packages/sdk/index';

/**
 * 提供商类型的显示标签映射
 */
export const PROVIDER_TYPE_LABELS: Record<string, string> = {
    'openai': 'OpenAI',
    'ollama': 'Ollama',
    'openrouter': 'OpenRouter',
    'gemini': 'Google Gemini',
    'lmstudio': 'LM Studio',
    'groq': 'Groq',
    'custom': 'Custom'
};

/**
 * 提供商类型的默认URL映射
 */
export const DEFAULT_PROVIDER_URLS: Record<string, string> = {
    openai: "https://api.openai.com/v1",
    ollama: "http://localhost:11434",
    gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
    openrouter: "https://openrouter.ai/api/v1",
    lmstudio: "http://localhost:1234/v1",
    groq: "https://api.groq.com/openai/v1",
    custom: "",
};

/**
 * 获取提供商类型的显示标签
 */
export function getProviderTypeLabel(type: string): string {
    return PROVIDER_TYPE_LABELS[type] || type;
}

/**
 * 获取提供商类型的默认URL
 */
export function getDefaultProviderUrl(type: string): string {
    return DEFAULT_PROVIDER_URLS[type] || '';
}

/**
 * 检查URL是否为指定类型的默认URL
 */
export function isDefaultProviderUrl(type: string, url: string): boolean {
    return DEFAULT_PROVIDER_URLS[type] === url;
} 