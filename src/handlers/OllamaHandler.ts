import { IAIHandler, IAIProvider, IAIProvidersExecuteParams, IChunkHandler, IAIProvidersEmbedParams, IAIProvidersPluginSettings } from '@obsidian-ai-providers/sdk';
import { Ollama } from 'ollama';
import { electronFetch } from '../utils/electronFetch';
import { obsidianFetch } from '../utils/obsidianFetch';
import { logger } from '../utils/logger';

// Extend GenerateResponse type
interface ExtendedGenerateResponse {
    response?: string;
    total_tokens?: number;
}

// Add interface for model cache
interface ModelInfo {
    contextLength: number;
    lastContextLength: number;
}

const SYMBOLS_PER_TOKEN = 2.5;
const DEFAULT_CONTEXT_LENGTH = 2048;
const EMBEDDING_CONTEXT_LENGTH = 2048;
const CONTEXT_BUFFER_MULTIPLIER = 1.2; // 20% buffer

export class OllamaHandler implements IAIHandler {
    private modelInfoCache: Map<string, ModelInfo>;

    constructor(private settings: IAIProvidersPluginSettings) {
        this.modelInfoCache = new Map();
    }

    dispose() {
        this.modelInfoCache.clear();
    }

    private getClient(provider: IAIProvider, fetch: typeof electronFetch | typeof obsidianFetch): Ollama {
        return new Ollama({
            host: provider.url || '',
            fetch
        });
    }

    private getDefaultModelInfo(): ModelInfo {
        return {
            contextLength: 0,
            lastContextLength: DEFAULT_CONTEXT_LENGTH
        };
    }

    private async getCachedModelInfo(provider: IAIProvider, modelName: string): Promise<ModelInfo> {
        const cacheKey = `${provider.url}_${modelName}`;
        const cached = this.modelInfoCache.get(cacheKey);
        if (cached) {
            return cached;
        }

        const ollama = this.getClient(provider, this.settings.useNativeFetch ? fetch : obsidianFetch);
        try {
            const response = await ollama.show({ model: modelName });
            const modelInfo = this.getDefaultModelInfo();

            const contextLengthEntry = Object.entries(response.model_info).find(([key, value]) => 
                (key.endsWith('.context_length') || key === 'num_ctx') && 
                typeof value === 'number' && 
                value > 0
            );

            if (contextLengthEntry && typeof contextLengthEntry[1] === 'number') {
                modelInfo.contextLength = contextLengthEntry[1];
            }

            this.modelInfoCache.set(cacheKey, modelInfo);
            return modelInfo;
        } catch (error) {
            logger.error('Failed to fetch model info:', error);
            return this.getDefaultModelInfo();
        }
    }

    private setModelInfoLastContextLength(provider: IAIProvider, modelName: string, num_ctx: number | undefined) {
        const cacheKey = `${provider.url}_${modelName}`;
        const modelInfo = this.modelInfoCache.get(cacheKey);
        if (modelInfo) {
            this.modelInfoCache.set(cacheKey, {
                ...modelInfo,
                lastContextLength: num_ctx || modelInfo.lastContextLength
            });
        }
    }

    async fetchModels(provider: IAIProvider): Promise<string[]> {
        const ollama = this.getClient(provider, this.settings.useNativeFetch ? fetch : obsidianFetch);
        const models = await ollama.list();
        return models.models.map(model => model.name);
    }

    private optimizeContext(
        inputLength: number,
        lastContextLength: number,
        defaultContextLength: number,
        limit: number
    ): { num_ctx?: number, shouldUpdate: boolean } {
        const estimatedTokens = Math.ceil(inputLength / SYMBOLS_PER_TOKEN);
        
        // If current context is smaller than last used,
        // use the last known context size
        if (estimatedTokens <= lastContextLength) {
            return { 
                num_ctx: lastContextLength > defaultContextLength ? lastContextLength : undefined,
                shouldUpdate: false 
            };
        }

        // For large inputs, calculate new size with buffer
        const targetLength = Math.min(
            Math.ceil(
                Math.max(estimatedTokens, defaultContextLength) * CONTEXT_BUFFER_MULTIPLIER
            ),
            limit
        );

        // Update only if we need context larger than previous
        const shouldUpdate = targetLength > lastContextLength;
        return {
            num_ctx: targetLength,
            shouldUpdate
        };
    }

    async embed(params: IAIProvidersEmbedParams): Promise<number[][]> {
        logger.debug('Starting embed process with params:', {
            model: params.provider.model,
            inputLength: Array.isArray(params.input) ? params.input.length : 1
        });

        const ollama = this.getClient(
            params.provider, 
            this.settings.useNativeFetch ? fetch : obsidianFetch
        );
        
        const modelInfo = await this.getCachedModelInfo(
            params.provider,
            params.provider.model || ""
        );
        logger.debug('Retrieved model info:', modelInfo);

        const maxInputLength = Array.isArray(params.input) 
            ? Math.max(...params.input.map(text => text.length))
            : params.input.length;
        
        logger.debug('Max input length:', maxInputLength);

        const { num_ctx, shouldUpdate } = this.optimizeContext(
            maxInputLength,
            modelInfo.lastContextLength || EMBEDDING_CONTEXT_LENGTH,
            EMBEDDING_CONTEXT_LENGTH,
            modelInfo.contextLength
        );
        
        logger.debug('Optimized context:', { num_ctx, shouldUpdate });

        if (shouldUpdate) {
            logger.debug('Updating model info last context length:', num_ctx);
            this.setModelInfoLastContextLength(
                params.provider,
                params.provider.model || "",
                num_ctx
            );
        }

        try {
            logger.debug('Sending embed request to Ollama');
            const response = await ollama.embed({
                model: params.provider.model || "",
                input: params.input,
                options: { num_ctx }
            });

            if (!response?.embeddings) {
                throw new Error('No embeddings in response');
            }

            logger.debug('Successfully received embeddings:', {
                count: response.embeddings.length,
                dimensions: response.embeddings[0]?.length
            });

            return response.embeddings;
        } catch (error) {
            logger.error('Failed to get embeddings:', error);
            throw error;
        }
    }

    async execute(params: IAIProvidersExecuteParams): Promise<IChunkHandler> {
        logger.debug('Starting execute process with params:', {
            model: params.provider.model,
            promptLength: params.prompt.length,
            systemPromptLength: params.systemPrompt?.length,
            hasImages: !!params.images?.length
        });

        const controller = new AbortController();
        const ollama = this.getClient(
            params.provider, 
            this.settings.useNativeFetch ? fetch : electronFetch.bind({
                controller
            })
        );
        let isAborted = false;
        let response: AsyncIterable<ExtendedGenerateResponse> | null = null;
        
        const handlers = {
            data: [] as ((chunk: string, accumulatedText: string) => void)[],
            end: [] as ((fullText: string) => void)[],
            error: [] as ((error: Error) => void)[]
        };

        (async () => {
            if (isAborted) return;
            
            let fullText = '';

            try {
                const images = params.images?.map((image) => image.replace(/^data:image\/(.*?);base64,/, ""));
                logger.debug('Processing request with images:', { imageCount: images?.length });

                const modelInfo = await this.getCachedModelInfo(
                    params.provider,
                    params.provider.model || ""
                ).catch(error => {
                    logger.error('Failed to get model info:', error);
                    return null;
                });
                
                logger.debug('Retrieved model info:', modelInfo);

                const requestBody: Record<string, any> = {
                    model: params.provider.model || "",
                    system: params.systemPrompt,
                    prompt: params.prompt,
                    images,
                    stream: true,
                    options: {}
                };

                if (!images?.length) {
                    const inputLength = (params.systemPrompt?.length || 0) + params.prompt.length;
                    logger.debug('Calculating context for text input:', { inputLength });

                    const { num_ctx, shouldUpdate } = this.optimizeContext(
                        inputLength,
                        modelInfo?.lastContextLength || DEFAULT_CONTEXT_LENGTH,
                        DEFAULT_CONTEXT_LENGTH,
                        modelInfo?.contextLength || DEFAULT_CONTEXT_LENGTH
                    );

                    requestBody.options.num_ctx = num_ctx;
                    logger.debug('Optimized context:', { num_ctx, shouldUpdate });

                    if (shouldUpdate) {
                        this.setModelInfoLastContextLength(
                            params.provider,
                            params.provider.model || "",
                            num_ctx
                        );
                        logger.debug('Updated context length:', num_ctx);
                    }
                }

                logger.debug('Sending generate request to Ollama');
                response = await ollama.generate(requestBody as any);

                for await (const part of response) {
                    if (isAborted) {
                        logger.debug('Generation aborted');
                        break;
                    }
                    const responseText = part.response || '';
                    if (responseText) {
                        fullText += responseText;
                        handlers.data.forEach(handler => handler(responseText, fullText));
                    }
                }

                if (!isAborted) {
                    logger.debug('Generation completed successfully:', {
                        totalLength: fullText.length
                    });
                    handlers.end.forEach(handler => handler(fullText));
                }
            } catch (error) {
                logger.error('Generation failed:', error);
                handlers.error.forEach(handler => handler(error as Error));
            }
        })();
        
        return {
            onData(callback: (chunk: string, accumulatedText: string) => void) {
                handlers.data.push(callback);
            },
            onEnd(callback: (fullText: string) => void) {
                handlers.end.push(callback);
            },
            onError(callback: (error: Error) => void) {
                handlers.error.push(callback);
            },
            abort() {
                isAborted = true;
                controller.abort();
            }
        };
    }
} 
