import {
  createShareLink,
  getShareLink,
  initApi,
  revokeShareLink,
} from '../../src/api/endpoints';

global.fetch = jest.fn();

describe('share link endpoints', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    initApi('https://example.com', 'key');
    fetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ link: null }) });
  });

  test('getShareLink uses query params', async () => {
    await getShareLink('note', 'uuid-1');
    expect(fetch.mock.calls[0][0]).toBe(
      'https://example.com/v1/share-links?item_type=note&item_uuid=uuid-1',
    );
  });

  test('createShareLink posts item payload', async () => {
    await createShareLink('shortcut', 'uuid-2');
    expect(fetch.mock.calls[0][0]).toBe('https://example.com/v1/share-links');
    expect(fetch.mock.calls[0][1].body).toBe(
      JSON.stringify({ item_type: 'shortcut', item_uuid: 'uuid-2' }),
    );
  });

  test('revokeShareLink deletes by token', async () => {
    await revokeShareLink('tok');
    expect(fetch.mock.calls[0][0]).toBe('https://example.com/v1/share-links/tok');
    expect(fetch.mock.calls[0][1].method).toBe('DELETE');
  });
});
