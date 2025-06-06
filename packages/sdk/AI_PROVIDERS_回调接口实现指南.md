# AI Providers SDK 性能数据回调功能实现指南

## 📋 概述

本文档详细说明了如何在 AI Providers 插件中实现新的性能数据回调功能，解决现有异步竞争问题并提供更优雅的性能数据获取方式。

## 🎯 功能特性

### 已实现的类型定义

#### 1. 性能数据回调接口
```typescript
export interface IPerformanceMetricsCallback {
    (metrics: IUsageMetrics | null, error?: Error): void;
}
```

#### 2. 请求回调配置
```typescript
export interface IRequestCallbacks {
    onPerformanceData?: IPerformanceMetricsCallback;
    onProgress?: (progress: number) => void;
    onError?: (error: Error) => void;
}
```

#### 3. 扩展的执行参数
```typescript
export interface IAIProvidersExecuteParamsBase {
    provider: IAIProvider;
    images?: string[];
    options?: { /* ... */ };
    
    // 新增：回调配置
    callbacks?: IRequestCallbacks;
    // 新增：直接的性能数据回调（便捷方式）
    onPerformanceData?: IPerformanceMetricsCallback;
}
```

#### 4. 增强的性能指标
```typescript
export interface IUsageMetrics {
    usage: ITokenUsage;
    durationMs: number;
    firstTokenLatencyMs?: number;
    promptEvalDurationMs?: number;
    evalDurationMs?: number;
    loadDurationMs?: number;
    tokensPerSecond?: number;        // 新增：计算的速度指标
    providerId?: string;             // 新增：提供者标识
    modelName?: string;              // 新增：模型名称
}
```

#### 5. 错误处理类型
```typescript
export enum PerformanceMetricsError {
    CALCULATION_FAILED = 'CALCULATION_FAILED',
    PROVIDER_NOT_SUPPORTED = 'PROVIDER_NOT_SUPPORTED',
    DATA_INCOMPLETE = 'DATA_INCOMPLETE',
    TIMEOUT = 'TIMEOUT'
}

export class PerformanceMetricsException extends Error {
    constructor(
        public code: PerformanceMetricsError,
        message: string,
        public details?: any
    ) {
        super(message);
        this.name = 'PerformanceMetricsException';
    }
}
```

#### 6. 扩展的服务接口
```typescript
export interface IAIProvidersService {
    // ... 现有方法 ...
    

}
```

## 🔧 实现指南

### 第一阶段：基础回调实现

#### 1. 修改 execute 方法签名

在 AI Providers 插件的核心服务中，需要修改 `execute` 方法来处理新的回调参数：

```typescript
// packages/ai-providers/src/AIProvidersService.ts

class AIProvidersService implements IAIProvidersService {
    async execute(params: IAIProvidersExecuteParams): Promise<IChunkHandler> {
        const startTime = Date.now();
        const { provider, onPerformanceData, callbacks } = params;
        
        try {
            // 执行现有的 AI 请求逻辑
            const chunkHandler = await this.performRequest(params);
            
            // 包装原始的 onEnd 处理器来触发性能回调
            const originalOnEnd = chunkHandler.onEnd;
            chunkHandler.onEnd = (callback) => {
                originalOnEnd((fullText) => {
                    // 先调用用户的回调
                    callback(fullText);
                    
                    // 异步计算和触发性能数据回调
                    this.calculateAndNotifyPerformanceMetrics(
                        params,
                        startTime,
                        fullText,
                        onPerformanceData || callbacks?.onPerformanceData
                    );
                });
            };
            
            return chunkHandler;
            
        } catch (error) {
            // 请求失败时也触发性能回调
            const performanceCallback = onPerformanceData || callbacks?.onPerformanceData;
            if (performanceCallback) {
                performanceCallback(null, new PerformanceMetricsException(
                    PerformanceMetricsError.CALCULATION_FAILED,
                    `Request failed: ${error.message}`,
                    { originalError: error }
                ));
            }
            throw error;
        }
    }
    
    private async calculateAndNotifyPerformanceMetrics(
        params: IAIProvidersExecuteParams,
        startTime: number,
        fullText: string,
        callback?: IPerformanceMetricsCallback
    ): Promise<void> {
        if (!callback) return;
        
        try {
            const metrics = await this.calculatePerformanceMetrics(params, startTime, fullText);
            callback(metrics);
        } catch (error) {
            callback(null, new PerformanceMetricsException(
                PerformanceMetricsError.CALCULATION_FAILED,
                `Failed to calculate performance metrics: ${error.message}`,
                { originalError: error }
            ));
        }
    }
    
    private async calculatePerformanceMetrics(
        params: IAIProvidersExecuteParams,
        startTime: number,
        fullText: string
    ): Promise<IUsageMetrics> {
        const endTime = Date.now();
        const durationMs = endTime - startTime;
        
        // 获取基础的 usage 数据（现有逻辑）
        const baseMetrics = this.getLastRequestMetrics(params.provider.id);
        
        if (!baseMetrics) {
            throw new Error('Base metrics not available');
        }
        
        // 计算增强指标
        const tokensPerSecond = baseMetrics.usage.totalTokens && durationMs > 0 ? 
            (baseMetrics.usage.totalTokens / (durationMs / 1000)) : undefined;
        
        return {
            ...baseMetrics,
            durationMs,
            tokensPerSecond,
            providerId: params.provider.id,
            modelName: params.provider.model,
        };
    }
}
```



## 📚 使用示例

### 1. 基本回调使用
```typescript
const chunkHandler = await aiProviders.execute({
    provider: selectedProvider,
    prompt: "Hello, world!",
    onPerformanceData: (metrics, error) => {
        if (error) {
            console.error('性能数据获取失败:', error);
            showErrorNotification('性能数据不可用');
        } else if (metrics) {
            console.log('性能数据就绪:', metrics);
            updatePerformanceDisplay(metrics);
        }
    }
});
```

### 2. 使用回调配置对象
```typescript
const chunkHandler = await aiProviders.execute({
    provider: selectedProvider,
    prompt: "Hello, world!",
    callbacks: {
        onPerformanceData: (metrics, error) => {
            handlePerformanceData(metrics, error);
        },
        onProgress: (progress) => {
            updateProgressBar(progress);
        },
        onError: (error) => {
            handleRequestError(error);
        }
    }
});
```



## 🚀 推出时间表

### Phase 1: 核心实现 (1-2周)
- [ ] 实现基本的回调接口
- [ ] 支持 `onPerformanceData` 回调
- [ ] 基本错误处理

### Phase 2: 提供者集成 (2-3周)
- [ ] Ollama 提供者集成
- [ ] OpenAI 提供者集成
- [ ] Gemini 提供者集成


### Phase 3: 优化和测试 (1-2周)
- [ ] 性能优化和内存管理
- [ ] 完整的测试覆盖
- [ ] 文档和示例更新

## 💡 实现注意事项

1. **向后兼容性**：确保现有的 `getLastRequestMetrics()` API 继续工作
2. **内存管理**：及时清理回调监听器，避免内存泄漏
3. **错误处理**：提供详细的错误信息和分类
4. **性能考虑**：异步计算性能指标，不阻塞主响应流
5. **提供者支持**：不同提供者可能支持不同级别的性能指标

## 📊 实现状态

- ✅ 类型定义已完成
- ✅ SDK 接口已扩展
- ✅ 示例代码已更新
- ⏳ 等待 AI Providers 插件主体实现
- ⏳ 测试和文档完善

这个实现指南为 AI Providers 插件开发者提供了完整的技术路线图，可以按照这个指南逐步实现性能数据回调功能。 