extends RigidBody2D
class_name Betty

const NORMAL_FRICTION := 1.0
const BUTTERED_FRICTION := 0.008
const BUTTER_DURATION := 6.0
const RADIUS := 42.0

@onready var sprite: AnimatedSprite2D = $AnimatedSprite2D

var buttered: bool = false
var butter_timer: float = 0.0
var anchor_pos: Vector2

# ramp lift: set once by Main after instancing. ramp_x1 <= ramp_x0 means "no
# ramp configured" and the lift is skipped.
var ramp_x0: float = 0.0
var ramp_x1: float = 0.0
var ramp_rise: float = 0.0
var ramp_ground_y: float = 0.0
var _ramp_prev_vel_x = null

var facing: int = 1

# loop-the-loop: driven entirely by script (see enter_loop / _integrate_forces)
# for the same reason the ramp is -- a real circular CollisionPolygon2D would
# give a fast RigidBody2D circle a bad contact normal constantly, and can't
# hold a ball to the inside of a loop through the upside-down section anyway
# without cheating the physics regardless. So we just cheat it directly.
var in_loop: bool = false
var loop_center: Vector2
var loop_radius: float = 0.0
var loop_speed: float = 0.0
var loop_dir: float = 1.0
var loop_theta: float = 0.0
var loop_cooldown: int = 0 # physics frames; blocks immediate re-trigger on exit,
# since the exit point sits right on top of the same trigger area she entered through
var loop_progress: float = 0.0

func _ready() -> void:
	var mat := PhysicsMaterial.new()
	mat.friction = NORMAL_FRICTION
	mat.bounce = 0.1
	physics_material_override = mat

	var shape := CircleShape2D.new()
	shape.radius = RADIUS
	$CollisionShape2D.shape = shape

	sprite.sprite_frames = _build_sprite_frames()
	sprite.play("idle")

	anchor_pos = position
	freeze = true

func _build_sprite_frames() -> SpriteFrames:
	# PLACEHOLDER animations built from the only run-cycle frames we have
	# (betty_0/1/2, all nearly the same pose). Swap in real idle and
	# launched/tumbling art here once it exists -- this is just enough
	# structure that "idle" and "launched" are already distinct states to
	# drop new frames into, rather than a single static sprite.
	var sf := SpriteFrames.new()
	sf.remove_animation("default")

	sf.add_animation("idle")
	sf.set_animation_speed("idle", 3.0)
	sf.set_animation_loop("idle", true)
	for i in range(3):
		sf.add_frame("idle", load("res://sprites/frames/betty_%d.png" % i))

	sf.add_animation("launched")
	sf.set_animation_speed("launched", 1.0)
	sf.set_animation_loop("launched", true)
	sf.add_frame("launched", load("res://sprites/frames/betty_0.png"))

	return sf

func apply_butter() -> void:
	# called every frame the butter stick (or a level pickup) touches her, so
	# only kick her speed up on the moment she actually becomes buttered --
	# not on every repeated re-touch while she's already slick, or dragging
	# the stick across her for a second would compound into a runaway speed.
	var was_already_buttered := buttered
	buttered = true
	butter_timer = BUTTER_DURATION
	physics_material_override.friction = BUTTERED_FRICTION
	sprite.modulate = Color(1.35, 1.15, 0.55)
	if not was_already_buttered and not freeze and linear_velocity.length() > 1.0:
		linear_velocity *= 1.2

func reset_to_anchor(new_anchor = null) -> void:
	if new_anchor != null:
		anchor_pos = new_anchor
	freeze = true
	position = anchor_pos
	rotation = 0.0
	linear_velocity = Vector2.ZERO
	angular_velocity = 0.0
	buttered = false
	butter_timer = 0.0
	in_loop = false
	physics_material_override.friction = NORMAL_FRICTION
	sprite.modulate = Color(1, 1, 1)
	# always face right (toward the level) when parked and ready to aim
	facing = 1
	sprite.flip_h = false
	sprite.play("idle")

func on_launched(direction: int) -> void:
	# facing is set ONCE here, not every frame during flight -- she's a
	# rolling/tumbling body, and rotation already conveys her spin. Flipping
	# the sprite on top of that every frame based on velocity was fighting
	# the rotation and was the actual cause of her looking like she faced the
	# wrong way; a rolling ball doesn't need a separate "facing" flip.
	facing = direction
	sprite.flip_h = direction < 0
	sprite.play("launched")

func enter_loop(center: Vector2, _nominal_radius: float) -> void:
	if in_loop or freeze or loop_cooldown > 0:
		return
	loop_center = center
	# derive the radius from her actual entry position rather than trusting
	# the nominal design radius -- if she enters the trigger zone a little
	# off from the exact bottom point (very likely, since triggers detect
	# circle-vs-rect overlap, not an exact point), snapping her onto a circle
	# of the WRONG radius creates an instant, large position discontinuity.
	# The velocity-from-position-delta calc in _integrate_forces then reads
	# that snap as a huge spurious velocity -- which was the actual cause of
	# the wild spin-out on entry.
	loop_radius = (position - center).length()
	loop_speed = max(abs(linear_velocity.x), 220.0)
	loop_dir = 1.0 if linear_velocity.x >= 0.0 else -1.0
	loop_theta = (position - center).angle()
	loop_progress = 0.0
	in_loop = true

func _process(delta: float) -> void:
	if loop_cooldown > 0:
		loop_cooldown -= 1
	if buttered:
		butter_timer -= delta
		if butter_timer <= 0.0:
			buttered = false
			physics_material_override.friction = NORMAL_FRICTION
			sprite.modulate = Color(1, 1, 1)

func _integrate_forces(phys_state: PhysicsDirectBodyState2D) -> void:
	if in_loop:
		var dtheta: float = -loop_dir * (loop_speed / loop_radius) * phys_state.step
		loop_theta += dtheta
		loop_progress += abs(dtheta)
		var new_pos: Vector2 = loop_center + Vector2(cos(loop_theta), sin(loop_theta)) * loop_radius
		var new_rot: float = phys_state.transform.get_rotation() - dtheta
		phys_state.transform = Transform2D(new_rot, new_pos)
		# analytic derivative of the circle parametrization, NOT a numeric
		# (new_pos - old_pos)/step -- the numeric version inherits whatever
		# old_pos the physics engine handed us that step, which occasionally
		# didn't match where we'd actually left her the frame before (likely
		# the engine's own collision resolution nudging her against the
		# platform ground nearby), producing a huge one-frame spurious
		# velocity. This formula's magnitude is always exactly loop_speed,
		# constant, by construction -- nothing else can corrupt it.
		phys_state.linear_velocity = loop_dir * loop_speed * Vector2(sin(loop_theta), -cos(loop_theta))
		if loop_progress >= TAU:
			in_loop = false
			loop_cooldown = 30 # exit point sits on the entry trigger; don't immediately re-fire
			phys_state.linear_velocity = Vector2(loop_dir * loop_speed, 0.0)
			phys_state.angular_velocity = 0.0
		return

	# A smooth sloped/stepped CollisionPolygon2D gave this fast-rolling circle
	# a bad contact normal right at the geometry's vertex (a well-known 2D
	# physics "internal edge" artifact) -- she'd bounce backward as if hitting
	# a wall instead of riding up. Lifting her manually here, via the state
	# object _integrate_forces hands you, is the textbook-correct way to
	# override a RigidBody2D's motion -- unlike poking .position from
	# _physics_process, which fights the engine's own integration for that
	# step and produces exactly the kind of stuck/jittery motion that was
	# happening before this was moved here.
	if ramp_x1 <= ramp_x0:
		_ramp_prev_vel_x = null
		return
	var leading_x: float = phys_state.transform.origin.x + RADIUS * 1.5
	if leading_x < ramp_x0 or phys_state.transform.origin.x > ramp_x1 + RADIUS:
		_ramp_prev_vel_x = null
		return

	var t: float = clamp((leading_x - ramp_x0) / (ramp_x1 - ramp_x0), 0.0, 1.0)
	var surface_y: float = ramp_ground_y - ramp_rise * t
	var target_y: float = surface_y - RADIUS - 8.0 # small clearance buffer

	var origin: Vector2 = phys_state.transform.origin
	if origin.y > target_y:
		origin.y = target_y
		phys_state.transform.origin = origin
		if phys_state.linear_velocity.y > 0.0:
			var v: Vector2 = phys_state.linear_velocity
			v.y = 0.0
			phys_state.linear_velocity = v

	# guard against a spurious contact-normal bounce reversing her horizontal
	# momentum while she's being lifted
	if _ramp_prev_vel_x != null and phys_state.linear_velocity.x < _ramp_prev_vel_x - 40.0:
		var v2: Vector2 = phys_state.linear_velocity
		v2.x = _ramp_prev_vel_x
		phys_state.linear_velocity = v2
	_ramp_prev_vel_x = phys_state.linear_velocity.x
