/** WebSocket relay client, mirrors the 2D version's Net.gd + relay_server.py protocol. */
export class Net {
  constructor() {
    this.ws = null;
    this.onHosted = null;
    this.onPaired = null;
    this.onPeerLeft = null;
    this.onError = null;
    this.onMessage = null;
  }

  hostLobby(url) {
    this._connect(url, { cmd: "host" });
  }

  joinLobby(url, code) {
    this._connect(url, { cmd: "join", code });
  }

  sendState(data) {
    data.cmd = "msg";
    this._send(data);
  }

  close() {
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
  }

  _connect(url, pending) {
    this.close();
    let ws;
    try {
      ws = new WebSocket(url);
    } catch {
      this.onError?.(`Could not connect to ${url}`);
      return;
    }
    this.ws = ws;
    ws.onopen = () => this._send(pending);
    ws.onerror = () => this.onError?.(`Could not connect to ${url}`);
    ws.onclose = () => this.onError?.("Connection closed");
    ws.onmessage = (ev) => {
      let data;
      try {
        data = JSON.parse(ev.data);
      } catch {
        return;
      }
      switch (data.cmd) {
        case "hosted":
          this.onHosted?.(data.code);
          break;
        case "paired":
          this.onPaired?.(data.role);
          break;
        case "peer_left":
          this.onPeerLeft?.();
          break;
        case "error":
          this.onError?.(data.message || "");
          break;
        case "msg":
          this.onMessage?.(data);
          break;
      }
    };
  }

  _send(d) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN)
      this.ws.send(JSON.stringify(d));
  }
}
