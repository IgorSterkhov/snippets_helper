export function createClient(baseUrl, apiKey) {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };

  async function request(method, path, body) {
    const options = { method, headers };
    if (body) options.body = JSON.stringify(body);

    const response = await fetch(`${baseUrl}${path}`, options);
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`${response.status}: ${text}`);
    }
    return response.json();
  }

  return {
    get: (path) => request('GET', path),
    post: (path, body) => request('POST', path, body),
  };
}
