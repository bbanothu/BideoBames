extends CanvasLayer

const FADE_TIME := 0.22

var overlay: ColorRect

func _ready() -> void:
	layer = 100
	process_mode = Node.PROCESS_MODE_ALWAYS
	overlay = ColorRect.new()
	overlay.color = Color(0.07, 0.07, 0.08, 1)
	overlay.set_anchors_preset(Control.PRESET_FULL_RECT)
	overlay.mouse_filter = Control.MOUSE_FILTER_IGNORE
	overlay.modulate.a = 0.0
	add_child(overlay)

func goto_scene(path: String) -> void:
	get_tree().paused = false
	var tw := create_tween()
	tw.tween_property(overlay, "modulate:a", 1.0, FADE_TIME).set_ease(Tween.EASE_IN)
	await tw.finished
	get_tree().change_scene_to_file(path)
	await get_tree().process_frame
	var tw2 := create_tween()
	tw2.tween_property(overlay, "modulate:a", 0.0, FADE_TIME).set_ease(Tween.EASE_OUT)

func reload_scene() -> void:
	get_tree().paused = false
	var tw := create_tween()
	tw.tween_property(overlay, "modulate:a", 1.0, FADE_TIME).set_ease(Tween.EASE_IN)
	await tw.finished
	get_tree().reload_current_scene()
	await get_tree().process_frame
	var tw2 := create_tween()
	tw2.tween_property(overlay, "modulate:a", 0.0, FADE_TIME).set_ease(Tween.EASE_OUT)

## Fades + slides a Control in from `from_offset`, e.g. call in a screen's _ready().
## Waits a frame first so any parent Container (CenterContainer etc.) has already
## laid the node out at its real position before we capture it as the settle target.
func animate_in(node: CanvasItem, from_offset: Vector2 = Vector2(0, 26), duration: float = 0.4, delay: float = 0.0) -> void:
	node.modulate.a = 0.0
	await node.get_tree().process_frame
	var base_pos: Vector2 = node.position
	node.position = base_pos + from_offset
	var tw := node.get_tree().create_tween()
	tw.set_parallel(true)
	tw.tween_property(node, "modulate:a", 1.0, duration).set_delay(delay).set_ease(Tween.EASE_OUT)
	tw.tween_property(node, "position", base_pos, duration).set_delay(delay).set_ease(Tween.EASE_OUT).set_trans(Tween.TRANS_CUBIC)

## Simple fade-in (no slide) for overlays like pause/game-over dim panels.
func fade_in(node: CanvasItem, duration: float = 0.2) -> void:
	node.modulate.a = 0.0
	var tw := node.get_tree().create_tween()
	tw.tween_property(node, "modulate:a", 1.0, duration).set_ease(Tween.EASE_OUT)
