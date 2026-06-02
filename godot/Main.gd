extends Node2D

# 視窗拖曳狀態變數
var dragging = false
var drag_offset = Vector2()

func _ready():
    # 程式碼層面強制開啟視窗透明背景與無邊框 (Godot 4.x API)
    get_viewport().transparent_bg = true
    DisplayServer.window_set_flag(DisplayServer.WINDOW_FLAG_BORDERLESS, true)
    DisplayServer.window_set_flag(DisplayServer.WINDOW_FLAG_ALWAYS_ON_TOP, true)
    
    # 讓視窗能夠接受每像素透明度 (Per-pixel transparency)
    # 這是在 Windows 下進行去背所需的底層設定
    DisplayServer.window_set_flag(DisplayServer.WINDOW_FLAG_TRANSPARENT, true)

func _input(event):
    # 滑鼠點擊拖曳視窗移動邏輯
    if event is InputEventMouseButton:
        if event.button_index == MOUSE_BUTTON_LEFT:
            if event.pressed:
                # 判定點擊範圍是否在史萊姆中心區域 (400x400 的中間)
                var mouse_pos = get_local_mouse_position()
                var slime_center = Vector2(200, 260) # 與前端 app.js 的預設渲染高度一致
                # 如果滑鼠與史萊姆距離小於 80 像素，開啟拖曳
                if mouse_pos.distance_to(slime_center) < 80:
                    dragging = true
                    # 記錄滑鼠點擊點與視窗當前位置的偏差量 (全域螢幕座標)
                    drag_offset = DisplayServer.window_get_position() - DisplayServer.mouse_get_position()
            else:
                dragging = false

    # 滑鼠移動時同步移動 OS 視窗
    if event is InputEventMouseMotion and dragging:
        var new_pos = DisplayServer.mouse_get_position() + drag_offset
        DisplayServer.window_set_position(new_pos)
