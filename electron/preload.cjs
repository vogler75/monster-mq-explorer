const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("mqttIpc", {
  send: (connectionId, command) => ipcRenderer.send("mqtt-tcp", connectionId, command),
  onEvent: (callback) => {
    const handler = (_event, connectionId, workerEvent) => callback(connectionId, workerEvent);
    ipcRenderer.on("mqtt-tcp-event", handler);
    return () => ipcRenderer.removeListener("mqtt-tcp-event", handler);
  },
  /** Tell main process which hosts should bypass TLS cert validation */
  setIgnoreCertHosts: (hosts) => ipcRenderer.send("ignore-cert-hosts", hosts),
});
