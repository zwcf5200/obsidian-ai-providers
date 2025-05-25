# AI Providers SDK - Token消耗与性能数据获取指南

## 概述

本指南介绍如何通过 AI Providers SDK 获取语言模型请求的 Token 消耗和性能数据。SDK 提供了简单的接口来获取最近一次请求的详细指标，帮助开发者了解其应用的资源使用情况和性能表现。

## 获取SDK实例

在使用SDK功能之前，您需要先获取正确的SDK实例。有以下几种方式可以获取SDK实例：

### 从Obsidian App获取

```typescript
import { ExtendedApp, IAIProvidersService } from '@obsidian-ai-providers/sdk';

// 假设您在插件中能够访问app实例
const app = this.app as ExtendedApp;
const aiProvidersService = app.aiProviders;

// 确保服务已加载
if (!aiProvidersService) {
  console.error('AI Providers Service 尚未加载');
  return;
}
```

### 使用waitForAI方法获取

```typescript
import { waitForAI, IAIProvidersService } from '@obsidian-ai-providers/sdk';

async function getAIService() {
  const { promise, cancel } = await waitForAI();
  try {
    const aiProvidersService = await promise;
    return aiProvidersService;
  } catch (error) {
    console.error('获取AI服务失败:', error);
    return null;
  }
}
```

### 在插件中使用initAI方法

```typescript
import { Plugin } from 'obsidian';
import { initAI, IAIProvidersService } from '@obsidian-ai-providers/sdk';

export default class MyPlugin extends Plugin {
  private aiService: IAIProvidersService | null = null;

  async onload() {
    await initAI(this.app, this, async () => {
      // 在这里可以访问到this.app.aiProviders
      this.aiService = (this.app as any).aiProviders;
      console.log('AI服务已加载');
    });
  }
}
```

## 获取请求指标

SDK的`IAIProvidersService`接口提供了`getLastRequestMetrics`方法来获取最近一次请求的详细指标。这些指标包括Token使用量和性能数据。

> **⚠️ 重要提示**
> 
> 从SDK 1.4.0版本开始，`getLastRequestMetrics`方法已在`IAIProvidersService`接口中正式定义。请确保您使用的是最新版本的SDK和AI Providers插件（≥1.4.0）。
> 
> 请**直接使用**`IAIProvidersService`接口调用此方法，无需任何类型转换或辅助函数。

### 使用方法

```typescript
import { IAIProvidersService, IUsageMetrics } from '@obsidian-ai-providers/sdk';

// 获取特定提供商的最近一次请求指标
// 直接调用方法，无需类型转换
const metrics = aiProvidersService.getLastRequestMetrics(providerId);

// 如果没有记录任何请求，返回null
if (metrics === null) {
  console.log('没有找到请求指标');
} else {
  console.log('Token 使用情况:', metrics.usage);
  console.log('请求总耗时:', metrics.durationMs, 'ms');
  
  // 如果有延迟数据
  if (metrics.firstTokenLatencyMs !== undefined) {
    console.log('首个Token延迟:', metrics.firstTokenLatencyMs, 'ms');
  }
  
  // 如果有提示词评估时间数据
  if (metrics.promptEvalDurationMs !== undefined) {
    console.log('提示词评估时间:', metrics.promptEvalDurationMs, 'ms');
  }
  
  // 如果有评估持续时间数据
  if (metrics.evalDurationMs !== undefined) {
    console.log('评估持续时间:', metrics.evalDurationMs, 'ms');
  }
}
```

### 指标说明

`IUsageMetrics` 接口定义了请求指标的数据结构：

```typescript
interface IUsageMetrics {
  // Token 使用情况
  usage: {
    promptTokens: number;    // 提示词消耗的Token数
    completionTokens: number; // 回复消耗的Token数
    totalTokens: number;     // 总Token数
  };
  
  // 性能指标
  durationMs: number;               // 请求总耗时(毫秒)
  firstTokenLatencyMs?: number;     // 首个Token延迟(毫秒)
  promptEvalDurationMs?: number;    // 提示词评估时间(毫秒)
  evalDurationMs?: number;          // 评估持续时间(毫秒)
  loadDurationMs?: number;          // 模型加载时间(毫秒)
}
```

## 示例应用场景

### 显示请求性能指标

```typescript
import { IAIProvidersService, IUsageMetrics } from '@obsidian-ai-providers/sdk';

async function checkRequestPerformance() {
  // 确保先获取AI服务实例
  const aiProvidersService = (this.app as any).aiProviders;
  if (!aiProvidersService) {
    console.error('AI Providers Service 尚未加载');
    return;
  }
  
  // 发送请求
  const response = await aiProvidersService.execute({
    provider: {
      id: 'ollama',
      name: 'Ollama',
      type: 'ollama',
      model: 'llama3'
    },
    prompt: '解释量子计算的基本原理'
  });
  
  // 等待请求完成
  await new Promise(resolve => {
    response.onEnd(() => resolve(null));
  });
  
  // 获取性能指标
  const metrics = aiProvidersService.getLastRequestMetrics('ollama');
  
  if (metrics) {
    // 构建性能报告
    const report = `
性能报告:
- 总Token数: ${metrics.usage.totalTokens}
- 提示词Token: ${metrics.usage.promptTokens}
- 回复Token: ${metrics.usage.completionTokens}
- 总耗时: ${metrics.durationMs}ms
${metrics.firstTokenLatencyMs ? `- 首个Token延迟: ${metrics.firstTokenLatencyMs}ms` : ''}
${metrics.promptEvalDurationMs ? `- 提示词评估时间: ${metrics.promptEvalDurationMs}ms` : ''}
${metrics.evalDurationMs ? `- 评估持续时间: ${metrics.evalDurationMs}ms` : ''}
${metrics.loadDurationMs ? `- 模型加载时间: ${metrics.loadDurationMs}ms` : ''}
    `;
    
    console.log(report);
  }
}
```

### 监控性能变化

您可以在每次请求后获取指标，并与预期性能阈值进行比较：

```typescript
import { IUsageMetrics } from '@obsidian-ai-providers/sdk';

function checkPerformanceThresholds(metrics: IUsageMetrics) {
  if (!metrics) return;
  
  const thresholds = {
    maxTotalTokens: 1000,
    maxDurationMs: 5000,
    maxFirstTokenLatencyMs: 1000
  };
  
  const warnings = [];
  
  if (metrics.usage.totalTokens > thresholds.maxTotalTokens) {
    warnings.push(`Token消耗(${metrics.usage.totalTokens})超出预期(${thresholds.maxTotalTokens})`);
  }
  
  if (metrics.durationMs > thresholds.maxDurationMs) {
    warnings.push(`请求耗时(${metrics.durationMs}ms)超出预期(${thresholds.maxDurationMs}ms)`);
  }
  
  if (metrics.firstTokenLatencyMs && metrics.firstTokenLatencyMs > thresholds.maxFirstTokenLatencyMs) {
    warnings.push(`首个Token延迟(${metrics.firstTokenLatencyMs}ms)超出预期(${thresholds.maxFirstTokenLatencyMs}ms)`);
  }
  
  if (warnings.length > 0) {
    console.warn('性能警告:', warnings.join('; '));
  }
}
```

## 兼容性问题排查

如果您在调用`getLastRequestMetrics`方法时遇到"不是一个函数"的错误，可能是由以下原因导致：

1. **SDK版本过低**：确保您使用的SDK版本≥1.4.0，较早版本不支持此功能
2. **AI Providers插件版本过低**：确保您安装的AI Providers插件版本≥1.4.0
3. **SDK实例不正确**：确保您正确获取了SDK实例，可以通过日志打印`aiProvidersService`对象进行检查
4. **TypeScript类型定义问题**：在TypeScript项目中，如果遇到编译错误，可以尝试以下方法：
   
   ```typescript
   // 检查服务实例是否包含getLastRequestMetrics方法
   if (typeof aiProvidersService.getLastRequestMetrics === 'function') {
     const metrics = aiProvidersService.getLastRequestMetrics(providerId);
     // 使用metrics...
   } else {
     console.error('getLastRequestMetrics方法不可用，请检查SDK版本');
   }
   ```

## 注意事项

1. 指标仅保存最近一次请求的数据，每次新请求都会覆盖旧数据
2. 不同AI提供商可能提供不同级别的指标详情，某些可选字段可能不存在
3. 必须先进行请求操作，才能获取到有效的指标数据
4. 指标数据在应用重启后会被清除
5. SDK版本和AI Providers插件版本均需要≥1.4.0才支持此功能

## 最佳实践

- 确保您使用的是最新版本的SDK和AI Providers插件
- 在发送请求前先检查SDK实例是否正确加载
- 如需长期跟踪使用情况，请在每次请求后自行保存指标数据
- 对于批量处理的场景，建议在每个请求完成后立即获取并存储其指标
- 在展示给用户的界面中，可以考虑仅显示最重要的指标如总Token数和请求耗时
