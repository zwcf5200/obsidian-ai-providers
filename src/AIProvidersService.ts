import { App, Notice } from 'obsidian';
import { IAIProvider, IAIProvidersService, IAIProvidersExecuteParams, IChunkHandler, IAIProvidersEmbedParams, IAIHandler, AIProviderType, ReportUsageCallback, ITokenUsage, AICapability, IUsageMetrics, IPerformanceMetricsCallback, PerformanceMetricsException, PerformanceMetricsError } from '../packages/sdk/index';
import { OpenAIHandler } from './handlers/OpenAIHandler';
import { OllamaHandler } from './handlers/OllamaHandler';
import { I18n } from './i18n';
import AIProvidersPlugin from './main';
import { ConfirmationModal } from './modals/ConfirmationModal';
import { logger } from './utils/logger';

export class AIProvidersService implements IAIProvidersService {
    providers: IAIProvider[] = [];
    version = 1;
    private app: App;
    private plugin: AIProvidersPlugin;
    private handlers: Record<string, IAIHandler>;

    constructor(app: App, plugin: AIProvidersPlugin) {
        this.plugin = plugin;
        this.providers = plugin.settings.providers || [];
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
        const startTime = Date.now();
        const { onPerformanceData, callbacks, provider } = params;
        const performanceCallback = onPerformanceData || callbacks?.onPerformanceData;
        
        // 用于存储Ollama的性能数据
        let ollamaMetrics: IUsageMetrics | null = null;

        const reportUsageCallback: ReportUsageCallback = (metrics: IUsageMetrics) => {
            // 只有Ollama提供者才处理性能数据
            if (provider.type === 'ollama') {
                // 增强性能数据，添加额外信息
                ollamaMetrics = {
                    ...metrics,
                    tokensPerSecond: metrics.usage.totalTokens && metrics.durationMs ? 
                        metrics.usage.totalTokens / (metrics.durationMs / 1000) : undefined,
                    providerId: provider.id,
                    modelName: provider.model,
                };
                logger.debug('Ollama性能数据已准备:', ollamaMetrics);
            }
        };

        try {
            const chunkHandler = await this.getHandler(provider.type).execute(params, reportUsageCallback);
            
            // 包装原始的 onEnd 处理器来触发性能回调
            const originalOnEnd = chunkHandler.onEnd;
            chunkHandler.onEnd = (callback) => {
                originalOnEnd((fullText) => {
                    // 先调用用户的回调
                    callback(fullText);
                    
                    // 流式输出终止后，立即处理性能数据回调
                    this.handlePerformanceDataCallback(
                        provider,
                        ollamaMetrics,
                        startTime,
                        performanceCallback
                    );
                });
            };
            
            return chunkHandler;
        } catch (error) {
            // 请求失败时也触发性能回调
            if (performanceCallback) {
                performanceCallback(null, new PerformanceMetricsException(
                    PerformanceMetricsError.CALCULATION_FAILED,
                    `Request failed: ${error.message}`,
                    { originalError: error }
                ));
            }
            
            const message = error instanceof Error ? error.message : I18n.t('errors.failedToExecuteRequest');
            new Notice(message);
            throw error;
        }
    }

    // 处理性能数据回调 - 实现您的流程逻辑
    private handlePerformanceDataCallback(
        provider: IAIProvider,
        ollamaMetrics: IUsageMetrics | null,
        startTime: number,
        callback?: IPerformanceMetricsCallback
    ): void {
        if (!callback) return;
        
        // 1. 监听ai流式输出是否终止 ✅ (已经在onEnd中处理)
        // 2. 判断当前请求是否为ollama
        if (provider.type !== 'ollama') {
            // 3. 如果不是ollama，则直接返回未知/不支持
            callback(null, new PerformanceMetricsException(
                PerformanceMetricsError.PROVIDER_NOT_SUPPORTED,
                `Performance metrics not supported for provider type: ${provider.type}`,
                { providerId: provider.id, providerType: provider.type }
            ));
            return;
        }
        
        // 4. 如果是ollama，则解析性能数据（已经实现）
        if (ollamaMetrics) {
            // 计算最终的性能指标
            const finalMetrics: IUsageMetrics = {
                ...ollamaMetrics,
                // 确保时间数据的准确性
                durationMs: ollamaMetrics.durationMs || (Date.now() - startTime),
            };
            
            logger.debug('触发Ollama性能数据回调:', finalMetrics);
            callback(finalMetrics);
        } else {
            // Ollama但没有性能数据
            callback(null, new PerformanceMetricsException(
                PerformanceMetricsError.DATA_INCOMPLETE,
                `Ollama performance data not available`,
                { providerId: provider.id }
            ));
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
        // 优先使用用户自定义能力配置
        const userDefinedCapabilities = (provider as any).userDefinedCapabilities as AICapability[] | undefined;
        if (userDefinedCapabilities && userDefinedCapabilities.length > 0) {
            return [...userDefinedCapabilities];
        }

        // 对于Ollama类型提供商，使用专门的能力检测功能
        if (provider.type === 'ollama' && provider.model) {
            try {
                const ollamaHandler = this.handlers.ollama as OllamaHandler;
                if (ollamaHandler.detectModelCapabilities) {
                    // 异步调用，但这里返回的是同步结果，先不等待
                    // 调用方可以使用detectModelCapabilities获取实际检测结果
                    ollamaHandler.detectModelCapabilities(provider, provider.model)
                        .then((ollamaCapabilities) => {
                            logger.debug(`Ollama检测到${provider.model}的能力:`, ollamaCapabilities);
                        })
                        .catch((error) => {
                            logger.error('Ollama能力检测失败:', error);
                        });
                }
            } catch (error) {
                logger.error('使用Ollama能力检测时出错:', error);
            }
        }

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

    // 添加一个帮助方法，用于查看模型实际支持的能力
    async detectModelCapabilities(provider: IAIProvider): Promise<AICapability[]> {
        // 对于Ollama类型提供商，使用专门的能力检测功能
        if (provider.type === 'ollama' && provider.model) {
            try {
                const ollamaHandler = this.getHandler(provider.type) as OllamaHandler;
                if (ollamaHandler.detectModelCapabilities) {
                    const ollamaCapabilities = await ollamaHandler.detectModelCapabilities(provider, provider.model);
                    logger.debug(`Ollama检测到${provider.model}的能力:`, ollamaCapabilities);
                    
                    // 将Ollama能力映射到AICapability类型
                    const mappedCapabilities = new Set<AICapability>();
                    
                    ollamaCapabilities.forEach((cap: string) => {
                        const lowerCap = cap.toLowerCase();
                        if (lowerCap === 'embedding') mappedCapabilities.add('embedding');
                        if (lowerCap === 'vision' || lowerCap === 'image') mappedCapabilities.add('vision');
                        if (lowerCap === 'dialogue' || lowerCap === 'chat' || lowerCap === 'completion') mappedCapabilities.add('dialogue');
                        if (lowerCap === 'tool' || lowerCap === 'tools' || lowerCap === 'function' || lowerCap === 'functions') mappedCapabilities.add('tool_use');
                        if (lowerCap === 'image-to-text' || lowerCap === 'text-to-image') mappedCapabilities.add('text_to_image');
                    });
                    
                    return Array.from(mappedCapabilities);
                }
            } catch (error) {
                logger.error('使用Ollama能力检测时出错:', error);
            }
        }
        
        // 默认返回基本能力
        return this.getModelCapabilities(provider);
    }
} 
