export type PathConfig = { mode: "raw" | "path"; path: string };

/**
 * Extracts a numeric value from an MQTT payload.
 *
 * In "raw" mode: decodes the payload as UTF-8 and parses it as a float.
 * In "path" mode: decodes as UTF-8, parses as JSON, walks the dot-separated path,
 * and converts the leaf value to a number.
 *
 * Returns null if the value cannot be parsed to a finite number, or on any error.
 */
export function extractValue(
  payload: Uint8Array,
  config: PathConfig
): number | null {
  try {
    const text = new TextDecoder().decode(payload);

    if (config.mode === "raw") {
      const num = parseFloat(text);
      return Number.isFinite(num) ? num : null;
    }

    // mode === "path"
    const obj = JSON.parse(text);
    let current: unknown = obj;

    for (const segment of config.path.split(".").filter(Boolean)) {
      if (current === null || typeof current !== "object") return null;
      current = (current as Record<string, unknown>)[segment];
    }

    const num = Number(current);
    return Number.isFinite(num) ? num : null;
  } catch {
    return null;
  }
}

/**
 * Walks a parsed JSON object and collects all leaf paths in dot-notation.
 * Used to populate the path selector autocomplete in ChartPane.
 *
 * Stops at non-objects or when depth exceeds 8 to avoid infinite recursion on circular references.
 */
export function collectJsonPaths(
  obj: unknown,
  prefix = "",
  depth = 0,
  maxDepth = 8
): string[] {
  const paths: string[] = [];

  if (depth > maxDepth || obj === null || typeof obj !== "object") {
    return paths;
  }

  if (Array.isArray(obj)) {
    // For arrays, treat the first element as the schema (common pattern in JSON)
    if (obj.length > 0) {
      return collectJsonPaths(obj[0], prefix, depth, maxDepth);
    }
    return paths;
  }

  const objRecord = obj as Record<string, unknown>;
  for (const [key, value] of Object.entries(objRecord)) {
    const newPath = prefix ? `${prefix}.${key}` : key;

    // Leaf: a non-object value
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      paths.push(newPath);
    } else {
      // Recurse into objects
      paths.push(...collectJsonPaths(value, newPath, depth + 1, maxDepth));
    }
  }

  return paths;
}
