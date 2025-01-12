import { OllamaHandler } from './OllamaHandler';
import { IAIProvider } from '@obsidian-ai-providers/sdk';
import { createAIHandlerTests, IMockClient, IVerifyApiCallsParams } from '../../test-utils/createAIHandlerTests';

jest.mock('ollama');

const createHandler = () => new OllamaHandler({
    _version: 1,
    debugLogging: false,
    useNativeFetch: false
});

const createMockProvider = (): IAIProvider => ({
    id: 'test-provider',
    name: 'Test Provider',
    type: 'ollama',
    url: 'http://localhost:11434',
    apiKey: '',
    model: 'llama2'
});

interface IMockOllamaClient extends IMockClient {
    list: jest.Mock;
    generate: jest.Mock;
    show: jest.Mock;
    embed: jest.Mock;
}

const createMockClient = (): IMockOllamaClient => ({
    list: jest.fn().mockResolvedValue({
        models: [
            { name: 'model1' },
            { name: 'model2' }
        ]
    }),
    generate: jest.fn().mockImplementation(async ({ signal }) => {
        const stream = {
            async *[Symbol.asyncIterator]() {
                yield { response: 'test response' };
            }
        };
        return stream;
    }),
    show: jest.fn().mockResolvedValue({
        model_info: {
            'num_ctx': 4096
        }
    }),
    embed: jest.fn().mockResolvedValue({
        embeddings: [[0.1, 0.2, 0.3]]
    })
});

const verifyApiCalls = ({ mockClient, executeParams }: IVerifyApiCallsParams) => {
    expect(mockClient.generate).toHaveBeenCalledWith({
        model: executeParams.provider.model,
        system: executeParams.systemPrompt,
        prompt: executeParams.prompt,
        stream: true,
        images: undefined,
        options: expect.any(Object)
    });
};

createAIHandlerTests(
    'OllamaHandler',
    createHandler,
    createMockProvider,
    createMockClient,
    verifyApiCalls,
    {
        mockStreamResponse: {
            response: 'test response'
        }
    }
);

describe('OllamaHandler context optimizations', () => {
    let handler: OllamaHandler;
    let mockClient: IMockOllamaClient;
    let provider: IAIProvider;

    beforeEach(() => {
        jest.useFakeTimers();
        handler = createHandler();
        provider = createMockProvider();
        mockClient = createMockClient();
        mockClient.show.mockReset().mockResolvedValue({
            model_info: {
                'num_ctx': 4096
            }
        });
        mockClient.generate.mockImplementation(async ({ signal }) => {
            const stream = {
                async *[Symbol.asyncIterator]() {
                    yield { response: 'test response', total_tokens: 10 };
                }
            };
            return stream;
        });
        // Clear cache before each test
        (handler as any).clearModelInfoCache?.();
        // Reset Ollama clients
        (handler as any).ollamaClients = new Map();
    });

    afterEach(() => {
        jest.useRealTimers();
        jest.clearAllMocks();
    });

    describe('execute', () => {
        beforeEach(() => {
            // Mock getClient for all execute tests
            (handler as any).getClient = jest.fn().mockReturnValue(mockClient);
        });

        it('should optimize context for large requests', async () => {
            mockClient.show.mockResolvedValueOnce({
                model_info: {
                    'num_ctx': 4096
                }
            });
            
            // Using SYMBOLS_PER_TOKEN = 2.5, creating ~3200 tokens
            const longPrompt = 'a'.repeat(8000);
            
            const response = await handler.execute({
                provider,
                systemPrompt: '',
                prompt: longPrompt
            });

            await new Promise<void>((resolve) => {
                response.onEnd(() => resolve());
            });

            expect(mockClient.show).toHaveBeenCalledWith({ model: 'llama2' });
            const call = mockClient.generate.mock.calls[0][0];
            expect(call.options).toBeDefined();
            expect(call.options.num_ctx).toBeDefined();
            // With 20% buffer: ~3200 * 1.2 = ~3840 tokens
            expect(call.options.num_ctx).toBeGreaterThanOrEqual(3500);
            expect(call.options.num_ctx).toBeLessThanOrEqual(4096);
        });

        it('should not optimize context for image requests', async () => {
            const response = await handler.execute({
                provider,
                systemPrompt: '',
                prompt: 'a'.repeat(8000),
                images: ['base64image']
            });

            await new Promise<void>((resolve) => {
                response.onEnd(() => resolve());
            });

            expect(mockClient.generate).toHaveBeenCalled();
            const call = mockClient.generate.mock.calls[0][0];
            expect(call.options?.num_ctx).toBeUndefined();
        });

        it('should properly handle context size progression', async () => {
            const MODEL_LIMIT = 4096;
            mockClient.show.mockResolvedValue({
                model_info: {
                    'num_ctx': MODEL_LIMIT
                }
            });

            // Helper function to execute and wait for completion
            const executeAndWait = async (prompt: string) => {
                const response = await handler.execute({
                    provider,
                    systemPrompt: '',
                    prompt
                });
                await new Promise<void>((resolve) => {
                    response.onEnd(() => resolve());
                });
                return mockClient.generate.mock.calls[mockClient.generate.mock.calls.length - 1][0];
            };

            // 1. Small text (< 2048 tokens)
            const smallText = 'a'.repeat(1000); // ~400 tokens
            const call1 = await executeAndWait(smallText);
            expect(call1.options.num_ctx).toBeUndefined();

            // 2. Large text (> 2048 tokens)
            const largeText = 'a'.repeat(6000); // ~2400 tokens
            const call2 = await executeAndWait(largeText);
            const expectedCtx2 = Math.ceil(2400 * 1.2); // ~2880 with 20% buffer
            expect(call2.options.num_ctx).toBe(expectedCtx2);

            // 3. Same large text - should reuse previous context
            const call3 = await executeAndWait(largeText);
            expect(call3.options.num_ctx).toBe(expectedCtx2);

            // 4. Even larger text
            const largerText = 'a'.repeat(8000); // ~3200 tokens
            const call4 = await executeAndWait(largerText);
            const expectedCtx4 = Math.ceil(3200 * 1.2); // ~3840 with 20% buffer
            expect(call4.options.num_ctx).toBe(expectedCtx4);

            // 5. Text exceeding model limit
            const hugeText = 'a'.repeat(12000); // ~4800 tokens
            const call5 = await executeAndWait(hugeText);
            expect(call5.options.num_ctx).toBe(MODEL_LIMIT);

            // 6. Back to smaller text - should keep using model limit
            const mediumText = 'a'.repeat(4000); // ~1600 tokens
            const call6 = await executeAndWait(mediumText);
            expect(call6.options.num_ctx).toBe(MODEL_LIMIT);
        });
    });

    describe('embed', () => {
        beforeEach(() => {
            // Mock getClient for all embed tests
            (handler as any).getClient = jest.fn().mockReturnValue(mockClient);
        });

        it('should properly handle context size progression for embeddings', async () => {
            const MODEL_LIMIT = 4096;
            mockClient.show.mockResolvedValue({
                model_info: {
                    'num_ctx': MODEL_LIMIT
                }
            });

            // Helper function to embed and get the last call
            const embedAndGetCall = async (text: string) => {
                await handler.embed({
                    provider,
                    input: [text]
                });
                return mockClient.embed.mock.calls[mockClient.embed.mock.calls.length - 1][0];
            };

            // 1. Small text (< 2048 tokens)
            const smallText = 'a'.repeat(1000); // ~400 tokens
            const call1 = await embedAndGetCall(smallText);
            expect(call1.options.num_ctx).toBeUndefined();

            // 2. Large text (> 2048 tokens)
            const largeText = 'a'.repeat(6000); // ~2400 tokens
            const call2 = await embedAndGetCall(largeText);
            const expectedCtx2 = Math.ceil(2400 * 1.2); // ~2880 with 20% buffer
            expect(call2.options.num_ctx).toBe(expectedCtx2);

            // 3. Same large text - should reuse previous context
            const call3 = await embedAndGetCall(largeText);
            expect(call3.options.num_ctx).toBe(expectedCtx2);

            // 4. Even larger text
            const largerText = 'a'.repeat(8000); // ~3200 tokens
            const call4 = await embedAndGetCall(largerText);
            const expectedCtx4 = Math.ceil(3200 * 1.2); // ~3840 with 20% buffer
            expect(call4.options.num_ctx).toBe(expectedCtx4);

            // 5. Text exceeding model limit
            const hugeText = 'a'.repeat(12000); // ~4800 tokens
            const call5 = await embedAndGetCall(hugeText);
            expect(call5.options.num_ctx).toBe(MODEL_LIMIT);

            // 6. Back to smaller text - should keep using model limit
            const mediumText = 'a'.repeat(4000); // ~1600 tokens
            const call6 = await embedAndGetCall(mediumText);
            expect(call6.options.num_ctx).toBe(MODEL_LIMIT);
        });
    });

    describe('caching behavior', () => {
        beforeEach(() => {
            jest.setSystemTime(new Date('2024-01-01'));
            mockClient.show.mockResolvedValue({
                model_info: {
                    'num_ctx': 4096
                }
            });
            (handler as any).modelInfoCache = new Map();
        });

        it('should cache model info', async () => {
            // Mock getClient for this test only
            (handler as any).getClient = jest.fn().mockReturnValue(mockClient);

            // Two sequential requests to the same model
            await handler.execute({
                provider,
                systemPrompt: '',
                prompt: 'test'
            });

            await handler.execute({
                provider,
                systemPrompt: '',
                prompt: 'test2'
            });

            expect(mockClient.show).toHaveBeenCalledWith({ model: 'llama2' });
            expect(mockClient.show).toHaveBeenCalledTimes(1);
        });

        it('should limit cache size and remove oldest entries', async () => {
            // Mock getClient for this test only
            (handler as any).getClient = jest.fn().mockReturnValue(mockClient);

            // Create MAX_CACHE_SIZE + 1 different providers
            for (let i = 0; i < 101; i++) {
                const testProvider = {
                    ...provider,
                    url: `http://localhost:${i}`,
                    model: `model${i}`
                };

                await handler.execute({
                    provider: testProvider,
                    systemPrompt: '',
                    prompt: 'test'
                });
            }

            // Check that show was called for the last request
            expect(mockClient.show).toHaveBeenCalledWith({ model: 'model100' });
            
            // Request with the first provider again should call show
            const firstProvider = {
                ...provider,
                url: 'http://localhost:0',
                model: 'model0'
            };

            await handler.execute({
                provider: firstProvider,
                systemPrompt: '',
                prompt: 'test'
            });

            expect(mockClient.show).toHaveBeenCalledWith({ model: 'model0' });
        });
    });
}); 