import { IAIHandler, IAIProvider, IAIProvidersExecuteParams, IChunkHandler, IAIProvidersEmbedParams, IAIProvidersPluginSettings, ITokenUsage, ReportUsageCallback, IUsageMetrics } from '@obsidian-ai-providers/sdk';
import { electronFetch } from '../utils/electronFetch';
import OpenAI from 'openai';
import { obsidianFetch } from '../utils/obsidianFetch';
import { logger } from '../utils/logger';

export class OpenAIHandler implements IAIHandler {
    constructor(private settings: IAIProvidersPluginSettings) {}

    private getClient(provider: IAIProvider, fetch: typeof electronFetch | typeof obsidianFetch): OpenAI {
        return new OpenAI({
            apiKey: provider.apiKey,
            baseURL: provider.url,
            dangerouslyAllowBrowser: true,
            fetch
        });
    }

    async fetchModels(provider: IAIProvider): Promise<string[]> {
        const openai = this.getClient(provider, this.settings.useNativeFetch ? fetch : obsidianFetch);
        const response = await openai.models.list();
        
        return response.data.map(model => model.id);
    }

    async embed(params: IAIProvidersEmbedParams): Promise<number[][]> {
        const openai = this.getClient(params.provider, this.settings.useNativeFetch ? fetch : obsidianFetch);
        
        // Support for both input and text (for backward compatibility)
        // Using type assertion to bypass type checking
        const inputText = params.input ?? (params as any).text;
        
        if (!inputText) {
            throw new Error('Either input or text parameter must be provided');
        }
        
        const response = await openai.embeddings.create({
            model: params.provider.model || "",
            input: inputText
        });
        logger.debug('Embed response:', response);

        return response.data.map(item => item.embedding);
    }

    async execute(params: IAIProvidersExecuteParams, reportUsage?: ReportUsageCallback): Promise<IChunkHandler> {
        const controller = new AbortController();
        const openai = this.getClient(params.provider, this.settings.useNativeFetch ? fetch : electronFetch.bind({
            controller
        }));
        let isAborted = false;

        let messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
        
        if ('messages' in params && params.messages) {
            // Convert messages to OpenAI format
            messages = params.messages.map(msg => {
                // Handle simple text content
                if (typeof msg.content === 'string') {
                    return {
                        role: msg.role as any, // Type as any to avoid role compatibility issues
                        content: msg.content
                    };
                } 
                
                // Handle content blocks (text and images)
                const content: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [];
                
                // Process each content block
                msg.content.forEach(block => {
                    if (block.type === 'text') {
                        content.push({ type: 'text', text: block.text });
                    } else if (block.type === 'image_url') {
                        content.push({
                            type: 'image_url',
                            image_url: { url: block.image_url.url }
                        } as OpenAI.Chat.Completions.ChatCompletionContentPartImage);
                    }
                });
                
                return {
                    role: msg.role as any,
                    content
                };
            });
        } else if ('prompt' in params) {
            // Legacy prompt-based API
            if (params.systemPrompt) {
                messages.push({ role: 'system', content: params.systemPrompt });
            }
            
            // Handle prompt with images
            if (params.images?.length) {
                const content: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
                    { type: "text", text: params.prompt }
                ];
                
                // Add images as content parts
                params.images.forEach(image => {
                    content.push({
                        type: "image_url",
                        image_url: { url: image }
                    } as OpenAI.Chat.Completions.ChatCompletionContentPartImage);
                });
                
                messages.push({ role: 'user', content });
            } else {
                messages.push({ role: 'user', content: params.prompt });
            }
        } else {
            throw new Error('Either messages or prompt must be provided');
        }

        const handlers = {
            data: [] as ((chunk: string, accumulatedText: string) => void)[],
            end: [] as ((fullText: string) => void)[],
            error: [] as ((error: Error) => void)[]
        };

        (async () => {
            if (isAborted) return;
            
            const requestStartTime = Date.now();
            let lastChunkUsage: OpenAI.CompletionUsage | undefined;
            let firstTokenTime: number | undefined; // 记录首字时间
        
            try {
                const response = await openai.chat.completions.create({
                    model: params.provider.model || "",
                    messages,
                    stream: true,
                    ...params.options
                }, { signal: controller.signal });
    
                let fullText = '';

                for await (const chunk of response) {
                    if (isAborted) break;
                    const content = chunk.choices[0]?.delta?.content;
                    if (content) {
                        // 记录首字时间
                        if (!firstTokenTime && content.length > 0) {
                            firstTokenTime = Date.now();
                        }
                        fullText += content;
                        handlers.data.forEach(handler => handler(content, fullText));
                    }
                    if (chunk.usage) {
                        lastChunkUsage = chunk.usage;
                    }
                }
                if (!isAborted) {
                    handlers.end.forEach(handler => handler(fullText));
                    if (reportUsage && lastChunkUsage) {
                        const usage: ITokenUsage = {
                            promptTokens: lastChunkUsage.prompt_tokens,
                            completionTokens: lastChunkUsage.completion_tokens,
                            totalTokens: lastChunkUsage.total_tokens,
                        };
                        const durationMs = Date.now() - requestStartTime;
                        
                        // 创建完整的指标对象
                        const metrics: IUsageMetrics = {
                            usage,
                            durationMs,
                            firstTokenLatencyMs: firstTokenTime ? firstTokenTime - requestStartTime : undefined
                        };
                        
                        // 记录详细日志
                        logger.debug('OpenAI detailed stats:', {
                            prompt_tokens: lastChunkUsage.prompt_tokens,
                            completion_tokens: lastChunkUsage.completion_tokens,
                            total_tokens: lastChunkUsage.total_tokens,
                            duration_ms: durationMs,
                            firstTokenLatency: firstTokenTime ? firstTokenTime - requestStartTime : undefined
                        });
                        
                        // 将完整的指标对象传递给回调
                        reportUsage(metrics);
                    }
                }
            } catch (error) {
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
                logger.debug('Request aborted');
                isAborted = true;
                controller.abort();
            }
        };
    }
} 