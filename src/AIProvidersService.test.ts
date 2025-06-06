import { AIProvidersService } from './AIProvidersService';
import { App } from 'obsidian';
import AIProvidersPlugin from './main';
import { IAIProvider, IUsageMetrics } from '../packages/sdk/index';

describe('AIProvidersService', () => {
    let service: AIProvidersService;
    let mockApp: Partial<App>;
    let mockPlugin: Partial<AIProvidersPlugin>;

    beforeEach(() => {
        mockApp = {};
        mockPlugin = {
            settings: {
                providers: [],
                _version: 1,
                debugLogging: false
            }
        };

        service = new AIProvidersService(mockApp as App, mockPlugin as AIProvidersPlugin);
    });

    describe('execute', () => {
        it('should be defined', () => {
            expect(service.execute).toBeDefined();
        });

        it('should handle non-ollama providers by returning unsupported error in onEnd callback', async () => {
            const mockProvider: IAIProvider = {
                id: 'test-openai',
                name: 'Test OpenAI',
                type: 'openai',
                apiKey: 'test-key'
            };

            const mockChunkHandler = {
                onData: jest.fn(),
                onEnd: jest.fn(),
                onError: jest.fn(),
                abort: jest.fn()
            };

            // Mock the handler - ensure it doesn't call reportUsage
            const mockHandler = {
                execute: jest.fn().mockImplementation((params, reportUsage) => {
                    // Don't call reportUsage for non-ollama providers
                    return Promise.resolve(mockChunkHandler);
                })
            };
            (service as any).handlers.openai = mockHandler;

            let callbackError: Error | undefined;
            let callbackMetrics: IUsageMetrics | null = null;

            await service.execute({
                provider: mockProvider,
                prompt: 'test',
                onPerformanceData: (metrics, error) => {
                    callbackMetrics = metrics;
                    callbackError = error;
                }
            });

            // 模拟onEnd被调用（没有reportUsage调用）
            const onEndCallback = mockChunkHandler.onEnd.mock.calls[0][0];
            onEndCallback('test response');

            expect(callbackMetrics).toBeNull();
            expect(callbackError).toBeDefined();
            expect(callbackError?.message).toContain('not supported for provider type: openai');
        });

        it('should trigger performance callback immediately when reportUsage is called for ollama', async () => {
            const mockProvider: IAIProvider = {
                id: 'test-ollama',
                name: 'Test Ollama',
                type: 'ollama',
                url: 'http://localhost:11434'
            };

            const mockChunkHandler = {
                onData: jest.fn(),
                onEnd: jest.fn(),
                onError: jest.fn(),
                abort: jest.fn()
            };

            let reportUsageCallback: any;

            // Mock the handler to capture reportUsage callback
            const mockHandler = {
                execute: jest.fn().mockImplementation((params, reportUsage) => {
                    reportUsageCallback = reportUsage;
                    return Promise.resolve(mockChunkHandler);
                })
            };
            (service as any).handlers.ollama = mockHandler;

            let callbackError: Error | undefined;
            let callbackMetrics: IUsageMetrics | null = null;

            await service.execute({
                provider: mockProvider,
                prompt: 'test',
                onPerformanceData: (metrics, error) => {
                    callbackMetrics = metrics;
                    callbackError = error;
                }
            });

            // 模拟Ollama返回性能数据
            const mockOllamaMetrics: IUsageMetrics = {
                usage: {
                    totalTokens: 100,
                    promptTokens: 50,
                    completionTokens: 50
                },
                durationMs: 2000
            };

            // 调用reportUsage应该立即触发性能回调
            reportUsageCallback(mockOllamaMetrics);

                         expect(callbackError).toBeUndefined();
             expect(callbackMetrics).toBeDefined();
             expect(callbackMetrics).not.toBeNull();
             
             const metrics = callbackMetrics as unknown as IUsageMetrics;
             expect(metrics.usage.totalTokens).toBe(100);
             expect((metrics as any).providerId).toBe('test-ollama');
             expect((metrics as any).tokensPerSecond).toBe(50); // 100 tokens / 2 seconds

             // 现在调用onEnd不应该再次触发回调
             const onEndCallback = mockChunkHandler.onEnd.mock.calls[0][0];
             onEndCallback('test response');

             // 回调应该只被调用一次
             const finalMetrics = callbackMetrics as unknown as IUsageMetrics;
             expect(finalMetrics.usage.totalTokens).toBe(100); // 没有变化
        });
    });
});
