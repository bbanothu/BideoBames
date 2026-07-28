extends Node
# Autoload singleton: character roster + animation frame builder.
# Reuses the same chroma-keyed PNG frames extracted for the web version.

const DATA = {
	"ichigo": {
		"name": "Ichigo",
		"dir": "ichigo",
		"counts": {"idle": 4, "walk": 8, "jump": 1, "attack1": 6, "attack2": 7, "hitstun": 4, "charge": 10},
		"scale": 2.0,
	},
	"vegeta": {
		"name": "Vegeta",
		"dir": "vegeta",
		"counts": {"idle": 4, "walk": 4, "jump": 6, "attack1": 8, "attack2": 12, "hitstun": 13, "charge": 6},
		"scale": 2.0,
	},
}

const ANIM_FPS = {
	"idle": 6.67, "walk": 12.5, "jump": 6.0,
	"attack1": 16.67, "attack2": 20.0,
	"hitstun": 10.0, "charge": 8.0,
}
const LOOPING_ANIMS = ["idle", "walk", "jump", "charge"]

var _cache: Dictionary = {}

func build_sprite_frames(key: String) -> SpriteFrames:
	if _cache.has(key):
		return _cache[key]
	var data: Dictionary = DATA[key]
	var sf := SpriteFrames.new()
	sf.remove_animation("default")
	for anim in data.counts.keys():
		var count: int = data.counts[anim]
		sf.add_animation(anim)
		sf.set_animation_speed(anim, ANIM_FPS[anim])
		sf.set_animation_loop(anim, LOOPING_ANIMS.has(anim))
		for i in range(count):
			var path := "res://sprites/frames/%s/%s/%s_%d.png" % [data.dir, anim, anim, i]
			sf.add_frame(anim, load(path))
	_cache[key] = sf
	return sf

func portrait_path(key: String) -> String:
	return "res://sprites/frames/%s/portrait/portrait_0.png" % DATA[key].dir

func projectile_texture(key: String) -> Texture2D:
	return load("res://sprites/frames/%s/projectile/projectile_0.png" % DATA[key].dir)
