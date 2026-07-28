extends Area2D

func _ready() -> void:
	body_entered.connect(_on_body_entered)
	var shape := RectangleShape2D.new()
	shape.size = Vector2(34, 22)
	$CollisionShape2D.shape = shape

func _on_body_entered(body: Node) -> void:
	if body is Betty:
		body.apply_butter()
		queue_free()
