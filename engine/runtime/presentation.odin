package engine_runtime

import "base:runtime"
import core_types "../core_types"
import presentation "../presentation"

ABI_TRANSFORM_OUTPUT_OFFSET :: 672

// Independent coordinate capability; this does not advertise object rendering.
@(export)
oe_playfield_transform :: proc "c" (engine: core_types.Handle, viewport_address, span_output: uintptr) -> u32 {
	context = runtime.default_context()
	_, status := engine_get(&abi_instance, engine)
	if status != .OK {
		return abi_status(status)
	}
	if span_output != abi_base() + ABI_OUTPUT_OFFSET {
		return abi_status(.INVALID_ARGUMENT)
	}
	status = abi_record(viewport_address, ABI_VIEWPORT_KIND, ABI_VIEWPORT_SIZE)
	if status != .OK {
		return abi_status(status)
	}
	input_bytes := abi_storage.bytes[:ABI_INPUT_SIZE]
	transform, valid := presentation.make_playfield_transform({
		css_left = get_f64(input_bytes, ABI_VIEWPORT_CSS_LEFT_OFFSET),
		css_top = get_f64(input_bytes, ABI_VIEWPORT_CSS_TOP_OFFSET),
		css_width = get_f64(input_bytes, ABI_VIEWPORT_CSS_WIDTH_OFFSET),
		css_height = get_f64(input_bytes, ABI_VIEWPORT_CSS_HEIGHT_OFFSET),
		device_pixel_ratio = get_f64(input_bytes, ABI_VIEWPORT_DEVICE_PIXEL_RATIO_OFFSET),
	})
	if !valid {
		return abi_status(.INVALID_ARGUMENT)
	}
	bytes := abi_storage.bytes[ABI_TRANSFORM_OUTPUT_OFFSET:ABI_TRANSFORM_OUTPUT_OFFSET + ABI_PLAYFIELD_TRANSFORM_SIZE]
	put_header(bytes, ABI_PLAYFIELD_TRANSFORM_KIND, ABI_PLAYFIELD_TRANSFORM_SIZE)
	put_f64(bytes, ABI_PLAYFIELD_TRANSFORM_SCALE_OFFSET, transform.scale)
	put_f64(bytes, ABI_PLAYFIELD_TRANSFORM_CLIENT_LEFT_OFFSET, transform.client_left)
	put_f64(bytes, ABI_PLAYFIELD_TRANSFORM_CLIENT_TOP_OFFSET, transform.client_top)
	put_f64(bytes, ABI_PLAYFIELD_TRANSFORM_INVERSE_A_OFFSET, transform.inverse[0])
	put_f64(bytes, ABI_PLAYFIELD_TRANSFORM_INVERSE_B_OFFSET, transform.inverse[1])
	put_f64(bytes, ABI_PLAYFIELD_TRANSFORM_INVERSE_C_OFFSET, transform.inverse[2])
	put_f64(bytes, ABI_PLAYFIELD_TRANSFORM_INVERSE_D_OFFSET, transform.inverse[3])
	put_f64(bytes, ABI_PLAYFIELD_TRANSFORM_INVERSE_E_OFFSET, transform.inverse[4])
	put_f64(bytes, ABI_PLAYFIELD_TRANSFORM_INVERSE_F_OFFSET, transform.inverse[5])
	abi_span(abi_base() + ABI_TRANSFORM_OUTPUT_OFFSET, ABI_PLAYFIELD_TRANSFORM_SIZE)
	return abi_status(.OK)
}
