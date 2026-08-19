extends Control

@onready var grid: GridContainer = %CharacterGrid
@onready var fight_button: Button = %FightButton
@onready var selected_label: Label = %SelectedLabel

var chosen := ""
var cards := {}  # name -> {"glow": Panel, "icon": TextureRect}

func _ready() -> void:
	fight_button.disabled = true
	fight_button.pressed.connect(_on_fight)
	%BackButton.pressed.connect(_on_back)

	Transition.animate_in($Center/VBox)

	var i := 0
	for char_name in GameState.list_characters():
		var preview_path := "res://characters/%s/idle/1.png" % char_name
		var tex: Texture2D = load(preview_path) if ResourceLoader.exists(preview_path) else null
		var card := _make_card(char_name, tex)
		grid.add_child(card)
		card.modulate.a = 0.0
		var tw := create_tween()
		tw.tween_property(card, "modulate:a", 1.0, 0.3).set_delay(0.1 + i * 0.06).set_ease(Tween.EASE_OUT)
		i += 1

	if cards.size() > 0:
		var first_name: String = cards.keys()[0]
		_on_pick(first_name)
	else:
		selected_label.text = "No characters found in res://characters/"

func _make_card(char_name: String, tex: Texture2D) -> Control:
	var card := Button.new()
	card.custom_minimum_size = Vector2(150, 190)
	card.focus_mode = Control.FOCUS_NONE
	var empty := StyleBoxEmpty.new()
	card.add_theme_stylebox_override("normal", empty)
	card.add_theme_stylebox_override("hover", empty)
	card.add_theme_stylebox_override("pressed", empty)
	card.add_theme_stylebox_override("focus", empty)

	var glow := Panel.new()
	glow.set_anchors_preset(Control.PRESET_FULL_RECT)
	var glow_style := StyleBoxFlat.new()
	glow_style.bg_color = Color(1.0, 0.85, 0.35, 0.16)
	glow_style.border_color = Color(1.0, 0.85, 0.35, 0.85)
	glow_style.set_border_width_all(2)
	glow_style.set_corner_radius_all(14)
	glow.add_theme_stylebox_override("panel", glow_style)
	glow.visible = false
	glow.mouse_filter = Control.MOUSE_FILTER_IGNORE
	card.add_child(glow)

	var vbox := VBoxContainer.new()
	vbox.set_anchors_preset(Control.PRESET_FULL_RECT)
	vbox.mouse_filter = Control.MOUSE_FILTER_IGNORE
	vbox.alignment = BoxContainer.ALIGNMENT_CENTER
	vbox.add_theme_constant_override("separation", 10)
	card.add_child(vbox)

	var icon := TextureRect.new()
	icon.texture = tex
	icon.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	icon.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	icon.custom_minimum_size = Vector2(120, 130)
	icon.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	vbox.add_child(icon)

	var label := Label.new()
	label.text = char_name
	label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	label.add_theme_font_size_override("font_size", 16)
	label.add_theme_color_override("font_color", Color(0.15, 0.15, 0.16, 1))
	vbox.add_child(label)

	card.pressed.connect(_on_pick.bind(char_name))
	card.mouse_entered.connect(_on_hover.bind(char_name, true))
	card.mouse_exited.connect(_on_hover.bind(char_name, false))

	cards[char_name] = {"glow": glow, "icon": icon}
	return card

func _on_hover(char_name: String, entering: bool) -> void:
	if char_name == chosen:
		return
	var icon: TextureRect = cards[char_name]["icon"]
	icon.modulate = Color(1.1, 1.1, 1.1, 1) if entering else Color(1, 1, 1, 1)

func _on_pick(char_name: String) -> void:
	chosen = char_name
	selected_label.text = "Selected: %s" % char_name
	fight_button.disabled = false
	for n in cards:
		cards[n]["glow"].visible = n == char_name
		cards[n]["icon"].modulate = Color(1, 1, 1, 1)

func _on_fight() -> void:
	GameState.selected_character = chosen
	Transition.goto_scene("res://MapSelect.tscn")

func _on_back() -> void:
	Transition.goto_scene("res://Start.tscn")
