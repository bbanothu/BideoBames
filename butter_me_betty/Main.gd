extends Node2D

const GROUND_Y := 460.0
const LAUNCH_MULTIPLIER := 5.2
const MAX_PULL := 130.0
const FALL_RESET_Y := 900.0
const GRAB_RADIUS := 90.0
const LOOP_MIN_SPEED := 180.0
const STALL_TIME := 2.5 # seconds of near-zero speed before an attempt counts as failed

const BETTY_SCENE := preload("res://Betty.tscn")
const BUTTER_SCENE := preload("res://ButterPickup.tscn")

const STICK_GRAB_RADIUS := 50.0
const STICK_CONTACT_RADIUS := 55.0
const BUTTERED_LAUNCH_BONUS := 1.3

const MAX_LIVES := 3
const LEVEL_START_POS := Vector2(150.0, GROUND_Y - 42.0 - 140.0) # 42 == Betty.RADIUS
const CHECKPOINT_ADVANCE := 40.0 # min forward progress before a new checkpoint counts

# Each level is flat-run -> wall hop -> pit -> slick stretch (butter needed)
# -> ramp -> raised platform (maybe with loops) -> goal.
const LEVELS := [
	{
		"wall_x": 500.0, "wall_h": 32.0,
		"pit_x0": 650.0, "pit_x1": 800.0,
		"butter": [870.0, 980.0],
		"ramp_x0": 1150.0, "ramp_x1": 1450.0, "ramp_rise": 110.0,
		"loops": [1750.0], "loop_radius": 80.0,
		"goal_x": 2050.0, "level_width": 2400.0,
	},
	{
		"wall_x": 480.0, "wall_h": 42.0,
		"pit_x0": 630.0, "pit_x1": 820.0,
		"butter": [890.0, 1030.0, 1150.0],
		"ramp_x0": 1250.0, "ramp_x1": 1600.0, "ramp_rise": 130.0,
		"loops": [1900.0], "loop_radius": 85.0,
		"goal_x": 2300.0, "level_width": 2650.0,
	},
	{
		"wall_x": 460.0, "wall_h": 46.0,
		"pit_x0": 620.0, "pit_x1": 840.0,
		"butter": [880.0, 1000.0, 1120.0],
		"ramp_x0": 1250.0, "ramp_x1": 1600.0, "ramp_rise": 150.0,
		"loops": [1850.0, 2150.0], "loop_radius": 85.0,
		"goal_x": 2500.0, "level_width": 2850.0,
	},
]

var betty: Betty
var camera: Camera2D
var aim_line: Line2D
var dragging := false
var state := "aiming" # aiming | launched | won | over_lives
var ui: CanvasLayer
var overlay: Control
var hint_label: Label
var lives_label: Label
var level_label: Label

var butter_stick: Node2D
var stick_home: Vector2
var dragging_stick := false

var level_nodes: Array = []
var current_level_index := 0
var lives := MAX_LIVES
var stall_timer := 0.0

func _ready() -> void:
	_build_background()
	_build_betty()
	_build_butter_stick()
	_build_camera()
	_build_ui()
	_start_level(0)

# --------------------------------------------------------------- level ----

func _build_background() -> void:
	var sky := ColorRect.new()
	sky.color = Color(0.55, 0.78, 0.92)
	sky.position = Vector2(-200, -1000)
	sky.size = Vector2(3200, 1900) # generous fixed size, bigger than any level
	sky.z_index = -10
	add_child(sky)

func _add_level_node(n: Node) -> Node:
	add_child(n)
	level_nodes.append(n)
	return n

func _clear_level() -> void:
	for n in level_nodes:
		if is_instance_valid(n):
			n.queue_free()
	level_nodes.clear()

func _make_ground(x0: float, x1: float, top_y: float = GROUND_Y) -> void:
	var body := StaticBody2D.new()
	var w := x1 - x0
	var h := 400.0
	var shape := CollisionShape2D.new()
	var rect := RectangleShape2D.new()
	rect.size = Vector2(w, h)
	shape.shape = rect
	shape.position = Vector2(x0 + w / 2.0, top_y + h / 2.0)
	body.add_child(shape)
	var vis := ColorRect.new()
	vis.color = Color(0.36, 0.6, 0.28)
	vis.position = Vector2(x0, top_y)
	vis.size = Vector2(w, h)
	body.add_child(vis)
	_add_level_node(body)

func _make_box(x: float, top_y: float, w: float, h: float, color: Color) -> void:
	var body := StaticBody2D.new()
	var shape := CollisionShape2D.new()
	var rect := RectangleShape2D.new()
	rect.size = Vector2(w, h)
	shape.shape = rect
	shape.position = Vector2(x + w / 2.0, top_y + h / 2.0)
	body.add_child(shape)
	var vis := ColorRect.new()
	vis.color = color
	vis.position = Vector2(x, top_y)
	vis.size = Vector2(w, h)
	body.add_child(vis)
	_add_level_node(body)

func _make_ramp_visual(x0: float, top_y: float, x1: float, raised_top_y: float, step_count: int = 7) -> void:
	# visual-only stepped ramp (no collision). A physical sloped or stepped
	# CollisionPolygon2D gives a fast-rolling circle a bad contact normal right
	# at the slope/step vertex (a well-known 2D physics "internal edge"
	# artifact) -- it kept bouncing Betty backward instead of letting her
	# ride up. The actual lift is handled by script in Betty._integrate_forces
	# instead; this is just the steps you see.
	var run: float = x1 - x0
	var rise: float = top_y - raised_top_y
	var step_w: float = run / step_count
	for i in range(step_count):
		var sx0: float = x0 + i * step_w
		var sy: float = top_y - (rise / step_count) * (i + 1)
		var vis := ColorRect.new()
		vis.color = Color(0.36, 0.6, 0.28)
		vis.position = Vector2(sx0, sy)
		vis.size = Vector2(run - i * step_w, 400)
		vis.z_index = -1
		_add_level_node(vis)

func _add_butter(x: float, y: float) -> void:
	var b := BUTTER_SCENE.instantiate()
	b.position = Vector2(x, y)
	_add_level_node(b)

func _make_loop(center_x: float, radius: float, ground_top_y: float) -> void:
	# Sonic-style loop -- visual ring only, no physical collision (a real
	# circular CollisionPolygon2D can't hold a fast RigidBody2D through the
	# upside-down section without either fighting the same bad-contact-normal
	# issue the ramp had, or literally requiring enough real speed to need
	# centripetal-force tuning). The actual loop-the-loop is driven by script
	# in Betty._integrate_forces once she triggers it below at speed.
	var center := Vector2(center_x, ground_top_y - radius)
	var ring := Line2D.new()
	ring.width = 10.0
	ring.default_color = Color(0.55, 0.55, 0.6)
	var pts := PackedVector2Array()
	for i in range(65):
		var a: float = TAU * i / 64.0
		pts.append(center + Vector2(cos(a), sin(a)) * radius)
	ring.points = pts
	ring.z_index = 1
	_add_level_node(ring)

	# small and right at the bottom of the circle (where her center sits while
	# rolling on the ground), so she enters close to true bottom-of-loop --
	# a wide/tall trigger let her catch it well off to the side, which made
	# enter_loop() see a very different angle/distance than intended.
	var trigger := Area2D.new()
	var shape := CollisionShape2D.new()
	var rect := RectangleShape2D.new()
	rect.size = Vector2(20, 20)
	shape.shape = rect
	shape.position = Vector2(center_x, ground_top_y - Betty.RADIUS)
	trigger.add_child(shape)
	trigger.body_entered.connect(func(body):
		if body is Betty and abs(body.linear_velocity.x) >= LOOP_MIN_SPEED:
			body.enter_loop(center, radius)
	)
	_add_level_node(trigger)

func _make_goal(x: float, ground_top_y: float) -> void:
	var pole := ColorRect.new()
	pole.color = Color(0.6, 0.6, 0.6)
	pole.position = Vector2(x - 3, ground_top_y - 120)
	pole.size = Vector2(6, 120)
	_add_level_node(pole)

	var flag := Polygon2D.new()
	flag.polygon = PackedVector2Array([
		Vector2(x + 3, ground_top_y - 120), Vector2(x + 55, ground_top_y - 100),
		Vector2(x + 3, ground_top_y - 80),
	])
	flag.color = Color(0.85, 0.2, 0.2)
	_add_level_node(flag)

	var goal_area := Area2D.new()
	var shape := CollisionShape2D.new()
	var rect := RectangleShape2D.new()
	rect.size = Vector2(90, 160)
	shape.shape = rect
	shape.position = Vector2(x + 20, ground_top_y - 80)
	goal_area.add_child(shape)
	goal_area.body_entered.connect(_on_goal_entered)
	_add_level_node(goal_area)

func _build_level_from_config(cfg: Dictionary) -> void:
	_make_ground(0, cfg.pit_x0)
	_make_box(cfg.wall_x, GROUND_Y - cfg.wall_h, 26, cfg.wall_h, Color(0.5, 0.35, 0.22))

	# gap from pit_x0 to pit_x1 -- falling here fails the attempt.
	# slick stretch (needs butter to cross without stopping), then a ramp up
	# to a raised goal platform. One solid safety floor under the whole
	# stretch (so nothing can fall through), raised platform as its own solid
	# piece at the top.
	_make_ground(cfg.pit_x1, cfg.ramp_x1)
	_make_ground(cfg.ramp_x1, cfg.level_width, GROUND_Y - cfg.ramp_rise)
	_make_ramp_visual(cfg.ramp_x0, GROUND_Y, cfg.ramp_x1, GROUND_Y - cfg.ramp_rise)

	for bx in cfg.butter:
		_add_butter(bx, GROUND_Y - 40)

	for loop_x in cfg.loops:
		_make_loop(loop_x, cfg.loop_radius, GROUND_Y - cfg.ramp_rise)

	_make_goal(cfg.goal_x, GROUND_Y - cfg.ramp_rise)

func _start_level(index: int) -> void:
	current_level_index = index
	_clear_level()
	lives = MAX_LIVES
	stall_timer = 0.0

	var cfg: Dictionary = LEVELS[index]
	_build_level_from_config(cfg)

	betty.ramp_x0 = cfg.ramp_x0
	betty.ramp_x1 = cfg.ramp_x1
	betty.ramp_rise = cfg.ramp_rise
	betty.ramp_ground_y = GROUND_Y
	betty.reset_to_anchor(LEVEL_START_POS) # a fresh level always starts from the true slingshot

	camera.limit_right = int(cfg.level_width)
	_snap_camera_to(betty.anchor_pos + Vector2(180, -60))

	state = "aiming"
	overlay.visible = false
	_update_hud()

func _build_betty() -> void:
	var anchor_y := GROUND_Y - Betty.RADIUS - 140
	var stand := ColorRect.new()
	stand.color = Color(0.45, 0.32, 0.2)
	stand.position = Vector2(150 - 6, anchor_y + Betty.RADIUS - 20)
	stand.size = Vector2(12, GROUND_Y - (anchor_y + Betty.RADIUS - 20))
	stand.z_index = -1
	add_child(stand)

	betty = BETTY_SCENE.instantiate()
	betty.position = Vector2(150, anchor_y)
	add_child(betty)

func _build_butter_stick() -> void:
	# a draggable butter stick sitting on a little dish near the slingshot --
	# drag it onto Betty to butter her up before launch (or mid-level, since
	# the same drag logic works whenever state == "aiming").
	stick_home = Vector2(360, GROUND_Y - 26)

	var dish := Polygon2D.new()
	dish.polygon = PackedVector2Array([
		Vector2(-30, 14), Vector2(30, 14), Vector2(24, 22), Vector2(-24, 22),
	])
	dish.color = Color(0.75, 0.75, 0.78)
	dish.position = stick_home
	add_child(dish)

	butter_stick = Node2D.new()
	butter_stick.position = stick_home
	add_child(butter_stick)

	var handle := Polygon2D.new()
	handle.polygon = PackedVector2Array([
		Vector2(-5, -6), Vector2(5, -6), Vector2(5, 8), Vector2(-5, 8),
	])
	handle.color = Color(0.55, 0.38, 0.22)
	butter_stick.add_child(handle)

	var pat := Polygon2D.new()
	pat.polygon = PackedVector2Array([
		Vector2(-14, -28), Vector2(14, -28), Vector2(16, -8), Vector2(-16, -8),
	])
	pat.color = Color(0.98, 0.85, 0.25)
	butter_stick.add_child(pat)

	var shine := Polygon2D.new()
	shine.polygon = PackedVector2Array([Vector2(-9, -24), Vector2(-2, -24), Vector2(-9, -12)])
	shine.color = Color(1, 0.98, 0.8, 0.6)
	butter_stick.add_child(shine)

func _build_camera() -> void:
	camera = Camera2D.new()
	camera.position_smoothing_enabled = true
	camera.position_smoothing_speed = 4.0
	camera.limit_left = 0
	camera.limit_top = -600
	camera.limit_bottom = int(GROUND_Y + 300)
	add_child(camera)

	aim_line = Line2D.new()
	aim_line.width = 4.0
	aim_line.default_color = Color(0.2, 0.2, 0.2, 0.8)
	aim_line.visible = false
	add_child(aim_line)

# ------------------------------------------------------------------ ui ----

func _build_ui() -> void:
	ui = CanvasLayer.new()
	add_child(ui)

	hint_label = Label.new()
	hint_label.text = "Drag the butter stick onto Betty to grease her up, then drag Betty back and release to launch!"
	hint_label.set_anchors_preset(Control.PRESET_TOP_WIDE)
	hint_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	hint_label.position.y = 12
	hint_label.add_theme_font_size_override("font_size", 18)
	ui.add_child(hint_label)

	level_label = Label.new()
	level_label.position = Vector2(20, 480)
	level_label.add_theme_font_size_override("font_size", 18)
	ui.add_child(level_label)

	lives_label = Label.new()
	lives_label.position = Vector2(20, 505)
	lives_label.add_theme_font_size_override("font_size", 18)
	ui.add_child(lives_label)

	overlay = Control.new()
	overlay.set_anchors_preset(Control.PRESET_FULL_RECT)
	overlay.visible = false
	ui.add_child(overlay)

func _update_hud() -> void:
	level_label.text = "Level %d / %d" % [current_level_index + 1, LEVELS.size()]
	lives_label.text = "Tries left: %d" % lives

func _rounded_style(color: Color, radius: int = 10) -> StyleBoxFlat:
	var sb := StyleBoxFlat.new()
	sb.bg_color = color
	sb.set_corner_radius_all(radius)
	return sb

func _make_button(text: String, x: float, y: float, w: float = 160.0) -> Button:
	var b := Button.new()
	b.text = text
	b.position = Vector2(x, y)
	b.size = Vector2(w, 44)
	b.add_theme_stylebox_override("normal", _rounded_style(Color(0.85, 0.2, 0.2)))
	b.add_theme_stylebox_override("hover", _rounded_style(Color(1.0, 0.33, 0.3)))
	b.add_theme_stylebox_override("pressed", _rounded_style(Color(0.6, 0.1, 0.1)))
	b.add_theme_color_override("font_color", Color(1, 1, 1))
	overlay.add_child(b)
	return b

func _show_overlay(message: String, button_text: String, on_press: Callable) -> void:
	overlay.visible = true
	for c in overlay.get_children():
		c.queue_free()
	var bg := ColorRect.new()
	bg.color = Color(0.04, 0.04, 0.06, 0.85)
	bg.set_anchors_preset(Control.PRESET_FULL_RECT)
	overlay.add_child(bg)
	var label := Label.new()
	label.text = message
	label.add_theme_font_size_override("font_size", 26)
	label.set_anchors_preset(Control.PRESET_TOP_WIDE)
	label.position.y = 190
	label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	overlay.add_child(label)
	var btn := _make_button(button_text, 480 - 90, 260, 180)
	btn.pressed.connect(on_press)

func show_win_screen() -> void:
	if current_level_index < LEVELS.size() - 1:
		_show_overlay(
			"Betty made it home, nice and buttery!",
			"Next Level",
			func(): _start_level(current_level_index + 1)
		)
	else:
		_show_overlay(
			"Betty made it through every level -- you're a butter genius!",
			"Play Again",
			func(): _start_level(0)
		)

func show_out_of_tries_screen() -> void:
	_show_overlay(
		"Out of tries! Betty's greasy but she didn't make it home.",
		"Retry Level",
		func(): _start_level(current_level_index)
	)

# --------------------------------------------------------------- input ----

func _input(event: InputEvent) -> void:
	if state != "aiming":
		return
	if event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT:
		if event.pressed:
			var mp := get_global_mouse_position()
			if mp.distance_to(butter_stick.position) < STICK_GRAB_RADIUS:
				dragging_stick = true
			elif mp.distance_to(betty.position) < GRAB_RADIUS:
				dragging = true
				aim_line.visible = true
		elif dragging_stick:
			dragging_stick = false
			var tw := create_tween()
			tw.tween_property(butter_stick, "position", stick_home, 0.2).set_trans(Tween.TRANS_BACK)
		elif dragging:
			dragging = false
			_launch()
	elif event is InputEventMouseMotion:
		if dragging_stick:
			var mp := get_global_mouse_position()
			butter_stick.position = mp
			if mp.distance_to(betty.position) < STICK_CONTACT_RADIUS:
				betty.apply_butter()
		elif dragging:
			var mp := get_global_mouse_position()
			var offset := mp - betty.anchor_pos
			if offset.length() > MAX_PULL:
				offset = offset.normalized() * MAX_PULL
			var target := betty.anchor_pos + offset
			target.y = min(target.y, GROUND_Y - Betty.RADIUS - 4.0) # never drag into solid ground
			betty.position = target
			aim_line.points = PackedVector2Array([betty.anchor_pos, betty.position])

func _launch() -> void:
	lives -= 1
	_update_hud()
	stall_timer = 0.0

	var pull := betty.anchor_pos - betty.position
	aim_line.visible = false
	betty.freeze = false
	var mult := LAUNCH_MULTIPLIER
	if betty.buttered:
		mult *= BUTTERED_LAUNCH_BONUS
	betty.linear_velocity = pull * mult
	betty.angular_velocity = 0.0
	betty.on_launched(1 if pull.x >= 0.0 else -1)
	state = "launched"

func _snap_camera_to(pos: Vector2) -> void:
	# jump instantly instead of smoothly panning there -- with smoothing left
	# on, a big jump (e.g. from a level's goal back to the next level's start)
	# takes a visible moment to catch up, which reads as "Betty didn't show up"
	camera.position_smoothing_enabled = false
	camera.global_position = pos
	camera.position_smoothing_enabled = true

func _fail_attempt() -> void:
	if lives > 0:
		# reset_to_anchor() with no args reuses betty.anchor_pos as-is, which
		# _process keeps advancing forward as she clears ground safely -- so a
		# failed attempt retries from her last checkpoint, not the start
		betty.reset_to_anchor()
		state = "aiming"
		_snap_camera_to(betty.anchor_pos + Vector2(180, -60))
	else:
		state = "over_lives"
		show_out_of_tries_screen()

func _on_goal_entered(body: Node) -> void:
	if body is Betty and state == "launched":
		state = "won"
		show_win_screen()

# ---------------------------------------------------------------- loop ----

func _process(delta: float) -> void:
	if state != "launched":
		return
	camera.global_position = betty.global_position

	if betty.global_position.y > FALL_RESET_Y:
		_fail_attempt()
		return

	if betty.in_loop or betty.linear_velocity.length() > 15.0:
		stall_timer = 0.0
		# advance her checkpoint while she's stably grounded and further along
		# than the last one -- keeps her from restarting all the way at the
		# slingshot every time an attempt fails partway through the level
		if not betty.in_loop and abs(betty.linear_velocity.y) < 5.0 \
				and betty.position.x > betty.anchor_pos.x + CHECKPOINT_ADVANCE:
			betty.anchor_pos = Vector2(betty.position.x, betty.position.y - 140.0)
	else:
		stall_timer += delta
		if stall_timer > STALL_TIME:
			_fail_attempt()
