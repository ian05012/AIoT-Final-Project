extends Node

# 當收到硬體或模擬器的封包時發送此訊號，將資料傳遞給 Slime 節點
signal packet_received(data: Dictionary)

var socket = WebSocketPeer.new()
const WS_URL = "ws://127.0.0.1:3000"
var is_connected = false
var reconnect_timer = 0.0
const RECONNECT_INTERVAL = 3.0 # 連線中斷後 3 秒自動重試

func _ready():
	_connect_ws()

func _connect_ws():
	print("[Network] 正在連線至 WebSocket 伺服器: ", WS_URL)
	var err = socket.connect_to_url(WS_URL)
	if err != OK:
		print("[Network] 初始化連線失敗！")
	is_connected = false

func _process(delta):
	# 必須每幀調用 poll() 來更新網路狀態與讀取封包
	socket.poll()
	
	var state = socket.get_ready_state()
	
	if state == WebSocketPeer.STATE_OPEN:
		if not is_connected:
			print("[Network] WebSocket 連線成功！已加入廣播頻道。")
			is_connected = true
			
		# 讀取所有待處理的封包
		while socket.get_available_packet_count() > 0:
			var packet = socket.get_packet()
			var text = packet.get_string_from_utf8()
			_parse_json_packet(text)
			
	elif state == WebSocketPeer.STATE_CLOSED or state == WebSocketPeer.STATE_CONNECTING:
		if is_connected:
			print("[Network] WebSocket 連線中斷！")
			is_connected = false
			
		# 自動重連計時器
		reconnect_timer += delta
		if reconnect_timer >= RECONNECT_INTERVAL:
			reconnect_timer = 0.0
			_connect_ws()

func _parse_json_packet(text):
	var json = JSON.new()
	var error = json.parse(text)
	if error == OK:
		var data = json.get_data()
		# 驗證資料是否來自智慧座墊模擬器
		if data.has("device_id") and (data["device_id"] == "virtual_esp32_01" or data["device_id"] == "virtual_esp32_other"):
			emit_signal("packet_received", data)
	else:
		print("[Network] 解析 JSON 封包錯誤: ", json.get_error_message())
