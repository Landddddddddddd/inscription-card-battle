// 联机客户端封装：连接服务端 WebSocket，转发消息给回调。
// 服务端在同源的同一端口上提供 WS（见 server.js）。
export function openCoop(handlers) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}`);
  ws.onopen = () => handlers.onOpen && handlers.onOpen();
  ws.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    handlers.onMessage && handlers.onMessage(msg);
  };
  ws.onclose = () => handlers.onClose && handlers.onClose();
  ws.onerror = () => handlers.onError && handlers.onError();
  return {
    send(obj) { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); },
    close() { ws.close(); },
    get ready() { return ws.readyState === 1; },
  };
}
