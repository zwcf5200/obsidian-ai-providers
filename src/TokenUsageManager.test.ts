import { TokenUsageManager } from './TokenUsageManager';
import { IUsageMetrics } from '../packages/sdk/index';

describe('TokenUsageManager', () => {
    describe('lastRequestMetrics', () => {
        it('should record and retrieve last request metrics', () => {
            const manager = new TokenUsageManager();
            const providerId = 'test-provider';
            
            const metrics: IUsageMetrics = {
                usage: {
                    promptTokens: 10,
                    completionTokens: 20,
                    totalTokens: 30
                },
                durationMs: 1000,
                firstTokenLatencyMs: 200,
                promptEvalDurationMs: 300,
                evalDurationMs: 700
            };
            
            manager.recordLastRequestMetrics(providerId, metrics);
            
            const retrievedMetrics = manager.getLastRequestMetrics(providerId);
            expect(retrievedMetrics).toEqual(metrics);
        });
        
        it('should return null for unknown provider', () => {
            const manager = new TokenUsageManager();
            const retrievedMetrics = manager.getLastRequestMetrics('unknown-provider');
            expect(retrievedMetrics).toBeNull();
        });
        
        it('should reset metrics when requested', () => {
            const manager = new TokenUsageManager();
            const providerId = 'test-provider';
            
            const metrics: IUsageMetrics = {
                usage: {
                    promptTokens: 10,
                    completionTokens: 20,
                    totalTokens: 30
                },
                durationMs: 1000
            };
            
            manager.recordLastRequestMetrics(providerId, metrics);
            expect(manager.getLastRequestMetrics(providerId)).not.toBeNull();
            
            manager.resetStats();
            expect(manager.getLastRequestMetrics(providerId)).toBeNull();
        });
        
        it('should overwrite previous metrics for the same provider', () => {
            const manager = new TokenUsageManager();
            const providerId = 'test-provider';
            
            const metrics1: IUsageMetrics = {
                usage: {
                    promptTokens: 10,
                    completionTokens: 20,
                    totalTokens: 30
                },
                durationMs: 1000
            };
            
            const metrics2: IUsageMetrics = {
                usage: {
                    promptTokens: 50,
                    completionTokens: 60,
                    totalTokens: 110
                },
                durationMs: 2000
            };
            
            manager.recordLastRequestMetrics(providerId, metrics1);
            expect(manager.getLastRequestMetrics(providerId)).toEqual(metrics1);
            
            manager.recordLastRequestMetrics(providerId, metrics2);
            expect(manager.getLastRequestMetrics(providerId)).toEqual(metrics2);
        });
    });
});