extends Node

const CHARACTERS_DIR := "res://characters"
const MAPS_DIR := "res://real_maps"

var selected_character := "StickFigure"
var selected_map := ""

var is_multiplayer := false
var is_host := false
var server_url := "ws://127.0.0.1:9080"

func list_characters() -> Array[String]:
	var names: Array[String] = []
	var dir := DirAccess.open(CHARACTERS_DIR)
	if dir == null:
		return names
	dir.list_dir_begin()
	var entry := dir.get_next()
	while entry != "":
		if dir.current_is_dir() and not entry.begins_with("."):
			names.append(entry)
		entry = dir.get_next()
	dir.list_dir_end()
	names.sort()
	return names

func list_maps() -> Array[String]:
	var names: Array[String] = []
	var dir := DirAccess.open(MAPS_DIR)
	if dir == null:
		return names
	dir.list_dir_begin()
	var entry := dir.get_next()
	while entry != "":
		if not dir.current_is_dir() and entry.ends_with(".png"):
			names.append(entry)
		entry = dir.get_next()
	dir.list_dir_end()
	names.sort()
	return names
