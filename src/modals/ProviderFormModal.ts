import { App, Modal, Setting, Notice } from 'obsidian';
import { I18n } from '../i18n';
import { IAIProvider } from '@obsidian-ai-providers/sdk';
import { logger } from '../utils/logger';
import AIProvidersPlugin from '../main';

export class ProviderFormModal extends Modal {
    private isLoadingModels = false;
    private readonly defaultProvidersUrls = {
        openai: "https://api.openai.com/v1",
        ollama: "http://localhost:11434"
    };

    constructor(
        app: App,
        private plugin: AIProvidersPlugin,
        private provider: IAIProvider,
        private onSave: (provider: IAIProvider) => Promise<void>,
        private isAddingNew = false
    ) {
        super(app);
    }

    onOpen() {
        const { contentEl } = this;
        
        // Add form title
        contentEl.createEl('h2', { 
            text: this.isAddingNew 
                ? I18n.t('settings.addNewProvider')
                : I18n.t('settings.editProvider') 
        }).setAttribute('data-testid', 'provider-form-title');

        new Setting(contentEl)
            .setName(I18n.t('settings.providerType'))
            .setDesc(I18n.t('settings.providerTypeDesc'))
            .addDropdown(dropdown => {
                dropdown
                    .addOptions({
                        "openai": "OpenAI",
                        "ollama": "Ollama"
                    })
                    .setValue(this.provider.type)
                    .onChange(value => {
                        this.provider.type = value as 'openai' | 'ollama';
                        this.provider.url = this.defaultProvidersUrls[value as 'openai' | 'ollama'];
                        this.provider.availableModels = undefined;
                        this.provider.model = undefined;
                        this.display();
                    });
                
                dropdown.selectEl.setAttribute('data-testid', 'provider-type-dropdown');
                return dropdown;
            });

        new Setting(contentEl)
            .setName(I18n.t('settings.providerName'))
            .setDesc(I18n.t('settings.providerNameDesc'))
            .addText(text => text
                .setPlaceholder(I18n.t('settings.providerNamePlaceholder'))
                .setValue(this.provider.name)
                .onChange(value => this.provider.name = value));

        new Setting(contentEl)
            .setName(I18n.t('settings.providerUrl'))
            .setDesc(I18n.t('settings.providerUrlDesc'))
            .addText(text => text
                .setPlaceholder(I18n.t('settings.providerUrlPlaceholder'))
                .setValue(this.provider.url || '')
                .onChange(value => this.provider.url = value));

        new Setting(contentEl)
            .setName(I18n.t('settings.apiKey'))
            .setDesc(I18n.t('settings.apiKeyDesc'))
            .addText(text => text
                .setPlaceholder(I18n.t('settings.apiKeyPlaceholder'))
                .setValue(this.provider.apiKey || '')
                .onChange(value => this.provider.apiKey = value));

        new Setting(contentEl)
            .setName(I18n.t('settings.model'))
            .setDesc(I18n.t('settings.modelDesc'))
            .addDropdown(dropdown => {
                if (this.isLoadingModels) {
                    dropdown.addOption('loading', I18n.t('settings.loadingModels'));
                    dropdown.setDisabled(true);
                } else {
                    const models = this.provider.availableModels;
                    if (!models || models.length === 0) {
                        dropdown.addOption('none', I18n.t('settings.noModelsAvailable'));
                        dropdown.setDisabled(true);
                    } else {
                        models.forEach(model => {
                            dropdown.addOption(model, model);
                            // Add title attribute to option elements
                            const options = dropdown.selectEl.options;
                            const lastOption = options[options.length - 1];
                            lastOption.title = model;
                        });
                        dropdown.setDisabled(false);
                    }
                }

                dropdown
                    .setValue(this.provider.model || "")
                    .onChange(value => {
                        this.provider.model = value;
                        // Update title when selection changes
                        dropdown.selectEl.title = value;
                    });
                
                dropdown.selectEl.setAttribute('data-testid', 'model-dropdown');
                dropdown.selectEl.title = this.provider.model || "";
                dropdown.selectEl.parentElement?.addClass('ai-providers-model-dropdown');
                return dropdown;
            })
            .addButton(button => {
                button
                    .setIcon("refresh-cw")
                    .setTooltip(I18n.t('settings.refreshModelsList'));
                
                button.buttonEl.setAttribute('data-testid', 'refresh-models-button');
                
                if (this.isLoadingModels) {
                    button.setDisabled(true);
                    button.buttonEl.addClass('loading');
                }
                
                button.onClick(async () => {
                    try {
                        this.isLoadingModels = true;
                        this.display();
                        
                        const models = await this.plugin.aiProviders.fetchModels(this.provider);
                        this.provider.availableModels = models;
                        if (models.length > 0) {
                            this.provider.model = models[0] || "";
                        }
                        
                        new Notice(I18n.t('settings.modelsUpdated'));
                    } catch (error) {
                        logger.error('Failed to fetch models:', error);
                        new Notice(I18n.t('errors.failedToFetchModels'));
                    } finally {
                        this.isLoadingModels = false;
                        this.display();
                    }
                });
            });

        new Setting(contentEl)
            .addButton(button => button
                .setButtonText(I18n.t('settings.save'))
                .setCta()
                .onClick(async () => {
                    await this.onSave(this.provider);
                    this.close();
                }))
            .addButton(button => {
                button
                    .setButtonText(I18n.t('settings.cancel'))
                    .onClick(() => {
                        this.close();
                    });
                button.buttonEl.setAttribute('data-testid', 'cancel-button');
                return button;
            });
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