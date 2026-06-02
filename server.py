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
main_loop = None

async def broadcast_message(message):
    if not connected_clients:
        return
    websockets_to_remove = set()
    for client in connected_clients:
        try:
            await client.send(message)
        except websockets.exceptions.ConnectionClosed:
            websockets_to_remove.add(client)
    if websockets_to_remove:
        connected_clients.difference_update(websockets_to_remove)

async def handler(websocket):
    # 註冊新連線
    connected_clients.add(websocket)
    print(f"[WebSocket] 新連線已建立。目前連線總數: {len(connected_clients)}")
    try:
        async for message in websocket:
            # 收到前端發送的感測器更新 JSON 數據，廣播給所有連線的客戶端（包括 Godot 與其他網頁分頁）
            # 用於即時同步與 Demo
            await broadcast_message(message)
    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        connected_clients.discard(websocket)
        print(f"[WebSocket] 連線已中斷。目前連線總數: {len(connected_clients)}")

# 讀取 USB Serial 串口並轉發至 WebSocket 廣播之背景線程
def serial_reader_thread(loop):
    try:
        import serial
        import serial.tools.list_ports
        import json
        import time
    except ImportError:
        print("[Serial] 提示: 未安裝 pyserial，無法讀取 USB 實體 Nano 的 PM2.5 資料。")
        print("[Serial] 建議在本機執行: pip install pyserial")
        return

    print("[Serial] USB 串口讀取線程已啟動。開始掃描 Nano 串口...")
    while True:
        ports = list(serial.tools.list_ports.comports())
        nano_port = None
        for p in ports:
            # 偵測常見的 Arduino Nano USB 串口晶片描述 (如 CH340 / FTDI / CP210x 等)
            if "CH340" in p.description or "USB" in p.description or "Arduino" in p.description:
                nano_port = p.device
                break
        
        # 如果沒篩選到特定關鍵字，但只有一個串口，預設選取該串口
        if not nano_port and len(ports) == 1:
            nano_port = ports[0].device

        if nano_port:
            try:
                print(f"[Serial] 嘗試連線至 Nano 串口: {nano_port} (9600 bps)...")
                ser = serial.Serial(nano_port, 9600, timeout=1)
                print(f"[Serial] 成功與 {nano_port} 建立連線！開始轉發 PM2.5 數據。")
                while True:
                    if ser.in_waiting:
                        line = ser.readline().decode('utf-8', errors='ignore').strip()
                        if line.startswith("PM25:"):
                            try:
                                pm25_val = float(line.split(":")[1])
                                # 構造與 ESP32 傳輸格式一致的 JSON
                                packet = {
                                    "device_id": "virtual_esp32_01",
                                    "timestamp": int(time.time()),
                                    "sensors": {
                                        "pm25": pm25_val
                                    }
                                }
                                message = json.dumps(packet)
                                # 將廣播任務線程安全地提交給主事件循環
                                asyncio.run_coroutine_threadsafe(broadcast_message(message), loop)
                            except Exception as e:
                                pass
                    time.sleep(0.1)
            except Exception as e:
                print(f"[Serial] 串口通訊中斷或連線出錯: {e}")
                time.sleep(3)
        else:
            time.sleep(5)

async def start_ws_server():
    global main_loop
    main_loop = asyncio.get_running_loop()
    
    # 啟動串口轉發 WebSocket 背景線程
    serial_thread = threading.Thread(target=serial_reader_thread, args=(main_loop,), daemon=True)
    serial_thread.start()

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
