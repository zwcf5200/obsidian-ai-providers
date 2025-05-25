import { IAIHandler, IAIProvider, IAIProvidersExecuteParams, IChunkHandler, IAIProvidersEmbedParams, IAIProvidersPluginSettings, ITokenUsage, ReportUsageCallback } from '@obsidian-ai-providers/sdk';
import { Ollama } from 'ollama';
import { electronFetch } from '../utils/electronFetch';
import { obsidianFetch } from '../utils/obsidianFetch';
import { logger } from '../utils/logger';

// Extend ChatResponse type
// Without this, we cannot reuse typing for extensions
interface ExtendedChatResponse {
    response: string;
    done: boolean;
    context?: number[];
    created_at?: string;
    message?: {
        content?: string;
    }
    total_tokens?: number;
    total_duration?: number;
    prompt_eval_count?: number;
    eval_count?: number;
}

// Add interface for model cache
interface ModelInfo {
    contextLength: number;
    lastContextLength: number;
}

const DEFAULT_CONTEXT_LENGTH = 2048;
const EMBEDDING_CONTEXT_LENGTH = 2048;
const SYMBOLS_PER_TOKEN = 2.5;
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
        
        // Support for both input and text (for backward compatibility)
        // Using type assertion to bypass type checking
        const inputText = params.input ?? (params as any).text;
        
        if (!inputText) {
            throw new Error('Either input or text parameter must be provided');
        }
        
        const modelInfo = await this.getCachedModelInfo(
            params.provider,
            params.provider.model || ""
        );
        logger.debug('Retrieved model info:', modelInfo);

        const maxInputLength = Array.isArray(inputText) 
            ? Math.max(...inputText.map(text => text.length))
            : inputText.length;
        
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
                input: inputText,
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

    async execute(params: IAIProvidersExecuteParams, reportUsage?: ReportUsageCallback): Promise<IChunkHandler> {
        logger.debug('Starting execute process with params:', {
            model: params.provider.model,
            messagesCount: params.messages?.length || 0,
            promptLength: params.prompt?.length || 0,
            systemPromptLength: params.systemPrompt?.length || 0,
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
        let response: any = null;
        
        const handlers = {
            data: [] as ((chunk: string, accumulatedText: string) => void)[],
            end: [] as ((fullText: string) => void)[],
            error: [] as ((error: Error) => void)[]
        };

        (async () => {
            if (isAborted) return;
            
            const requestStartTime = Date.now();
            let fullText = '';
            let finalOllamaStats: any; // To store the final stats object from Ollama

            try {
                const modelInfo = await this.getCachedModelInfo(
                    params.provider,
                    params.provider.model || ""
                ).catch(error => {
                    logger.error('Failed to get model info:', error);
                    return null;
                });
                
                logger.debug('Retrieved model info:', modelInfo);

                // Prepare messages in a standardized format
                const chatMessages: { role: string; content: string; images?: string[] }[] = [];
                const extractedImages: string[] = [];
                
                if ('messages' in params && params.messages) {
                    // Process messages with standardized handling for text and images
                    params.messages.forEach(msg => {
                        if (typeof msg.content === 'string') {
                            // Simple text content
                            chatMessages.push({
                                role: msg.role,
                                content: msg.content
                            });
                        } else {
                            // Extract text content from content blocks
                            const textContent = msg.content
                                .filter(block => block.type === 'text')
                                .map(block => block.type === 'text' ? block.text : '')
                                .join('\n');
                            
                            // Extract image URLs from content blocks
                            msg.content
                                .filter(block => block.type === 'image_url')
                                .forEach(block => {
                                    if (block.type === 'image_url' && block.image_url?.url) {
                                        extractedImages.push(block.image_url.url);
                                    }
                                });
                            
                            chatMessages.push({
                                role: msg.role,
                                content: textContent
                            });
                        }

                        // Add any images from the images property
                        if (msg.images?.length) {
                            extractedImages.push(...msg.images);
                        }
                    });
                } else if ('prompt' in params) {
                    // Handle legacy prompt-based API
                    if (params.systemPrompt) {
                        chatMessages.push({ role: 'system', content: params.systemPrompt });
                    }
                    
                    chatMessages.push({ role: 'user', content: params.prompt });
                    
                    // Add any images from params
                    if (params.images?.length) {
                        extractedImages.push(...params.images);
                    }
                } else {
                    throw new Error('Either messages or prompt must be provided');
                }

                // Process images for Ollama format (remove data URL prefix)
                const processedImages = extractedImages.length > 0 
                    ? extractedImages.map(image => image.replace(/^data:image\/(.*?);base64,/, ""))
                    : undefined;

                logger.debug('Processing request with images:', { imageCount: processedImages?.length || 0 });

                // Prepare request options
                const requestOptions: Record<string, any> = {};
                
                // Optimize context for text-based conversations
                if (!processedImages?.length) {
                    const inputLength = chatMessages.reduce((acc, msg) => acc + msg.content.length, 0);
                    
                    logger.debug('Calculating context for text input:', { inputLength });

                    const { num_ctx, shouldUpdate } = this.optimizeContext(
                        inputLength,
                        modelInfo?.lastContextLength || DEFAULT_CONTEXT_LENGTH,
                        DEFAULT_CONTEXT_LENGTH,
                        modelInfo?.contextLength || DEFAULT_CONTEXT_LENGTH
                    );

                    if (num_ctx) {
                        requestOptions.num_ctx = num_ctx;
                    }
                    
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

                // Add any additional options from params
                if (params.options) {
                    Object.assign(requestOptions, params.options);
                }

                // Add images to the last user message if present
                if (processedImages?.length) {
                    // Find the last user message in the chat
                    const lastUserMessageIndex = chatMessages.map(msg => msg.role).lastIndexOf('user');
                    
                    if (lastUserMessageIndex !== -1) {
                        // Add images to the last user message
                        chatMessages[lastUserMessageIndex] = {
                            ...chatMessages[lastUserMessageIndex],
                            images: processedImages
                        };
                        logger.debug('Added images to last user message at index:', lastUserMessageIndex);
                    } else if (chatMessages.length > 0) {
                        // If no user message, add to the last message regardless of role
                        chatMessages[chatMessages.length - 1] = {
                            ...chatMessages[chatMessages.length - 1],
                            images: processedImages
                        };
                        logger.debug('Added images to last message (non-user)');
                    } else {
                        // If no messages at all, create a user message with empty content
                        chatMessages.push({
                            role: 'user',
                            content: '',
                            images: processedImages
                        });
                        logger.debug('Created new user message with images');
                    }
                }

                logger.debug('Sending chat request to Ollama');
                
                // Using Ollama chat API instead of generate
                response = await ollama.chat({
                    model: params.provider.model || "",
                    messages: chatMessages,
                    stream: true,
                    options: Object.keys(requestOptions).length > 0 ? requestOptions : undefined
                } as any); // Type assertion for compatibility

                if (!response) {
                    throw new Error('No response from Ollama');
                }

                for await (const part of response) {
                    if (isAborted) {
                        logger.debug('Generation aborted');
                        break;
                    }
                    
                    // Store the part if it seems to be the final stats object
                    if (part.total_duration && part.prompt_eval_count !== undefined && part.eval_count !== undefined) {
                        finalOllamaStats = part;
                    }

                    // Extract content from message for chat API
                    const responseText = part.message?.content || '';
                    if (responseText) {
                        fullText += responseText;
                        handlers.data.forEach(handler => handler(responseText, fullText));
                    }
                }

                if (!isAborted) {
                    logger.debug('Generation completed successfully:', {
                        totalLength: fullText.length,
                        finalStats: finalOllamaStats 
                    });
                    handlers.end.forEach(handler => handler(fullText));

                    if (reportUsage && finalOllamaStats) {
                        try {
                            const usage: ITokenUsage = {
                                promptTokens: finalOllamaStats.prompt_eval_count,
                                completionTokens: finalOllamaStats.eval_count,
                                totalTokens: (finalOllamaStats.prompt_eval_count || 0) + (finalOllamaStats.eval_count || 0)
                            };
                            // Ollama's total_duration is in nanoseconds
                            const durationMs = finalOllamaStats.total_duration ? Math.round(finalOllamaStats.total_duration / 1_000_000) : (Date.now() - requestStartTime);
                            reportUsage(usage, durationMs);
                            logger.debug('Reported token usage:', { usage, durationMs });
                        } catch (statsError) {
                            logger.error('Error processing or reporting Ollama usage stats:', statsError, finalOllamaStats);
                        }
                    } else if (reportUsage) {
                        // Fallback if finalOllamaStats wasn't captured but reportUsage is expected
                        const durationMs = Date.now() - requestStartTime;
                        // We don't have token counts in this case
                        reportUsage({}, durationMs); 
                        logger.warn('Ollama final stats not available for usage reporting. Reporting duration only.');
                    }
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

    // 添加一个方法来获取模型能力
    async detectModelCapabilities(provider: IAIProvider, modelName: string): Promise<string[]> {
        logger.debug('Detecting Ollama model capabilities for:', modelName);
        
        const ollama = this.getClient(provider, this.settings.useNativeFetch ? fetch : obsidianFetch);
        try {
            const response = await ollama.show({ model: modelName });
            logger.debug('Ollama show response:', response);
            
            // 使用类型断言访问capabilities字段
            const anyResponse = response as any;
            
            // 直接从capabilities字段提取能力
            if (anyResponse.capabilities && Array.isArray(anyResponse.capabilities)) {
                logger.debug('Detected capabilities from Ollama:', anyResponse.capabilities);
                return anyResponse.capabilities;
            }
            
            // 如果没有明确的capabilities字段，尝试从其他信息推断
            const capabilities: string[] = [];
            
            // 检查架构类型来推断能力
            if (response.details?.family) {
                const family = response.details.family.toLowerCase();
                if (family.includes('bert') || family.includes('bge')) {
                    capabilities.push('embedding');
                }
                if (family.includes('llava') || family.includes('clip') || family.includes('vision')) {
                    capabilities.push('vision');
                }
            }
            
            // 从模型信息中搜索关键字
            if (response.template) {
                if (response.template.includes('vision') || response.template.includes('image')) {
                    capabilities.push('vision');
                }
                if (response.template.includes('embedding')) {
                    capabilities.push('embedding');
                }
            }
            
            // 从模型名称推断
            const modelNameLower = modelName.toLowerCase();
            if (modelNameLower.includes('vision') || 
                modelNameLower.includes('llava') || 
                modelNameLower.includes('clip') || 
                modelNameLower.includes('image')) {
                capabilities.push('vision');
            }
            if (modelNameLower.includes('embed') || 
                modelNameLower.includes('bge') || 
                modelNameLower.includes('bert')) {
                capabilities.push('embedding');
            }
            
            // 所有Ollama模型都支持对话能力
            capabilities.push('dialogue');
            
            // 去重
            return [...new Set(capabilities)];
        } catch (error) {
            logger.error('Failed to detect Ollama model capabilities:', error);
            // 默认返回对话能力
            return ['dialogue'];
        }
    }
} 
