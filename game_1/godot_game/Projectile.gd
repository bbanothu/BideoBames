extends Node2D

var velocity_x: float = 0.0
var damage: float = 25.0
var target: Fighter = null
var owner_fighter: Fighter = null
var _hit := false

@onready var sprite: Sprite2D = $Sprite2D

func setup(tex: Texture2D) -> void:
	sprite.texture = tex
	sprite.scale = Vector2(1.6, 1.6)

func _process(delta: float) -> void:
	position.x += velocity_x * delta
	rotation += 10.0 * delta * sign(velocity_x)

	if not _hit and target != null and target.hp > 0.0:
		if abs(position.x - target.position.x) < 45.0 and abs(position.y - (target.position.y - 50.0)) < 70.0:
			_hit = true
			target.hp = max(0.0, target.hp - damage)
			target.apply_hitstun(owner_fighter)
			queue_free()
			return

	if position.x < -60.0 or position.x > 860.0:
		queue_free()
