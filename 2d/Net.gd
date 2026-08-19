extends Node

signal hosted(code: String)
signal paired(role: String)
signal peer_left
signal net_error(message: String)
signal message(data: Dictionary)

var peer: WebSocketPeer
var _pending_cmd := {}
var _sent_pending := false
var _closed_emitted := false

func host_lobby(url: String) -> void:
	_start_connection(url, {"cmd": "host"})

func join_lobby(url: String, code: String) -> void:
	_start_connection(url, {"cmd": "join", "code": code})

func send_state(data: Dictionary) -> void:
	data["cmd"] = "msg"
	_send_raw(data)

func _start_connection(url: String, pending: Dictionary) -> void:
	peer = WebSocketPeer.new()
	var err := peer.connect_to_url(url)
	if err != OK:
		net_error.emit("Could not connect to %s" % url)
		peer = null
		return
	_pending_cmd = pending
	_sent_pending = false
	_closed_emitted = false

func _send_raw(d: Dictionary) -> void:
	if peer:
		peer.send_text(JSON.stringify(d))

func _process(_delta: float) -> void:
	if peer == null:
		return
	peer.poll()
	var state := peer.get_ready_state()
	if state == WebSocketPeer.STATE_OPEN:
		if not _sent_pending and not _pending_cmd.is_empty():
			_send_raw(_pending_cmd)
			_sent_pending = true
			_pending_cmd = {}
		while peer.get_available_packet_count() > 0:
			var pkt := peer.get_packet().get_string_from_utf8()
			var parsed = JSON.parse_string(pkt)
			if parsed == null:
				continue
			match parsed.get("cmd"):
				"hosted":
					hosted.emit(parsed["code"])
				"paired":
					paired.emit(parsed["role"])
				"peer_left":
					peer_left.emit()
				"error":
					net_error.emit(parsed.get("message", ""))
				"msg":
					message.emit(parsed)
	elif state == WebSocketPeer.STATE_CLOSED and not _closed_emitted:
		_closed_emitted = true
		net_error.emit("Connection closed")
