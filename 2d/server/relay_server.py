import asyncio
import json
import random
import string

import websockets

CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0/O/1/I, avoids confusion
PORT = 9080

lobbies = {}   # code -> host websocket (waiting for a joiner)
partner = {}   # websocket -> partner websocket (once paired)


def make_code():
    while True:
        code = "".join(random.choice(CODE_CHARS) for _ in range(4))
        if code not in lobbies:
            return code


async def send(ws, obj):
    try:
        await ws.send(json.dumps(obj))
    except websockets.ConnectionClosed:
        pass


async def cleanup(ws):
    for code, host_ws in list(lobbies.items()):
        if host_ws is ws:
            del lobbies[code]
    peer = partner.pop(ws, None)
    if peer is not None:
        partner.pop(peer, None)
        await send(peer, {"cmd": "peer_left"})


async def handler(ws):
    try:
        async for raw in ws:
            try:
                data = json.loads(raw)
            except ValueError:
                continue
            cmd = data.get("cmd")

            if cmd == "host":
                code = make_code()
                lobbies[code] = ws
                await send(ws, {"cmd": "hosted", "code": code})

            elif cmd == "join":
                code = str(data.get("code", "")).upper()
                host_ws = lobbies.pop(code, None)
                if host_ws is None:
                    await send(ws, {"cmd": "error", "message": "Lobby not found"})
                    continue
                partner[ws] = host_ws
                partner[host_ws] = ws
                await send(host_ws, {"cmd": "paired", "role": "host"})
                await send(ws, {"cmd": "paired", "role": "joiner"})

            elif cmd == "msg":
                peer = partner.get(ws)
                if peer is not None:
                    data["cmd"] = "msg"
                    await send(peer, data)
    finally:
        await cleanup(ws)


async def main():
    async with websockets.serve(handler, "0.0.0.0", PORT, max_size=2**16):
        print(f"Relay server listening on :{PORT}")
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
