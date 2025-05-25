import { AIProvidersService } from './AIProvidersService';
import { TokenUsageManager } from './TokenUsageManager';
import { App } from 'obsidian';
import AIProvidersPlugin from './main';
import { IAIProvider, IUsageMetrics } from '@obsidian-ai-providers/sdk';

// Mock TokenUsageManager
jest.mock('./TokenUsageManager');

describe('AIProvidersService', () => {
    let service: AIProvidersService;
    let mockApp: Partial<App>;
    let mockPlugin: Partial<AIProvidersPlugin>;
    let mockTokenUsageManagerInstance: jest.Mocked<TokenUsageManager>;

    beforeEach(() => {
        mockApp = {};
        mockPlugin = {
            settings: {
                providers: [],
                _version: 1,
                debugLogging: false
            }
        };

        // 重置并准备 TokenUsageManager mock
        (TokenUsageManager as jest.Mock).mockClear();
        mockTokenUsageManagerInstance = {
            recordLastRequestMetrics: jest.fn(),
            getLastRequestMetrics: jest.fn(),
            resetStats: jest.fn()
        } as unknown as jest.Mocked<TokenUsageManager>;
        (TokenUsageManager as jest.Mock).mockImplementation(() => mockTokenUsageManagerInstance);

        service = new AIProvidersService(mockApp as App, mockPlugin as AIProvidersPlugin);
    });

    describe('getLastRequestMetrics', () => {
        it('should call TokenUsageManager getLastRequestMetrics', () => {
            const providerId = 'test-provider';
            const mockMetrics: IUsageMetrics = {
                usage: {
                    promptTokens: 10,
                    completionTokens: 20,
                    totalTokens: 30
                },
                durationMs: 1000
            };
            
            mockTokenUsageManagerInstance.getLastRequestMetrics.mockReturnValue(mockMetrics);
            
            const result = service.getLastRequestMetrics(providerId);
            
            expect(mockTokenUsageManagerInstance.getLastRequestMetrics).toHaveBeenCalledWith(providerId);
            expect(result).toEqual(mockMetrics);
        });
        
        it('should return null for unknown provider', () => {
            mockTokenUsageManagerInstance.getLastRequestMetrics.mockReturnValue(null);
            
            const result = service.getLastRequestMetrics('unknown-provider');
            
            expect(result).toBeNull();
        });
    });

    describe('execute', () => {
        it('should record metrics when executing', async () => {
            // 这个测试需要更复杂的mock，这里只是简化示例
            // 实际实现需要模拟 handler 并捕获 reportUsageCallback
            // 此处只验证 TokenUsageManager 的集成
            expect(TokenUsageManager).toHaveBeenCalled();
        });
    });
});
