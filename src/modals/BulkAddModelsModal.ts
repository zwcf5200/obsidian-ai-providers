import { App, Modal, Setting, Notice, setIcon, ToggleComponent } from 'obsidian';
import { IAIProvider, AIProviderType } from '../../packages/sdk/index';
import { logger } from '../utils/logger';
import AIProvidersPlugin from '../main';
import { I18n } from '../i18n';
import { PROVIDER_TYPE_LABELS, DEFAULT_PROVIDER_URLS, getProviderTypeLabel, getDefaultProviderUrl } from '../constants';

export class BulkAddModelsModal extends Modal {
    private isLoadingModels = false;
    private selectedModels: Set<string> = new Set();
    private availableModels: string[] = [];
    private toggleComponents: Map<string, ToggleComponent> = new Map();
    private providerTemplate: IAIProvider;
    // 添加模型能力存储
    private modelCapabilities: Map<string, string[]> = new Map();
    
    // 统一的提供商类型标签定义
    // private readonly providerTypeLabels: Record<string, string> = {
    //     'openai': 'OpenAI',
    //     'ollama': 'Ollama',
    //     'openrouter': 'OpenRouter',
    //     'gemini': 'Google Gemini',
    //     'lmstudio': 'LM Studio',
    //     'groq': 'Groq',
    //     'custom': 'Custom'
    // };
    
    // 统一的能力映射关系
    private readonly capabilityMappings: Record<string, string[]> = {
        'embedding': ['embedding'],
        'vision': ['vision', 'image'],
        'dialogue': ['dialogue', 'chat', 'completion'],
        'tool_use': ['tool', 'tools', 'function', 'functions'],
        'text_to_image': ['image-to-text', 'text-to-image']
    };
    
    // 统一的能力显示标签
    private readonly capabilityLabels: Record<string, string> = {
        'dialogue': '对话',
        'vision': '视觉',
        'tool_use': '工具',
        'text_to_image': '文生图',
        'embedding': '嵌入',
        'unknown': '未知'
    };
    
    // 统一的能力图标
    private readonly capabilityIcons: Record<string, string> = {
        'dialogue': 'message-square',
        'vision': 'image',
        'tool_use': 'tool',
        'text_to_image': 'image-plus',
        'embedding': 'box',
        'unknown': 'help-circle'
    };

    // 移除重复的defaultProvidersUrls定义，使用导入的常量
    // private readonly defaultProvidersUrls = {
    //     openai: "https://api.openai.com/v1",
    //     ollama: "http://localhost:30100",
    //     gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
    //     openrouter: "https://openrouter.ai/api/v1",
    //     lmstudio: "http://localhost:1234/v1",
    //     groq: "https://api.groq.com/openai/v1",
    //     custom: "",
    // };

    constructor(
        app: App,
        private plugin: AIProvidersPlugin,
        private onSave?: (providers: IAIProvider[]) => Promise<void>
    ) {
        super(app);
        
        // 创建一个基础提供商模板
        this.providerTemplate = {
            id: '',
            name: '',
            type: 'ollama',
            url: getDefaultProviderUrl('ollama'),
            apiKey: '',
            model: '',
        };
    }

    onOpen() {
        const { contentEl } = this;
        
        // 添加标题 - 区分新增和编辑模式
        const isEditingExisting = !!this.providerTemplate.url;
        const titleText = isEditingExisting 
            ? `批量编辑 ${getProviderTypeLabel(this.providerTemplate.type)} 模型` 
            : '批量添加模型';
            
        contentEl.createEl('h2', { text: titleText });
        
        // 添加唯一标识，避免重复渲染
        const uniqueId = `bulk-editor-${this.providerTemplate.type}-${this.providerTemplate.url || 'new'}`;
        contentEl.setAttribute('data-editor-id', uniqueId);
        
        // 添加提供商基本信息设置
        this.createProviderBasicSettings(contentEl);
        
        // 创建模型选择区域
        this.createModelSelectionArea(contentEl);
        
        // 添加按钮区域
        this.createButtonArea(contentEl, isEditingExisting);
    }
    
    /**
     * 获取提供商类型的显示名称
     */
    private getProviderTypeLabel(type: string): string {
        return getProviderTypeLabel(type);
    }
    
    private createProviderBasicSettings(contentEl: HTMLElement) {
        // 提供商类型
        new Setting(contentEl)
            .setName('提供商类型')
            .setDesc('选择要批量添加模型的提供商类型')
            .addDropdown(dropdown => {
                dropdown
                    .addOptions(PROVIDER_TYPE_LABELS)
                    .setValue(this.providerTemplate.type)
                    .onChange(value => {
                        this.providerTemplate.type = value as AIProviderType;
                        this.providerTemplate.url = getDefaultProviderUrl(value);
                        this.selectedModels.clear();
                        this.availableModels = [];
                        
                        // 如果名称前缀为空，自动设置为供应商类型名称
                        if (!this.providerTemplate.name || this.providerTemplate.name === '') {
                            this.providerTemplate.name = getProviderTypeLabel(value);
                        }
                        
                        this.display();
                    });
                return dropdown;
            });
            
        // 提供商名称前缀
        new Setting(contentEl)
            .setName('提供商名称前缀')
            .setDesc('为所有添加的模型设置统一的名称前缀。提供商名称将只包含此前缀，不包含模型名称，避免与其他插件显示时产生重复。')
            .addText(text => text
                .setPlaceholder('例如：本地Ollama、我的OpenAI等')
                .setValue(this.providerTemplate.name || '')
                .onChange(value => this.providerTemplate.name = value));
            
        // 提供商URL
        new Setting(contentEl)
            .setName('提供商URL')
            .setDesc('所有添加的模型将共用此URL')
            .addText(text => text
                .setPlaceholder('例如：http://localhost:11434')
                .setValue(this.providerTemplate.url || '')
                .onChange(value => this.providerTemplate.url = value));
                
        // API密钥
        new Setting(contentEl)
            .setName('API密钥')
            .setDesc('所有添加的模型将共用此API密钥（如需要）')
            .addText(text => text
                .setPlaceholder('API密钥')
                .setValue(this.providerTemplate.apiKey || '')
                .onChange(value => this.providerTemplate.apiKey = value));
    }
    
    private createModelSelectionArea(contentEl: HTMLElement) {
        const modelAreaEl = contentEl.createDiv('bulk-add-models-area');
        
        // 模型区域标题
        const isEditingExisting = !!this.providerTemplate.url;
        const titleText = isEditingExisting ? '管理模型' : '选择要添加的模型';
        modelAreaEl.createEl('h3', { text: titleText });
        
        // 添加说明文字
        const descText = isEditingExisting
            ? '您可以添加新模型或移除现有模型。已添加的模型会自动被标记，取消选择已添加的模型将会在保存时删除它们。'
            : '点击"获取可用模型"按钮以列出可用的模型，然后选择您想要添加的模型。';
        
        const descEl = modelAreaEl.createEl('p', { text: descText });
        descEl.addClass('bulk-add-description');
        
        // 刷新模型按钮
        this.createModelFetchControls(modelAreaEl);
        
        // 模型列表
        this.createModelList(modelAreaEl);
    }
    
    /**
     * 创建模型获取控制区域
     */
    private createModelFetchControls(container: HTMLElement) {
        const refreshContainer = container.createDiv('bulk-add-refresh-container');
        const refreshButton = refreshContainer.createEl('button', { text: '获取可用模型' });
        refreshButton.addClass('mod-cta');
        
        if (this.isLoadingModels) {
            (refreshButton as HTMLButtonElement).disabled = true;
            refreshButton.textContent = '正在加载...';
        }
        
        refreshButton.addEventListener('click', async () => {
            await this.fetchModels();
        });
        
        // 添加全选/取消全选按钮
        if (this.availableModels.length > 0) {
            this.createModelSelectionControls(container);
        }
    }
    
    /**
     * 创建模型选择控制按钮
     */
    private createModelSelectionControls(container: HTMLElement) {
        const selectAllContainer = container.createDiv('bulk-add-select-container');
        
        const selectAllButton = selectAllContainer.createEl('button', { text: '全选' });
        selectAllButton.addEventListener('click', () => {
            this.availableModels.forEach(model => {
                this.selectedModels.add(model);
                const toggle = this.toggleComponents.get(model);
                if (toggle) toggle.setValue(true);
            });
        });
        
        const deselectAllButton = selectAllContainer.createEl('button', { text: '取消全选' });
        deselectAllButton.addEventListener('click', () => {
            this.selectedModels.clear();
            this.toggleComponents.forEach(toggle => toggle.setValue(false));
        });
    }
    
    /**
     * 创建模型列表区域
     */
    private createModelList(container: HTMLElement) {
        const modelsListEl = container.createDiv('bulk-add-models-list');
        
        if (this.availableModels.length === 0 && !this.isLoadingModels) {
            modelsListEl.createEl('p', { text: '点击上方按钮获取可用模型' });
            return;
        } 
        
        if (this.isLoadingModels) {
            modelsListEl.createEl('p', { text: '正在加载模型...' });
            return;
        }
        
        // 模型过滤输入框
        this.createModelFilterInput(modelsListEl);
        
        // 显示已选择的模型数量
        const selectedCountEl = modelsListEl.createDiv('bulk-add-selected-count');
        selectedCountEl.textContent = `已选择 ${this.selectedModels.size} 个模型`;
        
        // 创建模型列表
        this.createModelItems(modelsListEl, selectedCountEl);
    }
    
    /**
     * 创建模型过滤输入框
     */
    private createModelFilterInput(container: HTMLElement) {
        const filterContainer = container.createDiv('bulk-add-filter-container');
        filterContainer.createEl('span', { text: '筛选：' });
        const filterInput = filterContainer.createEl('input') as HTMLInputElement;
        filterInput.type = 'text';
        filterInput.placeholder = '输入关键词筛选模型';
        
        filterInput.addEventListener('input', (e) => {
            const filterValue = (e.target as HTMLInputElement).value.toLowerCase();
            const modelElements = container.querySelectorAll('.bulk-add-model-item');
            
            modelElements.forEach(el => {
                const modelName = el.getAttribute('data-model-name') || '';
                if (modelName.toLowerCase().includes(filterValue)) {
                    (el as unknown as HTMLElement).style.display = '';
                } else {
                    (el as unknown as HTMLElement).style.display = 'none';
                }
            });
        });
    }
    
    /**
     * 创建模型项列表
     */
    private createModelItems(container: HTMLElement, countElement: HTMLElement) {
        this.availableModels.forEach(model => {
            const modelItemEl = container.createDiv('bulk-add-model-item');
            modelItemEl.setAttribute('data-model-name', model);
            
            // 检查是否是已添加的模型
            const isExistingModel = this.selectedModels.has(model);
            if (isExistingModel) {
                modelItemEl.addClass('bulk-add-model-existing');
            }
            
            const setting = new Setting(modelItemEl);
            
            // 创建模型名称和能力显示区域
            const nameContainer = setting.nameEl.createDiv('bulk-add-model-name-container');
            
            // 为已添加的模型添加标记
            if (isExistingModel) {
                const nameEl = nameContainer.createSpan('bulk-add-existing-indicator');
                nameEl.textContent = '[已添加] ';
                nameEl.setAttr('title', '此模型已添加到配置中');
            }
            
            // 模型名称
            const modelNameEl = nameContainer.createSpan('bulk-add-model-name');
            modelNameEl.textContent = model;
            
            // 能力图标容器
            const capabilitiesContainer = nameContainer.createDiv('ai-providers-capabilities-container');
            this.renderModelCapabilities(capabilitiesContainer, model);
            
            setting.addToggle(toggle => {
                toggle.setValue(this.selectedModels.has(model))
                    .onChange(value => {
                        if (value) {
                            this.selectedModels.add(model);
                        } else {
                            this.selectedModels.delete(model);
                        }
                        countElement.textContent = `已选择 ${this.selectedModels.size} 个模型`;
                    });
                
                this.toggleComponents.set(model, toggle);
                return toggle;
            });
        });
    }
    
    /**
     * 渲染模型能力图标
     */
    private renderModelCapabilities(container: HTMLElement, modelName: string): void {
        const capabilities = this.modelCapabilities.get(modelName) || ['unknown'];
        
        capabilities.forEach(capability => {
            const capabilityPill = container.createDiv('ai-providers-capability-pill');
            
            // 为未知能力添加特殊样式类
            if (capability === 'unknown') {
                capabilityPill.addClass('ai-providers-capability-unknown');
            }
            
            // 能力图标
            const iconContainer = capabilityPill.createDiv('ai-providers-capability-icon');
            const iconName = this.capabilityIcons[capability] || 'help-circle';
            setIcon(iconContainer, iconName);
            
            // 能力标签
            const labelEl = capabilityPill.createSpan('ai-providers-capability-label');
            labelEl.textContent = this.capabilityLabels[capability] || capability;
            
            // 设置提示信息
            capabilityPill.setAttr('title', `${this.capabilityLabels[capability] || capability}能力`);
        });
    }
    
    private createButtonArea(contentEl: HTMLElement, isEditing: boolean = false) {
        const buttonContainer = contentEl.createDiv('bulk-add-button-container');
        
        const saveButtonText = isEditing ? '保存更改' : '添加所选模型';
        const saveButton = buttonContainer.createEl('button', { text: saveButtonText });
        saveButton.addClass('mod-cta');
        saveButton.addEventListener('click', async () => {
            if (this.selectedModels.size === 0) {
                new Notice('请至少选择一个模型');
                return;
            }
            
            // 如果提供商名称前缀为空，自动使用供应商类型名称
            if (!this.providerTemplate.name || this.providerTemplate.name.trim() === '') {
                this.providerTemplate.name = getProviderTypeLabel(this.providerTemplate.type);
            }
            
            await this.saveSelectedModels();
        });
        
        const cancelButton = buttonContainer.createEl('button', { text: '取消' });
        cancelButton.addEventListener('click', () => {
            this.close();
        });
    }
    
    private async fetchModels() {
        try {
            this.isLoadingModels = true;
            this.display();
            
            // 保存之前已选择的模型列表
            const previouslySelected = new Set(this.selectedModels);
            
            // 清空模型列表和能力缓存
            this.availableModels = [];
            this.modelCapabilities.clear();
            this.toggleComponents.clear();
            
            // 创建临时提供商对象用于获取模型列表
            const tempProvider: IAIProvider = {
                ...this.providerTemplate,
                id: `temp-${Date.now()}`,
                name: 'Temporary Provider'
            };
            
            const models = await this.plugin.aiProviders.fetchModels(tempProvider);
            this.availableModels = models;
            
            // 重置选择状态
            this.selectedModels.clear();
            
            // 获取已经添加的模型
            const existingProviders = this.plugin.settings.providers || [];
            const existingModels = new Set(
                existingProviders
                    .filter(p => p.type === this.providerTemplate.type && 
                           (p.url || '') === (this.providerTemplate.url || ''))
                    .map(p => p.model)
            );
            
            // 标记已添加的模型为已选择，同时保留之前已选择的状态
            models.forEach(model => {
                if (existingModels.has(model) || previouslySelected.has(model)) {
                    this.selectedModels.add(model);
                }
            });
            
            // 批量检测模型能力
            await this.detectModelsCapabilities(tempProvider, models);
            
            if (models.length === 0) {
                new Notice('未找到可用模型');
            } else {
                new Notice(`发现 ${models.length} 个可用模型，其中 ${this.selectedModels.size} 个已添加，已完成能力检测`);
            }
        } catch (error) {
            logger.error('获取模型失败:', error);
            new Notice('获取模型列表失败');
        } finally {
            this.isLoadingModels = false;
            this.display();
        }
    }
    
    private async saveSelectedModels() {
        if (this.selectedModels.size === 0 && !this.availableModels.length) return;
        
        const providers: IAIProvider[] = [];
        let existingProviders = this.plugin.settings.providers || [];
        
        // 查找已存在的模型集合，以URL和type为匹配条件
        const existingModelMap = new Map<string, IAIProvider>();
        const existingModelsFiltered = existingProviders
            .filter(p => p.type === this.providerTemplate.type && 
                   (p.url || '') === (this.providerTemplate.url || ''));
        
        existingModelsFiltered.forEach(p => {
            if (p.model) {
                existingModelMap.set(p.model, p);
            }
        });
        
        // 记录操作数量
        let newCount = 0;
        let skippedCount = 0;
        let removedCount = 0;
        let updatedCount = 0; // 添加更新计数
        
        // 1. 删除已取消选择的模型
        // 获取所有此类型和URL的模型，但没有被选中的
        const modelsToRemove = new Set<string>();
        existingModelsFiltered.forEach(p => {
            if (p.model && this.availableModels.includes(p.model) && !this.selectedModels.has(p.model)) {
                modelsToRemove.add(p.model);
            }
        });
        
        // 过滤掉要删除的模型
        if (modelsToRemove.size > 0) {
            const idsToRemove = new Set(
                existingModelsFiltered
                    .filter(p => p.model && modelsToRemove.has(p.model))
                    .map(p => p.id)
            );
            
            // 从所有提供商中过滤掉要删除的
            existingProviders = existingProviders.filter(p => !idsToRemove.has(p.id));
            removedCount = modelsToRemove.size;
        }
        
        // 2. 处理选中的模型（添加新模型或更新现有模型的能力）
        for (const model of this.selectedModels) {
            const capabilities = this.modelCapabilities.get(model);
            
            if (existingModelMap.has(model)) {
                // 现有模型：更新能力信息
                const existingProvider = existingModelMap.get(model)!;
                const existingCapabilities = (existingProvider as any).userDefinedCapabilities;
                
                // 检查能力是否有变化
                const capabilitiesChanged = JSON.stringify(existingCapabilities) !== JSON.stringify(capabilities);
                
                if (capabilitiesChanged) {
                    // 在现有提供商列表中找到并更新这个模型
                    const providerIndex = existingProviders.findIndex(p => p.id === existingProvider.id);
                    if (providerIndex !== -1) {
                        // 创建更新的提供商对象
                        const updatedProvider = { ...existingProvider };
                        if (capabilities && capabilities.length > 0) {
                            (updatedProvider as any).userDefinedCapabilities = capabilities;
                        } else {
                            // 删除能力属性（如果没有检测到能力）
                            delete (updatedProvider as any).userDefinedCapabilities;
                        }
                        
                        existingProviders[providerIndex] = updatedProvider;
                        updatedCount++;
                    }
                } else {
                    skippedCount++;
                }
            } else {
                // 新模型：创建新的提供商对象
                const provider = this.createProviderObject(model, capabilities);
                providers.push(provider);
                newCount++;
            }
        }
        
        try {
            // 将新模型添加到现有列表中
            existingProviders = [...existingProviders, ...providers];
            
            // 更新插件设置
            this.plugin.settings.providers = existingProviders;
            await this.plugin.saveSettings();
            
            // 构建提示信息
            const messagePoints = [];
            if (newCount > 0) messagePoints.push(`添加了 ${newCount} 个新模型`);
            if (removedCount > 0) messagePoints.push(`移除了 ${removedCount} 个现有模型`);
            if (updatedCount > 0) messagePoints.push(`更新了 ${updatedCount} 个现有模型`);
            if (skippedCount > 0) messagePoints.push(`${skippedCount} 个模型保持不变`);
            
            const message = messagePoints.join('，');
            new Notice(message || '没有模型变更');
            
            // 如果有onSave回调，先调用它
            if (this.onSave) {
                await this.onSave(providers);
            }
            
            this.close();
        } catch (error) {
            logger.error('保存模型失败:', error);
            new Notice('保存模型失败');
        }
    }
    
    /**
     * 将Ollama能力映射到插件支持的能力
     */
    private mapModelCapabilities(ollamaCapabilities: string[]): string[] {
        const mappedCapabilities = new Set<string>();
        
        // 遍历所有Ollama报告的能力
        ollamaCapabilities.forEach((cap: string) => {
            const lowerCap = cap.toLowerCase();
            
            // 查找匹配的能力映射
            for (const [capability, variants] of Object.entries(this.capabilityMappings)) {
                if (variants.includes(lowerCap)) {
                    mappedCapabilities.add(capability);
                    break;
                }
            }
        });
        
        // 如果没有识别到任何能力，返回空数组，让调用方处理
        return Array.from(mappedCapabilities);
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
    
    display() {
        const { contentEl } = this;
        
        // 清空内容区域
        contentEl.empty();
        
        // 重新打开（创建新的UI）
        this.onOpen();
    }

    /**
     * 设置模板提供商，并预加载组内已有的模型
     * 允许外部代码指定基础模板信息
     */
    public async setProviderTemplate(template: IAIProvider) {
        // 复制模板信息，确保不会修改原始对象
        this.providerTemplate = { ...template };
        
        // 确保类型字段是有效的提供商类型
        if (!DEFAULT_PROVIDER_URLS[this.providerTemplate.type]) {
            // 如果类型无效，设置为默认类型
            this.providerTemplate.type = 'ollama';
            this.providerTemplate.url = getDefaultProviderUrl('ollama');
        }
        
        // 如果名称前缀为空，自动使用供应商类型名称
        if (!this.providerTemplate.name || this.providerTemplate.name.trim() === '') {
            this.providerTemplate.name = getProviderTypeLabel(this.providerTemplate.type);
        }
        
        // 如果是在编辑已有组，预加载该组的模型
        if (this.providerTemplate.url) {
            await this.preloadExistingModels();
        }
        
        // 重新显示
        if (this.contentEl) {
            this.display();
        }
    }
    
    /**
     * 预加载当前类型和URL组合的现有模型
     */
    private async preloadExistingModels() {
        // 清空模型和选择
        this.availableModels = [];
        this.selectedModels.clear();
        this.modelCapabilities.clear();
        this.toggleComponents.clear();
        
        // 标记正在加载状态
        this.isLoadingModels = true;
        
        try {
            // 获取该组现有的模型提供商
            const existingProviders = this.plugin.settings.providers || [];
            const currentGroupProviders = existingProviders.filter(p => 
                p.type === this.providerTemplate.type && 
                (p.url || '') === (this.providerTemplate.url || '')
            );
            
            // 如果有现有模型，尝试提取它们
            if (currentGroupProviders.length > 0) {
                // 尝试加载可用模型列表
                try {
                    // 创建临时提供商对象用于获取模型列表
                    const tempProvider: IAIProvider = {
                        ...this.providerTemplate,
                        id: `temp-${Date.now()}`,
                        name: 'Temporary Provider'
                    };
                    
                    // 获取可用模型列表
                    const models = await this.plugin.aiProviders.fetchModels(tempProvider);
                    this.availableModels = models;
                    
                    // 标记已添加的模型
                    const existingModelNames = new Set(currentGroupProviders.map(p => p.model));
                    models.forEach(model => {
                        if (existingModelNames.has(model)) {
                            this.selectedModels.add(model);
                        }
                    });
                    
                    // 检测模型能力
                    await this.detectModelsCapabilities(tempProvider, models);
                    
                    if (models.length > 0) {
                        new Notice(`已加载 ${models.length} 个可用模型，其中 ${this.selectedModels.size} 个已添加，已完成能力检测`);
                    }
                    
                } catch (error) {
                    // 如果无法获取完整列表，至少显示现有的模型
                    logger.debug('无法获取完整模型列表，仅显示现有模型', error);
                    this.availableModels = Array.from(new Set(currentGroupProviders.map(p => p.model).filter(Boolean) as string[]));
                    this.availableModels.forEach(model => this.selectedModels.add(model));
                    
                    // 对现有模型也进行能力检测
                    const tempProvider: IAIProvider = {
                        ...this.providerTemplate,
                        id: `temp-${Date.now()}`,
                        name: 'Temporary Provider'
                    };
                    await this.detectModelsCapabilities(tempProvider, this.availableModels);
                    
                    new Notice(`无法获取完整模型列表，已加载 ${this.availableModels.length} 个现有模型并完成能力检测`);
                }
            }
        } catch (error) {
            logger.error('预加载现有模型失败:', error);
            new Notice('预加载现有模型失败');
        } finally {
            this.isLoadingModels = false;
            
            // 确保UI更新
            if (this.contentEl) {
                this.display();
            }
        }
    }

    /**
     * 创建新的提供商对象，确保类型安全
     */
    private createProviderObject(model: string, capabilities?: string[]): IAIProvider {
        // 确保有提供商名称前缀，如果没有则使用供应商类型名称
        const namePrefix = this.providerTemplate.name || 
                          getProviderTypeLabel(this.providerTemplate.type) || 
                          this.providerTemplate.type;
        
        // 检查现有提供商以确保名称唯一性
        const existingProviders = this.plugin.settings.providers || [];
        let finalName = namePrefix;
        let counter = 1;
        
        // 如果名称已存在，添加序号
        while (existingProviders.some(p => p.name === finalName)) {
            finalName = `${namePrefix} ${counter}`;
            counter++;
        }
        
        const newProvider: IAIProvider = {
            id: `id-${Date.now().toString()}-${Math.random().toString(36).substring(2, 11)}`,
            // 只使用前缀，不包含模型名称
            name: finalName,
            type: this.providerTemplate.type,
            url: this.providerTemplate.url,
            apiKey: this.providerTemplate.apiKey,
            model: model
        };
        
        // 添加能力信息（如果有）
        if (capabilities && capabilities.length > 0) {
            (newProvider as any).userDefinedCapabilities = capabilities;
        }
        
        return newProvider;
    }

    /**
     * 批量检测模型能力
     * 针对不同提供商类型使用不同的检测策略
     */
    private async detectModelsCapabilities(provider: IAIProvider, models: string[]): Promise<void> {
        if (models.length === 0) return;
        
        logger.debug(`开始检测 ${provider.type} 提供商的 ${models.length} 个模型能力`);
        
        try {
            if (provider.type === 'ollama') {
                await this.detectOllamaCapabilities(provider, models);
            } else {
                // 其他提供商统一设置为未知
                this.setUnknownCapabilities(models);
            }
        } catch (error) {
            logger.error(`检测 ${provider.type} 模型能力失败:`, error);
            // 如果检测失败，为所有模型设置未知能力
            this.setUnknownCapabilities(models);
        }
    }
    
    /**
     * 设置模型能力为未知
     */
    private setUnknownCapabilities(models: string[]): void {
        models.forEach(model => {
            this.modelCapabilities.set(model, ['unknown']);
        });
    }
    
    /**
     * 检测Ollama模型能力
     */
    private async detectOllamaCapabilities(provider: IAIProvider, models: string[]): Promise<void> {
        // 获取Ollama处理器
        // @ts-ignore - 直接访问内部处理器
        const ollamaHandler = this.plugin.aiProviders?.handlers?.ollama;
        
        if (!ollamaHandler || typeof (ollamaHandler as any).detectModelCapabilities !== 'function') {
            logger.warn('Ollama处理器不可用，设置为未知能力');
            this.setUnknownCapabilities(models);
            return;
        }
        
        // 逐个检测每个模型的能力
        for (const model of models) {
            try {
                const tempProvider = { ...provider, model, id: 'temp' };
                const ollamaCapabilities = await (ollamaHandler as any).detectModelCapabilities(tempProvider, model);
                
                if (ollamaCapabilities && ollamaCapabilities.length > 0) {
                    const mappedCapabilities = this.mapModelCapabilities(ollamaCapabilities);
                    
                    // 如果映射成功，使用映射的能力；否则设置为未知
                    if (mappedCapabilities.length > 0) {
                        this.modelCapabilities.set(model, mappedCapabilities);
                        logger.debug(`检测到 ${model} 的能力:`, mappedCapabilities);
                    } else {
                        this.modelCapabilities.set(model, ['unknown']);
                        logger.debug(`${model} 检测到能力但无法映射，设置为未知`);
                    }
                } else {
                    this.modelCapabilities.set(model, ['unknown']);
                    logger.debug(`${model} 未检测到能力，设置为未知`);
                }
            } catch (error) {
                logger.warn(`检测 ${model} 能力失败:`, error);
                this.modelCapabilities.set(model, ['unknown']);
            }
        }
    }
} 