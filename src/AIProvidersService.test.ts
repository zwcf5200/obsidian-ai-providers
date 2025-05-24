import { AIProvidersService } from './AIProvidersService';
import { TokenUsageManager } from './TokenUsageManager';
import { App } from 'obsidian';
import AIProvidersPlugin from './main'; // Assuming main.ts exports the plugin class
import { IAIProvider, IAIProvidersExecuteParams, AICapability, ITokenConsumptionStats, AIProviderType } from '@obsidian-ai-providers/sdk';

// Mock TokenUsageManager
jest.mock('./TokenUsageManager');

// Mock AIProvidersPlugin and App
// It's often easier to mock the entire module for external dependencies
jest.mock('./main', () => {
    return jest.fn().mockImplementation(() => {
        return {
            settings: {
                providers: [], // Default mock settings
                useNativeFetch: false,
                debugLogging: false,
            }
        };
    });
});

// Minimal App mock
const mockApp = {} as App;


describe('AIProvidersService', () => {
    let service: AIProvidersService;
    let mockTokenUsageManagerInstance: jest.Mocked<TokenUsageManager>;

    beforeEach(() => {
        // Create a new instance of the plugin mock for each test if needed
        const pluginMock = new (AIProvidersPlugin as any)(mockApp, {} as any) as jest.Mocked<AIProvidersPlugin>;
        
        // Reset and re-instantiate mocks for TokenUsageManager
        (TokenUsageManager as jest.Mock<TokenUsageManager>).mockClear();
        service = new AIProvidersService(mockApp, pluginMock);
        
        // Get the instance of TokenUsageManager created by AIProvidersService
        // This relies on TokenUsageManager being the first mock instance created.
        // A more robust way might involve a factory or direct injection if the class supported it.
        mockTokenUsageManagerInstance = (TokenUsageManager as jest.Mock<TokenUsageManager>).mock.instances[0] as jest.Mocked<TokenUsageManager>;
    });

    describe('Token Usage Methods', () => {
        it('getTokenConsumptionStats() should call tokenUsageManager.getStats and return its result', () => {
            const mockStats: ITokenConsumptionStats = {
                totalPromptTokens: 100,
                totalCompletionTokens: 200,
                totalTokensConsumed: 300,
                generationSpeed: 50,
            };
            mockTokenUsageManagerInstance.getStats.mockReturnValue(mockStats);

            const stats = service.getTokenConsumptionStats();

            expect(mockTokenUsageManagerInstance.getStats).toHaveBeenCalledTimes(1);
            expect(stats).toEqual(mockStats);
        });

        it('resetTokenConsumptionStats() should call tokenUsageManager.resetStats', () => {
            service.resetTokenConsumptionStats();
            expect(mockTokenUsageManagerInstance.resetStats).toHaveBeenCalledTimes(1);
        });
    });

    describe('detectCapabilities Method', () => {
        const baseProvider: IAIProvider = { id: 'test-provider', name: 'Test Provider', type: 'openai', model: 'test-model' };

        it('should detect dialogue when params.messages is non-empty', () => {
            const params: IAIProvidersExecuteParams = { provider: baseProvider, messages: [{ role: 'user', content: 'Hello' }] };
            const capabilities = service.detectCapabilities(params);
            expect(capabilities).toContain('dialogue');
        });

        it('should detect dialogue when params.prompt is a string', () => {
            const params: IAIProvidersExecuteParams = { provider: baseProvider, prompt: 'Hello there' };
            const capabilities = service.detectCapabilities(params);
            expect(capabilities).toContain('dialogue');
        });

        it('should not detect dialogue when no relevant params are present', () => {
            const params: IAIProvidersExecuteParams = { provider: baseProvider, messages: [] }; // Or prompt undefined
            const capabilities = service.detectCapabilities(params);
            expect(capabilities).not.toContain('dialogue');
        });
        
        it('should detect dialogue only once if both messages and prompt are present', () => {
            const params: IAIProvidersExecuteParams = { provider: baseProvider, messages: [{ role: 'user', content: 'Hi' }], prompt: 'Hello' };
            const capabilities = service.detectCapabilities(params);
            expect(capabilities.filter(c => c === 'dialogue').length).toBe(1);
            expect(capabilities).toContain('dialogue');
        });

        it('should detect vision when params.messages contains image_url', () => {
            const params: IAIProvidersExecuteParams = {
                provider: baseProvider,
                messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'test.jpg' } }] }],
            };
            const capabilities = service.detectCapabilities(params);
            expect(capabilities).toContain('vision');
        });

        it('should detect vision when params.images is non-empty (legacy)', () => {
            const params: IAIProvidersExecuteParams = { provider: baseProvider, prompt: "describe this", images: ['test.jpg'] };
            const capabilities = service.detectCapabilities(params);
            expect(capabilities).toContain('vision');
        });

        it('should not detect vision when no image indicators are present', () => {
            const params: IAIProvidersExecuteParams = { provider: baseProvider, messages: [{ role: 'user', content: 'Hello' }] };
            const capabilities = service.detectCapabilities(params);
            expect(capabilities).not.toContain('vision');
        });
        
        it('should detect vision only once if multiple image indicators are present', () => {
            const params: IAIProvidersExecuteParams = { 
                provider: baseProvider, 
                messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'test.jpg' } }] }],
                images: ['another.jpg'] 
            };
            const capabilities = service.detectCapabilities(params);
            expect(capabilities.filter(c => c === 'vision').length).toBe(1);
            expect(capabilities).toContain('vision');
        });

        it('should detect tool_use for openai provider when params.options.tools is present', () => {
            const params: IAIProvidersExecuteParams = {
                provider: { ...baseProvider, type: 'openai' },
                prompt: 'use a tool',
                options: { tools: [{ type: 'function', function: { name: 'get_weather' } }] },
            };
            const capabilities = service.detectCapabilities(params, 'openai');
            expect(capabilities).toContain('tool_use');
        });

        it('should detect tool_use for openrouter provider when params.options.tool_choice is present', () => {
            const params: IAIProvidersExecuteParams = {
                provider: { ...baseProvider, type: 'openrouter' },
                prompt: 'use a tool',
                options: { tool_choice: 'auto' },
            };
            const capabilities = service.detectCapabilities(params, 'openrouter');
            expect(capabilities).toContain('tool_use');
        });
        
        it('should detect tool_use for lmstudio provider with tools', () => {
            const params: IAIProvidersExecuteParams = {
                provider: { ...baseProvider, type: 'lmstudio' },
                prompt: 'use a tool',
                options: { tools: [{ type: 'function', function: { name: 'get_weather' } }] },
            };
            const capabilities = service.detectCapabilities(params, 'lmstudio');
            expect(capabilities).toContain('tool_use');
        });

        it('should detect tool_use for groq provider with tool_choice', () => {
            const params: IAIProvidersExecuteParams = {
                provider: { ...baseProvider, type: 'groq' },
                prompt: 'use a tool',
                options: { tool_choice: 'auto' },
            };
            const capabilities = service.detectCapabilities(params, 'groq');
            expect(capabilities).toContain('tool_use');
        });

        it('should not detect tool_use when no tool indicators are present for openai', () => {
            const params: IAIProvidersExecuteParams = { provider: { ...baseProvider, type: 'openai' }, prompt: 'Hello' };
            const capabilities = service.detectCapabilities(params, 'openai');
            expect(capabilities).not.toContain('tool_use');
        });

        it('should not detect tool_use for non-OpenAI-compatible provider type even with tool options', () => {
            const params: IAIProvidersExecuteParams = {
                provider: { ...baseProvider, type: 'ollama' }, // ollama is not in the openAICompatibleTypes list for tool_use
                prompt: 'use a tool',
                options: { tools: [{ type: 'function', function: { name: 'get_weather' } }] },
            };
            const capabilities = service.detectCapabilities(params, 'ollama');
            expect(capabilities).not.toContain('tool_use');
        });
        
        it('should detect tool_use if providerType param forces it, even if params.provider.type is different', () => {
            const params: IAIProvidersExecuteParams = {
                provider: { ...baseProvider, type: 'custom' }, 
                prompt: 'use a tool',
                options: { tools: [{ type: 'function', function: { name: 'get_weather' } }] },
            };
            const capabilities = service.detectCapabilities(params, 'openai'); // Force openai type
            expect(capabilities).toContain('tool_use');
        });


        it('should detect combination: dialogue + vision', () => {
            const params: IAIProvidersExecuteParams = {
                provider: baseProvider,
                messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'test.jpg' } }] }],
            };
            const capabilities = service.detectCapabilities(params);
            expect(capabilities).toEqual(expect.arrayContaining(['dialogue', 'vision']));
        });

        it('should detect combination: dialogue + tool_use (for openai)', () => {
            const params: IAIProvidersExecuteParams = {
                provider: { ...baseProvider, type: 'openai' },
                prompt: 'use a tool',
                options: { tools: [{ type: 'function', function: { name: 'get_weather' } }] },
            };
            const capabilities = service.detectCapabilities(params, 'openai');
            expect(capabilities).toEqual(expect.arrayContaining(['dialogue', 'tool_use']));
        });
        
        it('should return unique capabilities', () => {
            const params: IAIProvidersExecuteParams = {
                provider: baseProvider,
                messages: [{ role: 'user', content: 'Hello' }],
                prompt: 'Another hello' // Both imply dialogue
            };
            const capabilities = service.detectCapabilities(params);
            expect(capabilities.filter(c => c === 'dialogue').length).toBe(1);
        });
    });

    describe('getModelCapabilities Method', () => {
        // For these tests, we spy on detectCapabilities to isolate getModelCapabilities logic
        let detectCapabilitiesSpy: jest.SpyInstance;

        beforeEach(() => {
            detectCapabilitiesSpy = jest.spyOn(service, 'detectCapabilities');
        });

        afterEach(() => {
            detectCapabilitiesSpy.mockRestore();
        });

        it('should call detectCapabilities with a probe and provider type, and add embedding for openai', () => {
            const provider: IAIProvider = { id: 'p1', name: 'OpenAI-Test', type: 'openai', model: 'gpt-4' };
            detectCapabilitiesSpy.mockReturnValue(['dialogue', 'vision', 'tool_use']); // Mocked output

            const modelCaps = service.getModelCapabilities(provider);

            expect(detectCapabilitiesSpy).toHaveBeenCalledTimes(1);
            const probeParams = detectCapabilitiesSpy.mock.calls[0][0] as IAIProvidersExecuteParams;
            expect(probeParams.provider).toBe(provider);
            expect(probeParams.messages?.[0]?.content).toEqual(expect.arrayContaining([
                expect.objectContaining({ type: 'text' }),
                expect.objectContaining({ type: 'image_url' })
            ]));
            expect(probeParams.options?.tools).toBeDefined();
            expect(detectCapabilitiesSpy.mock.calls[0][1]).toBe('openai');
            
            expect(modelCaps).toEqual(expect.arrayContaining(['dialogue', 'vision', 'tool_use', 'embedding']));
            expect(modelCaps.filter(c => c === 'embedding').length).toBe(1); // Check uniqueness
        });

        it('should add embedding for ollama provider type', () => {
            const provider: IAIProvider = { id: 'p2', name: 'Ollama-Test', type: 'ollama', model: 'llama3' };
            detectCapabilitiesSpy.mockReturnValue(['dialogue']); // Ollama might not support tools/vision via probe

            const modelCaps = service.getModelCapabilities(provider);
            
            expect(detectCapabilitiesSpy).toHaveBeenCalledTimes(1);
            expect(detectCapabilitiesSpy.mock.calls[0][1]).toBe('ollama');
            expect(modelCaps).toEqual(expect.arrayContaining(['dialogue', 'embedding']));
        });
        
        it('should add embedding for gemini provider type', () => {
            const provider: IAIProvider = { id: 'p3', name: 'Gemini-Test', type: 'gemini', model: 'gemini-pro' };
            detectCapabilitiesSpy.mockReturnValue(['dialogue', 'vision']);

            const modelCaps = service.getModelCapabilities(provider);
            expect(modelCaps).toEqual(expect.arrayContaining(['dialogue', 'vision', 'embedding']));
        });
        
        it('should add embedding for lmstudio provider type', () => {
            const provider: IAIProvider = { id: 'p4', name: 'LMStudio-Test', type: 'lmstudio', model: 'some-model' };
            // lmstudio is openai compatible for tool_use in detectCapabilities
            detectCapabilitiesSpy.mockReturnValue(['dialogue', 'tool_use']); 

            const modelCaps = service.getModelCapabilities(provider);
            expect(modelCaps).toEqual(expect.arrayContaining(['dialogue', 'tool_use', 'embedding']));
        });

        it('should add embedding for groq provider type', () => {
            const provider: IAIProvider = { id: 'p5', name: 'Groq-Test', type: 'groq', model: 'mixtral' };
            // groq is openai compatible for tool_use in detectCapabilities
            detectCapabilitiesSpy.mockReturnValue(['dialogue', 'tool_use']); 

            const modelCaps = service.getModelCapabilities(provider);
            expect(modelCaps).toEqual(expect.arrayContaining(['dialogue', 'tool_use', 'embedding']));
        });
        
        it('should add embedding for openrouter provider type', () => {
            const provider: IAIProvider = { id: 'p6', name: 'OpenRouter-Test', type: 'openrouter', model: 'some/model' };
            detectCapabilitiesSpy.mockReturnValue(['dialogue', 'vision', 'tool_use']);

            const modelCaps = service.getModelCapabilities(provider);
            expect(modelCaps).toEqual(expect.arrayContaining(['dialogue', 'vision', 'tool_use', 'embedding']));
        });

        it('should not add embedding for a custom unknown provider type', () => {
            const provider: IAIProvider = { id: 'p7', name: 'Custom-Test', type: 'custom-type' as AIProviderType, model: 'custom-model' };
            detectCapabilitiesSpy.mockReturnValue(['dialogue']);

            const modelCaps = service.getModelCapabilities(provider);
            
            expect(detectCapabilitiesSpy).toHaveBeenCalledTimes(1);
            expect(modelCaps).toEqual(['dialogue']); // Should not contain 'embedding'
            expect(modelCaps).not.toContain('embedding');
        });

        it('should ensure capabilities are unique in the final output', () => {
            const provider: IAIProvider = { id: 'p1', name: 'OpenAI-Test', type: 'openai', model: 'gpt-4' };
            // Simulate detectCapabilities returning 'embedding' already (though it shouldn't)
            detectCapabilitiesSpy.mockReturnValue(['dialogue', 'embedding']); 

            const modelCaps = service.getModelCapabilities(provider);
            
            expect(modelCaps).toEqual(expect.arrayContaining(['dialogue', 'embedding']));
            expect(modelCaps.filter(c => c === 'embedding').length).toBe(1); // Still only one embedding
        });

        // End-to-end test example (without mocking detectCapabilities)
        describe('getModelCapabilities End-to-End', () => {
            beforeEach(() => {
                // Restore the original detectCapabilities for these e2e tests
                if (detectCapabilitiesSpy) detectCapabilitiesSpy.mockRestore();
            });
            
            it('should return dialogue, vision, tool_use, and embedding for a fully capable openai provider', () => {
                const provider: IAIProvider = { id: 'e2e-openai', name: 'E2E OpenAI', type: 'openai', model: 'gpt-4-vision-preview' };
                const modelCaps = service.getModelCapabilities(provider);

                expect(modelCaps).toContain('dialogue'); // From probe message
                expect(modelCaps).toContain('vision');   // From probe image_url
                expect(modelCaps).toContain('tool_use'); // From probe tools option
                expect(modelCaps).toContain('embedding'); // Added by getModelCapabilities
                expect(modelCaps.length).toBe(4); // Assuming no other capabilities detected by probe
            });

            it('should return only dialogue and embedding for a basic ollama provider (no vision/tools from probe)', () => {
                const provider: IAIProvider = { id: 'e2e-ollama', name: 'E2E Ollama', type: 'ollama', model: 'llama3' };
                const modelCaps = service.getModelCapabilities(provider);

                expect(modelCaps).toContain('dialogue');    // From probe message
                expect(modelCaps).not.toContain('vision');  // Ollama handler might not parse image_url from generic probe the same way
                                                         // or detectCapabilities logic for ollama doesn't trigger vision for the probe
                expect(modelCaps).not.toContain('tool_use');// Ollama is not in openAICompatibleTypes for tool_use
                expect(modelCaps).toContain('embedding');   // Added by getModelCapabilities
                
                // Expected: dialogue, embedding. The probe is generic.
                // detectCapabilities for 'ollama' type won't find 'vision' or 'tool_use' from the probe's structure.
                expect(modelCaps).toEqual(expect.arrayContaining(['dialogue', 'embedding']));
                const uniqueCaps = new Set(modelCaps);
                expect(uniqueCaps.size).toBe(2); 
            });
        });
    });
});
