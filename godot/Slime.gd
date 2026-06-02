extends Node2D

# 狀態變數 (由 Network 節點同步)
var health = 10.0
var is_drinking = false
var is_eating = false
var current_eat_color = Color("ff4f43")
var is_happy = false
var is_slouched = false
var is_suffocating = false
var is_tired = false
var is_dehydrated = false

var posture_stage = 0
var dehydration_stage = 0
var sedentary_stage = 0
var air_stage = 0

# 當前選取的角色：slime, cat, ghost, chick, bubble
var selected_pet = "slime"

# 跳躍與變形變數 (模擬 Canvas 位置與跳動)
var draw_x = 200.0
var draw_y = 260.0
var anim_time = 0.0

var jump_progress = 0.0
var is_jumping = false
var squash_count = 0
var jump_height = 60.0
var poke_timer = 0
var jump_timer = 100.0

var start_x = 200.0
var start_y = 260.0
var target_x = 200.0
var target_y = 260.0

# 咀嚼與喝水計時器
var eat_timer: Timer
var drink_timer: Timer
var happy_timer: Timer

# 色彩主題定義
var THEMES = {
    "normal": {
        "main": Color("ff7b90"),
        "shadow": Color("e05068"),
        "core": Color("ff4766"),
        "glow": Color("ff7b9099")
    },
    "water": {
        "main": Color("3da5ff"),
        "shadow": Color("187cdc"),
        "core": Color("187cff"),
        "glow": Color("3da5ffb2")
    },
    "airMild": {
        "main": Color("c98aff"),
        "shadow": Color("9947e6"),
        "core": Color("af57f5"),
        "glow": Color("c98aff80")
    },
    "airSevere": {
        "main": Color("8c15d4"),
        "shadow": Color("5c0594"),
        "core": Color("b338ff"),
        "glow": Color("8c15d4cc")
    },
    "postureMild": {
        "main": Color("ffa347"),
        "shadow": Color("d4751c"),
        "core": Color("ff7c1f"),
        "glow": Color("ffa34780")
    },
    "postureSevere": {
        "main": Color("e3401e"),
        "shadow": Color("a82208"),
        "core": Color("ff2a00"),
        "glow": Color("e3401eb2")
    },
    "dehydrateMild": {
        "main": Color("f3c2c2"),
        "shadow": Color("c88e8e"),
        "core": Color("d57272"),
        "glow": Color("f3c2c266")
    },
    "dehydrateSevere": {
        "main": Color("c0b098"),
        "shadow": Color("908068"),
        "core": Color("8a755d"),
        "glow": Color("c0b0984d")
    },
    "sedentaryMild": {
        "main": Color("8da5bd"),
        "shadow": Color("61788f"),
        "core": Color("6a829a"),
        "glow": Color("8da5bd66")
    },
    "sedentarySevere": {
        "main": Color("526273"),
        "shadow": Color("35424f"),
        "core": Color("3f4c59"),
        "glow": Color("5262734d")
    }
}

func _ready():
    # 綁定網路訊號
    var network = get_parent().get_node_or_null("Network")
    if network:
        network.packet_received.connect(_on_network_data)
    else:
        print("[Slime] 找不到 Network 節點，請確認節點樹結構。")
        
    # 初始化計時器
    eat_timer = Timer.new()
    eat_timer.one_shot = true
    eat_timer.timeout.connect(_on_eat_timeout)
    add_child(eat_timer)
    
    drink_timer = Timer.new()
    drink_timer.one_shot = true
    drink_timer.timeout.connect(_on_drink_timeout)
    add_child(drink_timer)

    happy_timer = Timer.new()
    happy_timer.one_shot = true
    happy_timer.timeout.connect(_on_happy_timeout)
    add_child(happy_timer)

func _on_network_data(packet: Dictionary):
    var status = packet["status"]
    
    health = packet.get("health", health)
    posture_stage = status.get("posture_stage", 0)
    dehydration_stage = status.get("dehydration_stage", 0)
    sedentary_stage = status.get("sedentary_stage", 0)
    air_stage = status.get("air_stage", 0)
    selected_pet = status.get("selected_pet", selected_pet) # 同步來自網頁端的角色選擇
    
    is_slouched = (posture_stage > 0)
    is_suffocating = (air_stage == 2)
    is_tired = (sedentary_stage == 1)
    is_dehydrated = (dehydration_stage > 0)
    
    var is_drinking_packet = status.get("is_drinking", false)
    if is_drinking_packet and not is_drinking:
        is_drinking = true
        is_happy = false
        drink_timer.start(2.5)

func _on_drink_timeout():
    is_drinking = false
    is_happy = true
    happy_timer.start(2.5)

func _on_eat_timeout():
    is_eating = false
    is_happy = true
    happy_timer.start(2.5)

func _on_happy_timeout():
    is_happy = false

func _process(delta):
    anim_time += delta * 60.0
    
    if poke_timer > 0:
        poke_timer -= 1
        
    if squash_count > 0:
        squash_count -= 1
        
    _update_movement(delta)
    queue_redraw()

func _update_movement(delta):
    var can_jump = (posture_stage == 0 and air_stage < 2 and sedentary_stage < 2)
    if can_jump:
        if is_jumping:
            var progress_increment = 0.03
            if poke_timer > 0:
                progress_increment = 0.018
            elif sedentary_stage == 1:
                progress_increment = 0.015
                
            jump_progress += progress_increment
            if jump_progress >= 1.0:
                draw_x = target_x
                draw_y = target_y
                is_jumping = false
                jump_progress = 0.0
                squash_count = 24
                jump_height = 60.0
            else:
                draw_x = lerp(start_x, target_x, jump_progress)
                var linear_y = lerp(start_y, target_y, jump_progress)
                var arc_y = sin(jump_progress * PI) * jump_height
                draw_y = linear_y - arc_y
        else:
            if squash_count == 0:
                jump_timer -= delta * 60.0
                if jump_timer <= 0:
                    start_x = draw_x
                    start_y = draw_y
                    target_x = 80.0 + randf() * 240.0
                    target_y = 220.0 + randf() * 80.0
                    is_jumping = true
                    jump_progress = 0.0
                    jump_timer = (300.0 if sedentary_stage == 1 else 180.0) + randf() * 180.0
    else:
        is_jumping = false
        jump_progress = 0.0
        squash_count = 0

func _input(event):
    if event is InputEventKey and event.pressed:
        # 按下 Tab 鍵循環切換角色
        if event.keycode == KEY_TAB:
            var pets = ["slime", "cat", "ghost", "chick", "bubble"]
            var idx = pets.find(selected_pet)
            selected_pet = pets[(idx + 1) % pets.size()]
            print("[Godot] 本機鍵盤切換角色為: ", selected_pet)
        # 按下 1~5 數字鍵直接選取角色
        elif event.keycode == KEY_1:
            selected_pet = "slime"
        elif event.keycode == KEY_2:
            selected_pet = "cat"
        elif event.keycode == KEY_3:
            selected_pet = "ghost"
        elif event.keycode == KEY_4:
            selected_pet = "chick"
        elif event.keycode == KEY_5:
            selected_pet = "bubble"

func _get_bezier_point(p0: Vector2, p1: Vector2, p2: Vector2, p3: Vector2, t: float) -> Vector2:
    var q0 = p0.lerp(p1, t)
    var q1 = p1.lerp(p2, t)
    var q2 = p2.lerp(p3, t)
    var r0 = q0.lerp(q1, t)
    var r1 = q1.lerp(q2, t)
    return r0.lerp(r1, t)

# 繪製貝茲平滑曲線輔助函數
func _draw_bezier_line(p0: Vector2, p1: Vector2, p2: Vector2, p3: Vector2, color: Color, width: float):
    var pts = PackedVector2Array()
    for i in range(11):
        var t = float(i) / 10.0
        pts.append(_get_bezier_point(p0, p1, p2, p3, t))
    draw_polyline(pts, color, width, true)

# 繪製旋轉橢圓輔助函數
func _draw_rotated_ellipse(center: Vector2, radius_x: float, radius_y: float, angle: float, color: Color, stroke_color: Color = Color(0,0,0,0), stroke_width: float = 0.0):
    var pts = PackedVector2Array()
    var segments = 32
    for i in range(segments + 1):
        var a = float(i) * 2.0 * PI / float(segments)
        var p = Vector2(cos(a) * radius_x, sin(a) * radius_y).rotated(angle) + center
        pts.append(p)
    draw_colored_polygon(pts, color)
    if stroke_width > 0:
        draw_polyline(pts, stroke_color, stroke_width, true)

func _draw():
    # 1. 顏色主題判定
    var theme = THEMES["normal"]
    if air_stage == 2:
        theme = THEMES["airSevere"]
    elif dehydration_stage == 2:
        theme = THEMES["dehydrateSevere"]
    elif posture_stage == 2:
        theme = THEMES["postureSevere"]
    elif sedentary_stage == 2:
        theme = THEMES["sedentarySevere"]
    elif air_stage == 1:
        theme = THEMES["airMild"]
    elif dehydration_stage == 1:
        theme = THEMES["dehydrateMild"]
    elif posture_stage == 1:
        theme = THEMES["postureMild"]
    elif sedentary_stage == 1:
        theme = THEMES["sedentaryMild"]
    elif is_drinking:
        theme = THEMES["water"]
    elif is_happy:
        theme = THEMES["normal"]

    # 針對各角色覆蓋正常狀態下的預設色系
    if air_stage == 0 and dehydration_stage == 0 and posture_stage == 0 and sedentary_stage == 0 and not is_drinking:
        if selected_pet == "cat":
            theme = {
                "main": Color("fdfaf2"),
                "shadow": Color("e8dfce"),
                "core": Color("ffccd5"),
                "glow": Color("fdfaf280")
            }
        elif selected_pet == "ghost":
            theme = {
                "main": Color(0.94, 0.96, 1.0, 0.85),
                "shadow": Color(0.76, 0.80, 0.90, 0.9),
                "core": Color(1.0, 0.71, 0.76, 0.5),
                "glow": Color(1.0, 1.0, 1.0, 0.4)
            }
        elif selected_pet == "chick":
            theme = {
                "main": Color("ffe135"),
                "shadow": Color("e0bf16"),
                "core": Color("ff9500"),
                "glow": Color("ffe13580")
            }
        elif selected_pet == "bubble":
            theme = {
                "main": Color("3c2f2f"),
                "shadow": Color("211818"),
                "core": Color("ff7b90"),
                "glow": Color("3c2f2f80")
            }

    # 2. 抖動效果
    var offset_x = 0.0
    var offset_y = 0.0
    if air_stage == 2:
        offset_x = (randf() - 0.5) * 8.0
        offset_y = (randf() - 0.5) * 6.0
    elif air_stage == 1:
        offset_x = (randf() - 0.5) * 2.5
        offset_y = (randf() - 0.5) * 2.0

    # 小精靈專屬浮空微動
    var ghost_float_y = 0.0
    if selected_pet == "ghost" and not is_jumping and squash_count == 0:
        if posture_stage != 2:
            ghost_float_y = sin(anim_time * 0.06) * 8.0

    # 3. 縮放與形變計算
    var base_scale = 1.0
    if dehydration_stage == 2:
        base_scale = 0.7
    elif dehydration_stage == 1:
        base_scale = 0.85

    var slouch_x = 1.0
    var slouch_y = 1.0
    if posture_stage == 2:
        slouch_y = 0.58
        slouch_x = 1.45
    elif posture_stage == 1:
        slouch_y = 0.80
        slouch_x = 1.20

    var jump_x = 1.0
    var jump_y = 1.0
    if is_jumping:
        if jump_progress < 0.5:
            jump_y = 1.22
            jump_x = 0.82
        else:
            jump_y = 0.95
            jump_x = 1.05
    elif squash_count > 0:
        jump_y = 0.72 + (24 - squash_count) * 0.0116
        jump_x = 1.28 - (24 - squash_count) * 0.0116

    var poke_x = 1.0
    var poke_y = 1.0
    if poke_timer > 0:
        poke_y = 0.5
        poke_x = 1.3

    # 呼吸起伏
    var breath_x = 1.0
    var breath_y = 1.0
    if not is_jumping and squash_count == 0 and posture_stage == 0 and poke_timer == 0 and not is_eating:
        var breath_speed = 0.05
        if sedentary_stage == 1:
            breath_speed = 0.025
        elif sedentary_stage == 2:
            breath_speed = 0.012
        breath_y = 1.0 + sin(anim_time * breath_speed) * 0.03
        breath_x = 1.0 / breath_y

    var scale_x = base_scale * slouch_x * jump_x * breath_x * poke_x
    var scale_y = base_scale * slouch_y * jump_y * breath_y * poke_y

    # --- 向量座標轉換 ---
    draw_set_transform(Vector2(draw_x + offset_x, draw_y + offset_y + ghost_float_y), 0.0, Vector2(scale_x, scale_y))

    # A. 貓耳朵與尾巴 (貓咪專屬)
    if selected_pet == "cat":
        # 左貓耳
        var left_ear = PackedVector2Array()
        if posture_stage > 0:
            left_ear.append(Vector2(-52, -22))
            left_ear.append(Vector2(-35, -25))
            left_ear.append(Vector2(-24, -28))
        else:
            left_ear.append(Vector2(-52, -25))
            left_ear.append(Vector2(-38, -48))
            left_ear.append(Vector2(-22, -32))
        draw_colored_polygon(left_ear, theme["main"])
        draw_polyline(left_ear, theme["shadow"], 5.0, true)
        
        # 左內耳
        var inner_left = PackedVector2Array()
        if posture_stage > 0:
            inner_left.append(Vector2(-47, -23))
            inner_left.append(Vector2(-37, -24))
            inner_left.append(Vector2(-27, -27))
        else:
            inner_left.append(Vector2(-47, -26))
            inner_left.append(Vector2(-38, -42))
            inner_left.append(Vector2(-26, -32))
        draw_colored_polygon(inner_left, Color("ffb4bec0"))

        # 右貓耳
        var right_ear = PackedVector2Array()
        if posture_stage > 0:
            right_ear.append(Vector2(52, -22))
            right_ear.append(Vector2(35, -25))
            right_ear.append(Vector2(24, -28))
        else:
            right_ear.append(Vector2(52, -25))
            right_ear.append(Vector2(38, -48))
            right_ear.append(Vector2(22, -32))
        draw_colored_polygon(right_ear, theme["main"])
        draw_polyline(right_ear, theme["shadow"], 5.0, true)
        
        # 右內耳
        var inner_right = PackedVector2Array()
        if posture_stage > 0:
            inner_right.append(Vector2(47, -23))
            inner_right.append(Vector2(37, -24))
            inner_right.append(Vector2(27, -27))
        else:
            inner_right.append(Vector2(47, -26))
            inner_right.append(Vector2(38, -42))
            inner_right.append(Vector2(26, -32))
        draw_colored_polygon(inner_right, Color("ffb4bec0"))

        # 貓尾巴
        if sedentary_stage == 2:
            _draw_bezier_line(Vector2(50, 25), Vector2(70, 25), Vector2(60, -5), Vector2(45, 5), theme["shadow"], 6.0)
        else:
            _draw_bezier_line(Vector2(50, 25), Vector2(75, 25), Vector2(70, -10), Vector2(80, -5), theme["shadow"], 6.0)

        # 貓鬍鬚
        var whisker_shake = sin(anim_time * 0.5) * 3.0 if air_stage > 0 else 0.0
        draw_line(Vector2(-35, 8), Vector2(-50, 6 + whisker_shake), Color("1e1b29"), 2.5, true)
        draw_line(Vector2(-35, 12), Vector2(-48, 14 - whisker_shake), Color("1e1b29"), 2.5, true)
        draw_line(Vector2(35, 8), Vector2(50, 6 - whisker_shake), Color("1e1b29"), 2.5, true)
        draw_line(Vector2(35, 12), Vector2(48, 14 + whisker_shake), Color("1e1b29"), 2.5, true)

    # B. 小精靈飄浮雙手 (小精靈專屬)
    if selected_pet == "ghost":
        var l_ctrl = Vector2(-60, 10) if posture_stage > 0 else (Vector2(-65, -15) if is_happy else Vector2(-65, -5))
        var l_end = Vector2(-50, 20) if posture_stage > 0 else (Vector2(-50, -25) if is_happy else Vector2(-55, 5))
        var left_pts = PackedVector2Array()
        for i in range(9):
            var t = float(i) / 8.0
            left_pts.append(Vector2(-45, -5).lerp(l_ctrl, t).lerp(l_ctrl.lerp(l_end, t), t))
        draw_polyline(left_pts, theme["shadow"], 5.0, true)

        var r_ctrl = Vector2(60, 10) if posture_stage > 0 else (Vector2(65, -15) if is_happy else Vector2(65, -5))
        var r_end = Vector2(50, 20) if posture_stage > 0 else (Vector2(50, -25) if is_happy else Vector2(55, 5))
        var right_pts = PackedVector2Array()
        for i in range(9):
            var t = float(i) / 8.0
            right_pts.append(Vector2(45, -5).lerp(r_ctrl, t).lerp(r_ctrl.lerp(r_end, t), t))
        draw_polyline(right_pts, theme["shadow"], 5.0, true)

    # C. 小黃雞腳丫
    if selected_pet == "chick" and not is_jumping and sedentary_stage != 2:
        var foot_color = Color("ffa347")
        draw_line(Vector2(-20, 50), Vector2(-20, 60), foot_color, 4.0, true)
        draw_line(Vector2(-20, 60), Vector2(-26, 62), foot_color, 4.0, true)
        draw_line(Vector2(-20, 60), Vector2(-14, 62), foot_color, 4.0, true)
        
        draw_line(Vector2(20, 50), Vector2(20, 60), foot_color, 4.0, true)
        draw_line(Vector2(20, 60), Vector2(14, 62), foot_color, 4.0, true)
        draw_line(Vector2(20, 60), Vector2(26, 62), foot_color, 4.0, true)

    # D. 繪製主身體
    if selected_pet == "slime" or selected_pet == "cat":
        var body_points = PackedVector2Array()
        for i in range(17):
            var t = float(i) / 16.0
            body_points.append(_get_bezier_point(Vector2(-60, 20), Vector2(-60, -50), Vector2(60, -50), Vector2(60, 20), t))
        for i in range(17):
            var t = float(i) / 16.0
            body_points.append(_get_bezier_point(Vector2(60, 20), Vector2(60, 45), Vector2(-60, 45), Vector2(-60, 20), t))
        draw_colored_polygon(body_points, theme["main"])
        var stroke_points = body_points
        stroke_points.append(body_points[0])
        draw_polyline(stroke_points, theme["shadow"], 6.0, true)
    elif selected_pet == "ghost":
        var ghost_points = PackedVector2Array()
        for i in range(17):
            var t = float(i) / 16.0
            ghost_points.append(_get_bezier_point(Vector2(-55, 15), Vector2(-55, -55), Vector2(55, -55), Vector2(55, 15), t))
        ghost_points.append(Vector2(55, 25))
        var wave_h = 2.0 if posture_stage == 2 else 12.0
        var wave_y = 25.0 + sin(anim_time * 0.1) * (0.0 if posture_stage == 2 else 3.0)
        
        for i in range(9):
            var t = float(i) / 8.0
            ghost_points.append(Vector2(55, 25).lerp(Vector2(36, wave_y + wave_h), t).lerp(Vector2(36, wave_y + wave_h).lerp(Vector2(18, wave_y), t), t))
        for i in range(9):
            var t = float(i) / 8.0
            ghost_points.append(Vector2(18, wave_y).lerp(Vector2(0, wave_y + wave_h), t).lerp(Vector2(0, wave_y + wave_h).lerp(Vector2(-18, wave_y), t), t))
        for i in range(9):
            var t = float(i) / 8.0
            ghost_points.append(Vector2(-18, wave_y).lerp(Vector2(-36, wave_y + wave_h), t).lerp(Vector2(-36, wave_y + wave_h).lerp(Vector2(-55, wave_y), t), t))
            
        draw_colored_polygon(ghost_points, theme["main"])
        var ghost_stroke = ghost_points
        ghost_stroke.append(ghost_points[0])
        draw_polyline(ghost_stroke, theme["shadow"], 6.0, true)
    elif selected_pet == "chick":
        draw_circle(Vector2(0, 5), 50.0, theme["main"])
        draw_arc(Vector2(0, 5), 50.0, 0.0, 2.0 * PI, 64, theme["shadow"], 6.0, true)

        # 翅膀
        var wing_angle = 0.0
        if is_jumping:
            wing_angle = -sin(anim_time * 0.3) * 0.5
        elif posture_stage > 0:
            wing_angle = 0.4
        _draw_rotated_ellipse(Vector2(-42, 5), 14.0, 8.0, wing_angle, theme["main"], theme["shadow"], 4.0)
        _draw_rotated_ellipse(Vector2(42, 5), 14.0, 8.0, -wing_angle, theme["main"], theme["shadow"], 4.0)
    elif selected_pet == "bubble":
        draw_circle(Vector2(0, 5), 52.0, theme["main"])
        draw_arc(Vector2(0, 5), 52.0, 0.0, 2.0 * PI, 64, theme["shadow"], 6.0, true)

    # 4. 脫水乾裂線 (精靈與珍珠除外)
    if selected_pet != "ghost" and selected_pet != "bubble":
        if dehydration_stage == 2:
            draw_line(Vector2(-45, -10), Vector2(-35, -5), Color(0, 0, 0, 0.25), 3.0, true)
            draw_line(Vector2(-35, -5), Vector2(-30, -12), Color(0, 0, 0, 0.25), 3.0, true)
            draw_line(Vector2(35, -15), Vector2(40, -8), Color(0, 0, 0, 0.25), 3.0, true)
            draw_line(Vector2(40, -8), Vector2(45, -12), Color(0, 0, 0, 0.25), 3.0, true)
        elif dehydration_stage == 1:
            draw_line(Vector2(-45, -10), Vector2(-35, -5), Color(0, 0, 0, 0.18), 2.5, true)
            draw_line(Vector2(35, -15), Vector2(40, -8), Color(0, 0, 0, 0.18), 2.5, true)

    # 5. 毒素斑點 (精靈與珍珠除外)
    if selected_pet != "ghost" and selected_pet != "bubble":
        if air_stage == 2:
            draw_circle(Vector2(-35, -25), 4.0, Color("3be255"))
            draw_circle(Vector2(35, -20), 5.0, Color("3be255"))
            draw_circle(Vector2(45, 5), 3.0, Color("3be255"))
        elif air_stage == 1:
            draw_circle(Vector2(-35, -25), 3.0, Color("5ae270"))
            draw_circle(Vector2(35, -20), 3.0, Color("5ae270"))

    # 6. 內層果凍核心 (史萊姆、貓咪專屬)
    if selected_pet == "slime" or selected_pet == "cat":
        var core_points = PackedVector2Array()
        for i in range(17):
            var t = float(i) / 16.0
            core_points.append(_get_bezier_point(Vector2(-25, 10), Vector2(-25, -20), Vector2(25, -20), Vector2(25, 10), t))
        for i in range(17):
            var t = float(i) / 16.0
            core_points.append(_get_bezier_point(Vector2(25, 10), Vector2(25, 22), Vector2(-25, 22), Vector2(-25, 10), t))
        draw_colored_polygon(core_points, theme["core"])

    # 7. 高光與光澤
    if selected_pet == "bubble":
        if dehydration_stage < 2:
            _draw_rotated_ellipse(Vector2(-20, -20), 11.0, 5.0, -PI/4.0, Color(1, 1, 1, 0.45))
            _draw_rotated_ellipse(Vector2(20, 20), 7.0, 3.0, -PI/4.0, Color(1, 1, 1, 0.25))
    else:
        _draw_rotated_ellipse(Vector2(-28, -12), 10.0, 5.0, -PI/4.0, Color(1, 1, 1, 0.4))

    # 8. 腮紅
    _draw_rotated_ellipse(Vector2(-30, 8), 8.0, 4.0, 0.0, Color(1, 0.2, 0.31, 0.4))
    _draw_rotated_ellipse(Vector2(30, 8), 8.0, 4.0, 0.0, Color(1, 0.2, 0.31, 0.4))

    # 9. 表情與眼睛
    var eye_color = Color("1e1b29")
    var left_eye = Vector2(-20, 0)
    var right_eye = Vector2(20, 0)
    
    var eye_type = "normal"
    if air_stage == 2:
        eye_type = "dead"
    elif dehydration_stage == 2 or dehydration_stage == 1:
        eye_type = "sad"
    elif posture_stage == 2 or posture_stage == 1:
        eye_type = "sad"
    elif sedentary_stage == 2:
        eye_type = "sleep"
    elif poke_timer > 0:
        eye_type = "shocked"
    elif air_stage == 1:
        eye_type = "dizzy"
    elif sedentary_stage == 1:
        eye_type = "tired"
    elif is_happy:
        eye_type = "happy"

    if eye_type == "happy":
        draw_arc(left_eye + Vector2(0, 4), 8.0, PI, 0.0, 16, eye_color, 4.0)
        draw_arc(right_eye + Vector2(0, 4), 8.0, PI, 0.0, 16, eye_color, 4.0)
    elif eye_type == "sad":
        draw_line(left_eye - Vector2(6, 4), left_eye, eye_color, 4.0)
        draw_line(left_eye, left_eye - Vector2(6, -4), eye_color, 4.0)
        draw_line(right_eye + Vector2(6, -4), right_eye, eye_color, 4.0)
        draw_line(right_eye, right_eye + Vector2(6, 4), eye_color, 4.0)
    elif eye_type == "dead":
        draw_line(left_eye - Vector2(5, 5), left_eye + Vector2(5, 5), eye_color, 4.0)
        draw_line(left_eye + Vector2(5, -5), left_eye - Vector2(5, 5), eye_color, 4.0)
        draw_line(right_eye - Vector2(5, 5), right_eye + Vector2(5, 5), eye_color, 4.0)
        draw_line(right_eye + Vector2(5, -5), right_eye - Vector2(5, 5), eye_color, 4.0)
    elif eye_type == "sleep":
        draw_line(left_eye - Vector2(6, -2), left_eye + Vector2(6, 2), eye_color, 4.0)
        draw_line(right_eye - Vector2(6, -2), right_eye + Vector2(6, 2), eye_color, 4.0)
    elif eye_type == "shocked":
        draw_circle(left_eye, 7.0, eye_color)
        draw_circle(left_eye, 5.0, Color.WHITE)
        draw_circle(left_eye, 2.0, eye_color)
        draw_circle(right_eye, 7.0, eye_color)
        draw_circle(right_eye, 5.0, Color.WHITE)
        draw_circle(right_eye, 2.0, eye_color)
    elif eye_type == "tired":
        draw_circle(left_eye, 6.0, eye_color)
        draw_circle(right_eye, 6.0, eye_color)
        draw_rect(Rect2(left_eye.x - 7, left_eye.y - 7, 14, 6), theme["shadow"])
        draw_rect(Rect2(right_eye.x - 7, right_eye.y - 7, 14, 6), theme["shadow"])
        draw_circle(left_eye - Vector2(2, -1), 1.5, Color.WHITE)
        draw_circle(right_eye - Vector2(2, -1), 1.5, Color.WHITE)
    else:
        var is_blinking = (int(anim_time) % 180 > 172)
        if is_blinking:
            draw_line(left_eye - Vector2(5, 0), left_eye + Vector2(5, 0), eye_color, 4.0)
            draw_line(right_eye - Vector2(5, 0), right_eye + Vector2(5, 0), eye_color, 4.0)
        else:
            draw_circle(left_eye, 6.0, eye_color)
            draw_circle(left_eye - Vector2(2, 2), 2.0, Color.WHITE)
            draw_circle(right_eye, 6.0, eye_color)
            draw_circle(right_eye - Vector2(2, 2), 2.0, Color.WHITE)

    # 10. 嘴巴 / 喙嘴 (小黃雞為喙嘴，其餘為通用嘴)
    if selected_pet == "chick":
        var beak_open = 0.0
        if is_eating:
            beak_open = abs(sin(anim_time * 0.25)) * 6.0
        var beak_color = Color("ffa347")
        var beak_stroke = Color("e87c1e")
        
        # 上喙
        var upper_beak = PackedVector2Array([
            Vector2(-10, 6.0 - beak_open),
            Vector2(0, 1.0 - beak_open),
            Vector2(10, 6.0 - beak_open),
            Vector2(0, 9.0)
        ])
        draw_colored_polygon(upper_beak, beak_color)
        var upper_outline = upper_beak
        upper_outline.append(upper_beak[0])
        draw_polyline(upper_outline, beak_stroke, 2.5, true)
        
        # 下喙
        var lower_beak = PackedVector2Array([
            Vector2(-8, 7.0 + beak_open),
            Vector2(0, 13.0 + beak_open),
            Vector2(8, 7.0 + beak_open),
            Vector2(0, 9.0)
        ])
        draw_colored_polygon(lower_beak, beak_color)
        var lower_outline = lower_beak
        lower_outline.append(lower_beak[0])
        draw_polyline(lower_outline, beak_stroke, 2.5, true)
    else:
        if poke_timer > 0:
            draw_circle(Vector2(0, 12), 8.0, eye_color)
        elif is_eating:
            var chew_scale_y = 1.0 + sin(anim_time * 0.25) * 0.3
            var chew_scale_x = 1.0 - sin(anim_time * 0.25) * 0.15
            _draw_rotated_ellipse(Vector2(0, 10), 7.0 * chew_scale_x, 5.0 * chew_scale_y, 0.0, eye_color)
        elif is_drinking:
            var drink_scale = 1.0 + sin(anim_time * 0.18) * 0.25
            draw_circle(Vector2(0, 10), 8.0 * drink_scale, eye_color)
        elif air_stage == 2:
            draw_circle(Vector2(0, 12), 7.0, eye_color)
        elif air_stage == 1:
            var points = PackedVector2Array([Vector2(-6, 10), Vector2(-2, 12), Vector2(2, 8), Vector2(6, 10)])
            draw_polyline(points, eye_color, 3.0)
        elif is_happy:
            draw_circle(Vector2(0, 8), 7.0, eye_color)
            draw_rect(Rect2(-7, 1, 14, 7), theme["main"])
        elif dehydration_stage == 2 or posture_stage == 2:
            draw_arc(Vector2(0, 21), 6.0, PI, 2 * PI, 16, eye_color, 3.0)
        elif dehydration_stage == 1 or posture_stage == 1:
            draw_arc(Vector2(0, 17), 4.0, PI, 2 * PI, 16, eye_color, 3.0)
        elif sedentary_stage == 2:
            var sleep_mouth_size = 2.0 + abs(sin(anim_time * 0.02)) * 3.0
            draw_circle(Vector2(0, 12), sleep_mouth_size, eye_color)
        elif sedentary_stage == 1:
            draw_line(Vector2(-4, 10), Vector2(4, 10), eye_color, 3.0)
        else:
            draw_circle(Vector2(0, 8), 3.0, eye_color)
            draw_rect(Rect2(-3, 5, 6, 3), theme["main"])

    # 11. 頭頂開花
    if is_happy:
        var stem_top = Vector2(0, -42)
        draw_line(stem_top + Vector2(0, 10), stem_top, Color("5c8e32"), 3.0)
        draw_circle(stem_top + Vector2(-4, -4), 4.0, Color("ff2e4d"))
        draw_circle(stem_top + Vector2(4, -4), 4.0, Color("ff2e4d"))
        draw_circle(stem_top + Vector2(-4, 2), 4.0, Color("ff2e4d"))
        draw_circle(stem_top + Vector2(4, 2), 4.0, Color("ff2e4d"))
        draw_circle(stem_top + Vector2(0, -1), 3.5, Color("ffdd00"))
