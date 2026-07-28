extends CharacterBody2D
class_name Fighter

const MOVE_SPEED := 250.0
const JUMP_SPEED := -750.0
const GRAVITY := 2000.0
const ATTACK_RANGE := 45.0
const HITBOX_W := 50.0
const HITBOX_H := 100.0

const LIGHT_DAMAGE := 10.0 # attack1 (Q/,)
const HEAVY_DAMAGE := 15.0 # attack2 (E/.) -- also causes hitstun+knockback
const SPECIAL_DAMAGE := 25.0 # charged ranged special

const KNOCKBACK_SPEED := 350.0
const KNOCKBACK_POP := -200.0
const KNOCKBACK_FRICTION := 800.0

const CHARGE_RATE := 40.0 # per second; 0 -> 100 in 2.5s
const SPECIAL_CAST_TIME := 0.35
const PROJECTILE_SPEED := 420.0

const PROJECTILE_SCENE := preload("res://Projectile.tscn")

@onready var sprite: AnimatedSprite2D = $AnimatedSprite2D
@onready var collision: CollisionShape2D = $CollisionShape2D

var char_key: String = ""
var char_name: String = ""
var controls = null # Dictionary of KEY_* per action, or null for CPU
var facing: int = 1
var state: String = "idle"
var attacking: String = "" # "attack1" | "attack2" | "special" | ""
var hit_done: bool = false
var hp: float = 100.0
var max_hp: float = 100.0
var charge: float = 0.0
var max_charge: float = 100.0
var charging: bool = false
var in_hitstun: bool = false
var special_timer: float = 0.0
var cpu_cooldown: float = 0.6
var opponent: Fighter = null
var frozen: bool = false # true once a round has ended

func setup(key: String, x: float, start_facing: int, ctrl) -> void:
	char_key = key
	char_name = Characters.DATA[key].name
	position.x = x
	facing = start_facing
	controls = ctrl
	hp = 100.0
	max_hp = 100.0
	charge = 0.0
	charging = false
	in_hitstun = false
	attacking = ""
	frozen = false
	sprite.sprite_frames = Characters.build_sprite_frames(key)
	var s: float = Characters.DATA[key].scale
	sprite.scale = Vector2(s, s)
	collision.shape = RectangleShape2D.new()
	collision.shape.size = Vector2(HITBOX_W, HITBOX_H)
	collision.position = Vector2(0, -HITBOX_H / 2.0)
	_change_state("idle")
	_apply_facing()

func is_cpu() -> bool:
	return controls == null

func start_attack(anim: String) -> void:
	if attacking != "" or in_hitstun or charging:
		return
	attacking = anim
	hit_done = false
	_change_state(anim)

func try_special() -> void:
	if attacking != "" or in_hitstun or charging or charge < max_charge:
		return
	attacking = "special"
	charge = 0.0
	special_timer = SPECIAL_CAST_TIME
	state = "charge"
	sprite.animation = "charge"
	sprite.frame = sprite.sprite_frames.get_frame_count("charge") - 1
	sprite.stop()
	_update_sprite_offset()

func apply_hitstun(attacker: Fighter) -> void:
	if frozen or hp <= 0.0:
		return
	attacking = ""
	charging = false
	var dir := 1 if position.x >= attacker.position.x else -1
	facing = -dir
	_apply_facing()
	velocity.x = KNOCKBACK_SPEED * dir
	velocity.y = KNOCKBACK_POP
	in_hitstun = true
	_change_state("hitstun")

func _change_state(new_state: String) -> void:
	state = new_state
	sprite.animation = new_state
	sprite.frame = 0
	sprite.play()
	_update_sprite_offset()

func _update_sprite_offset() -> void:
	# frames are pre-cropped per-animation with the character bottom-aligned in
	# the source PNG; re-center vertically each frame so feet stay pinned to y=0
	# even though frame texture size differs across animations/characters.
	var tex := sprite.sprite_frames.get_frame_texture(sprite.animation, sprite.frame)
	if tex:
		sprite.offset = Vector2(0, -tex.get_height() / 2.0)

func _apply_facing() -> void:
	sprite.flip_h = facing < 0

func _fire_projectile() -> void:
	var proj = PROJECTILE_SCENE.instantiate()
	get_parent().add_child(proj)
	proj.global_position = Vector2(position.x + facing * 40.0, position.y - 60.0)
	proj.velocity_x = PROJECTILE_SPEED * facing
	proj.damage = SPECIAL_DAMAGE
	proj.target = opponent
	proj.owner_fighter = self
	proj.setup(Characters.projectile_texture(char_key))

func _physics_process(delta: float) -> void:
	if frozen or opponent == null:
		return

	if in_hitstun:
		velocity.x = move_toward(velocity.x, 0.0, KNOCKBACK_FRICTION * delta)
		velocity.y += GRAVITY * delta
		move_and_slide()
		return

	if attacking == "special":
		special_timer -= delta
		velocity.y += GRAVITY * delta
		move_and_slide()
		if special_timer <= 0.0:
			attacking = ""
			_fire_projectile()
		return

	var moving := false

	if is_cpu():
		cpu_cooldown -= delta
		var dist: float = opponent.position.x - position.x
		if abs(dist) > ATTACK_RANGE:
			velocity.x = sign(dist) * MOVE_SPEED
			moving = true
		else:
			velocity.x = 0.0
			if attacking == "" and cpu_cooldown <= 0.0:
				start_attack("attack1" if randf() < 0.5 else "attack2")
				cpu_cooldown = 0.6 + randf() * 0.7
	else:
		velocity.x = 0.0
		if Input.is_physical_key_pressed(controls.charge) and attacking == "" and is_on_floor():
			charging = true
			charge = min(max_charge, charge + CHARGE_RATE * delta)
			if state != "charge":
				_change_state("charge")
		else:
			if charging:
				charging = false
			if Input.is_physical_key_pressed(controls.left):
				velocity.x = -MOVE_SPEED
				moving = true
			elif Input.is_physical_key_pressed(controls.right):
				velocity.x = MOVE_SPEED
				moving = true
			if Input.is_physical_key_pressed(controls.up) and is_on_floor():
				velocity.y = JUMP_SPEED

	if moving:
		facing = 1 if velocity.x > 0.0 else -1
		_apply_facing()

	velocity.y += GRAVITY * delta
	move_and_slide()

	if attacking == "" and not charging:
		var new_state := "jump" if not is_on_floor() else ("walk" if moving else "idle")
		if new_state != state:
			_change_state(new_state)

	if attacking != "" and attacking != "special" and not hit_done:
		if abs(position.x - opponent.position.x) < HITBOX_W:
			var dmg := HEAVY_DAMAGE if attacking == "attack2" else LIGHT_DAMAGE
			opponent.hp = max(0.0, opponent.hp - dmg)
			hit_done = true
			if attacking == "attack2":
				opponent.apply_hitstun(self)

func _on_sprite_animation_finished() -> void:
	if sprite.animation == "hitstun":
		in_hitstun = false
	elif attacking != "" and attacking != "special" and sprite.animation == attacking:
		attacking = ""
