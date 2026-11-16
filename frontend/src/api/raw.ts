// Простой POST без перехватчиков (нужен для обновления токена)
export class RawRequester {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async postJson(url: string, payload: unknown): Promise<{ status: number; data: any }> {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        credentials: 'same-origin',
      });
      const text = await res.text();
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = null;
      }
      return { status: res.status, data };
    } catch {
      return { status: 0, data: null };
    }
  }
}
