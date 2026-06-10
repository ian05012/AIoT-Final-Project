import asyncio
import http.server
import socketserver
import threading
import os
import sys
import websockets
import json
import time

# 強制 stdout/stderr 使用 UTF-8，避免 ESP32 debug 訊息中的 emoji 造成 cp950 crash
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

# 嘗試載入 Serial 模組以供 USB 本地 Demo 使用
try:
    import serial
    import serial.tools.list_ports
    SERIAL_AVAILABLE = True
except ImportError:
    SERIAL_AVAILABLE = False

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
main_loop = None  # 用於儲存主執行緒的事件循環，以便序列埠執行緒調用廣播

# USB 序列埠實例與控制
serial_port = None

async def broadcast_message(message):
    """將消息廣播給所有連接的 WebSocket 客戶端（網頁端、Godot桌寵等）"""
    if connected_clients:
        websockets_to_remove = set()
        for client in connected_clients:
            try:
                await client.send(message)
            except websockets.exceptions.ConnectionClosed:
                websockets_to_remove.add(client)
        
        if websockets_to_remove:
            connected_clients.difference_update(websockets_to_remove)

def write_to_serial(message):
    """將 WebSocket 收到的健康階段封包寫入 USB 序列埠，傳送給 ESP32 控制蜂鳴器"""
    global serial_port
    if serial_port and serial_port.is_open:
        try:
            # 確保結尾有換行符，以便 Arduino 端的 Deserialization
            serial_port.write((message + "\n").encode('utf-8'))
            print(f"[WS -> USB Serial] {message}")
        except Exception as e:
            print(f"[USB Serial] 寫入失敗: {e}")
            try:
                serial_port.close()
            except:
                pass
            serial_port = None

def serial_read_thread():
    """背景執行緒：自動搜尋並連線 ESP32 序列埠，讀取感測器數據並轉發給 WebSocket"""
    global serial_port, main_loop
    print("[USB Serial] 背景掃描執行緒已啟動...")
    
    while True:
        if serial_port is None or not serial_port.is_open:
            # 自動偵測可用的 COM Port
            ports = list(serial.tools.list_ports.comports())
            target_port = None
            
            for p in ports:
                # 優先尋找常見的 USB 轉串口晶片名稱
                if any(x in p.description for x in ["USB", "CH340", "CP210", "Silicon Labs", "FTDI"]):
                    target_port = p.device
                    break
            
            # 若無明確的 USB 串口標示，但有可用串口，則選取第一個
            if not target_port and ports:
                target_port = ports[0].device
            
            if target_port:
                try:
                    serial_port = serial.Serial(target_port, 115200, timeout=1)
                    print(f"[USB Serial] 成功連線至序列埠: {target_port} (Baudrate: 115200)")
                except Exception as e:
                    print(f"[USB Serial] 無法開啟序列埠 {target_port}: {e}")
                    serial_port = None
            
            if serial_port is None:
                # 未找到或開啟失敗，等待 3 秒後重新掃描
                time.sleep(3)
                continue

        # 讀取序列埠數據
        try:
            line = serial_port.readline().decode('utf-8', errors='ignore').strip()
            if line:
                # 驗證是否為合格的 JSON 數據
                try:
                    json.loads(line)
                    print(f"[USB Serial -> WS] {line}")
                    # 將讀取到的 JSON 轉發給 WebSocket 客戶端
                    if main_loop:
                        asyncio.run_coroutine_threadsafe(broadcast_message(line), main_loop)
                except json.JSONDecodeError:
                    # 若不是 JSON，則視為普通的偵錯輸出 (Serial.print)
                    print(f"[ESP32 Debug] {line}")
        except Exception as e:
            print(f"[USB Serial] 讀取錯誤: {e}")
            try:
                serial_port.close()
            except:
                pass
            serial_port = None

async def handler(websocket):
    remote = websocket.remote_address
    print(f"[WebSocket] 新連線: {remote}，目前總數: {len(connected_clients)+1}")
    connected_clients.add(websocket)
    try:
        async for message in websocket:
            await broadcast_message(message)
            write_to_serial(message)
    except websockets.exceptions.ConnectionClosed as e:
        print(f"[WebSocket] 連線正常關閉: {remote} code={e.code}")
    except Exception as e:
        print(f"[WebSocket] 非預期錯誤: {remote} {type(e).__name__}: {e}")
    finally:
        connected_clients.discard(websocket)
        print(f"[WebSocket] 連線結束: {remote}，剩餘: {len(connected_clients)}")

def log_request(connection, request):
    """記錄每一個抵達 WS 埠的 HTTP 請求（含 Origin、Upgrade 等 header）"""
    print(f"[WS-REQ] {connection.remote_address} → {request.path}")
    for k, v in request.headers.items():
        print(f"  {k}: {v}")
    return None  # 繼續正常握手

async def start_ws_server():
    global main_loop
    main_loop = asyncio.get_running_loop()
    async with websockets.serve(handler, "127.0.0.1", PORT_WS, reuse_address=True,
                                compression=None, process_request=log_request), \
               websockets.serve(handler, "::1",       PORT_WS, reuse_address=True,
                                compression=None, process_request=log_request):
        print(f"[WebSocket] 伺服器已啟動，正在監聽 ws://localhost:{PORT_WS} (IPv4+IPv6)")
        await asyncio.Future()  # 永遠運行

def main():
    # 確保 public 目錄存在
    os.makedirs(DIRECTORY_HTTP, exist_ok=True)
    
    # 啟動 HTTP 服務執行緒
    http_thread = threading.Thread(target=start_http_server, daemon=True)
    http_thread.start()
    
    # 啟動 USB 序列埠橋接執行緒 (若載入模組成功)
    if SERIAL_AVAILABLE:
        serial_thread = threading.Thread(target=serial_read_thread, daemon=True)
        serial_thread.start()
    else:
        print("[⚠️警告] 無法載入 pyserial 模組，USB 序列埠直連功能將無法運作！請執行 `pip install pyserial` 安裝。")
    
    # 啟動 WebSocket 服務
    try:
        asyncio.run(start_ws_server())
    except KeyboardInterrupt:
        print("\n[Server] 伺服器正在關閉...")
        if serial_port and serial_port.is_open:
            serial_port.close()

if __name__ == "__main__":
    main()
