# Obsidian AI Providers

⚠️ Important Note:
This plugin is a configuration tool - it helps you manage your AI settings in one place.

Think of it like a control panel where you can:
- Store your API keys and settings for AI services
- Share these settings with other Obsidian plugins
- Avoid entering the same AI settings multiple times

**The plugin itself doesn't do any AI processing - it just helps other plugins connect to AI services more easily.**

<img width="625" alt="image" src="https://github.com/user-attachments/assets/6ff8bd35-724c-4f1e-b52a-a9419fbba7b4" />

## Supported providers
- Ollama
- OpenAI compatible API

## Features
- Fully encapsulated API for working with AI providers
- Develop AI plugins faster without dealing directly with provider-specific APIs
- Easily extend support for additional AI providers in your plugin
- Available in 4 languages: English, Chinese, German, and Russian (more languages coming soon)

## Installation
### BRAT
You can install this plugin via [BRAT](https://obsidian.md/plugins?id=obsidian42-brat): `pfrankov/obsidian-ai-providers`

## Required by plugins
- [Local GPT](https://github.com/pfrankov/obsidian-local-gpt) (soon)

## For plugin developers
[Docs: How to integrate AI Providers in your plugin.](./packages/sdk/README.md)

## Roadmap
- [x] Docs for devs
- [x] Ollama context optimizations
- [ ] Gemini Provider support
- [ ] Anthropic Provider support
- [ ] Groq Provider support
- [ ] Image processing support
- [ ] Shared embeddings to avoid re-embedding the same documents multiple times
- [ ] Spanish, Italian, French, Dutch, Portuguese, Japanese, Korean translations
- [ ] Incapsulated basic RAG search with optional BM25 search

## My other Obsidian plugins
- [Local GPT](https://github.com/pfrankov/obsidian-local-gpt) that assists with local AI for maximum privacy and offline access.
- [Colored Tags](https://github.com/pfrankov/obsidian-colored-tags) that colorizes tags in distinguishable colors. 
