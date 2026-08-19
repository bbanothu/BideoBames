extends Node2D

@onready var pause_menu: CanvasLayer = $PauseMenu
@onready var game_over_menu: CanvasLayer = $GameOverMenu
@onready var player: CharacterBody2D = $Player
@onready var opponent: CharacterBody2D = $Opponent

var game_over := false

func _ready() -> void:
	pause_menu.visible = false
	game_over_menu.visible = false
	%ResumeButton.pressed.connect(_on_resume)
	%QuitMenuButton.pressed.connect(_on_quit_menu)
	%QuitGameButton.pressed.connect(_on_quit_game)
	%RematchButton.pressed.connect(_on_rematch)
	%GameOverQuitButton.pressed.connect(_on_quit_menu)

	player.character_died.connect(_on_character_died.bind(player))
	opponent.character_died.connect(_on_character_died.bind(opponent))

func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("ui_cancel") and not game_over:
		_toggle_pause()

func _toggle_pause() -> void:
	get_tree().paused = not get_tree().paused
	pause_menu.visible = get_tree().paused
	if pause_menu.visible:
		Transition.fade_in(pause_menu.get_node("Dim"))
		Transition.animate_in(pause_menu.get_node("Center/VBox"), Vector2(0, -16), 0.25)

func _on_resume() -> void:
	_toggle_pause()

func _on_character_died(who: CharacterBody2D) -> void:
	if game_over:
		return
	game_over = true
	var lost := who == player
	%GameOverTitle.text = "You Lose" if lost else "You Win!"
	%GameOverTitle.add_theme_color_override(
		"font_color", Color(0.9, 0.25, 0.25, 1) if lost else Color(1.0, 0.85, 0.2, 1)
	)
	game_over_menu.visible = true
	Transition.fade_in(game_over_menu.get_node("Dim"), 0.3)
	Transition.animate_in(game_over_menu.get_node("Center/VBox"), Vector2(0, 24), 0.4)
	get_tree().paused = true

func _on_rematch() -> void:
	Transition.reload_scene()

func _on_quit_menu() -> void:
	GameState.is_multiplayer = false
	Transition.goto_scene("res://Start.tscn")

func _on_quit_game() -> void:
	get_tree().quit()
