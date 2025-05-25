# Ollama Token消耗与性能数据获取指南

## Ollama API性能指标概述

Ollama API在生成响应时会提供一系列性能指标，这些指标对于评估模型性能、监控资源使用情况和优化应用体验非常有价值。根据官方API文档和实际实现，Ollama提供以下关键性能指标：

### 核心性能指标

| 指标名称 | 类型 | 单位 | 描述 |
|---------|------|------|------|
| `total_duration` | number | 纳秒 | 请求的总处理时间，包括模型加载、提示词评估和响应生成 |
| `load_duration` | number | 纳秒 | 模型加载所需的时间 |
| `prompt_eval_count` | number | tokens | 提示词中的token数量 |
| `prompt_eval_duration` | number | 纳秒 | 评估提示词所需的时间 |
| `eval_count` | number | tokens | 生成的响应中的token数量 |
| `eval_duration` | number | 纳秒 | 生成响应所需的时间 |

### 性能计算方法

根据这些指标，可以计算以下关键性能指标：

1. **提示词处理速度**：`prompt_eval_count / (prompt_eval_duration / 10^9)` (tokens/秒)
2. **响应生成速度**：`eval_count / (eval_duration / 10^9)` (tokens/秒)
3. **总体效率**：`(prompt_eval_count + eval_count) / (total_duration / 10^9)` (tokens/秒)

## Ollama API响应格式

Ollama API在生成完成后会返回包含这些性能指标的JSON对象。以下是一个典型的响应示例：

```json
{
  "model": "llama3.2",
  "created_at": "2023-08-04T19:22:45.499127Z",
  "response": "The sky is blue because...",
  "done": true,
  "context": [1, 2, 3],
  "total_duration": 4935886791,
  "load_duration": 534986708,
  "prompt_eval_count": 26,
  "prompt_eval_duration": 107345000,
  "eval_count": 237,
  "eval_duration": 4289432000
}
```

## 注意事项与常见问题

### 1. prompt_eval_count 在重复请求中可能消失

根据GitHub上的[Issue #2068](https://github.com/jmorganca/ollama/issues/2068)，在使用相同提示词进行重复请求时，`prompt_eval_count`可能会在后续响应中消失。这是因为Ollama实现了提示词缓存机制，后续请求会重用已缓存的提示词评估结果。

**解决方案**：
- 在实现Token计数时，需要考虑到这种情况，并在`prompt_eval_count`缺失时使用上一次有效的值或默认值
- 在Ollama 0.7.1版本后，此问题已通过[PR #5371](https://github.com/ollama/ollama/pull/5371)修复

### 2. 时间单位转换

所有时间相关的指标（`total_duration`、`load_duration`、`prompt_eval_duration`、`eval_duration`）都是以纳秒为单位的，在实际应用中通常需要转换为毫秒：

```javascript
// 纳秒转毫秒
const durationMs = Math.round(nanoseconds / 1_000_000);
```

### 3. 首字延迟计算

Ollama API本身不直接提供首字延迟（Time to First Token, TTFT）指标，但可以通过在客户端记录时间戳来计算：

```javascript
const requestStartTime = Date.now();
let firstTokenTime;

// 在接收到第一个token时记录时间
if (!firstTokenTime && responseText.length > 0) {
    firstTokenTime = Date.now();
}

// 计算首字延迟
const firstTokenLatency = firstTokenTime - requestStartTime;
```

## Obsidian AI Providers SDK实现分析

通过分析Obsidian AI Providers SDK的实现，可以看到SDK正确地使用了Ollama的性能指标：

1. **Token计数**：使用`prompt_eval_count`和`eval_count`作为提示词和响应的token数量
2. **时间单位转换**：将纳秒转换为毫秒以便于理解和使用
3. **首字延迟计算**：通过客户端时间戳计算首字延迟
4. **错误处理**：处理了指标缺失的情况，确保统计数据的可靠性

```javascript
// Ollama性能指标处理示例
if (reportUsage && finalOllamaStats) {
    try {
        const usage: ITokenUsage = {
            promptTokens: finalOllamaStats.prompt_eval_count,
            completionTokens: finalOllamaStats.eval_count,
            totalTokens: (finalOllamaStats.prompt_eval_count || 0) + (finalOllamaStats.eval_count || 0)
        };
        // Ollama的total_duration是纳秒，转换为毫秒
        const durationMs = finalOllamaStats.total_duration ? Math.round(finalOllamaStats.total_duration / 1_000_000) : (Date.now() - requestStartTime);
        
        reportUsage({
            usage,
            durationMs,
            firstTokenLatencyMs: firstTokenTime ? firstTokenTime - requestStartTime : undefined,
            promptEvalDurationMs: finalOllamaStats.prompt_eval_duration ? Math.round(finalOllamaStats.prompt_eval_duration / 1_000_000) : undefined,
            evalDurationMs: finalOllamaStats.eval_duration ? Math.round(finalOllamaStats.eval_duration / 1_000_000) : undefined,
            loadDurationMs: finalOllamaStats.load_duration ? Math.round(finalOllamaStats.load_duration / 1_000_000) : undefined
        });
    } catch (statsError) {
        // 错误处理...
    }
}
```

## 性能基准测试工具

对于需要进行更深入性能测试的用户，可以使用[ollama-benchmark](https://github.com/cloudmercato/ollama-benchmark)工具，它提供了多种工作负载测试，包括：

- `speed`: 评估聊天速度性能
- `embedding`: 评估嵌入性能
- `load`: 评估模型加载速度
- `chat`: 实时评估聊天性能

## 最佳实践

1. **监控所有性能指标**：不仅关注token数量，还要关注各阶段的时间消耗
2. **计算生成速率**：使用`eval_count`和`eval_duration`计算实际的生成速率
3. **考虑缓存影响**：了解Ollama的提示词缓存机制对性能指标的影响
4. **时间单位转换**：始终将纳秒转换为更易读的单位（如毫秒）
5. **错误处理**：处理指标缺失的情况，确保应用的稳定性

## 结论

Obsidian AI Providers SDK正确地利用了Ollama提供的性能指标，通过合理的转换和计算，为用户提供了全面的性能监控能力。对于开发者来说，了解这些指标的含义和使用方法，有助于优化应用性能和提升用户体验。

在使用Ollama API时，应当特别注意`prompt_eval_count`在重复请求中可能消失的问题，以及所有时间指标都是以纳秒为单位的特点。通过正确处理这些细节，可以获得准确的性能数据，为应用优化提供可靠依据。
