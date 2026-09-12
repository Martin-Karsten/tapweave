package main

import engine_runtime "../runtime"
foreign import probe "../artifacts/abi-c-probe.o"
foreign probe {
	abi_c_probe :: proc "c" () -> i32 ---
}

main :: proc() {
	_ = engine_runtime.oe_abi_control()
	assert(abi_c_probe() == 0)
	assert(engine_runtime.instance_destroy(&engine_runtime.abi_instance) == .OK)
}
