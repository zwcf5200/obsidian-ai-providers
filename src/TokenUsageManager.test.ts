import { TokenUsageManager } from './TokenUsageManager';
import { ITokenUsage } from '@obsidian-ai-providers/sdk';

describe('TokenUsageManager', () => {
    let manager: TokenUsageManager;

    beforeEach(() => {
        manager = new TokenUsageManager();
    });

    describe('Initialization', () => {
        it('should initialize with all stats at zero and empty requestRecords', () => {
            const stats = manager.getStats();
            expect(stats.totalPromptTokens).toBe(0);
            expect(stats.totalCompletionTokens).toBe(0);
            expect(stats.totalTokensConsumed).toBe(0);
            expect(stats.generationSpeed).toBeUndefined(); // Or 0, depending on initial state logic
            // @ts-expect-error Accessing private member for test
            expect(manager.requestRecords).toEqual([]);
        });
    });

    describe('recordUsage Method', () => {
        it('should correctly update stats and records with a single call', () => {
            const usage: ITokenUsage = { promptTokens: 10, completionTokens: 20, totalTokens: 30 };
            const durationMs = 1000;
            manager.recordUsage(usage, durationMs);

            const stats = manager.getStats();
            expect(stats.totalPromptTokens).toBe(10);
            expect(stats.totalCompletionTokens).toBe(20);
            expect(stats.totalTokensConsumed).toBe(30);
            // @ts-expect-error Accessing private member for test
            expect(manager.requestRecords).toEqual([{ durationMs: 1000, completionTokens: 20 }]);
        });

        it('should correctly accumulate stats and records with multiple calls', () => {
            manager.recordUsage({ promptTokens: 10, completionTokens: 20, totalTokens: 30 }, 1000);
            manager.recordUsage({ promptTokens: 5, completionTokens: 15, totalTokens: 20 }, 500);

            const stats = manager.getStats();
            expect(stats.totalPromptTokens).toBe(15);
            expect(stats.totalCompletionTokens).toBe(35);
            expect(stats.totalTokensConsumed).toBe(50);
            // @ts-expect-error Accessing private member for test
            expect(manager.requestRecords).toEqual([
                { durationMs: 1000, completionTokens: 20 },
                { durationMs: 500, completionTokens: 15 }
            ]);
        });
        
        it('should handle missing totalTokens by summing prompt and completion tokens', () => {
            manager.recordUsage({ promptTokens: 10, completionTokens: 20 }, 1000);
            const stats = manager.getStats();
            expect(stats.totalTokensConsumed).toBe(30);
        });

        it('should handle missing promptTokens gracefully', () => {
            manager.recordUsage({ completionTokens: 20, totalTokens: 20 }, 1000);
            const stats = manager.getStats();
            expect(stats.totalPromptTokens).toBe(0);
            expect(stats.totalCompletionTokens).toBe(20);
            expect(stats.totalTokensConsumed).toBe(20);
        });

        it('should handle missing completionTokens gracefully (no record for speed calc)', () => {
            manager.recordUsage({ promptTokens: 10, totalTokens: 10 }, 1000);
            const stats = manager.getStats();
            expect(stats.totalPromptTokens).toBe(10);
            expect(stats.totalCompletionTokens).toBe(0);
            expect(stats.totalTokensConsumed).toBe(10);
            // @ts-expect-error Accessing private member for test
            expect(manager.requestRecords).toEqual([]); // No completion tokens, no record for speed
        });
        
        it('should handle zero durationMs correctly', () => {
            manager.recordUsage({ promptTokens: 10, completionTokens: 20, totalTokens: 30 }, 0);
            const stats = manager.getStats();
            expect(stats.totalCompletionTokens).toBe(20);
            // @ts-expect-error Accessing private member for test
            expect(manager.requestRecords).toEqual([]); // durationMs is 0, no record for speed
        });
    });

    describe('getStats Method', () => {
        it('should return all zeros if no usage recorded', () => {
            const stats = manager.getStats();
            expect(stats.totalPromptTokens).toBe(0);
            expect(stats.totalCompletionTokens).toBe(0);
            expect(stats.totalTokensConsumed).toBe(0);
            expect(stats.generationSpeed).toBeUndefined(); // Or 0
        });

        it('should calculate stats correctly after one call', () => {
            manager.recordUsage({ promptTokens: 10, completionTokens: 20, totalTokens: 30 }, 1000);
            const stats = manager.getStats();
            expect(stats.totalPromptTokens).toBe(10);
            expect(stats.totalCompletionTokens).toBe(20);
            expect(stats.totalTokensConsumed).toBe(30);
            expect(stats.generationSpeed).toBe(20 / (1000 / 1000)); // 20 tokens/sec
        });

        it('should calculate stats correctly after multiple calls', () => {
            manager.recordUsage({ promptTokens: 10, completionTokens: 20, totalTokens: 30 }, 1000); // 20 t/s
            manager.recordUsage({ promptTokens: 5, completionTokens: 30, totalTokens: 35 }, 2000);  // 15 t/s
            const stats = manager.getStats();
            expect(stats.totalPromptTokens).toBe(15);
            expect(stats.totalCompletionTokens).toBe(50);
            expect(stats.totalTokensConsumed).toBe(65);
            // Total completion tokens = 20 + 30 = 50
            // Total duration = 1000ms + 2000ms = 3000ms = 3 seconds
            // Speed = 50 / 3 = 16.666...
            expect(stats.generationSpeed).toBeCloseTo(50 / 3);
        });

        it('should return generationSpeed as undefined if total durationMs is zero', () => {
            manager.recordUsage({ promptTokens: 10, completionTokens: 20, totalTokens: 30 }, 0);
            const stats = manager.getStats();
            expect(stats.generationSpeed).toBeUndefined();
        });
        
        it('should return generationSpeed as undefined if total durationMs is positive but completion tokens is zero', () => {
            manager.recordUsage({ promptTokens: 10, completionTokens: 0, totalTokens: 10 }, 1000);
            const stats = manager.getStats();
            expect(stats.generationSpeed).toBeUndefined();
        });

        it('should return generationSpeed as undefined if total completionTokens is zero', () => {
            manager.recordUsage({ promptTokens: 10, totalTokens: 10 }, 1000); // No completion tokens
            const stats = manager.getStats();
            expect(stats.generationSpeed).toBeUndefined();
        });
    });

    describe('resetStats Method', () => {
        it('should reset all stats to zero and clear requestRecords', () => {
            manager.recordUsage({ promptTokens: 10, completionTokens: 20, totalTokens: 30 }, 1000);
            manager.recordUsage({ promptTokens: 5, completionTokens: 15, totalTokens: 20 }, 500);

            let stats = manager.getStats();
            expect(stats.totalPromptTokens).not.toBe(0); // Ensure stats are populated

            manager.resetStats();

            stats = manager.getStats();
            expect(stats.totalPromptTokens).toBe(0);
            expect(stats.totalCompletionTokens).toBe(0);
            expect(stats.totalTokensConsumed).toBe(0);
            expect(stats.generationSpeed).toBeUndefined();
            // @ts-expect-error Accessing private member for test
            expect(manager.requestRecords).toEqual([]);
        });
    });
});
