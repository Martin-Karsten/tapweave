/* Production gameplay conformance, shared expected bytes with the WASM reader. */
static const char gameplay_map_text[] =
    "osu file format v14\n[Difficulty]\nHPDrainRate:0\nOverallDifficulty:5\n"
    "SliderMultiplier:1\nSliderTickRate:1\n[TimingPoints]\n0,1000\n[HitObjects]\n"
    "64,64,1000,1,0\n100,100,2000,2,0,L|200:100,1,100\n"
    "256,192,4000,8,0,6000\n320,192,7000,1,0\n";
static uint32_t gameplay_native_probe(unsigned char *result_bytes) {
    unsigned char *mailbox = (unsigned char *)oe_abi_control();
    oe_handle *handle_output = (oe_handle *)(mailbox + 256);
    oe_byte_span *span_output = (oe_byte_span *)(mailbox + 256);
    oe_error_v1 *error_output = (oe_error_v1 *)(mailbox + 320);
    oe_engine_create_v1 *engine_creation = (oe_engine_create_v1 *)mailbox;
    *engine_creation = (oe_engine_create_v1){1,1,sizeof(*engine_creation),1,0};
    assert(oe_engine_create(engine_creation,handle_output,error_output)==0);
    oe_handle engine_handle = *handle_output;
    assert(oe_buffer_reserve(engine_handle,1,sizeof(gameplay_map_text)-1,span_output)==0);
    memcpy((void *)(uintptr_t)span_output->address,gameplay_map_text,sizeof(gameplay_map_text)-1);
    uint64_t input_token = span_output->token;
    oe_map_prepare_v1 *map_creation = (oe_map_prepare_v1 *)mailbox;
    *map_creation = (oe_map_prepare_v1){2,1,sizeof(*map_creation),input_token,0,sizeof(gameplay_map_text)-1,2,0};
    assert(oe_map_prepare(engine_handle,map_creation,handle_output,error_output)==0);
    oe_handle map_handle = *handle_output;
    oe_gameplay_create_v1 *session_creation = (oe_gameplay_create_v1 *)mailbox;
    *session_creation = (oe_gameplay_create_v1){18,1,sizeof(*session_creation),2,0,65536,0,64,0};
    assert(oe_session_create(engine_handle,map_handle,(void *)session_creation,handle_output,error_output)==0);
    oe_handle session_handle = *handle_output;
    assert(oe_map_release(engine_handle,map_handle)==0);
    oe_input_snapshot_v1 frames[28] = {
        {23,1,64,1,1000,1000,64,64,1,0,0,0},
        {23,1,64,2,1500,1500,64,64,0,0,0,0},
        {23,1,64,3,2000,2000,100,100,1,0,0,0},
        {23,1,64,4,2900,2900,190,100,1,0,0,0},
        {23,1,64,5,3200,3200,190,100,0,0,0,0},
    };
    const double positions[4][2]={{356,192},{256,292},{156,192},{256,92}};
    for (uint32_t frame_index=0;frame_index<21;frame_index++) {
        double time_ms=4000+frame_index*50;
        frames[5+frame_index]=(oe_input_snapshot_v1){23,1,64,6+frame_index,time_ms,time_ms,positions[frame_index%4][0],positions[frame_index%4][1],1,0,0,0};
    }
    frames[26]=(oe_input_snapshot_v1){23,1,64,27,6500,6500,320,192,0,0,0,0};
    frames[27]=(oe_input_snapshot_v1){23,1,64,28,7000,7000,320,192,1,0,0,0};
    assert(oe_buffer_reserve(engine_handle,1,sizeof(frames),span_output)==0);
    memcpy((void *)(uintptr_t)span_output->address,frames,sizeof(frames));
    assert(oe_session_inputs_from_reserved(engine_handle,session_handle,span_output->token,28,(uintptr_t)error_output)==0);
    assert(oe_session_advance(engine_handle,session_handle,8000,(uintptr_t)span_output)==0);
    const oe_session_snapshot_v1 *snapshot = (const void *)(uintptr_t)span_output->address;
    assert(snapshot->state==3 && snapshot->score==1000050 && snapshot->judgements_count==18);
    assert(oe_session_result(engine_handle,session_handle,(uintptr_t)span_output)==0);
    uint32_t byte_count = span_output->count;
    memcpy(result_bytes,(void *)(uintptr_t)span_output->address,byte_count);
    assert(oe_session_release(engine_handle,session_handle)==0);
    assert(oe_engine_release(engine_handle)==0);
    return byte_count;
}
