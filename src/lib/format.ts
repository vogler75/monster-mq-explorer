const textDecoder = new TextDecoder();

export function payloadToString(payload: Uint8Array): string {
  return textDecoder.decode(payload);
}

export function tryParseJson(str: string): unknown | null {
  if (!str.startsWith("{") && !str.startsWith("[") && !str.startsWith('"')) {
    return null;
  }
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

export function payloadToHex(payload: Uint8Array): string {
  return Array.from(payload)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join(" ");
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
  });
}
