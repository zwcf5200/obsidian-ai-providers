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

        it('should handle non-ollama providers by returning unsupported error in callback', async () => {
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

            // Mock the handler
            const mockHandler = {
                execute: jest.fn().mockResolvedValue(mockChunkHandler)
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

            // 模拟onEnd被调用
            const onEndCallback = mockChunkHandler.onEnd.mock.calls[0][0];
            onEndCallback('test response');

            expect(callbackMetrics).toBeNull();
            expect(callbackError).toBeDefined();
            expect(callbackError?.message).toContain('not supported for provider type: openai');
        });
    });
});
