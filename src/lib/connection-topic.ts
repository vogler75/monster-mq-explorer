/**
 * Topics in the UI are prefixed with their connection name so multiple
 * connection trees can share one topic store. Broker operations must never
 * send that UI-only prefix back to the broker.
 */
export function stripConnectionPrefix(topic: string, connectionName: string): string {
  if (!connectionName) return topic;
  const prefix = `${connectionName}/`;
  return topic.startsWith(prefix) ? topic.slice(prefix.length) : topic;
}
