# Firmware Agent Prompt — BLE Configuration Protocol

## Purpose

This document is a prompt for the firmware agent. The web app connects to the ESP32 via BLE and expects a JSON-based configuration protocol. The firmware MUST implement the behavior below so the web UI can progress past "Waiting for device setup info…".

## BLE Identifiers

- Service UUID: `6e400001-b5a3-f393-e0a9-e50e24dcca9e`
- RX Characteristic (write): `6e400002-b5a3-f393-e0a9-e50e24dcca9e`
- TX Characteristic (notify): `6e400003-b5a3-f393-e0a9-e50e24dcca9e`
- Device name prefix: `ESP32-LoRaCfg`

## Protocol Requirements (critical)

1. Respond to the `info` command by sending a `setup_info` JSON event on the TX characteristic. Without this response the web app will remain stuck on the loading screen.
2. Commands are newline-terminated ASCII strings received on RX. Parse them exactly and reply with the appropriate JSON events on TX.

## Commands to implement

- `info` — send current `setup_info` event (see below).
- `set <key> <value>` — update a named configuration field; reply with `{"evt":"ok"}` on success or `{"evt":"unknown_cmd"}` / error JSON on failure.
- `device <device_type>` — change device type and confirm with `ok` or updated `setup_info`.
- `save` — persist configuration to NVS (or equivalent) and send `{"evt":"cfg_saved"}`.
- `init` — initialise the LoRa radio; on success send `{"evt":"radio_ready"}`, on failure send `{"evt":"radio_err","code":<code>}`.
- `reboot` — perform a device restart.
- `bt off` — disable Bluetooth and (optionally) send a confirmation event.

## JSON Events to Send (examples)

1. First boot notification:

```
{"evt":"first_boot"}
```

2. Normal boot notification:

```
{"evt":"boot"}
```

3. Critical: `setup_info` (response to `info` command). Must include current values from persistent storage.

Example:

```
{
  "evt": "setup_info",
  "device": "heltec",
  "fields": [
    {"k":"freq","v":868.0,"unit":"MHz","min":137.0,"max":1020.0},
    {"k":"bw","v":125.0,"unit":"kHz","opts":"7.8|10.4|15.6|20.8|31.25|41.7|62.5|125|250|500"},
    {"k":"sf","v":9,"min":6,"max":12},
    {"k":"cr","v":7,"opts":"5|6|7|8"},
    {"k":"pwr","v":22,"unit":"dBm","min":2,"max":22},
    {"k":"sw","v":"0x12","type":"hex"},
    {"k":"sclk","v":18,"type":"pin"},
    {"k":"miso","v":19,"type":"pin"},
    {"k":"mosi","v":27,"type":"pin"},
    {"k":"nss","v":5,"type":"pin"},
    {"k":"rst","v":14,"type":"pin"},
    {"k":"dio0","v":26,"type":"pin"},
    {"k":"dio1","v":35,"type":"pin"}
  ],
  "cmds": "info|set|device|save|init|reboot"
}
```

4. Config saved:

```
{"evt":"cfg_saved"}
```

5. Radio init success / failure:

```
{"evt":"radio_ready"}
```

or

```
{"evt":"radio_err","code":-701}
```

6. Mesh started:

```
{"evt":"mesh_started","nodeId":12345}
```

7. Defaults applied:

```
{"evt":"defaults_applied"}
```

## Implementation notes

- The web UI reassembles fragmented JSON; but the firmware should still attempt to send complete JSON messages when possible. Support splitting if messages exceed MTU.
- All JSON must be valid. Avoid trailing commas and ensure strings use double quotes.
- Use persistent storage to fill `setup_info` with actual saved values.
- Field semantics:
  - `type: "pin"` — integer 0–39
  - `type: "hex"` — hex string `0x00`–`0xFF`
  - `opts` — pipe-separated string (eg. `5|6|7|8`)

## Priority

CRITICAL: Implement the `info` → `setup_info` response first. Without it the web UI remains on "Waiting for device setup info…" and cannot continue.

## Testing tips

- Use the included `bluetooth-test.html` or the web app to connect and send `info`.
- Inspect TX notifications and ensure a valid `setup_info` JSON is received.

If you need example firmware code (ESP-IDF or Arduino) to parse newline-terminated commands on a NUS-like RX characteristic and notify JSON on TX, ask and we will provide a minimal reference implementation.
