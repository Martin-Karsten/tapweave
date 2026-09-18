// Type surface of generate_demo.mjs for tests/*.ts (the script itself is
// plain .mjs consumed by prepare_assets.mjs). Keep in sync with the script's
// exports.
export declare const DEMO_OSU_FILENAME: string;
export declare const DEMO_MUSIC_FILENAME: string;
export declare const DEMO_ARCHIVE_FILENAME: string;
export declare const DEMO_MAP_TITLE: string;
export declare const DEMO_MAP_ARTIST: string;
export declare const DEMO_MAP_CREATOR: string;
export declare const DEMO_MAP_VERSION: string;
export declare function generate_demo_parts(): {
  osu_text: string;
  music_bytes: Uint8Array<ArrayBuffer>;
  osz_bytes: Uint8Array<ArrayBuffer>;
};
