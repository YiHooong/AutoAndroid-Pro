import asyncio, websockets
async def test():
    async with websockets.connect("ws://127.0.0.1:8000/ws/scrcpy?serial=192.168.1.23:5555&max_size=1280&max_fps=60&bit_rate=8M") as ws:
        msg1 = await ws.recv()
        print(f"chunk1: {len(msg1)} bytes, starts with {msg1[:8].hex()}")
asyncio.run(test())
