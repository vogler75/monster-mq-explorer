const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("mqttIpc", {
  send: (connectionId, command) => ipcRenderer.send("mqtt-tcp", connectionId, command),
  onEvent: (callback) => {
    const handler = (_event, connectionId, workerEvent) => callback(connectionId, workerEvent);
    ipcRenderer.on("mqtt-tcp-event", handler);
    return () => ipcRenderer.removeListener("mqtt-tcp-event", handler);
  },
  /** Tell main process which hosts should bypass TLS cert validation.
   *  Returns a Promise that resolves once the main process has applied the new proc. */
  setIgnoreCertHosts: (hosts) => ipcRenderer.invoke("ignore-cert-hosts", hosts),
  /** Proxy a GraphQL POST request through the main process (Node.js http/https).
   *  Bypasses Chromium's HSTS cache and Web Worker cert-verify limitations. */
  graphqlProxy: (args) => ipcRenderer.invoke("graphql-proxy", args),
});
