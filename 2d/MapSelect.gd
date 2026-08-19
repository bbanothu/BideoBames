extends Control

@onready var bg: TextureRect = %MapBackground
@onready var name_label: Label = %MapNameLabel
@onready var prev_button: Button = %PrevButton
@onready var next_button: Button = %NextButton
@onready var fight_button: Button = %FightButton

var maps: Array[String] = []
var index := 0

func _ready() -> void:
	maps = GameState.list_maps()
	prev_button.pressed.connect(func(): _step(-1))
	next_button.pressed.connect(func(): _step(1))
	fight_button.pressed.connect(_on_fight)
	%BackButton.pressed.connect(_on_back)

	Transition.animate_in($TitleGlass, Vector2(0, -20))
	Transition.animate_in($BottomDock, Vector2(0, 30), 0.4, 0.08)

	if maps.is_empty():
		name_label.text = "No maps found in res://real_maps/"
		fight_button.disabled = true
		prev_button.disabled = true
		next_button.disabled = true
		return

	_show(0, false)

func _step(delta: int) -> void:
	_show((index + delta + maps.size()) % maps.size())

func _show(i: int, animate: bool = true) -> void:
	index = i
	var map_name: String = maps[index]
	var tex: Texture2D = load("res://real_maps/%s" % map_name)
	if not animate:
		bg.texture = tex
		name_label.text = map_name.get_basename().capitalize()
		return
	var tw := create_tween()
	tw.tween_property(bg, "modulate:a", 0.0, 0.15)
	tw.tween_callback(func():
		bg.texture = tex
		name_label.text = map_name.get_basename().capitalize()
	)
	tw.tween_property(bg, "modulate:a", 1.0, 0.2)

func _on_fight() -> void:
	GameState.selected_map = maps[index]
	Transition.goto_scene("res://Main.tscn")

func _on_back() -> void:
	Transition.goto_scene("res://CharacterSelect.tscn")
