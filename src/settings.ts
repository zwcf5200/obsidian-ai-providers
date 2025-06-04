import {App, PluginSettingTab, sanitizeHTMLToDom, Setting, setIcon} from 'obsidian';
import AIProvidersPlugin from './main';
import { I18n } from './i18n';
import { ConfirmationModal } from './modals/ConfirmationModal';
import { IAIProvider, IAIProvidersPluginSettings, AIProviderType } from '../packages/sdk/index';
import { logger } from './utils/logger';
import { ProviderFormModal } from './modals/ProviderFormModal';
import { BulkAddModelsModal } from './modals/BulkAddModelsModal';
import { Notice } from 'obsidian';


export const DEFAULT_SETTINGS: IAIProvidersPluginSettings = {
    _version: 1,
    debugLogging: false,
    useNativeFetch: false,
}

export class AIProvidersSettingTab extends PluginSettingTab {
    private isFormOpen = false;
    private isDeveloperMode = false;

    plugin: AIProvidersPlugin;

    constructor(app: App, plugin: AIProvidersPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    private openForm(isAdding: boolean, provider?: IAIProvider) {
        const editingProvider = provider || {
            id: `id-${Date.now().toString()}`,
            name: "",
            apiKey: "",
            url: "",
            type: "openai",
            model: "",
        };

        new ProviderFormModal(
            this.app,
            this.plugin,
            editingProvider,
            async (updatedProvider) => {
                await this.saveProvider(updatedProvider);
            },
            isAdding
        ).open();
    }
    
    private openBulkAddModal() {
        new BulkAddModelsModal(
            this.app,
            this.plugin,
            async (providers: IAIProvider[]) => {
                // 批量添加完成后，刷新主设置页面
                this.display();
            }
        ).open();
    }

    private closeForm() {
        this.isFormOpen = false;
        this.display();
    }

    private validateProvider(provider: IAIProvider): boolean {
        // Validate required fields
        if (!provider.id || !provider.name || !provider.type) return false;

        // Validate URL format if URL is provided
        if (provider.url) {
            try {
                new URL(provider.url);
            } catch {
                return false;
            }
        }

        return true;
    }
    
    async saveProvider(provider: IAIProvider) {
        // 如果供应商名称为空，自动使用供应商类型名称代替
        if (!provider.name || provider.name.trim() === '') {
            const typeLabels: Record<string, string> = {
                'openai': 'OpenAI',
                'ollama': 'Ollama',
                'openrouter': 'OpenRouter',
                'gemini': 'Google Gemini',
                'lmstudio': 'LM Studio',
                'groq': 'Groq',
                'custom': 'Custom'
            };
            provider.name = typeLabels[provider.type as keyof typeof typeLabels] || provider.type;
            
            // 移除自动添加模型名称后缀的逻辑
            // 保持名称简洁，避免与使用此SDK的插件产生重复命名
        }
        
        if (!this.validateProvider(provider)) return;

        const providers = this.plugin.settings.providers || [];
        const existingIndex = providers.findIndex((p: IAIProvider) => p.id === provider.id);
        
        if (existingIndex !== -1) {
            providers[existingIndex] = provider;
        } else {
            providers.push(provider);
        }
        
        this.plugin.settings.providers = providers;
        await this.plugin.saveSettings();
        this.closeForm();
    }
    
    async saveMultipleProviders(newProviders: IAIProvider[]) {
        if (!newProviders || newProviders.length === 0) return;
        
        const providers = this.plugin.settings.providers || [];
        
        // 添加所有新的提供商
        providers.push(...newProviders);
        
        this.plugin.settings.providers = providers;
        await this.plugin.saveSettings();
        this.display();
    }

    async deleteProvider(provider: IAIProvider) {
        const providers = this.plugin.settings.providers || [];
        const index = providers.findIndex((p: IAIProvider) => p.id === provider.id);
        if (index !== -1) {
            providers.splice(index, 1);
            this.plugin.settings.providers = providers;
            await this.plugin.saveSettings();
            this.display();
            
        }
    }

    async duplicateProvider(provider: IAIProvider) {
        const newProvider = {
            ...provider,
            id: `id-${Date.now().toString()}`,
            name: `${provider.name} (${I18n.t('settings.duplicate')})`
        };
        
        const providers = this.plugin.settings.providers || [];
        providers.push(newProvider);
        
        this.plugin.settings.providers = providers;
        await this.plugin.saveSettings();
        this.display();
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        // Show main interface
        const mainInterface = containerEl.createDiv('ai-providers-main-interface');
        mainInterface.setAttribute('data-testid', 'main-interface');

        // Add notice at the top
        const noticeEl = mainInterface.createDiv('ai-providers-notice');
        const noticeContent = noticeEl.createDiv('ai-providers-notice-content');
        noticeContent.appendChild(sanitizeHTMLToDom(`${I18n.t('settings.notice')}`));

        // Create providers section with header and add buttons
        const providerHeaderSetting = new Setting(mainInterface)
            .setHeading()
            .setName(I18n.t('settings.configuredProviders'))
            .addButton(button => {
                const addButton = button
                    .setIcon("plus")
                    .setTooltip(I18n.t('settings.addProvider'))
                    .onClick(() => {
                        if (this.isFormOpen) return;
                        this.openForm(true);
                    })

                addButton.buttonEl.setAttribute("aria-label", I18n.t('settings.addProvider'))
                addButton.buttonEl.setAttribute("data-testid", "add-provider-button")
                return addButton;
            });
            
        // 添加批量添加模型按钮
        providerHeaderSetting.addButton(button => {
            const bulkAddButton = button
                .setIcon("list-plus")
                .setTooltip("批量添加模型")
                .onClick(() => {
                    this.openBulkAddModal();
                });
                
            bulkAddButton.buttonEl.addClass("ai-providers-bulk-add-button");
            bulkAddButton.buttonEl.setAttribute("aria-label", "批量添加模型");
            return bulkAddButton;
        });
        
        // 创建分组容器
        const providersContainer = mainInterface.createDiv('ai-providers-groups-container');

        const providers = this.plugin.settings.providers || [];
        
        if (providers.length > 0) {
            // 按提供商类型和URL分组
            const providerGroups = this.groupProviders(providers);
            
            // 遍历每个分组并创建对应的UI
            for (const [groupKey, groupProviders] of Object.entries(providerGroups)) {
                this.createProviderGroup(providersContainer, groupKey, groupProviders);
            }
        } else {
            // 没有配置任何提供商时显示提示
            const emptyMessage = providersContainer.createEl('p', {
                text: '尚未配置任何AI提供商，点击上方"+"按钮添加提供商，或使用"批量添加"功能'
            });
            emptyMessage.addClass('ai-providers-empty-message');
        }

        // Add developer settings toggle at the top
        new Setting(mainInterface)
            .setHeading()
            .setName(I18n.t('settings.developerSettings'))
            .setDesc(I18n.t('settings.developerSettingsDesc'))
            .setClass('ai-providers-developer-settings-toggle')
            .addToggle(toggle => toggle
                .setValue(this.isDeveloperMode)
                .onChange(value => {
                    this.isDeveloperMode = value;
                    this.display();
                }));

        // Developer settings section
        if (this.isDeveloperMode) {
            const developerSection = mainInterface.createDiv('ai-providers-developer-settings');
            
            new Setting(developerSection)
                .setName(I18n.t('settings.debugLogging'))
                .setDesc(I18n.t('settings.debugLoggingDesc'))
                .addToggle(toggle => toggle
                    .setValue(this.plugin.settings.debugLogging ?? false)
                    .onChange(async value => {
                        this.plugin.settings.debugLogging = value;
                        logger.setEnabled(value);
                        await this.plugin.saveSettings();
                    }));

            new Setting(developerSection)
                .setName(I18n.t('settings.useNativeFetch'))
                .setDesc(I18n.t('settings.useNativeFetchDesc'))
                .addToggle(toggle => toggle
                    .setValue(this.plugin.settings.useNativeFetch ?? false)
                    .onChange(async value => {
                        this.plugin.settings.useNativeFetch = value;
                        await this.plugin.saveSettings();
                    }));
        }
    }
    
    /**
     * 按照提供商类型和URL对提供商进行分组
     */
    private groupProviders(providers: IAIProvider[]): Record<string, IAIProvider[]> {
        const groups: Record<string, IAIProvider[]> = {};
        
        providers.forEach(provider => {
            // 使用类型和URL作为分组键
            const groupKey = `${provider.type}|${provider.url || ''}`;
            
            if (!groups[groupKey]) {
                groups[groupKey] = [];
            }
            
            groups[groupKey].push(provider);
        });
        
        // 对每个分组内的提供商按名称排序
        for (const key in groups) {
            groups[key].sort((a, b) => a.name.localeCompare(b.name));
        }
        
        return groups;
    }
    
    /**
     * 创建提供商分组UI
     */
    private createProviderGroup(container: HTMLElement, groupKey: string, providers: IAIProvider[]) {
        if (!providers.length) return;
        
        // 解析分组键
        const [type, url] = groupKey.split('|');
        
        // 创建分组容器
        const groupEl = container.createDiv('ai-providers-group');
        
        // 创建分组标题栏（采用flex布局）
        const groupHeader = groupEl.createDiv('ai-providers-group-header');
        
        // 左侧：图标+分组名称
        const titleWrap = groupHeader.createDiv('ai-providers-group-title');
        
        // 添加提供商图标
        const iconEl = titleWrap.createSpan('ai-providers-provider-icon');
        setIcon(iconEl, `ai-providers-${type}`);
        
        // 添加提供商类型名称
        const typeLabels: Record<string, string> = {
            'openai': 'OpenAI',
            'ollama': 'Ollama',
            'openrouter': 'OpenRouter',
            'gemini': 'Google Gemini',
            'lmstudio': 'LM Studio',
            'groq': 'Groq',
            'custom': 'Custom'
        };
        
        titleWrap.createEl('h3', { text: typeLabels[type as keyof typeof typeLabels] || type });
        
        // 右侧：操作栏（编辑按钮、模型计数、折叠按钮）
        const actionBar = groupHeader.createDiv('ai-providers-group-actions');
        
        // 批量编辑按钮
        const editGroupButton = actionBar.createEl('button');
        editGroupButton.addClass('ai-providers-group-edit-button');
        setIcon(editGroupButton, 'settings');
        editGroupButton.setAttribute('aria-label', '批量编辑此组模型');
        editGroupButton.setAttribute('title', '批量编辑此组模型');
        
        editGroupButton.addEventListener('click', () => {
            this.openBulkAddModalForGroup(type, url, providers);
        });
        
        // 显示模型计数
        const countSpan = actionBar.createSpan();
        countSpan.textContent = `${providers.length}个模型`;
        countSpan.addClass('ai-providers-group-count');
        
        // 折叠/展开按钮
        const toggleButton = actionBar.createEl('button');
        toggleButton.addClass('ai-providers-group-toggle');
        setIcon(toggleButton, 'chevron-down');
        
        // 在header下方单独显示URL信息（如果有且非默认值）
        if (url) {
            // 检查是否是默认URL
            const isDefaultUrl = this.isDefaultProviderUrl(type, url);
            
            if (!isDefaultUrl) {
                const urlEl = groupEl.createDiv('ai-providers-group-url');
                urlEl.textContent = url;
            }
        }
        
        // 创建模型列表容器
        const modelsContainer = groupEl.createDiv('ai-providers-models-container');
        
        // 添加折叠/展开功能
        let isCollapsed = false;
        toggleButton.addEventListener('click', () => {
            isCollapsed = !isCollapsed;
            
            if (isCollapsed) {
                modelsContainer.style.display = 'none';
                setIcon(toggleButton, 'chevron-right');
            } else {
                modelsContainer.style.display = '';
                setIcon(toggleButton, 'chevron-down');
            }
        });
        
        // 按模型名称排序
        providers.sort((a, b) => a.model?.localeCompare(b.model || '') || 0);
        
        // 添加所有模型
        providers.forEach(provider => {
            this.createProviderItem(modelsContainer, provider);
        });
    }
    
    /**
     * 检查URL是否是提供商的默认URL
     */
    private isDefaultProviderUrl(type: string, url: string): boolean {
        const defaultUrls: Record<string, string> = {
            'openai': 'https://api.openai.com/v1',
            'ollama': 'http://localhost:11434',
            'gemini': 'https://generativelanguage.googleapis.com/v1beta/openai',
            'openrouter': 'https://openrouter.ai/api/v1',
            'lmstudio': 'http://localhost:1234/v1',
            'groq': 'https://api.groq.com/openai/v1'
        };
        
        return defaultUrls[type] === url;
    }
    
    /**
     * 创建单个提供商项目UI
     */
    private createProviderItem(container: HTMLElement, provider: IAIProvider) {
        const setting = new Setting(container)
            .setName(provider.model || provider.name)
            .setDesc(''); // 不再需要在描述中显示模型名

        // 添加能力指示器
        if ((provider as any).userDefinedCapabilities && (provider as any).userDefinedCapabilities.length > 0) {
            const capabilitiesEl = setting.settingEl.createDiv('ai-providers-capabilities-container');
            
            const capabilityLabels: Record<string, string> = {
                'dialogue': '对话',
                'vision': '视觉',
                'tool_use': '工具',
                'text_to_image': '文生图',
                'embedding': '嵌入'
            };
            
            const capabilityIcons: Record<string, string> = {
                'dialogue': 'message-square',
                'vision': 'image',
                'tool_use': 'tool',
                'text_to_image': 'image-plus',
                'embedding': 'box'
            };
            
            (provider as any).userDefinedCapabilities.forEach((cap: string) => {
                const pill = capabilitiesEl.createDiv('ai-providers-capability-pill');
                const iconSpan = pill.createSpan('ai-providers-capability-icon');
                setIcon(iconSpan, capabilityIcons[cap] || 'check');
                pill.createSpan('ai-providers-capability-label').textContent = capabilityLabels[cap] || cap;
            });
            
            setting.descEl.after(capabilitiesEl as any);
        }

        setting
            .addExtraButton(button => {
                button
                    .setIcon("gear")
                    .setTooltip(I18n.t('settings.options'))
                    .onClick(() => {
                        if (this.isFormOpen) return;
                        this.openForm(false, { ...provider });
                    });
                
                button.extraSettingsEl.setAttribute('data-testid', 'edit-provider');
            })
            .addExtraButton(button => {
                button
                    .setIcon("copy")
                    .setTooltip(I18n.t('settings.duplicate'))
                    .onClick(async () => {
                        await this.duplicateProvider(provider);
                    });
                
                button.extraSettingsEl.setAttribute('data-testid', 'duplicate-provider');
            })
            .addExtraButton(button => {
                button
                    .setIcon("lucide-trash-2")
                    .setTooltip(I18n.t('settings.delete'))
                    .onClick(async () => {
                        new ConfirmationModal(
                            this.app,
                            I18n.t('settings.deleteConfirmation', { name: provider.model || provider.name }),
                            async () => {
                                await this.deleteProvider(provider);
                            }
                        ).open();
                    });

                button.extraSettingsEl.setAttribute('data-testid', 'delete-provider');
            });
    }
    
    /**
     * 为特定分组打开批量编辑模态框
     */
    private async openBulkAddModalForGroup(type: string, url: string, groupProviders: IAIProvider[]) {
        // 创建临时提供商对象
        const templateProvider: IAIProvider = {
            id: '',
            name: '', // 不再需要名称字段
            type: type as AIProviderType,
            url: url,
            apiKey: groupProviders.length > 0 ? groupProviders[0].apiKey : '',
            model: ''
        };
        
        // 显示加载提示
        new Notice('正在加载模型信息...');
        
        // 打开批量编辑模态框，添加onSave回调来刷新主页面
        const modal = new BulkAddModelsModal(
            this.app,
            this.plugin,
            async (providers: IAIProvider[]) => {
                // 批量保存完成后，刷新主设置页面
                this.display();
            }
        );
        
        // 打开模态框
        modal.open();
        
        // 设置模板提供商 (异步操作)
        await modal.setProviderTemplate(templateProvider);
    }
}
