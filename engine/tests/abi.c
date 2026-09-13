/* Native C consumer of the generated ABI; matches the WASM lifecycle assertions. */
#include "../abi/engine.h"
#include <stdio.h>
#include <assert.h>
#include <string.h>
#include "gameplay_abi.h"
#include "presentation_abi.h"
int main(void) {
    unsigned char *base=(unsigned char *)oe_abi_control();
    oe_handle *handle_output=(oe_handle *)(base+256);
    oe_error_v1 *error=(oe_error_v1 *)(base+320);
    oe_byte_span *span=(oe_byte_span *)(base+256);
    unsigned statuses[15], status_count=0;
    statuses[status_count++]=oe_engine_create(NULL,handle_output,error);
    uint32_t error_record[16]; memcpy(error_record,error,64);
    oe_engine_create_v1 *create=(oe_engine_create_v1 *)base;
    *create=(oe_engine_create_v1){1,1,sizeof(*create),1,0};
    statuses[status_count++]=oe_engine_create(create,handle_output,error);
    oe_handle engine=*handle_output;
    statuses[status_count++]=oe_engine_capabilities(engine,span);
    uint32_t capabilities[16]; memcpy(capabilities,(void *)(uintptr_t)span->address,64);
    const char text[]="osu file format v14\n[HitObjects]\n0,0,0,1,0";
    statuses[status_count++]=oe_buffer_reserve(engine,1,sizeof(text)-1,span);
    memcpy((void *)(uintptr_t)span->address,text,sizeof(text)-1);
    uint64_t token=span->token;
    oe_map_prepare_v1 *prepare=(oe_map_prepare_v1 *)base;
    *prepare=(oe_map_prepare_v1){2,1,sizeof(*prepare),token,0,sizeof(text)-1,1,0};
    statuses[status_count++]=oe_map_prepare(engine,prepare,handle_output,error);
    oe_handle map=*handle_output;
    oe_session_create_v1 *session_create=(oe_session_create_v1 *)base;
    *session_create=(oe_session_create_v1){3,1,sizeof(*session_create),1,0,128,0};
    statuses[status_count++]=oe_session_create(engine,map,session_create,handle_output,error);
    oe_handle session=*handle_output;
    statuses[status_count++]=oe_map_release(engine,map);
    statuses[status_count++]=oe_map_release(engine,map);
    statuses[status_count++]=oe_session_reset(engine,session,-500);
    statuses[status_count++]=oe_session_advance(engine,session,0,0);
    statuses[status_count++]=oe_session_release(engine,session);
    statuses[status_count++]=oe_session_release(engine,session);
    statuses[status_count++]=oe_engine_release(engine);
    statuses[status_count++]=oe_engine_release(engine);
    statuses[status_count++]=oe_session_reset(engine,session,0);
    /* M1 is an explicit, separately discoverable preparation capability. */
    *create=(oe_engine_create_v1){1,1,sizeof(*create),1,0};
    assert(oe_engine_create(create,handle_output,error)==0);engine=*handle_output;
    assert(oe_preparation_capabilities(engine,span)==0);
    const oe_preparation_capabilities_v1 *preparation_capabilities=(const void *)(uintptr_t)span->address;
    assert(preparation_capabilities->preparation_version==2);
    assert(oe_buffer_reserve(engine,1,sizeof(text)-1,span)==0);
    memcpy((void *)(uintptr_t)span->address,text,sizeof(text)-1);token=span->token;
    *prepare=(oe_map_prepare_v1){2,1,sizeof(*prepare),token,0,sizeof(text)-1,2,0};
    assert(oe_map_prepare(engine,prepare,handle_output,error)==0);map=*handle_output;
    assert(oe_map_describe(engine,map,span)==0);
    const unsigned char *prepared_bytes=(const void *)(uintptr_t)span->address;
    const oe_prepared_descriptor_v1 *description=(const void *)prepared_bytes;
    assert(description->type==8 && description->version==1 && description->objects_count==1);
    assert(description->objects_stride==sizeof(oe_prepared_object_v1));
    assert(description->total_bytes==span->count);
    assert(description->format_version==14 && description->playback_count==1);
    assert(description->playback_stride==sizeof(oe_prepared_playback_v1));
    const oe_prepared_playback_v1 *playback=(const void *)(prepared_bytes+description->playback_offset);
    assert(playback->sample_volume==100 && playback->preview_time==-1);
    const oe_prepared_object_v1 *object=(const void *)(prepared_bytes+description->objects_offset);
    assert(object->id==0 && object->kind==1 && object->time_ms==0 && object->samples_count==1);
    *session_create=(oe_session_create_v1){3,1,sizeof(*session_create),1,0,128,0};
    assert(oe_session_create(engine,map,session_create,handle_output,error)==0);session=*handle_output;
    assert(oe_map_release(engine,map)==0);
    assert(oe_session_reset(engine,session,0)==0);
    assert(object->kind==1 && object->samples_count==1);
    assert(oe_session_release(engine,session)==0);
    assert(oe_engine_release(engine)==0);
    unsigned char gameplay_result[2048];
    uint32_t gameplay_byte_count=gameplay_native_probe(gameplay_result);
    presentation_native_probe();
    unsigned char draw_bytes[2048];
    uint32_t draw_byte_count = draw_native_probe(draw_bytes);
    unsigned char scene_bytes[65536];
    unsigned char resource_bytes[262144];
    uint32_t resource_byte_count = 0;
    uint32_t scene_byte_count = scene_native_probe(scene_bytes, resource_bytes, &resource_byte_count);
    printf("{\"capabilities\":[");
    for(unsigned value_index=0;value_index<16;value_index++)printf("%s%u",value_index?",":"",capabilities[value_index]);
    printf("],\"statuses\":[");
    for(unsigned value_index=0;value_index<status_count;value_index++)printf("%s%u",value_index?",":"",statuses[value_index]);
    printf("],\"error\":[");
    for(unsigned value_index=0;value_index<16;value_index++)printf("%s%u",value_index?",":"",error_record[value_index]);
    printf("],\"gameplay\":[");
    for(uint32_t byte_index=0;byte_index<gameplay_byte_count;byte_index++)printf("%s%u",byte_index?",":"",gameplay_result[byte_index]);
    printf("],\"circle_draw\":[");
    for (uint32_t byte_index = 0; byte_index < draw_byte_count; byte_index++) printf("%s%u", byte_index ? "," : "", draw_bytes[byte_index]);
    printf("],\"scene_draw\":[");
    for (uint32_t byte_index = 0; byte_index < scene_byte_count; byte_index++) printf("%s%u", byte_index ? "," : "", scene_bytes[byte_index]);
    printf("],\"scene_resources\":[");
    for (uint32_t byte_index = 0; byte_index < resource_byte_count; byte_index++) printf("%s%u", byte_index ? "," : "", resource_bytes[byte_index]);
    puts("]}");
    return 0;
}
