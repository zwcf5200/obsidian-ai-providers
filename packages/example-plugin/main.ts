import { App, Plugin, PluginSettingTab, Setting } from 'obsidian';
import { initAI, waitForAI, IUsageMetrics } from '../../packages/sdk';

interface AIProvidersExampleSettings {
	mySetting: string;
}

export default class AIProvidersExamplePlugin extends Plugin {
	settings: AIProvidersExampleSettings;

	async onload() {
        initAI(this.app, this, async ()=>{
            this.addSettingTab(new SampleSettingTab(this.app, this));
		});
	}
}

class SampleSettingTab extends PluginSettingTab {
	plugin: AIProvidersExamplePlugin;
	selectedProvider: string;
	performanceDataElement: HTMLElement | null = null;

	constructor(app: App, plugin: AIProvidersExamplePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	async display(): Promise<void> {
		const {containerEl} = this;

		containerEl.empty();
    
        const aiResolver = await waitForAI();
		const aiProviders = await aiResolver.promise;

        const providers = aiProviders.providers.reduce((acc: Record<string, string>, provider: { id: string; name: string; model?: string }) => ({
			...acc,
			[provider.id]: provider.model ? [provider.name, provider.model].join(' ~ ') : provider.name,
		}), {
			'': ''
		});

		if (Object.keys(providers).length === 1) {
			new Setting(containerEl)
				.setName("AI Providers")
				.setDesc("No AI providers found. Please install an AI provider.");

			return;
		}
		new Setting(containerEl)
			.setName("Select AI Provider")
			.setClass("ai-providers-select")
			.addDropdown((dropdown) =>
				dropdown
					.addOptions(providers)
					.setValue(this.selectedProvider)
					.onChange(async (value) => {
						this.selectedProvider = value;
						await this.display();
					})
			);

		if (this.selectedProvider) {
			const provider = aiProviders.providers.find(provider => provider.id === this.selectedProvider);
			if (!provider) {
				return;
			}

			new Setting(containerEl)
				.setName("Execute test prompt")
				.setDesc("测试基本的 AI 请求功能")
				.addButton((button) =>
					button
						.setButtonText("Execute")
						.onClick(async () => {
							button.setDisabled(true);
							const responseEl = containerEl.createEl('div', { cls: 'ai-response-container' });
							const paragraph = responseEl.createEl('p');

							const chunkHandler = await aiProviders.execute({
								provider,
								prompt: "What is the capital of Great Britain?",
							});
							chunkHandler.onData((chunk, accumulatedText) => {
								paragraph.setText(accumulatedText);
							});
							chunkHandler.onEnd((fullText) => {
								console.log(fullText);
							});
							chunkHandler.onError((error) => {
								paragraph.setText(error.message);
							});
							button.setDisabled(false);
						})
				);



					new Setting(containerEl)
			.setName("Performance Data Test")
			.setDesc("测试性能数据回调功能（仅支持Ollama）")
			.addButton((button) =>
				button
					.setButtonText("Test Performance")
						.onClick(async () => {
							button.setDisabled(true);
							
							// 清除之前的性能数据显示
							if (this.performanceDataElement) {
								this.performanceDataElement.remove();
								this.performanceDataElement = null;
							}

							const responseContainer = containerEl.createEl('div', { cls: 'ai-response-container' });
							const responseEl = responseContainer.createEl('p');
							this.performanceDataElement = responseContainer.createEl('div', { 
								cls: 'performance-metrics',
								text: '等待性能数据回调...'
							});

							try {
								const chunkHandler = await aiProviders.execute({
									provider,
									prompt: "What's the meaning of life?",
									// 使用新的性能数据回调功能
									onPerformanceData: (metrics: IUsageMetrics | null, error?: Error) => {
										if (error) {
											console.error('性能数据获取失败:', error);
											if (this.performanceDataElement) {
												this.performanceDataElement.innerHTML = `
													<div style="color: #ff6b6b; padding: 8px; border: 1px solid #ff6b6b; border-radius: 4px; margin-top: 8px;">
														<strong>性能数据获取失败:</strong><br>
														${error.message}
													</div>
												`;
											}
										} else if (metrics) {
											console.log('回调收到性能数据:', metrics);
											this.updatePerformanceDisplay(metrics, 'Performance Data (Real-time)');
										}
									}
								});

								chunkHandler.onData((chunk, accumulatedText) => {
									responseEl.setText(accumulatedText);
								});

								chunkHandler.onEnd((fullText) => {
									console.log('响应完成:', fullText);
								});

								chunkHandler.onError((error) => {
									responseEl.setText(`错误: ${error.message}`);
								});

							} catch (error) {
								responseEl.setText(`请求失败: ${error.message}`);
							} finally {
								button.setDisabled(false);
							}
						})
				);

			
		}
	}

	private updatePerformanceDisplay(metrics: IUsageMetrics, method = 'Unknown'): void {
		if (!this.performanceDataElement) return;

		// 计算衍生指标
		const tokensPerSecond = metrics.usage.totalTokens && metrics.durationMs ? 
			(metrics.usage.totalTokens / (metrics.durationMs / 1000)).toFixed(2) : 'N/A';

		// 获取新增的字段
		const providerId = (metrics as any).providerId;
		const modelName = (metrics as any).modelName;
		const calculatedTokensPerSecond = (metrics as any).tokensPerSecond;

		this.performanceDataElement.innerHTML = `
			<div style="background: #f0f8ff; padding: 12px; border: 1px solid #4a9eff; border-radius: 6px; margin-top: 12px; font-family: monospace;">
				<h4 style="margin: 0 0 8px 0; color: #2c5aa0;">📊 性能数据 (${method})</h4>
				<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 12px;">
					<div><strong>总时长:</strong> ${metrics.durationMs}ms</div>
					<div><strong>总 Token:</strong> ${metrics.usage.totalTokens || 'N/A'}</div>
					<div><strong>输入 Token:</strong> ${metrics.usage.promptTokens || 'N/A'}</div>
					<div><strong>输出 Token:</strong> ${metrics.usage.completionTokens || 'N/A'}</div>
					<div><strong>处理速度:</strong> ${calculatedTokensPerSecond ? calculatedTokensPerSecond.toFixed(2) : tokensPerSecond} tokens/s</div>
					<div><strong>首Token延迟:</strong> ${metrics.firstTokenLatencyMs || 'N/A'}ms</div>
					${metrics.promptEvalDurationMs ? `<div><strong>Prompt处理:</strong> ${metrics.promptEvalDurationMs}ms</div>` : ''}
					${metrics.evalDurationMs ? `<div><strong>生成时间:</strong> ${metrics.evalDurationMs}ms</div>` : ''}
					${metrics.loadDurationMs ? `<div><strong>模型加载:</strong> ${metrics.loadDurationMs}ms</div>` : ''}
					${providerId ? `<div><strong>提供者:</strong> ${providerId}</div>` : ''}
					${modelName ? `<div><strong>模型:</strong> ${modelName}</div>` : ''}
				</div>
			</div>
		`;
	}
}
