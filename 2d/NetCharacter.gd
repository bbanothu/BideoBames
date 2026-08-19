extends "res://Character.gd"

const SPEED = 340.0
const ACCEL = 2400.0  # velocity ramp rate, for a less robotic start/stop
const JUMP_VELOCITY = -820.0
const GRAVITY = 1300.0

const MAX_HEALTH = 100.0
const MAX_STAMINA = 100.0
const STAMINA_REGEN = 25.0  # per second
const ATTACK_STAMINA_COST := {"attack_1": 20.0, "attack_2": 25.0, "attack_special": 35.0}
const ATTACK_DAMAGE := {"attack_1": 10.0, "attack_2": 14.0, "attack_special": 25.0}
const HIT_RANGE := 100.0
const KNOCKBACK_FORCE := 420.0
const KNOCKBACK_DECAY := 1800.0
const NET_SEND_EVERY = 3  # physics frames between state broadcasts

signal character_died

@export var slot := "A"  # "A" = Player node's spawn/role, "B" = Opponent node's

@onready var health_bar: ProgressBar = %HealthBar
@onready var stamina_bar: ProgressBar = %StaminaBar
@onready var health_value: Label = %HealthValue
@onready var stamina_value: Label = %StaminaValue
@onready var opponent_health_bar: ProgressBar = %OpponentHealthBar
@onready var camera: Camera2D = $Camera2D

var mode := "local"  # "local" | "remote" | "idle_ai"
var attacking := false
var health := MAX_HEALTH
var stamina := MAX_STAMINA
var knockback_velocity := 0.0
var _prev_keys := {}
var _net_frame := 0
var _hit_this_swing := false

func _key_down(key: Key) -> bool:
	# check both logical and physical keycode so keyboard layout/remapping
	# quirks on either side can't silently drop a plain key press
	return Input.is_key_pressed(key) or Input.is_physical_key_pressed(key)

func _just_pressed(key: Key) -> bool:
	var now := _key_down(key)
	var was: bool = _prev_keys.get(key, false)
	_prev_keys[key] = now
	return now and not was

func _move_axis() -> float:
	var left := _key_down(KEY_LEFT) or _key_down(KEY_A)
	var right := _key_down(KEY_RIGHT) or _key_down(KEY_D)
	if left == right:
		return 0.0
	return -1.0 if left else 1.0

func _ready() -> void:
	character_name = GameState.selected_character
	super._ready()

	if GameState.is_multiplayer:
		var this_is_host_slot := slot == "A"
		mode = "local" if this_is_host_slot == GameState.is_host else "remote"
	else:
		mode = "local" if slot == "A" else "idle_ai"

	camera.enabled = mode == "local"
	anim.animation_finished.connect(_on_animation_finished)

	if mode == "idle_ai":
		anim.flip_h = true
		opponent_health_bar.max_value = MAX_HEALTH
		opponent_health_bar.value = MAX_HEALTH
		return

	health_bar.max_value = MAX_HEALTH
	stamina_bar.max_value = MAX_STAMINA
	_update_bars()

	if mode == "remote":
		anim.flip_h = slot == "A"  # remote character faces the local player
		opponent_health_bar.max_value = MAX_HEALTH
		opponent_health_bar.value = MAX_HEALTH
		Net.message.connect(_on_net_message)
		set_physics_process(false)
	elif mode == "local" and GameState.is_multiplayer:
		Net.message.connect(_on_net_message)

func _get_opponent() -> Node:
	var other_name := "Opponent" if name == "Player" else "Player"
	return get_parent().get_node_or_null(other_name)

func _update_bars() -> void:
	health_bar.value = health
	stamina_bar.value = stamina
	health_value.text = "%d / %d" % [roundi(health), int(MAX_HEALTH)]
	stamina_value.text = "%d / %d" % [roundi(stamina), int(MAX_STAMINA)]

func _on_animation_finished() -> void:
	if anim.animation == "dead" and health <= 0.0:
		return  # stay defeated
	if ONE_SHOT.has(anim.animation):
		attacking = false

func start_attack(action: String) -> void:
	var cost: float = ATTACK_STAMINA_COST.get(action, 0.0)
	if cost > stamina:
		return
	stamina -= cost
	_update_bars()
	attacking = true
	_hit_this_swing = false
	anim.play(action)

func take_damage(amount: float, knockback_dir: float = 1.0) -> void:
	if health <= 0.0:
		return
	health = max(0.0, health - amount)
	attacking = true
	_hit_this_swing = false
	anim.play("dead" if health <= 0.0 else "hit")

	if mode == "local":
		knockback_velocity = knockback_dir * KNOCKBACK_FORCE
		_update_bars()
	elif mode == "idle_ai":
		global_position.x += knockback_dir * 60.0
		opponent_health_bar.value = health
	else:
		opponent_health_bar.value = health

	if health <= 0.0:
		character_died.emit()

func _on_net_message(data: Dictionary) -> void:
	var kind: String = data.get("kind", "state")
	if kind == "hit" and mode == "local":
		take_damage(data.get("dmg", 0.0), data.get("dir", 1.0))
		return
	if kind != "state" or mode != "remote":
		return
	global_position = Vector2(data.get("x", global_position.x), data.get("y", global_position.y))
	anim.flip_h = data.get("flip_h", anim.flip_h)
	if data.has("health"):
		opponent_health_bar.value = data["health"]
	var remote_anim: String = data.get("anim", "idle")
	if anim.animation != remote_anim:
		anim.play(remote_anim)

func _check_hit() -> void:
	if _hit_this_swing or not ATTACK_DAMAGE.has(anim.animation):
		return
	var opp = _get_opponent()
	if opp == null:
		return
	var dx: float = opp.global_position.x - global_position.x
	var facing_right := not anim.flip_h
	var facing_opponent := (facing_right and dx > 0) or (not facing_right and dx < 0)
	if not facing_opponent or absf(dx) > HIT_RANGE:
		return
	_hit_this_swing = true
	var dmg: float = ATTACK_DAMAGE[anim.animation]
	var push_dir: float = signf(dx) if dx != 0.0 else 1.0
	if GameState.is_multiplayer and opp.mode == "remote":
		Net.send_state({"kind": "hit", "dmg": dmg, "dir": push_dir})
	elif opp.has_method("take_damage"):
		opp.take_damage(dmg, push_dir)

func _physics_process(delta: float) -> void:
	if mode != "local":
		return

	stamina = min(MAX_STAMINA, stamina + STAMINA_REGEN * delta)
	_update_bars()

	if not is_on_floor():
		velocity.y += GRAVITY * delta
	else:
		velocity.y = 0.0

	var jump_pressed := _just_pressed(KEY_SPACE) or _just_pressed(KEY_UP) or _just_pressed(KEY_W)
	if jump_pressed and is_on_floor() and not attacking:
		velocity.y = JUMP_VELOCITY

	if not attacking and is_on_floor():
		if _just_pressed(KEY_J):
			start_attack("attack_1")
		elif _just_pressed(KEY_K):
			start_attack("attack_2")
		elif _just_pressed(KEY_L):
			start_attack("attack_special")
		elif _just_pressed(KEY_H):
			start_attack("hit")
		elif _just_pressed(KEY_G):
			start_attack("dead")

	var dir := _move_axis()
	if not attacking:
		if dir != 0:
			anim.flip_h = dir < 0
		velocity.x = move_toward(velocity.x, dir * SPEED, ACCEL * delta)
	elif anim.animation == "hit" or anim.animation == "dead":
		velocity.x = knockback_velocity
		knockback_velocity = move_toward(knockback_velocity, 0.0, KNOCKBACK_DECAY * delta)
	else:
		velocity.x = 0.0
		_check_hit()

	move_and_slide()

	if attacking:
		pass
	elif not is_on_floor():
		if anim.animation != "jump":
			anim.play("jump")
	elif dir != 0:
		if anim.animation != "running":
			anim.play("running")
	else:
		if anim.animation != "idle":
			anim.play("idle")

	if GameState.is_multiplayer:
		_net_frame += 1
		if _net_frame >= NET_SEND_EVERY:
			_net_frame = 0
			Net.send_state({
				"kind": "state",
				"x": global_position.x, "y": global_position.y,
				"flip_h": anim.flip_h, "anim": anim.animation, "health": health,
			})
