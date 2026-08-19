extends CharacterBody2D

const ACTIONS := ["idle", "running", "jump", "attack_1", "attack_2", "attack_special", "hit", "dead"]
const ONE_SHOT := ["attack_1", "attack_2", "attack_special", "hit", "dead"]
const NO_LOOP := ["attack_1", "attack_2", "attack_special", "hit", "dead", "jump"]
const ANIM_FPS := {
	"idle": 8.0, "running": 16.0, "jump": 14.0,
	"attack_1": 18.0, "attack_2": 18.0, "attack_special": 16.0,
	"hit": 14.0, "dead": 10.0,
}

@export var character_name := "StickFigure"

@onready var anim: AnimatedSprite2D = $AnimatedSprite2D

func _ready() -> void:
	anim.sprite_frames = load_character_frames(character_name)
	anim.play("idle")

static func load_character_frames(char_name: String) -> SpriteFrames:
	var frames := SpriteFrames.new()
	var base_dir := "res://characters/%s" % char_name
	for action in ACTIONS:
		frames.add_animation(action)
		frames.set_animation_speed(action, ANIM_FPS.get(action, 12.0))
		frames.set_animation_loop(action, not NO_LOOP.has(action))
		var action_dir := "%s/%s" % [base_dir, action]
		var count := _count_pngs(action_dir)
		for i in range(1, count + 1):
			frames.add_frame(action, load("%s/%d.png" % [action_dir, i]))
	return frames

static func _count_pngs(dir_path: String) -> int:
	var dir := DirAccess.open(dir_path)
	if dir == null:
		return 0
	var n := 0
	dir.list_dir_begin()
	var file_name := dir.get_next()
	while file_name != "":
		if file_name.ends_with(".png"):
			n += 1
		file_name = dir.get_next()
	dir.list_dir_end()
	return n
