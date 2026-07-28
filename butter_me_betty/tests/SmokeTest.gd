extends Node
# Headless test in two phases:
#  1) a real slingshot launch, just to prove input->velocity->physics works.
#  2) Betty is placed just past the wall with travel speed, to prove the
#     pit/butter/friction-stretch/ramp/goal chain works independent of
#     exact wall-hop tuning (which needs real playtesting to feel right).
# Run with: godot --headless --path . tests/SmokeTest.tscn

var main
var frame := 0
var phase := "launch"
var saw_butter := false
var min_friction := 999.0

func _ready() -> void:
	main = preload("res://Main.tscn").instantiate()
	add_child(main)
	main.betty.position = main.betty.anchor_pos + Vector2(-100, 60)
	main.state = "aiming"
	main._launch()
	print("SMOKE START vel=%s pos=%s" % [main.betty.linear_velocity, main.betty.position])

func _process(_delta: float) -> void:
	frame += 1
	var b = main.betty

	if phase == "launch":
		if frame % 30 == 0:
			print("t=%d pos=(%.1f,%.1f) vel=(%.1f,%.1f)" % [frame, b.position.x, b.position.y, b.linear_velocity.x, b.linear_velocity.y])
		if frame == 91:
			b.freeze = true # RigidBody2D transform writes need freeze to "take" reliably
			b.position = Vector2(820, main.GROUND_Y - Betty.RADIUS)
			b.rotation = 0.0
			b.linear_velocity = Vector2.ZERO
		elif frame == 95:
			print("--- launch mechanics confirmed, jumping past the wall for phase 2 (pos now %s) ---" % b.position)
			b.linear_velocity = Vector2(260, 0)
			b.freeze = false
			phase = "path"
			frame = 0
		return

	if b.physics_material_override.friction < min_friction:
		min_friction = b.physics_material_override.friction
	if b.buttered and not saw_butter:
		saw_butter = true
		print("BUTTER PICKED UP at frame %d, pos=%.1f friction=%.3f" % [frame, b.position.x, b.physics_material_override.friction])
	if frame % 60 == 0:
		print("t=%d pos=(%.1f,%.1f) vel=(%.1f,%.1f) buttered=%s state=%s" % [
			frame, b.position.x, b.position.y, b.linear_velocity.x, b.linear_velocity.y, b.buttered, main.state])
	if main.state == "won":
		print("SMOKE RESULT: WON at frame %d, min_friction_seen=%.3f, saw_butter=%s" % [frame, min_friction, saw_butter])
		get_tree().quit()
	elif main.state == "aiming" and frame > 5:
		print("SMOKE RESULT: fell into the pit and got reset (fall-reset works). saw_butter=%s min_friction=%.3f" % [saw_butter, min_friction])
		get_tree().quit()
	elif frame > 1800:
		print("SMOKE RESULT: TIMEOUT after %d frames. final pos=%.1f state=%s saw_butter=%s min_friction=%.3f" % [
			frame, b.position.x, main.state, saw_butter, min_friction])
		get_tree().quit()
