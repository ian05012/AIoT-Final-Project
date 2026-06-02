import asyncio
import http.server
import socketserver
import threading
import os
import websockets

# 設定靜態網頁服務
PORT_HTTP = 8000
DIRECTORY_HTTP = os.path.join(os.path.dirname(os.path.abspath(__file__)), "public")

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY_HTTP, **kwargs)

def start_http_server():
    # 允許地址重複使用以防止重啟時出現 Address already in use
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT_HTTP), Handler) as httpd:
        print(f"[HTTP] 伺服器已啟動，請在瀏覽器打開: http://localhost:{PORT_HTTP}")
        httpd.serve_forever()

# WebSocket 廣播
PORT_WS = 3000
connected_clients = set()

async def handler(websocket):
    # 註冊新連線
    connected_clients.add(websocket)
    print(f"[WebSocket] 新連線已建立。目前連線總數: {len(connected_clients)}")
    try:
        async for message in websocket:
            # 收到前端發送的感測器更新 JSON 數據，廣播給所有連線的客戶端（包括 Godot 與其他網頁分頁）
            # 用於即時同步與 Demo
            websockets_to_remove = set()
            for client in connected_clients:
                try:
                    await client.send(message)
                except websockets.exceptions.ConnectionClosed:
                    websockets_to_remove.add(client)
            
            if websockets_to_remove:
                connected_clients.difference_update(websockets_to_remove)
    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        connected_clients.discard(websocket)
        print(f"[WebSocket] 連線已中斷。目前連線總數: {len(connected_clients)}")

async def start_ws_server():
    async with websockets.serve(handler, "0.0.0.0", PORT_WS):
        print(f"[WebSocket] 伺服器已啟動，正在監聽 ws://localhost:{PORT_WS}")
        await asyncio.Future()  # 永遠運行

def main():
    # 確保 public 目錄存在
    os.makedirs(DIRECTORY_HTTP, exist_ok=True)
    
    # 啟動 HTTP 服務線程
    http_thread = threading.Thread(target=start_http_server, daemon=True)
    http_thread.start()
    
    # 啟動 WebSocket 服務
    try:
        asyncio.run(start_ws_server())
    except KeyboardInterrupt:
        print("\n[Server] 伺服器正在關閉...")

if __name__ == "__main__":
    main()
