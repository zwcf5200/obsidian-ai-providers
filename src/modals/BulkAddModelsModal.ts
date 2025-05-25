import { App, Modal, Setting, Notice, setIcon, ToggleComponent } from 'obsidian';
import { IAIProvider, AIProviderType } from '@obsidian-ai-providers/sdk';
import { logger } from '../utils/logger';
import AIProvidersPlugin from '../main';
import { I18n } from '../i18n';

export class BulkAddModelsModal extends Modal {
    private isLoadingModels = false;
    private selectedModels: Set<string> = new Set();
    private availableModels: string[] = [];
    private toggleComponents: Map<string, ToggleComponent> = new Map();
    private providerTemplate: IAIProvider;
    
    private readonly defaultProvidersUrls = {
        openai: "https://api.openai.com/v1",
        ollama: "http://localhost:11434",
        gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
        openrouter: "https://openrouter.ai/api/v1",
        lmstudio: "http://localhost:1234/v1",
        groq: "https://api.groq.com/openai/v1",
        custom: "",
    };

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
            url: this.defaultProvidersUrls['ollama'],
            apiKey: '',
            model: '',
        };
    }

    onOpen() {
        const { contentEl } = this;
        
        // 添加标题
        contentEl.createEl('h2', { text: '批量添加模型' });
        
        // 添加提供商基本信息设置
        this.createProviderBasicSettings(contentEl);
        
        // 创建模型选择区域
        this.createModelSelectionArea(contentEl);
        
        // 添加按钮区域
        this.createButtonArea(contentEl);
    }
    
    private createProviderBasicSettings(contentEl: HTMLElement) {
        // 提供商类型
        new Setting(contentEl)
            .setName('提供商类型')
            .setDesc('选择要批量添加模型的提供商类型')
            .addDropdown(dropdown => {
                dropdown
                    .addOptions({
                        "openai": "OpenAI",
                        "ollama": "Ollama",
                        "openrouter": "OpenRouter",
                        "gemini": "Google Gemini",
                        "lmstudio": "LM Studio",
                        "groq": "Groq",
                        "custom": "Custom"
                    })
                    .setValue(this.providerTemplate.type)
                    .onChange(value => {
                        this.providerTemplate.type = value as AIProviderType;
                        this.providerTemplate.url = this.defaultProvidersUrls[value as AIProviderType];
                        this.selectedModels.clear();
                        this.availableModels = [];
                        this.display();
                    });
                return dropdown;
            });
            
        // 提供商名称前缀
        new Setting(contentEl)
            .setName('提供商名称前缀')
            .setDesc('添加的每个模型都将使用此前缀，最终名称格式为：前缀 + 模型名')
            .addText(text => text
                .setPlaceholder('例如：Ollama')
                .setValue(this.providerTemplate.name)
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
        modelAreaEl.createEl('h3', { text: '选择要添加的模型' });
        
        // 添加说明文字
        const descEl = modelAreaEl.createEl('p', { 
            text: '您可以添加新模型或移除现有模型。已添加的模型会自动被标记，取消选择已添加的模型将会在保存时删除它们。' 
        });
        descEl.addClass('bulk-add-description');
        
        // 刷新模型按钮
        const refreshContainer = modelAreaEl.createDiv('bulk-add-refresh-container');
        const refreshButton = refreshContainer.createEl('button', { text: '获取可用模型' });
        refreshButton.addClass('mod-cta');
        
        if (this.isLoadingModels) {
            (refreshButton as HTMLButtonElement).disabled = true;
            refreshButton.setText('正在加载...');
        }
        
        refreshButton.addEventListener('click', async () => {
            await this.fetchModels();
        });
        
        // 添加全选/取消全选按钮
        if (this.availableModels.length > 0) {
            const selectAllContainer = modelAreaEl.createDiv('bulk-add-select-container');
            
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
        
        // 模型列表
        const modelsListEl = modelAreaEl.createDiv('bulk-add-models-list');
        
        if (this.availableModels.length === 0 && !this.isLoadingModels) {
            modelsListEl.createEl('p', { text: '点击上方按钮获取可用模型' });
        } else if (this.isLoadingModels) {
            modelsListEl.createEl('p', { text: '正在加载模型...' });
        } else {
            // 模型过滤输入框
            const filterContainer = modelsListEl.createDiv('bulk-add-filter-container');
            filterContainer.createEl('span', { text: '筛选：' });
            const filterInput = filterContainer.createEl('input') as HTMLInputElement;
            filterInput.type = 'text';
            filterInput.placeholder = '输入关键词筛选模型';
            
            filterInput.addEventListener('input', (e) => {
                const filterValue = (e.target as HTMLInputElement).value.toLowerCase();
                const modelElements = modelsListEl.querySelectorAll('.bulk-add-model-item');
                
                modelElements.forEach(el => {
                    const modelName = el.getAttribute('data-model-name') || '';
                    if (modelName.toLowerCase().includes(filterValue)) {
                        (el as unknown as HTMLElement).style.display = '';
                    } else {
                        (el as unknown as HTMLElement).style.display = 'none';
                    }
                });
            });
            
            // 显示已选择的模型数量
            const selectedCountEl = modelsListEl.createDiv('bulk-add-selected-count');
            selectedCountEl.setText(`已选择 ${this.selectedModels.size} 个模型`);
            
            // 创建模型列表
            this.availableModels.forEach(model => {
                const modelItemEl = modelsListEl.createDiv('bulk-add-model-item');
                modelItemEl.setAttribute('data-model-name', model);
                
                // 检查是否是已添加的模型
                const isExistingModel = this.selectedModels.has(model);
                if (isExistingModel) {
                    modelItemEl.addClass('bulk-add-model-existing');
                }
                
                const setting = new Setting(modelItemEl);
                
                // 为已添加的模型添加标记
                if (isExistingModel) {
                    const nameEl = setting.nameEl.createSpan('bulk-add-existing-indicator');
                    nameEl.setText('[已添加] ');
                    nameEl.setAttr('title', '此模型已添加到配置中');
                }
                
                setting.setName(model)
                    .addToggle(toggle => {
                        toggle.setValue(this.selectedModels.has(model))
                            .onChange(value => {
                                if (value) {
                                    this.selectedModels.add(model);
                                } else {
                                    this.selectedModels.delete(model);
                                }
                                selectedCountEl.setText(`已选择 ${this.selectedModels.size} 个模型`);
                            });
                        
                        this.toggleComponents.set(model, toggle);
                        return toggle;
                    });
            });
        }
    }
    
    private createButtonArea(contentEl: HTMLElement) {
        const buttonContainer = contentEl.createDiv('bulk-add-button-container');
        
        const saveButton = buttonContainer.createEl('button', { text: '添加所选模型' });
        saveButton.addClass('mod-cta');
        saveButton.addEventListener('click', async () => {
            if (this.selectedModels.size === 0) {
                new Notice('请至少选择一个模型');
                return;
            }
            
            if (!this.providerTemplate.name) {
                new Notice('请设置提供商名称前缀');
                return;
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
            
            // 创建临时提供商对象用于获取模型列表
            const tempProvider: IAIProvider = {
                ...this.providerTemplate,
                id: `temp-${Date.now()}`,
                name: 'Temporary Provider'
            };
            
            const models = await this.plugin.aiProviders.fetchModels(tempProvider);
            this.availableModels = models;
            
            // 清空之前的选择
            this.selectedModels.clear();
            this.toggleComponents.clear();
            
            // 获取已经添加的模型
            const existingProviders = this.plugin.settings.providers || [];
            const existingModels = new Set(
                existingProviders
                    .filter(p => p.type === this.providerTemplate.type && 
                           (p.url || '') === (this.providerTemplate.url || ''))
                    .map(p => p.model)
            );
            
            // 标记已添加的模型为已选择
            models.forEach(model => {
                if (existingModels.has(model)) {
                    this.selectedModels.add(model);
                }
            });
            
            if (models.length === 0) {
                new Notice('未找到可用模型');
            } else {
                new Notice(`发现 ${models.length} 个可用模型，其中 ${this.selectedModels.size} 个已添加`);
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
        
        // 2. 添加新选择的模型
        for (const model of this.selectedModels) {
            // 如果模型已存在，跳过添加
            if (existingModelMap.has(model)) {
                skippedCount++;
                continue;
            }
            
            const provider: IAIProvider = {
                ...this.providerTemplate,
                id: `id-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                name: `${this.providerTemplate.name} ${model}`,
                model: model,
                availableModels: [model]
            };
            
            providers.push(provider);
            newCount++;
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
            if (skippedCount > 0) messagePoints.push(`${skippedCount} 个模型保持不变`);
            
            const message = messagePoints.join('，');
            new Notice(message || '没有模型变更');
            
            this.close();
        } catch (error) {
            logger.error('保存模型失败:', error);
            new Notice('保存模型失败');
        }
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
    
    display() {
        const { contentEl } = this;
        contentEl.empty();
        this.onOpen();
    }
} 