extends Node2D

# 視窗拖曳狀態變數
var dragging = false
var drag_offset = Vector2()
var last_passthrough_pos = Vector2()

func _ready():
    print("[Main] 視窗腳本載入成功，正在初始化透明與置頂設定...")
    # 程式碼層面強制開啟視窗透明背景與無邊框 (Godot 4.x API)
    get_viewport().transparent_bg = true
    DisplayServer.window_set_flag(DisplayServer.WINDOW_FLAG_BORDERLESS, true)
    DisplayServer.window_set_flag(DisplayServer.WINDOW_FLAG_ALWAYS_ON_TOP, true)
    
    # 讓視窗能夠接受每像素透明度 (Per-pixel transparency)
    # 這是在 Windows 下進行去背所需的底層設定
    DisplayServer.window_set_flag(DisplayServer.WINDOW_FLAG_TRANSPARENT, true)
    print("[Main] 透明、無邊框與 Always-on-Top 設定完成。")

    # 初始化滑鼠點擊區域 (以預設中心 200, 260 為中心的 160x160 矩形)
    var points = PackedVector2Array([
        Vector2(120, 180),
        Vector2(280, 180),
        Vector2(280, 340),
        Vector2(120, 340)
    ])
    DisplayServer.window_set_mouse_passthrough(points)
    print("[Main] 滑鼠點擊穿透區域初始化完成。")

func _process(_delta):
    # 動態更新 Windows 滑鼠穿透與點擊區域，防止整張透明畫布阻擋滑鼠或點擊失效
    var slime_node = get_node_or_null("Slime")
    if slime_node and not slime_node.is_jumping:
        var current_pos = Vector2(slime_node.draw_x, slime_node.draw_y)
        if current_pos.distance_to(last_passthrough_pos) > 2.0:
            last_passthrough_pos = current_pos
            var x = current_pos.x
            var y = current_pos.y
            var r = 80.0 # 點擊半徑
            var points = PackedVector2Array([
                Vector2(x - r, y - r),
                Vector2(x + r, y - r),
                Vector2(x + r, y + r),
                Vector2(x - r, y + r)
            ])
            DisplayServer.window_set_mouse_passthrough(points)

func _input(event):
    # 除錯：列印所有接收到的輸入事件 (滑鼠點擊與按鍵)
    if event is InputEventMouseButton or event is InputEventKey:
        print("[Main] 接收到輸入事件: ", event.as_text())

    # 滑鼠點擊拖曳視窗移動邏輯
    if event is InputEventMouseButton:
        if event.button_index == MOUSE_BUTTON_LEFT:
            if event.pressed:
                # 取得史萊姆的目前位置以計算動態中心點
                var slime_center = Vector2(200, 260)
                var slime_node = get_node_or_null("Slime")
                if slime_node:
                    slime_center = Vector2(slime_node.draw_x, slime_node.draw_y)
                
                # 判定點擊範圍是否在史萊姆中心區域
                var mouse_pos = get_local_mouse_position()
                var distance = mouse_pos.distance_to(slime_center)
                print("[Main] 偵測到左鍵按下! 滑鼠本地位置: ", mouse_pos, "，寵物中心位置: ", slime_center, "，距離: ", distance)
                
                # 如果滑鼠與史萊姆目前位置的距離小於 80 像素，開啟拖曳並觸發戳擊動畫
                if distance < 80:
                    dragging = true
                    # 記錄滑鼠點擊點與視窗當前位置的偏差量 (全域螢幕座標)
                    drag_offset = DisplayServer.window_get_position() - DisplayServer.mouse_get_position()
                    print("[Main] 點擊在寵物身上！觸發拖曳與戳擊動畫。")
                    # 觸發史萊姆的戳擊/受驚動畫
                    if slime_node:
                        slime_node.poke_timer = 30
                else:
                    print("[Main] 點擊位置距離寵物過遠 (>= 80 像素)，不進行互動。")
            else:
                if dragging:
                    print("[Main] 放開滑鼠左鍵，停止拖曳. ")
                dragging = false

    # 滑鼠移動時同步移動 OS 視窗
    if event is InputEventMouseMotion and dragging:
        var new_pos = DisplayServer.mouse_get_position() + drag_offset
        DisplayServer.window_set_position(new_pos)
