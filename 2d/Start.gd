extends Control

func _ready() -> void:
	%StartButton.pressed.connect(_on_start)
	%MultiplayerButton.pressed.connect(_on_multiplayer)
	%QuitButton.pressed.connect(_on_quit)
	%StartButton.grab_focus()
	Transition.animate_in($Center/VBox)

func _on_start() -> void:
	GameState.is_multiplayer = false
	Transition.goto_scene("res://CharacterSelect.tscn")

func _on_multiplayer() -> void:
	Transition.goto_scene("res://Lobby.tscn")

func _on_quit() -> void:
	get_tree().quit()
