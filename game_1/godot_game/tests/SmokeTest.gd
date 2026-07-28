extends Node
# Headless smoke test covering: CPU vs CPU combat, heavy-attack hitstun +
# knockback, and the charge -> special projectile flow.
# Run with: godot --headless --path . tests/SmokeTest.tscn

var main
var frame := 0
var phase := "combat"

func _ready() -> void:
	main = preload("res://Main.tscn").instantiate()
	add_child(main)
	main.show_select_screen("cpu")
	main.start_game("ichigo", "vegeta")
	main.fighters[0].controls = null # both sides CPU-driven for phase 1
	main.fighters[1].controls = null
	print("SMOKE START p1hp=%s p2hp=%s p1x=%.1f p2x=%.1f" % [
		main.fighters[0].hp, main.fighters[1].hp,
		main.fighters[0].position.x, main.fighters[1].position.x])

func _process(_delta: float) -> void:
	frame += 1
	var p1 = main.fighters[0]
	var p2 = main.fighters[1]

	if phase == "combat":
		if frame % 60 == 0:
			print("t=%d p1hp=%s p2hp=%s p1state=%s p2state=%s" % [frame, p1.hp, p2.hp, p1.state, p2.state])
		if p1.in_hitstun or p2.in_hitstun:
			var victim = p1 if p1.in_hitstun else p2
			print("HITSTUN CONFIRMED on %s, vx=%.1f (nonzero = knockback applied)" % [victim.char_key, victim.velocity.x])
			phase = "hitstun_check"
			frame = 0
		elif main.state_name == "over":
			print("SMOKE RESULT (combat): winner=%s at frame %d" % [main.winner.char_key, frame])
			_start_charge_phase()
		elif frame > 1500:
			print("SMOKE (combat): no hitstun/KO seen after %d frames, moving on" % frame)
			_start_charge_phase()

	elif phase == "hitstun_check":
		if frame > 30:
			print("post-hitstun p1x=%.1f p2x=%.1f (should have slid then stopped)" % [p1.position.x, p2.position.x])
			_start_charge_phase()

	elif phase == "charge":
		# manually drive p1's charge meter to simulate holding P, bypassing real input
		p1.charge = min(p1.max_charge, p1.charge + Fighter.CHARGE_RATE * (1.0 / 60.0))
		if frame % 30 == 0:
			print("charging t=%d p1.charge=%.1f" % [frame, p1.charge])
		if p1.charge >= p1.max_charge:
			print("CHARGE FULL, firing special")
			p1.try_special()
			phase = "special"
			frame = 0

	elif phase == "special":
		if frame % 10 == 0:
			var proj_count = 0
			for child in main.get_children():
				if child.get_script() != null and child.get_script().resource_path.ends_with("Projectile.gd"):
					proj_count += 1
			print("t=%d p1.attacking=%s p2.hp=%s projectiles=%d" % [frame, p1.attacking, p2.hp, proj_count])
		if frame > 180:
			print("SMOKE RESULT (special): final p2.hp=%s (should be < 100 if projectile connected)" % p2.hp)
			get_tree().quit()

func _start_charge_phase() -> void:
	phase = "charge"
	frame = 0
	# freeze both to dummy (non-CPU, unreachable keys) control so only this
	# script drives them from here on -- isolates the charge/special mechanic
	var dummy_controls = {"left": KEY_F24, "right": KEY_F24, "up": KEY_F24, "attack1": KEY_F24, "attack2": KEY_F24, "charge": KEY_F24, "special": KEY_F24}
	main.fighters[0].controls = dummy_controls
	main.fighters[1].controls = dummy_controls
	main.fighters[0].frozen = false
	main.fighters[1].frozen = false
	main.state_name = "playing"
	main.match_time_left = main.MATCH_TIME
	main.fighters[0].hp = 100.0
	main.fighters[1].hp = 100.0
	main.fighters[0].position.x = 300.0
	main.fighters[1].position.x = 600.0
	main.fighters[0].in_hitstun = false
	main.fighters[1].in_hitstun = false
	main.fighters[0].attacking = ""
	main.fighters[1].attacking = ""
	print("--- starting charge/special phase ---")
