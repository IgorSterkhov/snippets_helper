import { sendAiChat } from '../../src/api/ai';

global.fetch = jest.fn();

describe('AI API', () => {
  beforeEach(() => jest.clearAllMocks());

  test('posts client-channel requests to the AI gateway', async () => {
    fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ mode: 'command', reply: 'ok', commands: [], results: [] }),
    });

    await sendAiChat('https://example.test/snippets-api', 'mobile-key', {
      mode: 'command',
      channel: 'telegram',
      message: 'покажи задачу',
      context: { module: 'ai' },
    });

    expect(fetch).toHaveBeenCalledWith(
      'https://example.test/snippets-api/v1/ai/chat',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer mobile-key' }),
        body: JSON.stringify({
          mode: 'command',
          channel: 'client',
          message: 'покажи задачу',
          context: { module: 'ai' },
        }),
      }),
    );
  });
});
