import { ITokenUsage, ITokenConsumptionStats } from "@obsidian-ai-providers/sdk";

export class TokenUsageManager {
    private totalPromptTokens: number = 0;
    private totalCompletionTokens: number = 0;
    private totalTokensConsumed: number = 0;
    private requestRecords: { durationMs: number, completionTokens: number }[] = [];

    constructor() {
        this.resetStats();
    }

    recordUsage(usage: ITokenUsage, durationMs: number): void {
        if (usage.promptTokens) {
            this.totalPromptTokens += usage.promptTokens;
        }
        if (usage.completionTokens) {
            this.totalCompletionTokens += usage.completionTokens;
        }
        if (usage.totalTokens) {
            this.totalTokensConsumed += usage.totalTokens;
        } else if (usage.promptTokens && usage.completionTokens) {
            this.totalTokensConsumed += usage.promptTokens + usage.completionTokens;
        }

        if (usage.completionTokens && durationMs > 0) {
            this.requestRecords.push({ durationMs, completionTokens: usage.completionTokens });
        }
    }

    getStats(): ITokenConsumptionStats {
        let totalDurationMs = 0;
        let totalCompletionTokensFromRecords = 0;

        for (const record of this.requestRecords) {
            totalDurationMs += record.durationMs;
            totalCompletionTokensFromRecords += record.completionTokens;
        }

        const generationSpeed = totalDurationMs > 0 && totalCompletionTokensFromRecords > 0
            ? (totalCompletionTokensFromRecords / (totalDurationMs / 1000))
            : undefined;

        return {
            totalPromptTokens: this.totalPromptTokens,
            totalCompletionTokens: this.totalCompletionTokens,
            totalTokensConsumed: this.totalTokensConsumed,
            generationSpeed,
        };
    }

    resetStats(): void {
        this.totalPromptTokens = 0;
        this.totalCompletionTokens = 0;
        this.totalTokensConsumed = 0;
        this.requestRecords = [];
    }
}
