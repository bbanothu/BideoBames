extends Control

@onready var server_field: LineEdit = %ServerField
@onready var status_label: Label = %StatusLabel
@onready var code_field: LineEdit = %CodeField
@onready var host_button: Button = %HostButton
@onready var join_button: Button = %JoinButton
@onready var back_button: Button = %BackButton

func _ready() -> void:
	server_field.text = GameState.server_url
	host_button.pressed.connect(_on_host)
	join_button.pressed.connect(_on_join)
	back_button.pressed.connect(_on_back)
	Net.hosted.connect(_on_hosted)
	Net.paired.connect(_on_paired)
	Net.net_error.connect(_on_error)
	Transition.animate_in($Center/VBox)

func _on_host() -> void:
	GameState.server_url = server_field.text.strip_edges()
	status_label.text = "Connecting..."
	Net.host_lobby(GameState.server_url)

func _on_join() -> void:
	GameState.server_url = server_field.text.strip_edges()
	var code := code_field.text.strip_edges().to_upper()
	if code == "":
		status_label.text = "Enter a lobby code"
		return
	status_label.text = "Connecting..."
	Net.join_lobby(GameState.server_url, code)

func _on_hosted(code: String) -> void:
	status_label.text = "Your code: %s\nWaiting for opponent..." % code

func _on_paired(role: String) -> void:
	GameState.is_multiplayer = true
	GameState.is_host = role == "host"
	Transition.goto_scene("res://CharacterSelect.tscn")

func _on_error(msg: String) -> void:
	status_label.text = "Error: %s" % msg

func _on_back() -> void:
	Transition.goto_scene("res://Start.tscn")
