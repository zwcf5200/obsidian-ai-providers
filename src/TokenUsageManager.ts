import { IUsageMetrics } from "../packages/sdk/index";

export class TokenUsageManager {
    // 只保留最后一次请求指标的存储，按providerId索引
    private lastRequestMetrics: Record<string, IUsageMetrics> = {};

    constructor() {
        this.resetStats();
    }
    
    // 记录最后一次请求指标的方法
    recordLastRequestMetrics(providerId: string, metrics: IUsageMetrics): void {
        this.lastRequestMetrics[providerId] = metrics;
    }
    
    // 获取特定提供商最后一次请求的指标
    getLastRequestMetrics(providerId: string): IUsageMetrics | null {
        return this.lastRequestMetrics[providerId] || null;
    }

    resetStats(): void {
        this.lastRequestMetrics = {}; // 重置最后一次请求指标
    }
}
