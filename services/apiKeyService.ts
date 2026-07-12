const SERVER_URL = import.meta.env.VITE_SERVER_URL || (import.meta.env.DEV ? 'http://localhost:3001' : '');

/** Validate a user-provided key without loading the OpenAI SDK in the browser. */
export const validateApiKey = async (apiKey: string): Promise<boolean> => {
    const key = apiKey.trim();
    if (!key) return false;

    try {
        const response = await fetch(`${SERVER_URL}/api/keys/validate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ apiKey: key }),
            signal: AbortSignal.timeout(12_000)
        });
        if (!response.ok) return false;
        const body = await response.json();
        return body?.valid === true;
    } catch {
        return false;
    }
};
