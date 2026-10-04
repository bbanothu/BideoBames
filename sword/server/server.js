// Serves the game and relays multiplayer messages between players in a room.
//
// Protocol (JSON over WebSocket at /ws), mirroring the 2D game's relay but with rooms of many:
//   -> {cmd:"host", name}              <- {cmd:"hosted", code, id}
//   -> {cmd:"join", code, name}        <- {cmd:"joined", id, hostId, peers:[{id,name}]}
//                                      others <- {cmd:"peer_joined", id, name}
//   -> {cmd:"msg", to?, ...}           relayed to `to` (or everyone else) with `from` added
//   disconnect                         others <- {cmd:"peer_left", id}; host leaving closes the room
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { networkInterfaces } from "node:os";
import { WebSocketServer } from "ws";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const PORT = Number(process.env.PORT) || 8137;
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
const MAX_PLAYERS = 16;
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".glb": "model/gltf-binary", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml",
};

const http = createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (path.endsWith("/")) path += "index.html";
    const file = normalize(join(ROOT, path));
    // Only files inside the game folder, never server code, sources or dependencies.
    if (!file.startsWith(ROOT + "/") || /\/(server|node_modules|blender|assets\/source)\//.test(file.slice(ROOT.length))) throw 0;
    if (!(await stat(file)).isFile()) throw 0;
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404).end("not found");
  }
});

const rooms = new Map(); // code -> { hostId, members: Map<id, {ws, name}>, nextId }
const wss = new WebSocketServer({ server: http, path: "/ws", maxPayload: 64 * 1024 });

const send = (ws, obj) => ws.readyState === 1 && ws.send(JSON.stringify(obj));
const clean = (name) => String(name || "Ashen").replace(/[^\p{L}\p{N} _-]/gu, "").slice(0, 16) || "Ashen";

function makeCode() {
  for (;;) {
    const code = Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join("");
    if (!rooms.has(code)) return code;
  }
}

wss.on("connection", (ws) => {
  let room = null;
  let id = 0;

  ws.on("message", (raw) => {
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }
    if (data.cmd === "host" && !room) {
      const code = makeCode();
      room = { code, hostId: 1, members: new Map(), nextId: 2 };
      id = 1;
      room.members.set(id, { ws, name: clean(data.name) });
      rooms.set(code, room);
      send(ws, { cmd: "hosted", code, id });
    } else if (data.cmd === "join" && !room) {
      const r = rooms.get(String(data.code || "").toUpperCase().trim());
      if (!r) return send(ws, { cmd: "error", message: "No match with that code" });
      if (r.members.size >= MAX_PLAYERS) return send(ws, { cmd: "error", message: "That match is full" });
      room = r;
      id = r.nextId++;
      const name = clean(data.name);
      const peers = [...r.members].map(([pid, m]) => ({ id: pid, name: m.name }));
      r.members.set(id, { ws, name });
      send(ws, { cmd: "joined", id, hostId: r.hostId, code: r.code, peers });
      for (const [pid, m] of r.members) if (pid !== id) send(m.ws, { cmd: "peer_joined", id, name });
    } else if (data.cmd === "msg" && room) {
      data.from = id;
      const out = JSON.stringify(data);
      if (data.to) {
        const m = room.members.get(data.to);
        if (m && m.ws.readyState === 1) m.ws.send(out);
      } else for (const [pid, m] of room.members) if (pid !== id && m.ws.readyState === 1) m.ws.send(out);
    }
  });

  ws.on("close", () => {
    if (!room) return;
    room.members.delete(id);
    if (id === room.hostId) {
      for (const m of room.members.values()) send(m.ws, { cmd: "room_closed" });
      rooms.delete(room.code);
    } else for (const m of room.members.values()) send(m.ws, { cmd: "peer_left", id });
  });
});

http.listen(PORT, () => {
  const ips = Object.values(networkInterfaces()).flat().filter((i) => i && i.family === "IPv4" && !i.internal).map((i) => i.address);
  console.log(`Ashen Oath on http://localhost:${PORT}`);
  for (const ip of ips) console.log(`  friends on your network: http://${ip}:${PORT}`);
});
