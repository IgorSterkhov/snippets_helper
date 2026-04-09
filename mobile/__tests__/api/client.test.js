import { createClient } from '../../src/api/client';

global.fetch = jest.fn();

describe('API client', () => {
  beforeEach(() => jest.clearAllMocks());

  test('adds Bearer token to requests', async () => {
    fetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ status: 'ok' }) });
    const client = createClient('https://example.com', 'test-key-123');
    await client.get('/v1/health');
    expect(fetch).toHaveBeenCalledWith(
      'https://example.com/v1/health',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer test-key-123' }),
      }),
    );
  });

  test('post sends JSON body', async () => {
    fetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ status: 'ok' }) });
    const client = createClient('https://example.com', 'test-key-123');
    await client.post('/v1/sync/push', { changes: {} });
    expect(fetch).toHaveBeenCalledWith(
      'https://example.com/v1/sync/push',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ changes: {} }),
      }),
    );
  });

  test('throws on non-ok response', async () => {
    fetch.mockResolvedValue({ ok: false, status: 401, text: () => Promise.resolve('Unauthorized') });
    const client = createClient('https://example.com', 'bad-key');
    await expect(client.get('/v1/auth/me')).rejects.toThrow('401');
  });
});
