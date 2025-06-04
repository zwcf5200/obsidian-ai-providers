import { App, Modal, Setting, Notice } from 'obsidian';
import { AICapability, IAIProvider } from '../../packages/sdk/index';
import { I18n } from '../i18n';
import { logger } from '../utils/logger';

export class CapabilitiesConfigModal extends Modal {
    private capabilities: Set<AICapability>;
    private capabilityLabels: Record<AICapability, string> = {
        'dialogue': '对话',
        'vision': '视觉',
        'tool_use': '工具使用',
        'text_to_image': '文生图',
        'embedding': '嵌入向量'
    };
    private toggleControls: Record<string, any> = {};
    private capabilitiesDesc: HTMLElement | null = null;

    constructor(
        app: App,
        private provider: IAIProvider,
        private onSave: (capabilities: AICapability[]) => void,
        private aiService?: any  // 用于自动探测
    ) {
        super(app);
        this.capabilities = new Set((provider as any).userDefinedCapabilities || []);
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        
        // 添加标题
        contentEl.createEl('h2', { 
            text: `${this.provider.name} 能力配置`
        });

        contentEl.createEl('p', {
            text: '选择此模型支持的能力:'
        });

        // 添加当前能力描述
        this.capabilitiesDesc = contentEl.createEl('div');
        this.capabilitiesDesc.addClass('ai-providers-capabilities');
        this.capabilitiesDesc.setText(`当前能力: ${this.getCapabilitiesDisplayText()}`);

        // 创建能力选项
        const capabilities: AICapability[] = ['dialogue', 'vision', 'tool_use', 'text_to_image', 'embedding'];
        
        capabilities.forEach(capability => {
            new Setting(contentEl)
                .setName(this.capabilityLabels[capability])
                .addToggle(toggle => {
                    toggle.setValue(this.capabilities.has(capability))
                        .onChange(value => {
                            if (value) {
                                this.capabilities.add(capability);
                            } else {
                                this.capabilities.delete(capability);
                            }
                            // 更新能力描述
                            if (this.capabilitiesDesc) {
                                this.capabilitiesDesc.setText(`当前能力: ${this.getCapabilitiesDisplayText()}`);
                            }
                        });
                    // 存储开关控件引用
                    this.toggleControls[capability] = toggle;
                    return toggle;
                });
        });

        // 添加自动探测按钮
        if (this.aiService) {
            new Setting(contentEl)
                .setName('自动探测')
                .setDesc('尝试自动探测模型支持的能力')
                .addButton(button => button
                    .setButtonText('自动探测')
                    .onClick(async () => {
                        try {
                            button.setDisabled(true);
                            button.setButtonText('探测中...');
                            
                            const detected = await this.aiService.detectModelCapabilities(this.provider);
                            this.capabilities = new Set(detected);
                            
                            // 更新所有开关状态，而不是关闭并重新打开对话框
                            this.updateToggleStates();
                            
                            // 更新当前能力显示
                            if (this.capabilitiesDesc) {
                                this.capabilitiesDesc.setText(`当前能力: ${this.getCapabilitiesDisplayText()}`);
                            }
                            
                            new Notice(`成功探测到 ${detected.length} 项能力`);
                            logger.debug(`模型 ${this.provider.name} 能力探测结果: ${detected.join(', ')}`);
                        } catch (error) {
                            logger.error('能力探测失败', error);
                            new Notice('能力探测失败，请手动设置');
                        } finally {
                            button.setDisabled(false);
                            button.setButtonText('自动探测');
                        }
                    }));
        }

        // 添加按钮
        new Setting(contentEl)
            .addButton(button => button
                .setButtonText('保存')
                .setCta()
                .onClick(() => {
                    this.onSave(Array.from(this.capabilities));
                    this.close();
                }))
            .addButton(button => button
                .setButtonText('取消')
                .onClick(() => {
                    this.close();
                }));
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }

    // 添加获取能力显示文本的方法
    private getCapabilitiesDisplayText(): string {
        if (this.capabilities.size === 0) {
            return '未设置任何能力';
        }
        return Array.from(this.capabilities)
            .map(cap => this.capabilityLabels[cap])
            .join(', ');
    }

    // 添加更新开关状态的方法
    private updateToggleStates(): void {
        const allCapabilities: AICapability[] = ['dialogue', 'vision', 'tool_use', 'text_to_image', 'embedding'];
        
        // 更新每个能力的开关状态
        allCapabilities.forEach(capability => {
            const toggle = this.toggleControls[capability];
            if (toggle) {
                toggle.setValue(this.capabilities.has(capability));
            }
        });
    }
} 