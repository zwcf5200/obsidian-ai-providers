import { OpenAIHandler } from './OpenAIHandler';
import { IAIProvider } from '@obsidian-ai-providers/sdk';
import { createAIHandlerTests, createDefaultVerifyApiCalls, IMockClient } from '../../test-utils/createAIHandlerTests';

jest.mock('openai');

const createHandler = () => new OpenAIHandler({
    _version: 1,
    debugLogging: false,
    useNativeFetch: false
});

const createMockProvider = (): IAIProvider => ({
    id: 'test-provider',
    name: 'Test Provider',
    type: 'openai',
    url: 'https://api.openai.com/v1',
    apiKey: 'test-key',
    model: 'gpt-4'
});

const createMockClient = (): IMockClient => ({
    models: {
        list: jest.fn().mockResolvedValue({
            data: [
                { id: 'model1' },
                { id: 'model2' }
            ]
        })
    },
    chat: {
        completions: {
            create: jest.fn().mockImplementation(async (_params, { signal }) => {
                const responseStream = {
                    async *[Symbol.asyncIterator]() {
                        for (let i = 0; i < 5; i++) {
                            if (signal?.aborted) {
                                break;
                            }
                            yield { choices: [{ delta: { content: `chunk${i}` } }] };
                        }
                    }
                };
                return responseStream;
            })
        }
    }
});

// Use the default OpenAI verification function
const verifyApiCalls = createDefaultVerifyApiCalls();

// Use createAIHandlerTests for common test cases
createAIHandlerTests(
    'OpenAIHandler',
    createHandler,
    createMockProvider,
    createMockClient,
    verifyApiCalls,
    {
        mockStreamResponse: {
            choices: [{ delta: { content: 'test response' } }]
        },
        // Add image handling test for OpenAI
        imageHandlingOptions: {
            verifyImageHandling: async (handler, mockClient) => {
                // OpenAI image handling is done through content array with image_url objects
                expect(mockClient.chat?.completions.create).toHaveBeenCalledWith(
                    expect.objectContaining({
                        messages: expect.arrayContaining([
                            expect.objectContaining({
                                content: expect.arrayContaining([
                                    expect.objectContaining({ type: 'text' }),
                                    expect.objectContaining({ 
                                        type: 'image_url',
                                        image_url: expect.anything()
                                    })
                                ])
                            })
                        ])
                    }),
                    expect.anything()
                );
            }
        },
        // Add embedding options for OpenAI
        embeddingOptions: {
            mockEmbeddingResponse: [[0.1, 0.2, 0.3]],
            setupEmbedMock: (mockClient) => {
                // Add mock for embeddings API in OpenAI
                (mockClient as any).embeddings = {
                    create: jest.fn().mockResolvedValue({
                        data: [{ embedding: [0.1, 0.2, 0.3], index: 0 }]
                    })
                };
            }
        }
    }
); 