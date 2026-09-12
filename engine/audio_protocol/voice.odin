package audio_protocol

import core_types "../core_types"

Command_Kind :: enum u32 { ONE_SHOT = 1, LOOP_START, LOOP_STOP, PARAMETER_RAMP }
Late_Policy :: enum u32 { IMMEDIATE = 1, DROP }
Command :: struct {
	sequence: u64,
	epoch: u32,
	command_kind: Command_Kind,
	time_ms: f64,
	voice_id, asset_id: u64,
	volume, pan, rate, duration_ms, lateness_threshold_ms: f64,
	parameter_mask: u32,
	late_policy: Late_Policy,
	object_id, component_id, flags: u32,
}

valid_command :: proc(command: Command) -> bool {
	return command.sequence > 0 && command.epoch > 0 && command.voice_id > 0 &&
		command.command_kind >= .ONE_SHOT && command.command_kind <= .PARAMETER_RAMP &&
		command.late_policy >= .IMMEDIATE && command.late_policy <= .DROP && command.flags <= 1 &&
		(command.asset_id == 0) == (command.flags == 1) && command.parameter_mask & ~u32(7) == 0 &&
		core_types.finite(command.time_ms) && core_types.finite(command.volume) && command.volume >= 0 && command.volume <= 1 &&
		core_types.finite(command.pan) && command.pan >= -1 && command.pan <= 1 &&
		core_types.finite(command.rate) && command.rate > 0 &&
		core_types.finite(command.duration_ms) && command.duration_ms >= 0 &&
		core_types.finite(command.lateness_threshold_ms) && command.lateness_threshold_ms >= 0 &&
		(command.command_kind == .PARAMETER_RAMP ? command.parameter_mask != 0 : command.parameter_mask == 0 && command.duration_ms == 0)
}

one_shot_command :: proc(event: Event) -> Command {
	return {sequence = event.sequence, epoch = event.epoch, command_kind = .ONE_SHOT,
		time_ms = event.time_ms, voice_id = event.sequence, asset_id = event.asset_id,
		volume = event.volume, pan = 0, rate = 1, late_policy = .IMMEDIATE,
		object_id = event.object_id, component_id = event.component_id, flags = event.missing ? 1 : 0}
}
