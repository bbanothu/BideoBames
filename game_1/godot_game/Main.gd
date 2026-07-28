extends Node2D

const VIEW_W := 800.0
const VIEW_H := 450.0
const GROUND_Y := 400.0
const MATCH_TIME := 60.0
const FIGHTER_SCENE := preload("res://Fighter.tscn")

const P1_CONTROLS = {"left": KEY_A, "right": KEY_D, "up": KEY_W, "attack1": KEY_Q, "attack2": KEY_E, "charge": KEY_P, "special": KEY_SHIFT}
const P2_CONTROLS = {"left": KEY_LEFT, "right": KEY_RIGHT, "up": KEY_UP, "attack1": KEY_COMMA, "attack2": KEY_PERIOD, "charge": KEY_SEMICOLON, "special": KEY_SLASH}

@onready var ui: CanvasLayer = $UI

var fighters: Array = []
var state_name: String = "title" # title | mode | select | playing | over
var mode: String = ""
var winner: Fighter = null

var overlay: Control
var hud: Control
var hp_bar_p1: Panel
var hp_bar_p2: Panel
var hp_label_p1: Label
var hp_label_p2: Label
var charge_bar_p1: Panel
var charge_bar_p2: Panel
var timer_label: Label
var match_time_left: float = 0.0

var _hp1_shown := 100.0
var _hp2_shown := 100.0
var _charge1_shown := 0.0
var _charge2_shown := 0.0

func _ready() -> void:
	_build_world()
	_build_hud()
	_build_overlay_root()
	show_title_screen()

# ---------------------------------------------------------------- world ----

func _build_world() -> void:
	var background := Sprite2D.new()
	background.texture = load("res://backgrounds/rooftop.jpg")
	background.centered = true
	background.position = Vector2(VIEW_W / 2.0, VIEW_H / 2.0)
	var tex_size: Vector2 = background.texture.get_size()
	background.scale = Vector2(VIEW_W / tex_size.x, VIEW_H / tex_size.y)
	add_child(background)

	var dim := ColorRect.new()
	dim.color = Color(0, 0, 0, 0.4)
	dim.size = Vector2(VIEW_W, VIEW_H)
	add_child(dim)

	_make_platform(0, GROUND_Y, VIEW_W, 50, false, false)
	_make_platform(250, 300, 200, 20, true, true)
	_make_platform(520, 190, 180, 20, true, true)

func _make_platform(x: float, y: float, w: float, h: float, draw_visible: bool, one_way: bool) -> void:
	var body := StaticBody2D.new()
	body.position = Vector2(x + w / 2.0, y + h / 2.0)
	var shape := CollisionShape2D.new()
	var rect := RectangleShape2D.new()
	rect.size = Vector2(w, h)
	shape.shape = rect
	shape.one_way_collision = one_way
	body.add_child(shape)
	if draw_visible:
		var vis := ColorRect.new()
		vis.color = Color(0.29, 0.49, 0.24)
		vis.size = Vector2(w, h)
		vis.position = Vector2(-w / 2.0, -h / 2.0)
		body.add_child(vis)
	add_child(body)

# ------------------------------------------------------------------ hud ----

func _rounded_style(color: Color, radius: int = 8, border_w: int = 0, border_color: Color = Color(0, 0, 0, 0)) -> StyleBoxFlat:
	var sb := StyleBoxFlat.new()
	sb.bg_color = color
	sb.set_corner_radius_all(radius)
	if border_w > 0:
		sb.set_border_width_all(border_w)
		sb.border_color = border_color
	return sb

func _make_bar(x: float, y: float, w: float, h: float, bg_color: Color, fill_color: Color) -> Panel:
	var bg := Panel.new()
	bg.position = Vector2(x, y)
	bg.size = Vector2(w, h)
	bg.add_theme_stylebox_override("panel", _rounded_style(bg_color, h / 2.0, 1, Color(0, 0, 0, 0.5)))
	hud.add_child(bg)
	var fill := Panel.new()
	fill.position = Vector2(x, y)
	fill.size = Vector2(w, h)
	fill.add_theme_stylebox_override("panel", _rounded_style(fill_color, h / 2.0))
	hud.add_child(fill)
	return fill

func _build_hud() -> void:
	hud = Control.new()
	hud.set_anchors_preset(Control.PRESET_FULL_RECT)
	hud.mouse_filter = Control.MOUSE_FILTER_IGNORE
	hud.visible = false
	ui.add_child(hud)

	var p1_name := Label.new()
	p1_name.name = "P1Name"
	p1_name.position = Vector2(20, 2)
	hud.add_child(p1_name)

	var p2_name := Label.new()
	p2_name.name = "P2Name"
	p2_name.position = Vector2(VIEW_W - 240, 2)
	p2_name.size = Vector2(220, 20)
	p2_name.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	hud.add_child(p2_name)

	hp_label_p1 = p1_name
	hp_label_p2 = p2_name

	hp_bar_p1 = _make_bar(20, 20, 220, 20, Color(0.15, 0.02, 0.02), Color(0.85, 0.18, 0.18))
	hp_bar_p2 = _make_bar(VIEW_W - 240, 20, 220, 20, Color(0.15, 0.02, 0.02), Color(0.85, 0.18, 0.18))
	charge_bar_p1 = _make_bar(20, 46, 220, 8, Color(0.12, 0.1, 0.02), Color(1.0, 0.82, 0.15))
	charge_bar_p2 = _make_bar(VIEW_W - 240, 46, 220, 8, Color(0.12, 0.1, 0.02), Color(1.0, 0.82, 0.15))

	timer_label = Label.new()
	timer_label.set_anchors_preset(Control.PRESET_TOP_WIDE)
	timer_label.position.y = 8
	timer_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	timer_label.add_theme_font_size_override("font_size", 30)
	hud.add_child(timer_label)

func _process(delta: float) -> void:
	if state_name != "playing":
		return
	var p1: Fighter = fighters[0]
	var p2: Fighter = fighters[1]
	hp_bar_p1.size.x = 220.0 * max(0.0, p1.hp / p1.max_hp)
	var p2_pct: float = max(0.0, p2.hp / p2.max_hp)
	hp_bar_p2.size.x = 220.0 * p2_pct
	hp_bar_p2.position.x = (VIEW_W - 240) + 220.0 * (1.0 - p2_pct)

	var p1_charge_pct: float = p1.charge / p1.max_charge
	charge_bar_p1.size.x = 220.0 * p1_charge_pct
	var p2_charge_pct: float = p2.charge / p2.max_charge
	charge_bar_p2.size.x = 220.0 * p2_charge_pct
	charge_bar_p2.position.x = (VIEW_W - 240) + 220.0 * (1.0 - p2_charge_pct)

	match_time_left = max(0.0, match_time_left - delta)
	timer_label.text = str(int(ceil(match_time_left)))

	if p1.hp <= 0.0 or p2.hp <= 0.0 or match_time_left <= 0.0:
		_end_round()

func _unhandled_input(event: InputEvent) -> void:
	if state_name != "playing":
		return
	if event is InputEventKey and event.pressed and not event.echo:
		for f in fighters:
			if f.controls == null:
				continue
			if event.physical_keycode == f.controls.attack1:
				f.start_attack("attack1")
			elif event.physical_keycode == f.controls.attack2:
				f.start_attack("attack2")
			elif event.physical_keycode == f.controls.special:
				f.try_special()

# -------------------------------------------------------------- overlay ----

func _build_overlay_root() -> void:
	overlay = Control.new()
	overlay.set_anchors_preset(Control.PRESET_FULL_RECT)
	var bg := ColorRect.new()
	bg.color = Color(0.04, 0.04, 0.06, 0.92)
	bg.set_anchors_preset(Control.PRESET_FULL_RECT)
	overlay.add_child(bg)
	ui.add_child(overlay)

func _clear_overlay() -> void:
	for child in overlay.get_children():
		child.queue_free()
	var bg := ColorRect.new()
	bg.color = Color(0.04, 0.04, 0.06, 0.92)
	bg.set_anchors_preset(Control.PRESET_FULL_RECT)
	overlay.add_child(bg)
	overlay.visible = true

func _make_title(text: String, y: float, size: int = 32) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", size)
	l.set_anchors_preset(Control.PRESET_TOP_WIDE)
	l.position.y = y
	l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	overlay.add_child(l)
	return l

func _make_button(text: String, x: float, y: float, w: float = 160.0) -> Button:
	var b := Button.new()
	b.text = text
	b.position = Vector2(x, y)
	b.size = Vector2(w, 44)
	b.add_theme_stylebox_override("normal", _rounded_style(Color(0.85, 0.2, 0.2), 12))
	b.add_theme_stylebox_override("hover", _rounded_style(Color(1.0, 0.33, 0.3), 12))
	b.add_theme_stylebox_override("pressed", _rounded_style(Color(0.6, 0.1, 0.1), 12))
	b.add_theme_stylebox_override("disabled", _rounded_style(Color(0.3, 0.3, 0.32), 12))
	b.add_theme_color_override("font_color", Color(1, 1, 1))
	b.add_theme_color_override("font_hover_color", Color(1, 1, 1))
	b.add_theme_color_override("font_pressed_color", Color(1, 1, 1))
	b.add_theme_font_size_override("font_size", 18)
	overlay.add_child(b)
	return b

# --------------------------------------------------------------- screens ----

func show_title_screen() -> void:
	state_name = "title"
	hud.visible = false
	_clear_overlay()
	_make_title("Ichigo vs Vegeta", 130, 40)
	var sub := _make_title("a very lazy fighting platformer", 185, 18)
	sub.modulate = Color(0.7, 0.7, 0.7)
	var play_btn := _make_button("Play", VIEW_W / 2.0 - 80, 240)
	play_btn.pressed.connect(show_mode_screen)

func show_mode_screen() -> void:
	state_name = "mode"
	_clear_overlay()
	_make_title("Choose Mode", 130, 32)
	var b1 := _make_button("1 v 1", VIEW_W / 2.0 - 170, 210, 150)
	b1.pressed.connect(func(): show_select_screen("1v1"))
	var b2 := _make_button("1 v CPU", VIEW_W / 2.0 + 20, 210, 150)
	b2.pressed.connect(func(): show_select_screen("cpu"))

func show_select_screen(chosen_mode: String) -> void:
	mode = chosen_mode
	state_name = "select"
	_clear_overlay()
	_make_title("Select Fighters", 30, 28)

	var col1_label := "Player 1: choose your fighter"
	var col2_label := ("Player 2: choose your fighter" if mode == "1v1" else "Choose the enemy")

	var l1 := Label.new()
	l1.text = col1_label
	l1.set_anchors_preset(Control.PRESET_TOP_WIDE)
	l1.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	l1.position.y = 68
	overlay.add_child(l1)

	var l2 := Label.new()
	l2.text = col2_label
	l2.set_anchors_preset(Control.PRESET_TOP_WIDE)
	l2.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	l2.position.y = 218
	overlay.add_child(l2)

	var p1_choice := {"key": ""}
	var p2_choice := {"key": ""}
	var p1_buttons := {}
	var p2_buttons := {}

	var fight_btn := _make_button("Fight!", VIEW_W / 2.0 - 80, 372)
	fight_btn.disabled = true

	var try_enable := func():
		fight_btn.disabled = not (p1_choice.key != "" and p2_choice.key != "")

	var n := Characters.DATA.size()
	var spacing := 100.0
	var start_x := VIEW_W / 2.0 - (n * spacing) / 2.0 + (spacing - 96.0) / 2.0

	var i := 0
	for key in Characters.DATA.keys():
		var btn := _make_portrait_button(key, start_x + i * spacing, 96)
		p1_buttons[key] = btn
		btn.pressed.connect(func():
			p1_choice.key = key
			for k in p1_buttons: _mark_card(p1_buttons[k], false)
			_mark_card(btn, true)
			try_enable.call()
		)
		var btn2 := _make_portrait_button(key, start_x + i * spacing, 246)
		p2_buttons[key] = btn2
		btn2.pressed.connect(func():
			p2_choice.key = key
			for k in p2_buttons: _mark_card(p2_buttons[k], false)
			_mark_card(btn2, true)
			try_enable.call()
		)
		i += 1

	fight_btn.pressed.connect(func(): start_game(p1_choice.key, p2_choice.key))

func _make_portrait_button(key: String, x: float, y: float) -> TextureButton:
	var card := Panel.new()
	card.position = Vector2(x - 6, y - 6)
	card.size = Vector2(108, 90)
	card.add_theme_stylebox_override("panel", _rounded_style(Color(0.12, 0.12, 0.14), 10, 2, Color(0.4, 0.4, 0.45)))
	card.name = "card_%s" % key
	overlay.add_child(card)

	var b := TextureButton.new()
	b.texture_normal = load(Characters.portrait_path(key))
	b.stretch_mode = TextureButton.STRETCH_KEEP_ASPECT_CENTERED
	b.position = Vector2(x, y)
	b.size = Vector2(96, 78)
	b.set_meta("card", card)
	overlay.add_child(b)
	var label := Label.new()
	label.text = Characters.DATA[key].name
	label.position = Vector2(x, y + 82)
	label.size = Vector2(96, 20)
	label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	overlay.add_child(label)
	return b

func _mark_card(btn: TextureButton, selected: bool) -> void:
	var card: Panel = btn.get_meta("card")
	if selected:
		card.add_theme_stylebox_override("panel", _rounded_style(Color(0.16, 0.22, 0.14), 10, 3, Color(0.4, 1.0, 0.4)))
	else:
		card.add_theme_stylebox_override("panel", _rounded_style(Color(0.12, 0.12, 0.14), 10, 2, Color(0.4, 0.4, 0.45)))

func start_game(p1_key: String, p2_key: String) -> void:
	for f in fighters:
		f.queue_free()
	fighters.clear()

	var p2_ctrl = P2_CONTROLS if mode == "1v1" else null

	var p1 := FIGHTER_SCENE.instantiate() as Fighter
	add_child(p1)
	p1.position.y = GROUND_Y
	p1.setup(p1_key, 120.0, 1, P1_CONTROLS)

	var p2 := FIGHTER_SCENE.instantiate() as Fighter
	add_child(p2)
	p2.position.y = GROUND_Y
	p2.setup(p2_key, 630.0, -1, p2_ctrl)

	p1.opponent = p2
	p2.opponent = p1
	fighters = [p1, p2]
	match_time_left = MATCH_TIME

	hp_label_p1.text = Characters.DATA[p1_key].name
	hp_label_p2.text = Characters.DATA[p2_key].name

	overlay.visible = false
	hud.visible = true
	state_name = "playing"

func _end_round() -> void:
	state_name = "over"
	winner = fighters[1] if fighters[0].hp <= 0.0 else fighters[0]
	for f in fighters:
		f.frozen = true
	show_game_over_screen()

func show_game_over_screen() -> void:
	_clear_overlay()
	var label_text: String
	if mode == "cpu":
		label_text = "You win!" if winner == fighters[0] else "CPU wins!"
	else:
		label_text = "%s wins!" % Characters.DATA[winner.char_key].name
	_make_title(label_text, 150, 32)
	var again := _make_button("Play Again", VIEW_W / 2.0 - 80, 240)
	again.pressed.connect(show_title_screen)
