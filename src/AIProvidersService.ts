import { App, Notice } from 'obsidian';
import { IAIProvider, IAIProvidersService, IAIProvidersExecuteParams, IChunkHandler, IAIProvidersEmbedParams, IAIHandler, AIProviderType, ITokenConsumptionStats, ReportUsageCallback, ITokenUsage, AICapability } from '@obsidian-ai-providers/sdk';
import { OpenAIHandler } from './handlers/OpenAIHandler';
import { OllamaHandler } from './handlers/OllamaHandler';
import { TokenUsageManager } from './TokenUsageManager';
import { I18n } from './i18n';
import AIProvidersPlugin from './main';
import { ConfirmationModal } from './modals/ConfirmationModal';

export class AIProvidersService implements IAIProvidersService {
    providers: IAIProvider[] = [];
    version = 1;
    private app: App;
    private plugin: AIProvidersPlugin;
    private handlers: Record<string, IAIHandler>;
    private tokenUsageManager: TokenUsageManager;

    constructor(app: App, plugin: AIProvidersPlugin) {
        this.plugin = plugin;
        this.providers = plugin.settings.providers || [];
        this.tokenUsageManager = new TokenUsageManager();
        this.app = app;
        this.handlers = {
            openai: new OpenAIHandler(plugin.settings),
            openrouter: new OpenAIHandler(plugin.settings),
            ollama: new OllamaHandler(plugin.settings),
            gemini: new OpenAIHandler(plugin.settings),
            lmstudio: new OpenAIHandler(plugin.settings),
            groq: new OpenAIHandler(plugin.settings),
        };
    }

    private getHandler(type: AIProviderType) {
        return this.handlers[type];
    }

    async embed(params: IAIProvidersEmbedParams): Promise<number[][]> {
        try {
            return await this.getHandler(params.provider.type).embed(params);
        } catch (error) {
            const message = error instanceof Error ? error.message : I18n.t('errors.failedToEmbed');
            new Notice(message);
            throw error;
        }
    }

    async fetchModels(provider: IAIProvider): Promise<string[]> {
        try {
            return await this.getHandler(provider.type).fetchModels(provider);
        } catch (error) {
            const message = error instanceof Error ? error.message : I18n.t('errors.failedToFetchModels');
            new Notice(message);
            throw error;
        }
    }

    async execute(params: IAIProvidersExecuteParams): Promise<IChunkHandler> {
        const startTime = Date.now(); // Kept for broader context if needed
        
        const reportUsageCallback: ReportUsageCallback = (usage: ITokenUsage, durationMs: number) => {
            // Note: The 'durationMs' from the handler is more accurate for the API call itself.
            // The 'startTime' in AIProviderService is for the whole execute operation.
            // We should use the durationMs reported by the handler.
            this.tokenUsageManager.recordUsage(usage, durationMs);
        };

        try {
            return await this.getHandler(params.provider.type).execute(params, reportUsageCallback);
        } catch (error) {
            const message = error instanceof Error ? error.message : I18n.t('errors.failedToExecuteRequest');
            new Notice(message);
            throw error;
        }
    }

    async migrateProvider(provider: IAIProvider): Promise<IAIProvider | false> {
        const fieldsToCompare = ['type', 'apiKey', 'url', 'model'] as const;
        this.plugin.settings.providers = this.plugin.settings.providers || [];
        
        const existingProvider = this.plugin.settings.providers.find((p: IAIProvider) => fieldsToCompare.every(field => p[field as keyof IAIProvider] === provider[field as keyof IAIProvider]));
        if (existingProvider) {
            return Promise.resolve(existingProvider);
        }

        return new Promise<IAIProvider | false>((resolve) => {
            new ConfirmationModal(
                this.app,
                `Migrate provider ${provider.name}?`,
                async () => {
                    this.plugin.settings.providers?.push(provider);
                    await this.plugin.saveSettings();
                    resolve(provider);
                },
                () => {
                    // When canceled, return false to indicate the migration was not performed
                    resolve(false);
                }
            ).open();
        });
    }

    // Allows not passing version with every method call
    checkCompatibility(requiredVersion: number) {
        if (requiredVersion > this.version) {
            new Notice(I18n.t('errors.pluginMustBeUpdatedFormatted'));
            throw new Error(I18n.t('errors.pluginMustBeUpdated'));
        }
    }

    getTokenConsumptionStats(): ITokenConsumptionStats {
        return this.tokenUsageManager.getStats();
    }

    resetTokenConsumptionStats(): void {
        this.tokenUsageManager.resetStats();
    }

    detectCapabilities(params: IAIProvidersExecuteParams, providerType?: AIProviderType): AICapability[] {
        const capabilities: Set<AICapability> = new Set();

        // Dialogue Detection
        if ((params.messages && Array.isArray(params.messages) && params.messages.length > 0) || 
            (params.prompt && typeof params.prompt === 'string')) {
            capabilities.add('dialogue');
        }

        // Vision Detection
        if (params.images && params.images.length > 0) {
            capabilities.add('vision');
        } else if (params.messages && Array.isArray(params.messages)) {
            for (const msg of params.messages) {
                if (Array.isArray(msg.content)) {
                    for (const part of msg.content) {
                        if (part.type === 'image_url') {
                            capabilities.add('vision');
                            break; // Found vision, no need to check further in this message
                        }
                    }
                }
                if (capabilities.has('vision')) {
                    break; // Found vision, no need to check further messages
                }
            }
        }

        // Tool Use Detection (Initial for OpenAI and compatible handlers)
        const openAICompatibleTypes: AIProviderType[] = ['openai', 'openrouter', 'lmstudio', 'groq'];
        const currentProviderType = providerType || params.provider.type;

        if (openAICompatibleTypes.includes(currentProviderType)) {
            if ((params.options?.tools && Array.isArray(params.options.tools) && params.options.tools.length > 0) ||
                params.options?.tool_choice) {
                capabilities.add('tool_use');
            }
        }
        
        // Text-to-Image Placeholder:
        // No direct detection from IAIProvidersExecuteParams yet.
        // Could be based on model name conventions or specific options in the future.

        // Embedding: Handled by embed() method, not typically part of execute() capabilities.

        return Array.from(capabilities);
    }

    getModelCapabilities(provider: IAIProvider): AICapability[] {
        const probeParams: IAIProvidersExecuteParams = {
            provider: provider,
            messages: [
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: 'Hello!' },
                        { type: 'image_url', image_url: { url: 'data:image/png;base64,dummy' } }
                    ]
                }
            ],
            options: {
                tools: [{ type: 'function', function: { name: 'dummy_tool', parameters: {} } }]
            }
        };

        const detected = this.detectCapabilities(probeParams, provider.type);
        const capabilities = new Set<AICapability>(detected);

        // Add embedding capability based on provider type
        // This is a simplified check; a more robust method would involve handler introspection
        if (['openai', 'openrouter', 'ollama', 'gemini', 'lmstudio', 'groq'].includes(provider.type)) {
            capabilities.add('embedding');
        }

        return Array.from(capabilities);
    }
} 
