extends Node2D

const WORLD_LEFT := -300.0
const WORLD_RIGHT := 4300.0
const WORLD_HEIGHT := 720.0

func _ready() -> void:
	var map_name: String = GameState.selected_map
	if map_name == "":
		return
	var tex: Texture2D = load("res://real_maps/%s" % map_name)
	if tex == null:
		return
	var scale_factor: float = WORLD_HEIGHT / tex.get_height()
	var tile_w: float = tex.get_width() * scale_factor
	var x := WORLD_LEFT
	while x < WORLD_RIGHT:
		var spr := Sprite2D.new()
		spr.texture = tex
		spr.centered = false
		spr.position = Vector2(x, 0)
		spr.scale = Vector2(scale_factor, scale_factor)
		add_child(spr)
		x += tile_w
